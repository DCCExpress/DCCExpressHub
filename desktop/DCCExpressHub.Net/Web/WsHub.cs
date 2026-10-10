using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed class WsHub
{
    private readonly ICommandCenter CommandCenter;
    private readonly HubState HubState;
    private readonly CommandCenterConfigStore CommandCenterConfigStore;
    readonly LayoutRuntime LayoutRuntime;
    readonly RuntimeStateStore RuntimeStateStore;
    readonly LocoCounterRuntime LocoCounters;
    readonly SwitchManManager SwitchMan;
    readonly DispatcherRuntime Dispatcher;
    readonly MovementRuntime Movement;
    readonly TrainTrackingRuntime TrainTracking;
    readonly ScriptRuntime Scripts;
    readonly FlowRuntime Flows;
    readonly TimetableRuntime Timetable;
    private readonly ILogger<WsHub> Logger;
    private readonly FastClockRuntime FastClock;
    private readonly ConcurrentDictionary<Guid, IHubWebSocketClient> Clients = new();
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly Channel<QueuedBroadcast> _stateBroadcastQueue =
        Channel.CreateBounded<QueuedBroadcast>(
            new BoundedChannelOptions(256)
            {
                SingleReader = true,
                SingleWriter = false,
                FullMode = BoundedChannelFullMode.Wait
            });

    private readonly SemaphoreSlim _runtimeSnapshotGate =
        new(
            1,
            1);

    private int _stateBroadcastResyncRequested;

    private sealed record QueuedBroadcast(
        byte[] Payload);
    private readonly object _programmingGate = new();
    private readonly object _audioAckGate = new();
    private Guid? _audioSubscriberConnectionId;
    private readonly Dictionary<string, PendingAudioAck> _pendingAudioAcks =
        new(StringComparer.Ordinal);
    private PendingProgramming? _pendingProgramming;
    private sealed record PendingProgramming(string RequestId, string Action, int ExpectedCv, long Token);

    private sealed class PendingAudioAck
    {
        public required bool Script { get; init; }
        public required Guid ConnectionId { get; init; }
    }
    private long _programmingToken;
    private const int ProgrammingTimeoutMs = 24000;
    private static readonly TimeSpan WebSocketSendTimeout = TimeSpan.FromSeconds(2);
    public int ClientCount => Clients.Count;

    public WsHub(ICommandCenter cc, HubState state, LayoutRuntime runtime, RuntimeStateStore stateStore, CommandCenterConfigStore ccConfig, LocoCounterRuntime locoCounters, FastClockRuntime fastClock, SwitchManManager switchMan, DispatcherRuntime dispatcher, MovementRuntime movement, TrainTrackingRuntime trainTracking, ScriptRuntime scripts, FlowRuntime flows, TimetableRuntime timetable, ILogger<WsHub> log, IHostApplicationLifetime lifetime)
    {
        CommandCenter = cc;
        HubState = state;
        LayoutRuntime = runtime;
        RuntimeStateStore = stateStore;
        LocoCounters = locoCounters;
        FastClock = fastClock;
        SwitchMan = switchMan;
        Dispatcher = dispatcher;
        Movement = movement;
        TrainTracking = trainTracking;
        Scripts = scripts;
        Flows = flows;
        Timetable = timetable;
        CommandCenterConfigStore = ccConfig;
        LayoutRuntime.Changed +=
            (type, data) =>
                QueueStateBroadcast(
                    type,
                    data);
        SwitchMan.Changed +=
            snapshot =>
                QueueStateBroadcast(
                    "switchManChanged",
                    new
                    {
                        locks =
                            snapshot ??
                            SwitchMan.Snapshot()
                    });
        Dispatcher.Changed +=
            snapshot =>
                QueueStateBroadcast(
                    "dispatcherChanged",
                    new
                    {
                        leases =
                            snapshot ??
                            Dispatcher.Snapshot(),
                        routes =
                            Dispatcher.RouteSnapshot()
                    });
        Movement.Changed +=
            state =>
                QueueStateBroadcast(
                    "movementStateChanged",
                    state);
        Movement.AudioRequested += request => _ = HandleMovementAudioRequest(request);
        Movement.LocoChanged +=
            loco =>
                QueueLocoBroadcast(
                    loco);
        Movement.PowerStateChanged +=
            () =>
                QueuePowerBroadcast();
        Movement.SafetyEmergencyStop += trip =>
            _ = Broadcast(
                "safetyEmergencyStop",
                trip);

        TrainTracking.Changed +=
            state =>
                QueueStateBroadcast(
                    "trainTrackingChanged",
                    state);

        Scripts.Changed +=
            state =>
                QueueStateBroadcast(
                    "automationScriptStateChanged",
                    state);
        Scripts.LogChanged +=
            entry =>
                QueueStateBroadcast(
                    "automationScriptLog",
                    entry,
                    resyncOnDrop:
                        false);
        Scripts.AudioRequested += request => _ = HandleScriptAudioRequest(request);
        Scripts.LocoChanged +=
            loco =>
                QueueLocoBroadcast(
                    loco);
        Scripts.PowerStateChanged +=
            () =>
                QueuePowerBroadcast();

        Flows.Changed +=
            state =>
                QueueStateBroadcast(
                    "flowStateChanged",
                    state);
        Flows.LogChanged +=
            entry =>
                QueueStateBroadcast(
                    "flowLog",
                    entry,
                    resyncOnDrop:
                        false);

        Timetable.Changed +=
            state =>
                QueueStateBroadcast(
                    "timetableStateChanged",
                    state);
        Logger = log;

        _ = Task.Run(
            () =>
                StateBroadcastLoop(
                    lifetime.ApplicationStopping),
            CancellationToken.None);

        LocoCounters.Changed +=
            () =>
                QueueStateBroadcast(
                    "locoCounterSnapshot",
                    LocoCounters.Snapshot());

        cc.RawInfo += raw =>
        {
            HandleProgrammingRawResponse(raw);
            if (CommandCenter.EmergencyPauseStateKnown && HubState.EmergencyStop != CommandCenter.EmergencyPaused)
            {
                HubState.EmergencyStop = CommandCenter.EmergencyPaused;
                QueuePowerBroadcast();
            }
            QueueStateBroadcast(
                "rawInfo",
                new
                {
                    raw
                },
                resyncOnDrop:
                    false);
        };
        cc.StationInfoChanged += x => HubState.Station = x;
        cc.TrackConfigurationChanged += x => HubState.Tracks.GetOrAdd(x.Index, _ => new()).Mode = x.Mode;
        cc.CurrentTelemetryChanged += x => { for (int i = 0; i < x.Length; i++) { var t = HubState.Tracks.GetOrAdd(i, _ => new()); t.Overload = x[i] < 0; t.CurrentMa = Math.Max(0, x[i]); } };
        cc.TripTelemetryChanged += x => { for (int i = 0; i < x.Length; i++) HubState.Tracks.GetOrAdd(i, _ => new()).TripMa = Math.Max(0, x[i]); };
        cc.PowerFeedbackChanged += x =>
        {
            var wasMainOn = HubState.TrackPower;
            ApplyPower(x);

            LocoCounters.SetTrackPower(
                HubState.TrackPower);

            if (wasMainOn && !HubState.TrackPower)
            {
                /*
                 * Track power OFF is a hard execution boundary. Do not leave a
                 * logical Movement/Timetable run alive to continue later from
                 * stale sensor/authority state when power returns.
                 */
                Movement.StopAll(false);
                Scripts.AbortAll(
                    "Track power turned OFF.");
                Timetable.StopScheduler();

                _ = RuntimeStateStore.SaveAsync();
                _ = LocoCounters.SaveAsync();
            }

            QueuePowerBroadcast();
        };

        cc.LocoFeedbackChanged += x =>
        {
            HubState.Locos[x.Address] = x;
            LocoCounters.UpdateLoco(x);
            QueueLocoBroadcast(
                x);
        };
        cc.ConnectionChanged += connected =>
        {
            if (!connected)
            {
                LocoCounters.SetTrackPower(false);

                Movement.StopAll(false);
                Scripts.AbortAll(
                    "Command center disconnected.");
                Timetable.StopScheduler();
            }

            // The backend is the single source of truth for command-center
            // connectivity. Push the authoritative state immediately when the
            // TCP/Serial transport changes instead of waiting for the next
            // browser heartbeat.
            QueueStateBroadcast(
                "commandCenterInfo",
                CommandCenterInfo());

            QueueStateBroadcast(
                "dccExStatus",
                Status());
        };
    }

    private void QueueStateBroadcast(
        string type,
        object data,
        bool resyncOnDrop = true)
    {
        if (Clients.IsEmpty)
            return;

        var payload =
            SerializeMessage(
                type,
                data);

        if (
            !_stateBroadcastQueue.Writer
                .TryWrite(
                    new QueuedBroadcast(
                        payload)) &&
            resyncOnDrop
        )
        {
            Interlocked.Exchange(
                ref _stateBroadcastResyncRequested,
                1);
        }
    }

    private void QueuePowerBroadcast() =>
        QueueStateBroadcast(
            "powerInfo",
            new
            {
                emergencyStop =
                    HubState.EmergencyStop,
                trackVoltageOn =
                    HubState.TrackPower,
                trackVoltageOff =
                    !HubState.TrackPower,
                shortCircuit =
                    false,
                programmingModeActive =
                    HubState.ProgrammingPower,
                programmingJoined =
                    HubState.ProgrammingJoined
            });

    private void QueueLocoBroadcast(
        LocoFeedback loco) =>
        QueueStateBroadcast(
            "locoState",
            new
            {
                loco =
                    new
                    {
                        address =
                            loco.Address,
                        speed =
                            loco.Speed,
                        direction =
                            loco.Forward
                                ? "forward"
                                : "reverse",
                        functionsMask =
                            loco.FunctionsMask
                    }
            });

    private async Task StateBroadcastLoop(
        CancellationToken cancellationToken)
    {
        try
        {
            while (
                await _stateBroadcastQueue
                    .Reader
                    .WaitToReadAsync(
                        cancellationToken)
            )
            {
                while (
                    _stateBroadcastQueue
                        .Reader
                        .TryRead(
                            out var item)
                )
                {
                    await BroadcastSerialized(
                        item.Payload);

                    if (
                        Interlocked.Exchange(
                            ref _stateBroadcastResyncRequested,
                            0) != 0
                    )
                    {
                        // The bounded state queue overflowed. Intermediate
                        // telemetry may be stale, so discard the remaining
                        // lossy state updates and send one authoritative
                        // runtime snapshot instead.
                        while (
                            _stateBroadcastQueue
                                .Reader
                                .TryRead(
                                    out _)
                        )
                        {
                        }

                        await BroadcastRuntimeSnapshotCore();
                        break;
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            Logger.LogError(
                ex,
                "WebSocket state broadcast loop failed");
        }
    }

    private void CompleteAudioWait(
        string requestId,
        bool script,
        bool ok)
    {
        if (script)
            Scripts.CompleteAudio(
                requestId,
                ok);
        else
            Movement.CompleteAudio(
                requestId,
                ok);
    }

    private List<(
        string RequestId,
        bool Script)> RemovePendingAudioForClientLocked(
            Guid connectionId)
    {
        var removed =
            new List<(
                string RequestId,
                bool Script)>();

        foreach (var pair in
                 _pendingAudioAcks.ToArray())
        {
            if (pair.Value.ConnectionId !=
                connectionId)
                continue;

            removed.Add(
                (
                    pair.Key,
                    pair.Value.Script
                ));

            _pendingAudioAcks.Remove(
                pair.Key);
        }

        return removed;
    }

    private void CompleteFailedAudioWaits(
        IEnumerable<(
            string RequestId,
            bool Script)> requests)
    {
        foreach (var request in
                 requests)
            CompleteAudioWait(
                request.RequestId,
                request.Script,
                false);
    }

    private async Task PublishAudioSubscriberState()
    {
        Guid? subscriber;

        lock (_audioAckGate)
            subscriber =
                _audioSubscriberConnectionId;

        foreach (var pair in
                 Clients.ToArray())
        {
            try
            {
                await Send(
                    pair.Value,
                    "audioPlaybackStateChanged",
                    new
                    {
                        enabled =
                            subscriber.HasValue &&
                            subscriber.Value ==
                                pair.Key
                    });
            }
            catch
            {
                // Normal socket cleanup will remove dead clients.
            }
        }
    }

    private async Task UpdateAudioPlaybackState(
        Guid connectionId,
        bool enabled)
    {
        List<(
            string RequestId,
            bool Script)> failed =
            [];

        lock (_audioAckGate)
        {
            if (enabled &&
                Clients.ContainsKey(
                    connectionId))
            {
                if (_audioSubscriberConnectionId.HasValue &&
                    _audioSubscriberConnectionId.Value !=
                        connectionId)
                    failed =
                        RemovePendingAudioForClientLocked(
                            _audioSubscriberConnectionId.Value);

                _audioSubscriberConnectionId =
                    connectionId;
            }
            else if (_audioSubscriberConnectionId ==
                     connectionId)
            {
                failed =
                    RemovePendingAudioForClientLocked(
                        connectionId);

                _audioSubscriberConnectionId =
                    null;
            }
        }

        CompleteFailedAudioWaits(
            failed);

        await PublishAudioSubscriberState();
    }

    private async Task RemoveAudioClient(
        Guid connectionId)
    {
        List<(
            string RequestId,
            bool Script)> failed;
        bool stateChanged;

        lock (_audioAckGate)
        {
            failed =
                RemovePendingAudioForClientLocked(
                    connectionId);

            stateChanged =
                _audioSubscriberConnectionId ==
                connectionId;

            if (stateChanged)
                _audioSubscriberConnectionId =
                    null;
        }

        CompleteFailedAudioWaits(
            failed);

        if (stateChanged)
            await PublishAudioSubscriberState();
    }

    private void StartAudioWait(
        string requestId,
        bool script)
    {
        Guid? subscriber;

        lock (_audioAckGate)
        {
            subscriber =
                _audioSubscriberConnectionId;

            if (subscriber.HasValue &&
                Clients.ContainsKey(
                    subscriber.Value))
            {
                _pendingAudioAcks[
                    requestId] =
                    new PendingAudioAck
                    {
                        Script =
                            script,
                        ConnectionId =
                            subscriber.Value
                    };

                return;
            }
        }

        CompleteAudioWait(
            requestId,
            script,
            false);
    }

    private void HandleAudioComplete(
        Guid connectionId,
        string requestId,
        bool script,
        bool ok)
    {
        bool complete =
            false;

        lock (_audioAckGate)
        {
            if (!_pendingAudioAcks.TryGetValue(
                    requestId,
                    out var pending) ||
                pending.Script !=
                    script ||
                pending.ConnectionId !=
                    connectionId)
                return;

            _pendingAudioAcks.Remove(
                requestId);

            complete =
                true;
        }

        if (complete)
            CompleteAudioWait(
                requestId,
                script,
                ok);
    }

    private async Task HandleMovementAudioRequest(
        MovementAudioRequest request)
    {
        /*
         * Exactly one browser may subscribe to audio playback. Blocking
         * requests wait only for that authoritative subscriber.
         */
        if (request.WaitForEnd)
            StartAudioWait(
                request.RequestId,
                script:
                    false);

        await Broadcast(
            "playAudio",
            new
            {
                requestId =
                    request.RequestId,
                fileName =
                    request.FileName
            });
    }

    private async Task HandleScriptAudioRequest(
        ScriptAudioRequest request)
    {
        if (request.WaitForEnd)
            StartAudioWait(
                request.RequestId,
                script:
                    true);

        await Broadcast(
            "playAudio",
            new
            {
                requestId =
                    request.RequestId,
                fileName =
                    request.FileName
            });
    }

    private void ApplyPower(PowerFeedback p)
    {
        if (p.Target == "All") { HubState.TrackPower = p.On; HubState.ProgrammingPower = p.On; }
        else if (p.Target == "Main") HubState.TrackPower = p.On;
        else if (p.Target == "Programming") { HubState.ProgrammingPower = p.On; HubState.ProgrammingJoined = false; }
        else if (p.Target == "Joined") { HubState.TrackPower = p.On; HubState.ProgrammingPower = p.On; HubState.ProgrammingJoined = p.On; }
        else if (p.Target == "Track" && p.TrackIndex >= 0) HubState.Tracks.GetOrAdd(p.TrackIndex, _ => new()).Power = p.On;
    }

    public async Task Accept(
        IHubWebSocketClient ws,
        CancellationToken cancellationToken)
    {
        var id =
            Guid.NewGuid();

        Clients[id] =
            ws;

        try
        {
            await Send(
                ws,
                "ws:welcome",
                new
                {
                    message =
                        "DCCExpressHub"
                });

            await SendSnapshot(
                ws);

            await foreach (
                var text in
                    ws.ReadTextMessagesAsync(
                        cancellationToken)
            )
            {
                await Handle(
                    id,
                    ws,
                    text,
                    cancellationToken);
            }
        }
        finally
        {
            Clients.TryRemove(
                id,
                out _);

            await RemoveAudioClient(
                id);

            if (Clients.IsEmpty)
            {
                Movement.FailPendingAudio();
                Scripts.FailPendingAudio();
            }

            try
            {
                await ws.CloseAsync(
                    CancellationToken.None);
            }
            catch
            {
            }
        }
    }

    private async Task Handle(Guid connectionId, IHubWebSocketClient ws, string text, CancellationToken ct)
    {
        JsonDocument json;
        try
        {
            json = JsonDocument.Parse(text);
        }
        catch
        {
            await Send(ws, "error", new { message = "invalid_json" });
            return;
        }
        using (json)
        {
            var root = json.RootElement; var type = root.TryGetProperty("type", out var t) ? t.GetString() ?? "" : ""; var data = root.TryGetProperty("data", out var x) ? x : default;
            bool ok = true;
            switch (type)
            {
                case "audioPlaybackState":
                    await UpdateAudioPlaybackState(
                        connectionId,
                        B(
                            data,
                            "enabled"));
                    return;
                case "broadcastPlayAudio":
                    {
                        var requestId = S(data, "requestId");
                        var fileName = S(data, "fileName");

                        if (
                            string.IsNullOrWhiteSpace(requestId) ||
                            string.IsNullOrWhiteSpace(fileName) ||
                            fileName.Length > 240)
                        {
                            await Send(ws, "error", new { message = "invalid_audio_broadcast" });
                            return;
                        }

                        await Broadcast("playAudio", new
                        {
                            requestId,
                            fileName
                        });
                        return;
                    }
                case "broadcastStopAudio":
                    {
                        var fileName = S(data, "fileName");

                        if (
                            string.IsNullOrWhiteSpace(fileName) ||
                            fileName.Length > 240)
                            return;

                        await Broadcast("stopAudio", new
                        {
                            fileName
                        });
                        return;
                    }
                case "heartbeat":
                    await Send(ws, "heartbeatAck", new { });
                    await SendCommandCenterInfo(ws);
                    await SendPower(ws);
                    return;
                case "fastClockCommand":
                    await HandleFastClockCommand(ws, data);
                    return;
                case "switchManCommand":
                    await HandleSwitchManCommand(ws, data, ct);
                    return;
                case "dispatcherCommand":
                    await HandleDispatcherCommand(connectionId, ws, data, ct);
                    return;
                case "trainTrackingCommand":
                    await HandleTrainTrackingCommand(ws, data, ct);
                    return;
                case "movementCommand":
                    await HandleMovementCommand(connectionId, ws, data, ct);
                    return;
                case "movementAudioComplete":
                    HandleAudioComplete(
                        connectionId,
                        S(data, "requestId"),
                        script:
                            false,
                        B(data, "ok"));
                    return;
                case "scriptCommand":
                    await HandleScriptCommand(connectionId, ws, data);
                    return;
                case "scriptAudioComplete":
                    HandleAudioComplete(
                        connectionId,
                        S(data, "requestId"),
                        script:
                            true,
                        B(data, "ok"));
                    return;
                case "flowCommand":
                    await HandleFlowCommand(connectionId, ws, data);
                    return;
                case "timetableCommand":
                    await HandleTimetableCommand(connectionId, ws, data);
                    return;
                case "setTrackPower":
                    ok = await CommandCenter.SetTrackPowerAsync(B(data, "on"), CommandCenterConfigStore.Current.PowerIncludesProgramming, ct);
                    if (!B(data, "on"))
                    {
                        // Persist before acknowledging OFF: callers may close the app.
                        var saved = await RuntimeStateStore.SaveAsync();
                        if (!saved)
                            ok = false;
                    }
                    break;
                case "setProgrammingPower":
                    ok = await CommandCenter.SetProgrammingPowerAsync(B(data, "on"), ct);
                    break;
                case "emergencyStop":
                    ok = await CommandCenter.EmergencyStopAsync(ct);
                    if (ok)
                    {
                        HubState.EmergencyStop = CommandCenter.EmergencyPauseStateKnown ? CommandCenter.EmergencyPaused : true;
                        await BroadcastPower();
                    }
                    break;
                case "writeDccExDirectCommand":
                    {
                        var command = S(data, "command");
                        ok = await CommandCenter.SendRawAsync(command, true, ct);
                        if (ok)
                        {
                            var normalized = command.Trim().ToUpperInvariant();
                            if (normalized == "<1 JOIN>")
                            {
                                HubState.ProgrammingJoined = true;
                                HubState.TrackPower = true;
                                HubState.ProgrammingPower = true;
                                await BroadcastPower();
                            }
                            else if (normalized == "<1 PROG>")
                            {
                                HubState.ProgrammingJoined = false;
                                HubState.ProgrammingPower = true;
                                await BroadcastPower();
                            }
                        }
                        await Send(ws, "dccExDirectCommandResponse", new { response = ok ? "sent" : "send failed" });
                        return;
                    }
                case "setLoco":
                    {
                        int a = I(data, "locoAddress"), s = Math.Clamp(I(data, "speed"), 0, 126);
                        bool f = S(data, "direction") != "reverse";
                        ok = await CommandCenter.SetLocoAsync(a, s, f, ct);
                        if (ok)
                        {
                            var old = HubState.Locos.GetValueOrDefault(a, new(a, 0, true, 0));
                            var l = old with { Speed = s, Forward = f };
                            HubState.Locos[a] = l;
                            await BroadcastLoco(l);
                        }
                        break;
                    }
                case "getLoco":
                    ok = await CommandCenter.RequestLocoAsync(I(data, "locoAddress"), ct);
                    break;
                case "setLocoFunction":
                    {
                        int a = I(data, "locoAddress"), fn = I(data, "functionNumber");
                        if (fn is < 0 or > 28) return;
                        bool on = B(data, "active");
                        ok = await CommandCenter.SetLocoFunctionAsync(a, fn, on, ct);
                        if (ok)
                        {
                            var old = HubState.Locos.GetValueOrDefault(a, new(a, 0, true, 0));
                            uint bit = 1u << fn;
                            var l = old with { FunctionsMask = on ? old.FunctionsMask | bit : old.FunctionsMask & ~bit };
                            HubState.Locos[a] = l;
                            await BroadcastLoco(l);
                        }
                        break;
                    }
                case "setTurnout":
                    {
                        var a = (ushort)I(data, "address");
                        var v = B(data, "closed");
                        var turnout = LayoutRuntime.FindAccessory(RuntimeAccessoryKind.Turnout, a);
                        string? leaseOwner = null;

                        if (turnout is not null && !turnout.TurnoutExtended && !turnout.TurnoutVPin)
                        {
                            var lease = await AcquireManualTurnoutOperation(ws, a, ct);
                            if (!lease.Ok) return;
                            leaseOwner = lease.OwnerId;
                        }

                        try
                        {
                            ok = await CommandCenter.SetTurnoutAsync(a, v, ct);
                            if (ok) LayoutRuntime.SetTurnout(a, v);
                        }
                        finally
                        {
                            if (leaseOwner is not null)
                                SwitchMan.ReleaseOwned(new[] { a }, leaseOwner);
                        }
                        break;
                    }
                case "setSignalAspect":
                    {
                        var a = (ushort)I(data, "address");
                        var v = I(data, "aspect");
                        string? leaseOwner = null;
                        var turnout = LayoutRuntime.FindAccessory(RuntimeAccessoryKind.Turnout, a);
                        if (turnout?.TurnoutExtended == true)
                        {
                            var lease = await AcquireManualTurnoutOperation(ws, a, ct);
                            if (!lease.Ok) return;
                            leaseOwner = lease.OwnerId;
                        }
                        try
                        {
                            ok = await CommandCenter.SetSignalAspectAsync(a, v, ct);
                            if (ok)
                            {
                                LayoutRuntime.SetSignal(a, v);
                                if (data.TryGetProperty("turnoutPhysicalValue", out var tp) &&
                                    tp.ValueKind is JsonValueKind.True or JsonValueKind.False)
                                    LayoutRuntime.SetTurnout(a, tp.GetBoolean());
                            }
                        }
                        finally
                        {
                            if (leaseOwner is not null)
                                SwitchMan.ReleaseOwned(new[] { a }, leaseOwner);
                        }
                        break;
                    }
                case "setBasicAccessory":
                    {
                        var a = (ushort)I(data, "address");
                        var v = B(data, "active");
                        string? leaseOwner = null;
                        var turnout = LayoutRuntime.FindAccessory(RuntimeAccessoryKind.Turnout, a);
                        if (turnout is not null && !turnout.TurnoutExtended && !turnout.TurnoutVPin)
                        {
                            var lease = await AcquireManualTurnoutOperation(ws, a, ct);
                            if (!lease.Ok) return;
                            leaseOwner = lease.OwnerId;
                        }
                        try
                        {
                            ok = await CommandCenter.SetAccessoryAsync(a, v, ct);
                            if (ok) LayoutRuntime.SetAccessory(a, v);
                        }
                        finally
                        {
                            if (leaseOwner is not null)
                                SwitchMan.ReleaseOwned(new[] { a }, leaseOwner);
                        }
                        break;
                    }
                case "setVpin":
                    {
                        var a = (ushort)I(data, "vpin");
                        var v = B(data, "active");
                        string? leaseOwner = null;
                        var turnout = LayoutRuntime.FindAccessory(RuntimeAccessoryKind.Turnout, a);
                        if (turnout?.TurnoutVPin == true)
                        {
                            var lease = await AcquireManualTurnoutOperation(ws, a, ct);
                            if (!lease.Ok) return;
                            leaseOwner = lease.OwnerId;
                        }
                        try
                        {
                            ok = await CommandCenter.SetVPinAsync(a, v, ct);
                            if (ok) LayoutRuntime.SetVPin(a, v);
                        }
                        finally
                        {
                            if (leaseOwner is not null)
                                SwitchMan.ReleaseOwned(new[] { a }, leaseOwner);
                        }
                        break;
                    }
                case "setSensor":
                    {
                        var a = (ushort)I(data, "address");
                        LayoutRuntime.SetSensor(a, B(data, "on"));
                        break;
                    }
                case "setBlock":
                    {
                        var idValue = I(data, "blockId");
                        var lid = S(data, "locoId");
                        var addressValue = I(data, "locoAddress");
                        var id = idValue is > 0 and <= 65535 ? (ushort)idValue : (ushort)0;
                        var la = addressValue is > 0 and <= 10239 ? (ushort)addressValue : (ushort)0;
                        if (id == 0 || (lid.Length == 0 && la == 0) || !LayoutRuntime.SetBlock(id, lid, la))
                            await Send(ws, "error", new { message = "invalid_block_assignment" });
                        break;
                    }
                case "setBlockRemove":
                    {
                        var idValue = I(data, "blockId");
                        var id = idValue is > 0 and <= 65535 ? (ushort)idValue : (ushort)0;
                        var lid = S(data, "locoId");
                        if (id == 0 || !LayoutRuntime.RemoveBlock(id, lid))
                            await Send(ws, "error", new { message = "invalid_block_remove" });
                        break;
                    }
                case "setBlocksReset":
                    LayoutRuntime.ClearBlocks();
                    break;
                case "getBlocks":
                    await Send(ws, "blockStateChanged", LayoutRuntime.BlockSnapshot());
                    return;
                case "getLayoutRuntimeSnapshot":
                    foreach (var item in LayoutRuntime.RuntimeSnapshot())
                        await Send(ws, item.Type, item.Data);
                    return;
                case "programmingCommand":
                    await Programming(data, ct);
                    return;
                default:
                    await Send(ws, "ack", new { ok = true, message = "Not implemented yet: " + type });
                    return;
            }

            if (!ok)
                await Send(ws, "error", new { message = "command_center_send_failed", operation = type });
        }
    }

    private async Task<(bool Ok, string? OwnerId)> AcquireManualTurnoutOperation(
        IHubWebSocketClient ws,
        ushort address,
        CancellationToken ct)
    {
        if (address is < 1 or > 2048)
        {
            await Send(ws, "error", new { message = "turnout_address_out_of_range", address });
            return (false, null);
        }

        var ownerId = "manual:" + Guid.NewGuid().ToString("N");
        var result = await SwitchMan.AcquireAsync(
            new[] { address },
            ownerId,
            "Manual/UI",
            0,
            ct);

        if (result.Ok)
            return (true, ownerId);

        var blockingLock = result.Conflicts.FirstOrDefault();
        await Send(ws, "error", new
        {
            message = "turnout_locked",
            address,
            ownerId = blockingLock?.OwnerId,
            ownerName = blockingLock?.OwnerName
        });

        return (false, null);
    }

    private async Task HandleSwitchManCommand(IHubWebSocketClient ws, JsonElement data, CancellationToken ct)
    {
        var requestId = S(data, "requestId");
        var action = S(data, "action");
        var ownerId = S(data, "ownerId");
        var ownerName = S(data, "ownerName");

        async Task Reply(bool ok, string? message = null, object? extra = null)
        {
            await Send(ws, "switchManResponse", new
            {
                requestId,
                action,
                ok,
                message,
                extra
            });
        }

        ushort[] ReadAddresses()
        {
            if (data.ValueKind != JsonValueKind.Object ||
                !data.TryGetProperty("addresses", out var raw) ||
                raw.ValueKind != JsonValueKind.Array)
                return Array.Empty<ushort>();

            return raw.EnumerateArray()
                .Select(x => x.TryGetInt32(out var n) && n is >= 1 and <= 2048 ? (ushort)n : (ushort)0)
                .Where(x => x != 0)
                .Distinct()
                .OrderBy(x => x)
                .ToArray();
        }

        switch (action)
        {
            case "snapshot":
                await Reply(true, extra: new { locks = SwitchMan.Snapshot() });
                return;

            case "acquire":
                {
                    var addresses = ReadAddresses();
                    if (addresses.Length == 0 ||
                        addresses.Any(address => LayoutRuntime.FindAccessory(RuntimeAccessoryKind.Turnout, address) is null))
                    {
                        await Reply(false, "invalid_turnout_addresses");
                        return;
                    }

                    var timeoutMs = Math.Clamp(IOr(data, "timeoutMs", 0), 0, 600000);
                    SwitchManAcquireResult result;

                    try
                    {
                        result = await SwitchMan.AcquireAsync(
                            addresses,
                            ownerId,
                            ownerName,
                            timeoutMs,
                            ct);
                    }
                    catch (OperationCanceledException)
                    {
                        return;
                    }

                    await Reply(result.Ok, result.Error, new
                    {
                        locks = result.Locks,
                        conflicts = result.Conflicts
                    });
                    return;
                }

            case "release":
                {
                    if (string.IsNullOrWhiteSpace(ownerId))
                    {
                        await Reply(false, "invalid_owner");
                        return;
                    }

                    var addresses = ReadAddresses();
                    var released = SwitchMan.ReleaseOwned(
                        addresses.Length == 0 ? null : addresses,
                        ownerId);

                    await Reply(true, extra: new
                    {
                        released,
                        locks = SwitchMan.Snapshot()
                    });
                    return;
                }

            case "forceReleaseAll":
                {
                    var released = SwitchMan.ForceReleaseAll();
                    await Reply(true, extra: new
                    {
                        released,
                        locks = SwitchMan.Snapshot()
                    });
                    return;
                }

            case "set":
                {
                    var rawAddress = I(data, "address");
                    if (rawAddress is < 1 or > 2048)
                    {
                        await Reply(false, "invalid_turnout_address");
                        return;
                    }

                    var address = (ushort)rawAddress;
                    var turnout = LayoutRuntime.FindAccessory(RuntimeAccessoryKind.Turnout, address);

                    if (turnout is null)
                    {
                        await Reply(false, "turnout_not_found");
                        return;
                    }

                    if (string.IsNullOrWhiteSpace(ownerId))
                    {
                        await Reply(false, "invalid_owner");
                        return;
                    }

                    if (!SwitchMan.IsOwnedBy(address, ownerId))
                    {
                        SwitchMan.IsLocked(address, out var blockingLock);
                        await Reply(false, "turnout_lock_required", new
                        {
                            address,
                            lockInfo = blockingLock
                        });
                        return;
                    }

                    var logicalClosed = B(data, "closed");
                    var physicalValue = logicalClosed
                        ? turnout.ClosedValue
                        : !turnout.ClosedValue;

                    bool ok;

                    if (turnout.TurnoutExtended)
                    {
                        var aspect = logicalClosed
                            ? turnout.TurnoutClosedAspect
                            : turnout.TurnoutOpenedAspect;

                        ok = await CommandCenter.SetSignalAspectAsync(address, aspect, ct);
                        if (ok)
                            LayoutRuntime.SetSignal(address, aspect);
                    }
                    else if (turnout.TurnoutVPin)
                    {
                        ok = await CommandCenter.SetVPinAsync(address, physicalValue, ct);
                        if (ok)
                            LayoutRuntime.SetVPin(address, physicalValue);
                    }
                    else
                    {
                        ok = await CommandCenter.SetTurnoutAsync(address, physicalValue, ct);
                        if (ok)
                            LayoutRuntime.SetTurnout(address, physicalValue);
                    }

                    await Reply(
                        ok,
                        ok ? null : "turnout_command_failed",
                        new
                        {
                            address,
                            closed = logicalClosed
                        });
                    return;
                }

            default:
                await Reply(false, "unknown_switchman_action");
                return;
        }
    }

    private async Task HandleFlowCommand(
        Guid connectionId,
        IHubWebSocketClient ws,
        JsonElement data)
    {
        var requestId =
            S(
                data,
                "requestId");

        var action =
            S(
                data,
                "action");

        async Task Reply(
            bool ok,
            string? message = null,
            object? extra = null)
        {
            await Send(
                ws,
                "flowResponse",
                new
                {
                    requestId,
                    action,
                    ok,
                    message,
                    extra
                });
        }

        switch (action)
        {
            case "snapshot":
                await Reply(
                    true,
                    extra:
                        new
                        {
                            state =
                                Flows.Snapshot()
                        });
                return;

            case "runPage":
                {
                    var pageId =
                        S(
                            data,
                            "pageId");

                    var inputNodeId =
                        S(
                            data,
                            "inputNodeId");

                    JsonElement? payload =
                        null;

                    if (data.ValueKind ==
                            JsonValueKind.Object &&
                        data.TryGetProperty(
                            "payload",
                            out var rawPayload))
                        payload =
                            rawPayload.Clone();

                    var mode =
                        S(
                            data,
                            "mode");

                    var result =
                        Flows.RunPage(
                            pageId,
                            string.IsNullOrWhiteSpace(
                                inputNodeId)
                                ? null
                                : inputNodeId,
                            payload,
                            string.IsNullOrWhiteSpace(
                                mode)
                                ? "run"
                                : mode);

                    await Reply(
                        result.Ok,
                        result.Error,
                        new
                        {
                            state =
                                Flows.Snapshot()
                        });
                    return;
                }

            case "abortPage":
                {
                    var count =
                        Flows.AbortPage(
                            S(
                                data,
                                "pageId"));

                    await Reply(
                        true,
                        extra:
                            new
                            {
                                count,
                                state =
                                    Flows.Snapshot()
                            });
                    return;
                }

            case "abortAll":
                {
                    var count =
                        Flows.AbortAll();

                    await Reply(
                        true,
                        extra:
                            new
                            {
                                count,
                                state =
                                    Flows.Snapshot()
                            });
                    return;
                }

            default:
                await Reply(
                    false,
                    "unknown_flow_action");
                return;
        }
    }

    private async Task HandleScriptCommand(
        Guid connectionId,
        IHubWebSocketClient ws,
        JsonElement data)
    {
        var requestId =
            S(
                data,
                "requestId");

        var action =
            S(
                data,
                "action");

        async Task Reply(
            bool ok,
            string? message = null,
            object? extra = null)
        {
            await Send(
                ws,
                "automationScriptResponse",
                new
                {
                    requestId,
                    action,
                    ok,
                    message,
                    extra
                });
        }

        switch (action)
        {
            case "snapshot":
                await Reply(
                    true,
                    extra:
                        new
                        {
                            states =
                                Scripts.Snapshot(),
                            finishing =
                                Scripts.Finishing
                        });
                return;

            case "startSaved":
                {
                    var scriptId =
                        S(
                            data,
                            "scriptId");

                    var executionId =
                        S(
                            data,
                            "executionId");

                    var result =
                        Scripts.StartSaved(
                            scriptId,
                            string.IsNullOrWhiteSpace(
                                executionId)
                                ? null
                                : executionId,
                            S(
                                data,
                                "executionType"));

                    await Reply(
                        result.Ok,
                        result.Error,
                        new
                        {
                            state =
                                result.State
                        });
                    return;
                }

            case "startSource":
                {
                    var executionId =
                        S(
                            data,
                            "executionId");

                    var result =
                        Scripts.StartSource(
                            executionId,
                            S(
                                data,
                                "name"),
                            S(
                                data,
                                "executionType"),
                            S(
                                data,
                                "source"));

                    await Reply(
                        result.Ok,
                        result.Error,
                        new
                        {
                            state =
                                result.State
                        });
                    return;
                }

            case "pause":
                {
                    var executionId =
                        S(
                            data,
                            "executionId");

                    var ok =
                        Scripts.Pause(
                            executionId);

                    await Reply(
                        ok,
                        ok
                            ? null
                            : "script_not_running",
                        new
                        {
                            state =
                                Scripts.GetState(
                                    executionId)
                        });
                    return;
                }

            case "resume":
                {
                    var executionId =
                        S(
                            data,
                            "executionId");

                    var ok =
                        Scripts.Resume(
                            executionId);

                    await Reply(
                        ok,
                        ok
                            ? null
                            : "script_not_paused",
                        new
                        {
                            state =
                                Scripts.GetState(
                                    executionId)
                        });
                    return;
                }

            case "abort":
                {
                    var executionId =
                        S(
                            data,
                            "executionId");

                    var ok =
                        Scripts.Abort(
                            executionId);

                    await Reply(
                        ok,
                        ok
                            ? null
                            : "script_not_running",
                        new
                        {
                            state =
                                Scripts.GetState(
                                    executionId)
                        });
                    return;
                }

            case "startAll":
                await Reply(
                    true,
                    extra:
                        new
                        {
                            count =
                                Scripts.StartAllSaved()
                        });
                return;

            case "pauseAll":
                await Reply(
                    true,
                    extra:
                        new
                        {
                            count =
                                Scripts.PauseAll()
                        });
                return;

            case "resumeAll":
                await Reply(
                    true,
                    extra:
                        new
                        {
                            count =
                                Scripts.ResumeAll()
                        });
                return;

            case "abortAll":
                await Reply(
                    true,
                    extra:
                        new
                        {
                            count =
                                Scripts.AbortAll()
                        });
                return;

            case "pauseAllSaved":
                await Reply(
                    true,
                    extra:
                        new
                        {
                            count =
                                Scripts.PauseAllSaved()
                        });
                return;

            case "resumeAllSaved":
                await Reply(
                    true,
                    extra:
                        new
                        {
                            count =
                                Scripts.ResumeAllSaved()
                        });
                return;

            case "abortAllSaved":
                await Reply(
                    true,
                    extra:
                        new
                        {
                            count =
                                Scripts.AbortAllSaved()
                        });
                return;

            case "setFinishing":
                Scripts.SetFinishing(
                    B(
                        data,
                        "finishing"));

                Timetable.SetFinishing(
                    Scripts.Finishing);

                await Reply(
                    true,
                    extra:
                        new
                        {
                            finishing =
                                Scripts.Finishing
                        });
                return;

            default:
                await Reply(
                    false,
                    "unknown_script_action");
                return;
        }
    }

    private async Task HandleTimetableCommand(
        Guid connectionId,
        IHubWebSocketClient ws,
        JsonElement data)
    {
        var requestId =
            S(
                data,
                "requestId");

        var action =
            S(
                data,
                "action");

        async Task Reply(
            bool ok,
            string? message = null)
        {
            await Send(
                ws,
                "timetableResponse",
                new
                {
                    requestId,
                    action,
                    ok,
                    message,
                    state =
                        Timetable.Snapshot()
                });
        }

        switch (action)
        {
            case "snapshot":
                await Reply(true);
                return;

            case "start":
                Timetable.StartScheduler();
                await Reply(true);
                return;

            case "stop":
                Timetable.StopScheduler();
                await Reply(true);
                return;

            case "rebase":
                Timetable.Rebase();
                await Reply(true);
                return;

            case "setFinishing":
                Timetable.SetFinishing(
                    B(
                        data,
                        "finishing"));
                await Reply(true);
                return;

            default:
                await Reply(
                    false,
                    "unknown_timetable_action");
                return;
        }
    }

    private async Task HandleTrainTrackingCommand(
        IHubWebSocketClient ws,
        JsonElement data,
        CancellationToken ct)
    {
        var requestId =
            S(
                data,
                "requestId");
        var action =
            S(
                data,
                "action");

        async Task Reply(
            bool ok,
            string? message = null)
        {
            await Send(
                ws,
                "trainTrackingResponse",
                new
                {
                    requestId,
                    action,
                    ok,
                    message,
                    snapshot =
                        TrainTracking.Snapshot()
                });
        }

        switch (action)
        {
            case "snapshot":
                await Reply(true);
                return;

            case "setEnabled":
                TrainTracking.SetEnabled(
                    B(
                        data,
                        "enabled"));

                if (B(
                        data,
                        "enabled"))
                    await CommandCenter
                        .RequestSensorSnapshotAsync(
                            ct);

                await Reply(true);
                return;

            case "refresh":
                TrainTracking.RefreshTopology();
                await CommandCenter
                    .RequestSensorSnapshotAsync(
                        ct);
                await Reply(true);
                return;

            case "reset":
                TrainTracking.Reset();
                await Reply(true);
                return;

            case "clearLogs":
                TrainTracking.ClearLogs();
                await Reply(true);
                return;

            default:
                await Reply(
                    false,
                    "unknown_train_tracking_action");
                return;
        }
    }

    private async Task HandleMovementCommand(
        Guid connectionId,
        IHubWebSocketClient ws,
        JsonElement data,
        CancellationToken ct)
    {
        var requestId = S(data, "requestId");
        var action = S(data, "action");

        async Task Reply(
            bool ok,
            string? message = null,
            object? extra = null)
        {
            await Send(ws, "movementResponse", new
            {
                requestId,
                action,
                ok,
                message,
                extra
            });
        }

        switch (action)
        {
            case "snapshot":
                await Reply(
                    true,
                    extra: new
                    {
                        states = Movement.Snapshot()
                    });
                return;

            case "start":
                {
                    var pageId =
                        S(
                            data,
                            "pageId");

                    if (string.IsNullOrWhiteSpace(
                            pageId))
                    {
                        await Reply(
                            false,
                            "invalid_movement_start");
                        return;
                    }

                    var result =
                        Movement.Start(
                            pageId);

                    await Reply(
                        result.Ok,
                        result.Error,
                        new
                        {
                            state =
                                Movement.GetState(
                                    pageId)
                        });
                    return;
                }

            case "stop":
                {
                    var pageId = S(data, "pageId");
                    var ok = Movement.Stop(pageId);
                    await Reply(
                        ok,
                        ok ? null : "movement_not_running",
                        new
                        {
                            state =
                                Movement.GetState(
                                    pageId)
                        });
                    return;
                }

            case "abort":
                {
                    var pageId = S(data, "pageId");
                    var emergency =
                        !data.TryGetProperty(
                            "emergencyStop",
                            out var emergencyElement) ||
                        emergencyElement.ValueKind != JsonValueKind.False;

                    var ok =
                        Movement.Abort(
                            pageId,
                            emergency);

                    await Reply(
                        ok,
                        ok ? null : "movement_not_running",
                        new
                        {
                            state =
                                Movement.GetState(
                                    pageId)
                        });
                    return;
                }

            case "stopAll":
                {
                    var count =
                        Movement.StopAll(false);

                    await Reply(
                        true,
                        extra: new
                        {
                            count,
                            states =
                                Movement.Snapshot()
                        });
                    return;
                }

            case "abortAll":
                {
                    var count =
                        Movement.StopAll(true);

                    await Reply(
                        true,
                        extra: new
                        {
                            count,
                            states =
                                Movement.Snapshot()
                        });
                    return;
                }

            default:
                await Reply(
                    false,
                    "unknown_movement_action");
                return;
        }
    }

    private async Task HandleDispatcherCommand(
        Guid connectionId,
        IHubWebSocketClient ws,
        JsonElement data,
        CancellationToken ct)
    {
        var requestId = S(data, "requestId");
        var action = S(data, "action");

        async Task Reply(
            bool ok,
            string? message = null,
            object? extra = null)
        {
            await Send(ws, "dispatcherResponse", new
            {
                requestId,
                action,
                ok,
                message,
                extra
            });
        }

        static ushort[] ReadUShortArray(
            JsonElement source,
            string propertyName,
            int maxValue = 65535)
        {
            if (source.ValueKind != JsonValueKind.Object ||
                !source.TryGetProperty(propertyName, out var raw) ||
                raw.ValueKind != JsonValueKind.Array)
                return Array.Empty<ushort>();

            return raw
                .EnumerateArray()
                .Select(x =>
                    x.TryGetInt32(out var n) &&
                    n is >= 1 &&
                    n <= maxValue
                        ? (ushort)n
                        : (ushort)0)
                .Where(x => x != 0)
                .Distinct()
                .OrderBy(x => x)
                .ToArray();
        }

        static string[] ReadStringArray(
            JsonElement source,
            string propertyName)
        {
            if (source.ValueKind != JsonValueKind.Object ||
                !source.TryGetProperty(propertyName, out var raw) ||
                raw.ValueKind != JsonValueKind.Array)
                return Array.Empty<string>();

            return raw
                .EnumerateArray()
                .Where(item =>
                    item.ValueKind ==
                        JsonValueKind.String)
                .Select(item =>
                    (item.GetString() ?? "")
                        .Trim())
                .Where(value =>
                    value.Length is
                        > 0 and <= 240)
                .Distinct(
                    StringComparer.Ordinal)
                .OrderBy(
                    value => value,
                    StringComparer.Ordinal)
                .ToArray();
        }

        static DispatcherRouteBlockRequirement[] ReadRouteBlocks(
            JsonElement source)
        {
            if (source.ValueKind != JsonValueKind.Object ||
                !source.TryGetProperty(
                    "downstreamBlocks",
                    out var raw) ||
                raw.ValueKind !=
                    JsonValueKind.Array)
                return [];

            var result =
                new List<DispatcherRouteBlockRequirement>();

            foreach (var item in raw.EnumerateArray())
            {
                if (item.ValueKind !=
                        JsonValueKind.Object ||
                    !item.TryGetProperty(
                        "blockId",
                        out var blockIdElement) ||
                    !blockIdElement.TryGetInt32(
                        out var blockId) ||
                    blockId is < 1 or > 65535)
                    continue;

                var sensorAddress =
                    item.TryGetProperty(
                        "sensorAddress",
                        out var sensorElement) &&
                    sensorElement.TryGetInt32(
                        out var sensor) &&
                    sensor is >= 1 and <= 65535
                        ? sensor
                        : 0;

                result.Add(
                    new DispatcherRouteBlockRequirement(
                        (ushort)blockId,
                        (ushort)sensorAddress));
            }

            return result
                .GroupBy(item =>
                    item.BlockId)
                .Select(group =>
                    group.First())
                .ToArray();
        }

        static DispatcherTurnoutRequirement[] ReadTurnouts(
            JsonElement source)
        {
            if (source.ValueKind != JsonValueKind.Object ||
                !source.TryGetProperty("turnouts", out var raw) ||
                raw.ValueKind != JsonValueKind.Array)
                return Array.Empty<DispatcherTurnoutRequirement>();

            var result =
                new List<DispatcherTurnoutRequirement>();

            foreach (var item in raw.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object ||
                    !item.TryGetProperty("address", out var addressElement) ||
                    !addressElement.TryGetInt32(out var address) ||
                    address is < 1 or > 2048)
                    continue;

                var closed =
                    item.TryGetProperty("closed", out var closedElement) &&
                    closedElement.ValueKind == JsonValueKind.True;

                result.Add(
                    new DispatcherTurnoutRequirement(
                        (ushort)address,
                        closed));
            }

            return result.ToArray();
        }

        switch (action)
        {
            case "snapshot":
                await Reply(
                    true,
                    extra: new
                    {
                        leases =
                            Dispatcher.Snapshot(),
                        routes =
                            Dispatcher.RouteSnapshot()
                    });
                return;

            case "acquireLeg":
                {
                    var ownerId = S(data, "ownerId");
                    var ownerName = S(data, "ownerName");
                    var loco = I(data, "locoAddress");
                    var fromBlock = I(data, "fromBlockId");
                    var toBlock = I(data, "toBlockId");

                    if (loco is < 1 or > 10239 ||
                        fromBlock is < 1 or > 65535 ||
                        toBlock is < 1 or > 65535)
                    {
                        await Reply(false, "invalid_dispatcher_leg");
                        return;
                    }

                    var request =
                        new DispatcherLegRequest(
                            ownerId,
                            ownerName,
                            (ushort)loco,
                            (ushort)fromBlock,
                            (ushort)toBlock,
                            ReadTurnouts(data),
                            ReadUShortArray(
                                data,
                                "safetySensors"),
                            ReadStringArray(
                                data,
                                "resourceKeys")
                                .Select(
                                    DispatcherRuntime.ResourceToken)
                                .Where(token =>
                                    token != 0)
                                .Distinct()
                                .OrderBy(token =>
                                    token)
                                .ToArray(),
                            Math.Clamp(
                                IOr(
                                    data,
                                    "timeoutMs",
                                    0),
                                0,
                                600000),
                            Math.Clamp(
                                IOr(
                                    data,
                                    "setDelayMs",
                                    250),
                                0,
                                600000));

                    DispatcherAcquireResult result;

                    try
                    {
                        result =
                            await Dispatcher.AcquireLegAsync(
                                request,
                                ct);
                    }
                    catch (OperationCanceledException)
                    {
                        return;
                    }

                    await Reply(
                        result.Ok,
                        result.Error,
                        new
                        {
                            lease = result.Lease,
                            blockingSensor =
                                result.BlockingSensor,
                            blockingBlock =
                                result.BlockingBlock,
                            turnoutConflicts =
                                result.TurnoutConflicts
                        });
                    return;
                }

            case "releaseLeg":
                {
                    var ownerId = S(data, "ownerId");

                    if (string.IsNullOrWhiteSpace(ownerId))
                    {
                        await Reply(false, "invalid_owner");
                        return;
                    }

                    var released =
                        Dispatcher.ReleaseLeg(
                            ownerId);

                    await Reply(
                        released,
                        released
                            ? null
                            : "dispatcher_lease_not_found",
                        new
                        {
                            leases =
                                Dispatcher.Snapshot()
                        });
                    return;
                }

            case "acquireRoute":
                {
                    var ownerId =
                        S(
                            data,
                            "ownerId");

                    var ownerName =
                        S(
                            data,
                            "ownerName");

                    var loco =
                        I(
                            data,
                            "locoAddress");

                    var sourceBlock =
                        I(
                            data,
                            "sourceBlockId");

                    var downstream =
                        ReadRouteBlocks(
                            data);

                    if (string.IsNullOrWhiteSpace(
                            ownerId) ||
                        loco is < 1 or > 10239 ||
                        sourceBlock is < 1 or > 65535 ||
                        downstream.Length == 0)
                    {
                        await Reply(
                            false,
                            "invalid_dispatcher_route");
                        return;
                    }

                    DispatcherRouteAcquireResult result;

                    try
                    {
                        result =
                            await Dispatcher.AcquireRouteAsync(
                                new DispatcherRouteRequest(
                                    ownerId,
                                    ownerName,
                                    (ushort)loco,
                                    (ushort)sourceBlock,
                                    downstream,
                                    ReadTurnouts(
                                        data),
                                    ReadStringArray(
                                        data,
                                        "resourceKeys")
                                        .Select(
                                            DispatcherRuntime.ResourceToken)
                                        .Where(token =>
                                            token != 0)
                                        .Distinct()
                                        .OrderBy(token =>
                                            token)
                                        .ToArray(),
                                    Math.Clamp(
                                        IOr(
                                            data,
                                            "timeoutMs",
                                            0),
                                        0,
                                        600000),
                                    Math.Clamp(
                                        IOr(
                                            data,
                                            "setDelayMs",
                                            250),
                                        0,
                                        600000)),
                                ct);
                    }
                    catch (OperationCanceledException)
                    {
                        return;
                    }

                    await Reply(
                        result.Ok,
                        result.Error,
                        new
                        {
                            lease =
                                result.Lease,
                            blockingSensor =
                                result.BlockingSensor,
                            blockingBlock =
                                result.BlockingBlock,
                            turnoutConflicts =
                                result.TurnoutConflicts
                        });
                    return;
                }

            case "commitRoute":
                {
                    var ownerId =
                        S(
                            data,
                            "ownerId");

                    var committed =
                        Dispatcher.CommitRoute(
                            ownerId);

                    await Reply(
                        committed,
                        committed
                            ? null
                            : "dispatcher_route_commit_failed",
                        new
                        {
                            leases =
                                Dispatcher.Snapshot(),
                            routes =
                                Dispatcher.RouteSnapshot()
                        });
                    return;
                }

            case "releaseRoute":
                {
                    var ownerId =
                        S(
                            data,
                            "ownerId");

                    var released =
                        Dispatcher.ReleaseRoute(
                            ownerId);

                    await Reply(
                        released,
                        released
                            ? null
                            : "dispatcher_route_lease_not_found",
                        new
                        {
                            leases =
                                Dispatcher.Snapshot(),
                            routes =
                                Dispatcher.RouteSnapshot()
                        });
                    return;
                }

            case "releaseAll":
                {
                    var released =
                        Dispatcher.ReleaseAll();

                    await Reply(
                        true,
                        extra: new
                        {
                            released,
                            leases =
                                Dispatcher.Snapshot(),
                            routes =
                                Dispatcher.RouteSnapshot()
                        });
                    return;
                }

            default:
                await Reply(
                    false,
                    "unknown_dispatcher_action");
                return;
        }
    }

    private async Task HandleFastClockCommand(IHubWebSocketClient ws, JsonElement data)
    {
        var requestId = S(data, "requestId");
        var action = S(data, "action");

        FastClockSnapshot snapshot;
        var changed = false;

        switch (action)
        {
            case "snapshot":
                snapshot = FastClock.GetSnapshot();
                break;

            case "run":
                snapshot = FastClock.Run();
                changed = true;
                break;

            case "pause":
                snapshot = FastClock.Pause();
                changed = true;
                break;

            case "reset":
                snapshot = FastClock.Reset();
                changed = true;
                break;

            case "setSpeed":
                snapshot = FastClock.SetSpeed(
                    D(
                        data,
                        "speed",
                        1d));
                changed = true;
                break;

            case "setTime":
                snapshot = FastClock.SetTime(
                    D(
                        data,
                        "timeMs",
                        0d));
                changed = true;
                break;

            default:
                await Send(
                    ws,
                    "fastClockResponse",
                    new
                    {
                        requestId,
                        action,
                        ok = false,
                        message = "Unknown fast clock command action."
                    });
                return;
        }

        if (changed)
            await Broadcast(
                "fastClockChanged",
                snapshot);

        await Send(
            ws,
            "fastClockResponse",
            new
            {
                requestId,
                action,
                ok = true,
                snapshot
            });
    }

    private async Task Programming(JsonElement d, CancellationToken ct)
    {
        string id = S(d, "requestId"), action = S(d, "action");
        async Task Fail(string message) => await SendProgrammingResponse(id, action, false, message);

        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(action)) { await Fail("Invalid programming request."); return; }
        if (!CommandCenter.Connected) { await Fail("Command center is not connected."); return; }

        if (action == "accessoryLearn")
        {
            int address = I(d, "address");
            if (address <= 0 || address > 2044) { await Fail("Invalid accessory address."); return; }

            bool sent =
                await CommandCenter.SetAccessoryAsync(
                    address,
                    B(d, "active"),
                    ct);

            await SendProgrammingResponse(
                id,
                action,
                sent,
                sent
                    ? "Accessory programming command sent."
                    : "Accessory programming command could not be sent.",
                address);

            return;
        }

        if (string.Equals(
                CommandCenter.Type,
                "loconet",
                StringComparison.OrdinalIgnoreCase))
        {
            int address = I(d, "address");
            int cv = I(d, "cv");
            int value = IOr(d, "value", -1);
            CommandCenterProgrammingResult result;

            if (action == "readCv")
                result = await CommandCenter.ReadServiceCvAsync(cv, ct);
            else if (action == "writeCv")
                result = await CommandCenter.WriteServiceCvAsync(cv, value, ct);
            else if (action == "pomReadCv")
                result = await CommandCenter.ReadPomCvAsync(address, cv, ct);
            else if (action == "pomWriteCv")
                result = await CommandCenter.WritePomCvAsync(address, cv, value, ct);
            else if (action == "accessoryPomWriteCv")
                result = await CommandCenter.WriteAccessoryPomCvAsync(address, cv, value, ct);
            else if (action == "readAddress")
            {
                // Read CV29 first: its long-address bit tells us whether to
                // report CV1 or the combined CV17/CV18 address.
                var config = await CommandCenter.ReadServiceCvAsync(29, ct);
                if (!config.Ok)
                    result = config;
                else if ((config.Value & 0x20) == 0)
                    result = await CommandCenter.ReadServiceCvAsync(1, ct);
                else
                {
                    var high = await CommandCenter.ReadServiceCvAsync(17, ct);
                    var low = high.Ok
                        ? await CommandCenter.ReadServiceCvAsync(18, ct)
                        : high;
                    result = high.Ok && low.Ok
                        ? new CommandCenterProgrammingResult(true, 29,
                            ((high.Value & 0x3F) << 8) | low.Value,
                            "Long locomotive address read successfully.")
                        : high.Ok ? low : high;
                }
            }
            else if (action == "writeAddress")
            {
                if (address is < 1 or > 10239)
                {
                    await Fail("Invalid locomotive address.");
                    return;
                }

                // Preserve unrelated CV29 settings while switching short/
                // long addressing. Do not start writing if CV29 cannot be read.
                var config = await CommandCenter.ReadServiceCvAsync(29, ct);
                if (!config.Ok)
                    result = config;
                else if (address <= 127)
                {
                    var first = await CommandCenter.WriteServiceCvAsync(1, address, ct);
                    result = first.Ok
                        ? await CommandCenter.WriteServiceCvAsync(29, config.Value & ~0x20, ct)
                        : first;
                }
                else
                {
                    var first = await CommandCenter.WriteServiceCvAsync(
                        17, 0xC0 | (address >> 8), ct);
                    var second = first.Ok
                        ? await CommandCenter.WriteServiceCvAsync(18, address & 0xFF, ct)
                        : first;
                    result = first.Ok && second.Ok
                        ? await CommandCenter.WriteServiceCvAsync(29, config.Value | 0x20, ct)
                        : first.Ok ? second : first;
                }
                if (result.Ok)
                    result = result with
                    {
                        Value = address,
                        Message = "Locomotive address written on programming track."
                    };
            }
            else
            {
                await Fail("Unsupported LocoNet programming action.");
                return;
            }

            await SendProgrammingResponse(
                id, action, result.Ok, result.Message, result.Value, result.Raw);
            return;
        }

        if (string.Equals(
                CommandCenter.Type,
                "z21",
                StringComparison.OrdinalIgnoreCase))
        {
            int address = I(d, "address");
            int cv = I(d, "cv");
            int value = IOr(d, "value", -1);

            CommandCenterProgrammingResult result;

            if (action == "readCv")
                result =
                    await CommandCenter.ReadServiceCvAsync(
                        cv,
                        ct);
            else if (action == "writeCv")
                result =
                    await CommandCenter.WriteServiceCvAsync(
                        cv,
                        value,
                        ct);
            else if (action == "pomReadCv")
                result =
                    await CommandCenter.ReadPomCvAsync(
                        address,
                        cv,
                        ct);
            else if (action == "pomWriteCv")
                result =
                    await CommandCenter.WritePomCvAsync(
                        address,
                        cv,
                        value,
                        ct);
            else if (action == "accessoryPomReadCv")
                result =
                    await CommandCenter.ReadAccessoryPomCvAsync(
                        address,
                        cv,
                        ct);
            else if (action == "accessoryPomWriteCv")
                result =
                    await CommandCenter.WriteAccessoryPomCvAsync(
                        address,
                        cv,
                        value,
                        ct);
            else
            {
                await Fail("Unsupported Z21 programming action.");
                return;
            }

            await SendProgrammingResponse(
                id,
                action,
                result.Ok,
                result.Message,
                result.Value,
                result.Raw);

            return;
        }

        lock (_programmingGate)
            if (_pendingProgramming != null) { _ = Fail("Another decoder programming request is already running."); return; }

        string cmd; int expectedCv = -1; bool wait = true;
        if (action == "readAddress") cmd = "<R LOCOID>";
        else if (action == "writeAddress")
        {
            int address = I(d, "address"); if (address <= 0 || address > 10239) { await Fail("Invalid locomotive address."); return; }
            cmd = $"<W {address}>";
        }
        else if (action == "readCv")
        {
            int cv = I(d, "cv"); if (cv <= 0 || cv > 1024) { await Fail("Invalid CV number."); return; }
            expectedCv = cv; cmd = $"<R {cv}>";
        }
        else if (action == "writeCv")
        {
            int cv = I(d, "cv"), value = IOr(d, "value", -1);
            if (cv <= 0 || cv > 1024 || value < 0 || value > 255) { await Fail("Invalid CV number or value."); return; }
            expectedCv = cv; cmd = $"<W {cv} {value}>";
        }
        else if (action == "pomWriteCv")
        {
            int address = I(d, "address"), cv = I(d, "cv"), value = IOr(d, "value", -1);
            if (address <= 0 || address > 10239 || cv <= 0 || cv > 1024 || value < 0 || value > 255) { await Fail("Invalid POM address, CV or value."); return; }
            cmd = $"<w {address} {cv} {value}>"; wait = false;
        }
        else
        {
            await Fail("Unsupported programming action.");
            return;
        }

        long token = 0;
        if (wait)
        {
            if (HubState.ProgrammingJoined) { HubState.ProgrammingJoined = false; await BroadcastPower(); }
            lock (_programmingGate)
            {
                token = ++_programmingToken;
                _pendingProgramming = new(id, action, expectedCv, token);
            }
        }

        bool ok = await CommandCenter.SendRawAsync(cmd, true, ct);
        if (!ok)
        {
            if (wait) ClearPendingProgramming(token);
            await Fail("Programming command could not be sent.");
            return;
        }

        Logger.LogInformation("Programming command sent: {Action} {Command}", action, cmd);

        if (!wait)
        {
            await SendProgrammingResponse(id, action, true, "Programming command sent.", IOr(d, "value", -1), cmd);
            return;
        }

        _ = ProgrammingTimeout(token);
    }

    private async Task ProgrammingTimeout(long token)
    {
        await Task.Delay(ProgrammingTimeoutMs);
        PendingProgramming? p = null;
        lock (_programmingGate)
        {
            if (_pendingProgramming?.Token != token) return;
            p = _pendingProgramming;
            _pendingProgramming = null;
        }

        if (p != null)
            await SendProgrammingResponse(p.RequestId, p.Action, false, "Programming command timed out.");
    }

    private void ClearPendingProgramming(long token)
    {
        lock (_programmingGate)
            if (_pendingProgramming?.Token == token)
                _pendingProgramming = null;
    }

    private void HandleProgrammingRawResponse(string raw)
    {
        PendingProgramming? p;
        lock (_programmingGate) p = _pendingProgramming;

        if (p == null || raw.Length < 4 || !raw.EndsWith('>')) return;

        // DCC-EX <R LOCOID> responds <r LOCOID address>, unlike
        // <R> (which may return an active consist address).
        // CV reads respond <v cv value>; address writes respond <w address>.
        bool isR = raw.StartsWith("<r ", StringComparison.Ordinal);
        bool isV = raw.StartsWith("<v ", StringComparison.Ordinal);
        bool isW = raw.StartsWith("<w ", StringComparison.Ordinal);
        if (p.Action == "readAddress")
        {
            if (!isR) return;
            var body = raw.Substring(3, raw.Length - 4).Trim();
            var parts = body.Split((char[]?)null,
                StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length != 2 ||
                !string.Equals(parts[0], "LOCOID",
                    StringComparison.OrdinalIgnoreCase) ||
                !int.TryParse(parts[1], out var address)) return;

            bool ok = address is >= 1 and <= 10239;
            ClearPendingProgramming(p.Token);
            _ = SendProgrammingResponse(
                p.RequestId, p.Action, ok,
                ok ? "Decoder's own address read successfully."
                   : $"DCC-EX decoder address read failed ({address}).",
                ok ? address : -1, raw);
            return;
        }

        if (p.Action == "writeAddress")
        {
            if (!isW) return;
            var body = raw.Substring(3, raw.Length - 4).Trim();
            if (!int.TryParse(body, out var address)) return;
            bool ok = address is >= 1 and <= 10239;
            ClearPendingProgramming(p.Token);
            _ = SendProgrammingResponse(
                p.RequestId, p.Action, ok,
                ok ? "Decoder address written and verified."
                   : $"DCC-EX address write failed ({address}).",
                ok ? address : -1, raw);
            return;
        }

        if (p.Action == "readCv" && !isV) return;
        if (p.Action == "writeCv" && !isR) return;
        if (p.Action is not ("readCv" or "writeCv")) return;

        var payload = raw.Substring(3, raw.Length - 4).Trim();
        var cvParts = payload.Split((char[]?)null,
            StringSplitOptions.RemoveEmptyEntries);
        if (cvParts.Length != 2 ||
            !int.TryParse(cvParts[0], out var cv) ||
            !int.TryParse(cvParts[1], out var value) ||
            cv != p.ExpectedCv) return;

        bool success = value is >= 0 and <= 255;
        ClearPendingProgramming(p.Token);
        _ = SendProgrammingResponse(
            p.RequestId, p.Action, success,
            success ? "CV operation completed."
                    : $"DCC-EX CV operation failed ({value}).",
            success ? value : -1, raw);
    }

    private Task SendProgrammingResponse(
        string requestId,
        string action,
        bool ok,
        string message,
        int value = -1,
        string raw = "")
    {
        if (value >= 0 && raw.Length > 0) return Broadcast("programmingResponse", new { requestId, action, ok, message, value, raw });
        if (value >= 0) return Broadcast("programmingResponse", new { requestId, action, ok, message, value });
        if (raw.Length > 0) return Broadcast("programmingResponse", new { requestId, action, ok, message, raw });
        return Broadcast("programmingResponse", new { requestId, action, ok, message });
    }

    public Task BroadcastRuntimeSnapshot()
    {
        // IMPORTANT:
        // Layout/config HTTP handlers may call this and await it. WS delivery must
        // never be able to hold an HTTP save request open.
        _ = BroadcastRuntimeSnapshotCore();
        return Task.CompletedTask;
    }

    private object CommandCenterInfo()
    {
        var x = CommandCenterConfigStore.Current;

        return new
        {
            alive = CommandCenter.Connected,
            power = HubState.TrackPower,
            type = CommandCenter.Type,
            name = CommandCenter.Name,
            transport = x.Transport,
            ip = x.IsSerial ? "" : x.TcpHost,
            port = x.IsSerial ? 0 : x.TcpPort,
            serialPort = x.IsSerial ? x.SerialPort : "",
            baudRate = x.IsSerial ? CommandCenterSettings.DccExSerialBaudRate : 0,
            connectionString = x.IsSerial
                ? $"{x.SerialPort} @ {CommandCenterSettings.DccExSerialBaudRate} baud"
                : $"{x.TcpHost}:{x.TcpPort}"
        };
    }

    private async Task BroadcastRuntimeSnapshotCore()
    {
        await _runtimeSnapshotGate.WaitAsync();

        try
        {
            await Broadcast(
                "commandCenterInfo",
                CommandCenterInfo());

            await BroadcastPower();
            await BroadcastStatus();
            await Broadcast(
                "fastClockChanged",
                FastClock.GetSnapshot());

            foreach (var item in LayoutRuntime.RuntimeSnapshot())
                await Broadcast(item.Type, item.Data);
        }
        catch (Exception ex)
        {
            Logger.LogWarning(
                ex,
                "Runtime snapshot broadcast failed");
        }
        finally
        {
            _runtimeSnapshotGate.Release();
        }
    }

    public Task BroadcastStatus() => Broadcast("dccExStatus", Status());

    private object Status()
    {
        var x =
            CommandCenterConfigStore.Current;

        var configured =
            CommandCenter as
                ConfiguredCommandCenter;

        var z21 =
            configured?
                .GetZ21Diagnostics();

        var locoNet =
            configured?
                .GetLocoNetDiagnostics();

        return new
        {
            commandCenterType =
                CommandCenter.Type,
            commandCenterName =
                CommandCenter.Name,
            commandCenterProfile =
                z21?.Profile,
            version = HubState.Station.Version,
            processor = HubState.Station.Processor,
            hardware = HubState.Station.Hardware,
            build = HubState.Station.Build,
            transport = x.Transport,
            host = x.IsSerial ? "" : x.TcpHost,
            port = x.IsSerial ? 0 : x.TcpPort,
            serialPort = x.IsSerial ? x.SerialPort : "",
            baudRate = x.IsSerial
                ? CommandCenterSettings.DccExSerialBaudRate
                : 0,
            alive = CommandCenter.Connected,
            maxLocos = HubState.Station.MaxLocos,
            trackVoltageOn = HubState.TrackPower,
            emergencyStop =
                HubState.EmergencyStop,
            mainCurrentMa = HubState.Tracks.GetValueOrDefault(0)?.CurrentMa ?? 0,
            progCurrentMa = HubState.Tracks.GetValueOrDefault(1)?.CurrentMa ?? 0,
            linkUptimeMs =
                z21 is not null &&
                z21.UdpUptimeMs >= 0
                    ? z21.UdpUptimeMs
                    : (long?)null,
            z21 =
                z21 is null
                    ? null
                    : new
                    {
                        profile =
                            z21.Profile,
                        broadcastFlags =
                            $"0x{z21.BroadcastFlags:X8}",
                        udpUptimeMs =
                            z21.UdpUptimeMs,
                        mainCurrentMa =
                            z21.MainCurrentMa,
                        progCurrentMa =
                            z21.ProgCurrentMa,
                        filteredMainCurrentMa =
                            z21.FilteredMainCurrentMa,
                        temperatureC =
                            z21.TemperatureC,
                        supplyVoltageMv =
                            z21.SupplyVoltageMv,
                        trackVoltageMv =
                            z21.TrackVoltageMv,
                        centralState =
                            z21.CentralState,
                        centralStateEx =
                            z21.CentralStateEx,
                        capabilities =
                            z21.Capabilities,
                        lastSystemStateAgeMs =
                            z21.LastSystemStateAgeMs
                    },
            locoNet =
                locoNet is null
                    ? null
                    : new
                    {
                        lbServerEnabled =
                            locoNet.LbServerEnabled,
                        lbServerConnected =
                            locoNet.LbServerConnected,
                        host =
                            locoNet.Host,
                        lbServerPort =
                            locoNet.LbServerPort,
                        lbServerUptimeMs =
                            locoNet.LbServerUptimeMs,
                        lastLbServerRxAgeMs =
                            locoNet.LastLbServerRxAgeMs,
                        lbServerLinesObserved =
                            locoNet.LbServerLinesObserved,
                        lbServerVersion =
                            locoNet.LbServerVersion,
                        binaryFeedbackEnabled =
                            locoNet.BinaryFeedbackEnabled,
                        binaryPort =
                            locoNet.BinaryPort,
                        sensorFeedbackCount =
                            locoNet.SensorFeedbackCount,
                        lastSensorAddress =
                            locoNet.LastSensorAddress,
                        lastSensorOn =
                            locoNet.LastSensorOn,
                        lastSensorFeedbackAgeMs =
                            locoNet.LastSensorFeedbackAgeMs,
                        lastInterrogateAgeMs =
                            locoNet.LastInterrogateAgeMs,
                        interrogateEnabled =
                            locoNet.InterrogateEnabled
                    },
            tracks = HubState.Tracks.OrderBy(track => track.Key).Select(track => new
            {
                letter = ((char)('A' + track.Key)).ToString(),
                mode = track.Value.Mode,
                currentMa = track.Value.CurrentMa,
                overload = track.Value.Overload,
                tripMa = track.Value.TripMa
            }),
            hub = new
            {
                platform = Environment.OSVersion.Platform.ToString(),
                framework = Environment.Version.ToString(),
                wsClients = ClientCount
            }
        };
    }

    public Task BroadcastPowerState() => BroadcastPower();

    private Task BroadcastPower() => Broadcast("powerInfo", new
    {
        emergencyStop = HubState.EmergencyStop,
        trackVoltageOn = HubState.TrackPower,
        trackVoltageOff = !HubState.TrackPower,
        shortCircuit = false,
        programmingModeActive = HubState.ProgrammingPower,
        programmingJoined = HubState.ProgrammingJoined
    });

    private Task BroadcastLoco(LocoFeedback l) => Broadcast("locoState", new
    {
        loco = new
        {
            address = l.Address,
            speed = l.Speed,
            direction = l.Forward ? "forward" : "reverse",
            functionsMask = l.FunctionsMask
        }
    });

    private async Task SendSnapshot(IHubWebSocketClient ws)
    {
        await SendCommandCenterInfo(ws);
        await SendPower(ws);
        await Send(ws, "dccExStatus", Status());
        await Send(
            ws,
            "fastClockChanged",
            FastClock.GetSnapshot());

        await Send(
            ws,
            "locoCounterSnapshot",
            LocoCounters.Snapshot());

        foreach (var l in HubState.Locos.Values)
        {
            await Send(ws, "locoState", new
            {
                loco = new
                {
                    address = l.Address,
                    speed = l.Speed,
                    direction = l.Forward ? "forward" : "reverse",
                    functionsMask = l.FunctionsMask
                }
            });
        }

        foreach (var item in LayoutRuntime.RuntimeSnapshot())
            await Send(ws, item.Type, item.Data);

        await Send(ws, "switchManChanged", new { locks = SwitchMan.Snapshot() });
        await Send(
            ws,
            "dispatcherChanged",
            new
            {
                leases =
                    Dispatcher.Snapshot(),
                routes =
                    Dispatcher.RouteSnapshot()
            });
        await Send(ws, "movementSnapshot", new { states = Movement.Snapshot() });
        await Send(
            ws,
            "trainTrackingChanged",
            TrainTracking.Snapshot());
        await Send(ws, "automationScriptSnapshot", new { states = Scripts.Snapshot(), finishing = Scripts.Finishing });
        await Send(ws, "flowStateChanged", Flows.Snapshot());
        await Send(ws, "timetableStateChanged", Timetable.Snapshot());
    }

    private Task SendCommandCenterInfo(IHubWebSocketClient ws)
    {
        return Send(
            ws,
            "commandCenterInfo",
            CommandCenterInfo());
    }

    private Task SendPower(IHubWebSocketClient ws)
    {
        return Send(ws, "powerInfo", new
        {
            emergencyStop = HubState.EmergencyStop,
            trackVoltageOn = HubState.TrackPower,
            trackVoltageOff = !HubState.TrackPower,
            shortCircuit = false,
            programmingModeActive = HubState.ProgrammingPower,
            programmingJoined = HubState.ProgrammingJoined
        });
    }

    public Task Broadcast(
        string type,
        object data) =>
        BroadcastSerialized(
            SerializeMessage(
                type,
                data));

    private async Task BroadcastSerialized(
        byte[] payload)
    {
        foreach (
            var kv in
                Clients.ToArray()
        )
        {
            try
            {
                await SendSerialized(
                    kv.Value,
                    payload);
            }
            catch (OperationCanceledException)
            {
                Clients.TryRemove(
                    kv.Key,
                    out _);

                await SafeClose(
                    kv.Value);
            }
            catch
            {
                Clients.TryRemove(
                    kv.Key,
                    out _);

                await SafeClose(
                    kv.Value);
            }
        }
    }

    private static Task Send(
        IHubWebSocketClient ws,
        string type,
        object data) =>
        SendSerialized(
            ws,
            SerializeMessage(
                type,
                data));

    private static byte[] SerializeMessage(
        string type,
        object data) =>
        JsonSerializer.SerializeToUtf8Bytes(
            new
            {
                type,
                data
            },
            Json);

    private static async Task SendSerialized(
        IHubWebSocketClient ws,
        byte[] payload)
    {
        if (!ws.IsConnected)
            return;

        using var timeout =
            new CancellationTokenSource(
                WebSocketSendTimeout);

        await ws.SendTextAsync(
            payload,
            timeout.Token);
    }

    private static async Task SafeClose(
        IHubWebSocketClient ws)
    {
        try
        {
            await ws.CloseAsync(
                CancellationToken.None);
        }
        catch
        {
            // Nothing else to do for a dead client.
        }
    }

    private static int I(JsonElement d, string n)
    {
        if (d.ValueKind != JsonValueKind.Object || !d.TryGetProperty(n, out var x)) return 0;
        if (x.ValueKind == JsonValueKind.Number && x.TryGetInt32(out var number)) return number;
        if (x.ValueKind == JsonValueKind.String && int.TryParse(x.GetString(), out var textNumber)) return textNumber;
        return 0;
    }

    private static int IOr(JsonElement d, string n, int fallback)
    {
        if (d.ValueKind != JsonValueKind.Object || !d.TryGetProperty(n, out var x)) return fallback;
        if (x.ValueKind == JsonValueKind.Number && x.TryGetInt32(out var number)) return number;
        if (x.ValueKind == JsonValueKind.String && int.TryParse(x.GetString(), out var textNumber)) return textNumber;
        return fallback;
    }

    private static double D(JsonElement d, string n, double fallback)
    {
        if (d.ValueKind != JsonValueKind.Object || !d.TryGetProperty(n, out var x))
            return fallback;

        if (x.ValueKind == JsonValueKind.Number && x.TryGetDouble(out var number))
            return number;

        return fallback;
    }

    private static bool B(JsonElement d, string n) =>
        d.ValueKind == JsonValueKind.Object &&
        d.TryGetProperty(n, out var x) &&
        x.ValueKind == JsonValueKind.True;

    private static string S(JsonElement d, string n) =>
        d.ValueKind == JsonValueKind.Object &&
        d.TryGetProperty(n, out var x)
            ? x.GetString() ?? ""
            : "";
}
