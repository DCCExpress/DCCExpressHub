using System.Text.Json;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed class WsRuntimeCoordinator : BackgroundService
{
    readonly ICommandCenter _cc;
    readonly WsHub _ws;
    readonly LayoutRuntime _runtime;
    readonly SignalAutomationEngine _signalAutomation;
    readonly AppPaths _env;
    readonly ILogger<WsRuntimeCoordinator> _log;
    volatile bool _connected;
    volatile bool _connectionChanged;
    readonly Queue<int> _locoSync=new();
    readonly Queue<(int Address,int Function)> _startupFunctions=new();
    bool _startupFunctionsApplied;

    public WsRuntimeCoordinator(
        ICommandCenter cc,
        WsHub ws,
        LayoutRuntime runtime,
        SignalAutomationEngine signalAutomation,
        AppPaths env,
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
        cc.AccessoryFeedbackChanged+=OnAccessoryFeedbackChanged;
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

        // This is the single authoritative sensor input path on Windows.
        // Q/q, simulated input or any future sensor adapter ends here.
        _runtime.SetSensor(
            (ushort)address,
            on);

        _log.LogInformation(
            "Sensor {Address} = {State}",
            address,
            on ? 1 : 0);
    }

    void OnAccessoryFeedbackChanged(int address,bool active)
    {
        if(address is <=0 or >65535)
            return;

        if(!_runtime.SetAccessory(
               (ushort)address,
               active))
            return;

        _log.LogInformation(
            "Accessory {Address} = {State}",
            address,
            active ? 1 : 0);
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var nextCurrent=DateTimeOffset.MinValue;
        var nextStatus=DateTimeOffset.MinValue;
        var nextLoco=DateTimeOffset.MinValue;
        var nextStartupFunction=DateTimeOffset.MinValue;

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
                    _startupFunctions.Clear();
                    _startupFunctionsApplied=false;
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

            if(
                _cc.Connected &&
                !_startupFunctionsApplied &&
                _locoSync.Count==0 &&
                now>=nextStartupFunction)
            {
                if(_startupFunctions.Count==0)
                {
                    _startupFunctionsApplied=true;

                    _log.LogInformation(
                        "Startup locomotive functions applied");
                }
                else
                {
                    var item=
                        _startupFunctions.Peek();

                    if(await _cc.SetLocoFunctionAsync(
                        item.Address,
                        item.Function,
                        true,
                        ct))
                    {
                        _startupFunctions.Dequeue();

                        _log.LogInformation(
                            "Startup locomotive function ON: loco #{Address} F{Function}",
                            item.Address,
                            item.Function);

                        // Refresh the authoritative locomotive mask after the
                        // startup command so every connected UI gets the same
                        // state from normal command-center feedback.
                        await _cc.RequestLocoAsync(
                            item.Address,
                            ct);

                        nextStartupFunction=
                            now.AddMilliseconds(25);
                    }
                    else
                    {
                        // Do not hammer a temporarily unavailable command
                        // station. Keep the same item queued and retry later.
                        nextStartupFunction=
                            now.AddMilliseconds(500);
                    }
                }
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

        // Re-apply the safe/current automation result immediately after the
        // command center becomes writable. The engine may have evaluated while
        // the TCP connection was still offline.
        await _signalAutomation.EvaluateAsync();

        // Then replace unknown sensor states from DCC-EX. Every returned Q/q
        // enters LayoutRuntime.SetSensor(), which triggers another evaluation.
        await _cc.RequestSensorSnapshotAsync(ct);

        LoadConfiguredLocos();

        // Re-apply configured startup functions on every successful
        // command-center connection, including reconnects.
        _startupFunctionsApplied=false;
        LoadStartupFunctions();

        _log.LogInformation(
            "Command center bootstrap: automation evaluated, sensor snapshot requested, {Count} loco state request(s) and {StartupCount} startup function(s) queued",
            _locoSync.Count,
            _startupFunctions.Count);
    }

    void LoadStartupFunctions()
    {
        _startupFunctions.Clear();

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

            var seen=
                new HashSet<(int Address,int Function)>();

            foreach(var loco in doc.RootElement.EnumerateArray())
            {
                if(
                    !loco.TryGetProperty("address",out var addressElement) ||
                    !addressElement.TryGetInt32(out var address) ||
                    address is <1 or >10239 ||
                    !loco.TryGetProperty("functions",out var functions) ||
                    functions.ValueKind!=JsonValueKind.Array)
                    continue;

                foreach(var function in functions.EnumerateArray())
                {
                    var startupActive=
                        function.TryGetProperty(
                            "startupActive",
                            out var startupElement) &&
                        startupElement.ValueKind==
                            JsonValueKind.True;

                    var momentary=
                        function.TryGetProperty(
                            "momentary",
                            out var momentaryElement) &&
                        momentaryElement.ValueKind==
                            JsonValueKind.True;

                    if(
                        !startupActive ||
                        momentary ||
                        !function.TryGetProperty(
                            "number",
                            out var numberElement) ||
                        !numberElement.TryGetInt32(
                            out var number) ||
                        number is <0 or >28 ||
                        !seen.Add(
                            (address,number)))
                        continue;

                    _startupFunctions.Enqueue(
                        (address,number));

                    if(_startupFunctions.Count>=256)
                        return;
                }
            }
        }
        catch(Exception ex)
        {
            _log.LogWarning(
                ex,
                "Startup locomotive functions: invalid locos.json");
        }
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
