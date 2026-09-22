using System.Text.Json;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed class WsRuntimeCoordinator : BackgroundService
{
    readonly ICommandCenter _cc;
    readonly WsHub _ws;
    readonly LayoutRuntime _runtime;
    readonly SignalAutomationEngine _signalAutomation;
    readonly IWebHostEnvironment _env;
    readonly ILogger<WsRuntimeCoordinator> _log;
    volatile bool _connected;
    volatile bool _connectionChanged;
    readonly Queue<int> _locoSync=new();

    public WsRuntimeCoordinator(
        ICommandCenter cc,
        WsHub ws,
        LayoutRuntime runtime,
        SignalAutomationEngine signalAutomation,
        IWebHostEnvironment env,
        ILogger<WsRuntimeCoordinator> log)
    {
        _cc=cc;
        _ws=ws;
        _runtime=runtime;
        _signalAutomation=signalAutomation;
        _env=env;
        _log=log;

        _connected=cc.Connected;
        cc.ConnectionChanged+=OnConnectionChanged;
        cc.SensorFeedbackChanged+=OnSensorFeedbackChanged;
    }

    void OnConnectionChanged(bool connected)
    {
        _connected=connected;
        _connectionChanged=true;
    }

    void OnSensorFeedbackChanged(int address,bool on)
    {
        if(address is <=0 or >65535)
            return;

        _runtime.SetSensor((ushort)address,on);

        _log.LogInformation(
            "Sensor feedback: {Address} = {State}",
            address,
            on ? 1 : 0);

        // Explicitly schedule automation evaluation from authoritative physical
        // sensor feedback. LayoutRuntime.Changed also triggers evaluation, but
        // keeping this direct path guarantees sensor-driven signal/level-crossing
        // automation cannot be lost if another runtime consumer changes later.
        _ = _signalAutomation.EvaluateAsync();
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var nextCurrent=DateTimeOffset.MinValue;
        var nextStatus=DateTimeOffset.MinValue;
        var nextLoco=DateTimeOffset.MinValue;

        if(_connected)
            await ConnectedAsync(ct);

        while(!ct.IsCancellationRequested)
        {
            if(_connectionChanged)
            {
                _connectionChanged=false;

                if(_connected)
                    await ConnectedAsync(ct);
                else
                {
                    _locoSync.Clear();
                    nextCurrent=DateTimeOffset.MinValue;
                }
            }

            var now=DateTimeOffset.UtcNow;

            if(_cc.Connected && _locoSync.Count>0 && now>=nextLoco)
            {
                var address=_locoSync.Peek();

                if(await _cc.RequestLocoAsync(address,ct))
                    _locoSync.Dequeue();

                nextLoco=now.AddMilliseconds(25);
            }

            if(_cc.Connected && _ws.ClientCount>0 && now>=nextCurrent)
            {
                await _cc.RequestCurrentTelemetryAsync(ct);
                nextCurrent=now.AddSeconds(1);
            }

            if(_ws.ClientCount>0 && now>=nextStatus)
            {
                await _ws.BroadcastStatus();
                nextStatus=now.AddSeconds(1);
            }

            await Task.Delay(20,ct);
        }
    }

    async Task ConnectedAsync(CancellationToken ct)
    {
        await _cc.RequestTrackConfigurationAsync(ct);
        await _cc.RequestTripTelemetryAsync(ct);
        await _cc.RequestSensorSnapshotAsync(ct);

        LoadConfiguredLocos();

        _log.LogInformation(
            "Command center bootstrap: track/trip/sensor snapshot requested, {Count} loco state request(s) queued",
            _locoSync.Count);
    }

    void LoadConfiguredLocos()
    {
        _locoSync.Clear();

        var path=Path.Combine(
            _env.ContentRootPath,
            "data",
            "config",
            "locos.json");

        if(!File.Exists(path))
            return;

        try
        {
            using var doc=JsonDocument.Parse(
                File.ReadAllText(path));

            if(doc.RootElement.ValueKind!=JsonValueKind.Array)
                return;

            var seen=new HashSet<int>();

            foreach(var item in doc.RootElement.EnumerateArray())
            {
                if(!item.TryGetProperty("address",out var a) ||
                   !a.TryGetInt32(out var address) ||
                   address is <1 or >10239 ||
                   !seen.Add(address))
                    continue;

                _locoSync.Enqueue(address);

                if(_locoSync.Count>=32)
                    break;
            }
        }
        catch(Exception ex)
        {
            _log.LogWarning(
                ex,
                "Loco state sync: invalid locos.json");
        }
    }
}
