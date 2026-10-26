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
    readonly ExternalDevicesRuntime _externalDevices;
    readonly ScriptRuntime _scripts;
    readonly ILogger<WsRuntimeCoordinator> _log;
    volatile bool _connected;
    volatile bool _connectionChanged;
    volatile bool _locomotiveConfigurationChanged;

    public void RefreshLocomotives() => _locomotiveConfigurationChanged = true;
    readonly Queue<int> _locoSync=new();
    readonly Queue<ushort> _dccExTurnoutSync = new();
    DateTimeOffset _nextDccExTurnoutRefresh = DateTimeOffset.MinValue;
    readonly Queue<(int Address,int Function)> _startupFunctions=new();
    bool _startupFunctionsApplied;
    // Power ON may boot feedback modules on any command center. Delay the
    // driver-specific sensor interrogation; the coordinator owns the schedule.
    readonly object _powerResyncGate = new();
    DateTimeOffset? _powerResyncDue;
    bool? _powerOn;


    public WsRuntimeCoordinator(
        ICommandCenter cc,
        WsHub ws,
        LayoutRuntime runtime,
        SignalAutomationEngine signalAutomation,
        AppPaths env,
        ExternalDevicesRuntime externalDevices,
        ScriptRuntime scripts,
        ILogger<WsRuntimeCoordinator> log)
    {
        _cc=cc;
        _ws=ws;
        _runtime=runtime;
        _signalAutomation=signalAutomation;
        _env=env;
        _externalDevices=externalDevices;
        _scripts=scripts;
        _log=log;

        _connected=cc.Connected;
        cc.ConnectionChanged+=OnConnectionChanged;
        cc.SensorFeedbackChanged+=OnSensorFeedbackChanged;
        cc.PowerFeedbackChanged+=OnPowerFeedbackChanged;
        cc.AccessoryFeedbackChanged+=OnAccessoryFeedbackChanged;
        // DCC-EX <H> broadcasts and <jT> detail replies are NOT DCC
        // accessory messages. Process them in a separate state namespace.
        cc.RawInfo += OnDccExRawInfo;
        // Every sensor source uses the same authoritative LayoutRuntime path.
        externalDevices.SensorFeedbackChanged += OnSensorFeedbackChanged;
        externalDevices.SensorRangeUnavailable +=
            (first, count) => _runtime.InvalidateSensorRange(first, count);
    }

    void OnConnectionChanged(bool connected)
    {
        _connected=connected;
        _connectionChanged=true;
        if (!connected)
        {
            // A disconnected command center has no confirmed power state.
            // Serialize invalidation with sensor reports, and do not replay
            // external feedback until a new Power ON has been confirmed.
            lock (_powerResyncGate)
            {
                _powerOn = null;
                _powerResyncDue = null;
                _runtime.InvalidateSensorStates();
                if (_cc.Type.StartsWith("dcc-ex", StringComparison.OrdinalIgnoreCase))
                    _runtime.InvalidateDccExTurnoutStates();
            }
            _log.LogWarning(
                "Command center disconnected: previous sensor states are UNKNOWN pending fresh power and sensor feedback");
        }
    }

    void OnPowerFeedbackChanged(PowerFeedback feedback)
    {
        if (!string.Equals(feedback.Target, "Main", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(feedback.Target, "All", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(feedback.Target, "Joined", StringComparison.OrdinalIgnoreCase))
            return;

        // Serialize the power transition with incoming sensor feedback. An OFF
        // report arriving just after power loss must not turn UNKNOWN into FREE.
        lock (_powerResyncGate)
        {
            if (_powerOn == feedback.On)
                return; // Duplicate broadcast must not repeatedly discard valid states.
            _powerOn = feedback.On;
            _powerResyncDue = feedback.On
                ? DateTimeOffset.UtcNow.AddMilliseconds(1500)
                : null;
            _runtime.InvalidateSensorStates();
        }

        // Live external adapter feedback is valid again once track power is ON.
        // Do not replay stale OFF values after power is switched OFF.
        if (feedback.On)
            _externalDevices.ReplayLiveSensorStates();

        _log.LogInformation("{CommandCenter} track power {Power}: sensor states UNKNOWN; {Action}",
            _cc.Name,
            feedback.On ? "ON" : "OFF",
            feedback.On ? "sensor interrogation scheduled" : "waiting for power ON");
    }

    void OnSensorFeedbackChanged(int address,bool on)
    {
        if(address is <=0 or >65535)
            return;

        // A track-power OFF invalidation must not be undone by delayed R-BUS,
        // LocoNet, S88 or adapter OFF reports. Serialize with the transition
        // so an in-flight feedback cannot repopulate the cache after clearing.
        lock (_powerResyncGate)
        {
            // Startup/reconnect is UNKNOWN until power feedback confirms ON.
            // Never assume an unknown power state is safe to interpret as FREE.
            // if (_powerOn != true)
            //     return;
            _runtime.SetSensor((ushort)address, on);
        }

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

    void OnDccExRawInfo(string frame)
    {
        if (!_cc.Type.StartsWith("dcc-ex", StringComparison.OrdinalIgnoreCase) ||
            !DccExTurnoutFeedbackParser.TryParse(frame, out var id, out var thrown))
            return;

        if (_runtime.SetDccExTurnoutState(id, thrown, fromFeedback: true))
            _log.LogDebug("DCC-EX turnout #{Id} feedback {Position}",
                id, thrown ? "Thrown" : "Closed");
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var nextCurrent=DateTimeOffset.MinValue;
        var nextStatus=DateTimeOffset.MinValue;
        var nextLoco=DateTimeOffset.MinValue;
        var nextDccExTurnout=DateTimeOffset.MinValue;
        var nextStartupFunction=DateTimeOffset.MinValue;

        if(_connected)
            await ConnectedAsync(ct);

        // Start opted-in, enabled scripts once per Hub startup, independently
        // of track power. Reconnects must not launch duplicate executions.
        try
        {
            var started = _scripts.StartAutoSaved();
            _log.LogInformation("Autostart launched {Count} saved script(s)", started);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Script autostart failed");
        }

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
                    _dccExTurnoutSync.Clear();
                    _startupFunctionsApplied=false;
                    nextCurrent=DateTimeOffset.MinValue;
                }
            }

            if (_locomotiveConfigurationChanged)
            {
                _locomotiveConfigurationChanged = false;
                LoadConfiguredLocos();
                LoadStartupFunctions();
                _startupFunctionsApplied = false;
            }

            var now=DateTimeOffset.UtcNow;
            // Periodic refresh also discovers newly saved turnout bindings.
            // Throttle queries individually rather than dumping a <JT> burst.
            if (_cc.Connected &&
                _cc.Type.StartsWith("dcc-ex", StringComparison.OrdinalIgnoreCase) &&
                now >= _nextDccExTurnoutRefresh && _dccExTurnoutSync.Count == 0)
            {
                foreach (var id in _runtime.DccExTurnoutIds())
                    _dccExTurnoutSync.Enqueue(id);
                _nextDccExTurnoutRefresh = now.AddSeconds(60);
            }
            bool requestPowerOnSensors = false;
            if (_cc.Connected)
            {
                lock (_powerResyncGate)
                {
                    if (_powerResyncDue.HasValue && now >= _powerResyncDue.Value)
                    {
                        _powerResyncDue = null;
                        requestPowerOnSensors = true;
                    }
                }
            }
            if (requestPowerOnSensors)
            {
                var requested = await _cc.RequestSensorSnapshotAsync(ct);
                _log.LogInformation(
                    "{CommandCenter} power ON sensor interrogation {Result}; missing feedback remains UNKNOWN",
                    _cc.Name,
                    requested ? "sent" : "not sent");
            }


            if (_cc.Connected && _dccExTurnoutSync.Count > 0 && now >= nextDccExTurnout)
            {
                var id = _dccExTurnoutSync.Peek();
                if (await _cc.SendRawAsync($"<JT {id}>", false, ct))
                    _dccExTurnoutSync.Dequeue();
                nextDccExTurnout = now.AddMilliseconds(100);
            }

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
        _dccExTurnoutSync.Clear();
        if (_cc.Type.StartsWith("dcc-ex", StringComparison.OrdinalIgnoreCase))
        {
            // Do not treat a stale state from an earlier controller session
            // as authoritative. <JT id> repopulates it after reconnect.
            _runtime.InvalidateDccExTurnoutStates();
            foreach (var id in _runtime.DccExTurnoutIds())
                _dccExTurnoutSync.Enqueue(id);
            _nextDccExTurnoutRefresh = DateTimeOffset.UtcNow.AddSeconds(60);
        }
        await _cc.RequestTrackConfigurationAsync(ct);
        await _cc.RequestTripTelemetryAsync(ct);

        // Re-apply the safe/current automation result immediately after the
        // command center becomes writable. The engine may have evaluated while
        // the TCP connection was still offline.
        await _signalAutomation.EvaluateAsync();

        // Do not interrogate sensors before confirmed Power ON: feedback from
        // an unpowered detector must not become FREE, and the driver's
        // change-only cache must not consume the first valid post-ON snapshot.
        // OnPowerFeedbackChanged schedules the interrogation after Power ON.

        LoadConfiguredLocos();

        // Re-apply configured startup functions on every successful
        // command-center connection, including reconnects.
        _startupFunctionsApplied=false;
        LoadStartupFunctions();

        _log.LogInformation(
            "Command center bootstrap: automation evaluated, sensor interrogation waits for confirmed Power ON, {Count} loco state request(s) and {StartupCount} startup function(s) queued",
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
                if (loco.TryGetProperty("active", out var activeFlag) && activeFlag.ValueKind == JsonValueKind.False)
                    continue;
                if (
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
                if (item.TryGetProperty("active", out var activeFlag) && activeFlag.ValueKind == JsonValueKind.False)
                    continue;
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
