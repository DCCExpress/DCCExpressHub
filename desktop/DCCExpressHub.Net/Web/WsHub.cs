using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed class WsHub
{
    private readonly ICommandCenter CommandCenter;
    private readonly HubState HubState;
    private readonly CommandCenterConfigStore CommandCenterConfigStore;
    readonly LayoutRuntime LayoutRuntime;
    readonly RuntimeStateStore RuntimeStateStore;
    private readonly ILogger<WsHub> Logger;
    private readonly ConcurrentDictionary<Guid, WebSocket> Clients = new();
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly object _programmingGate = new();
    private PendingProgramming? _pendingProgramming;
    private sealed record PendingProgramming(string RequestId, string Action, int ExpectedCv, long Token);
    private long _programmingToken;
    private const int ProgrammingTimeoutMs = 24000;
    private static readonly TimeSpan WebSocketSendTimeout = TimeSpan.FromSeconds(2);
    public int ClientCount => Clients.Count;

    public WsHub(ICommandCenter cc, HubState state, LayoutRuntime runtime, RuntimeStateStore stateStore, CommandCenterConfigStore ccConfig, ILogger<WsHub> log)
    {
        CommandCenter = cc;
        HubState = state;
        LayoutRuntime = runtime;
        RuntimeStateStore = stateStore;
        CommandCenterConfigStore = ccConfig;
        LayoutRuntime.Changed += (type, data) => _ = Broadcast(type, data); Logger = log;

        cc.RawInfo += raw =>
        {
            HandleProgrammingRawResponse(raw);
            if (CommandCenter.EmergencyPauseStateKnown && HubState.EmergencyStop != CommandCenter.EmergencyPaused)
            {
                HubState.EmergencyStop = CommandCenter.EmergencyPaused;
                _ = BroadcastPower();
            }
            _ = Broadcast("rawInfo", new { raw });
        };
        cc.StationInfoChanged += x => HubState.Station = x;
        cc.TrackConfigurationChanged += x => HubState.Tracks.GetOrAdd(x.Index, _ => new()).Mode = x.Mode;
        cc.CurrentTelemetryChanged += x => { for (int i = 0; i < x.Length; i++) { var t = HubState.Tracks.GetOrAdd(i, _ => new()); t.Overload = x[i] < 0; t.CurrentMa = Math.Max(0, x[i]); } };
        cc.TripTelemetryChanged += x => { for (int i = 0; i < x.Length; i++) HubState.Tracks.GetOrAdd(i, _ => new()).TripMa = Math.Max(0, x[i]); };
        cc.PowerFeedbackChanged += x =>
        {
            var wasMainOn = HubState.TrackPower;
            ApplyPower(x);
            if (wasMainOn && !HubState.TrackPower) _ = RuntimeStateStore.SaveAsync();
            _ = BroadcastPower();
        };
        cc.LocoFeedbackChanged += x => { HubState.Locos[x.Address] = x; _ = BroadcastLoco(x); };
        cc.ConnectionChanged += connected =>
        {
            // The backend is the single source of truth for command-center
            // connectivity. Push the authoritative state immediately when the
            // TCP/Serial transport changes instead of waiting for the next
            // browser heartbeat.
            _ = Broadcast(
                "commandCenterInfo",
                CommandCenterInfo());

            _ = BroadcastStatus();
        };
    }

    private void ApplyPower(PowerFeedback p)
    {
        if (p.Target == "All") { HubState.TrackPower = p.On; HubState.ProgrammingPower = p.On; }
        else if (p.Target == "Main") HubState.TrackPower = p.On;
        else if (p.Target == "Programming") { HubState.ProgrammingPower = p.On; HubState.ProgrammingJoined = false; }
        else if (p.Target == "Joined") { HubState.TrackPower = p.On; HubState.ProgrammingPower = p.On; HubState.ProgrammingJoined = p.On; }
        else if (p.Target == "Track" && p.TrackIndex >= 0) HubState.Tracks.GetOrAdd(p.TrackIndex, _ => new()).Power = p.On;
    }

    public async Task Accept(HttpContext ctx)
    {
        var ws = await ctx.WebSockets.AcceptWebSocketAsync(); var id = Guid.NewGuid(); Clients[id] = ws;
        try
        {
            await Send(ws, "ws:welcome", new { message = "DCCExpressHub" });
            await SendSnapshot(ws);
            var buf = new byte[64 * 1024];
            while (ws.State == WebSocketState.Open)
            {
                var ms = new MemoryStream(); WebSocketReceiveResult r;
                do { r = await ws.ReceiveAsync(buf, ctx.RequestAborted); if (r.MessageType == WebSocketMessageType.Close) return; ms.Write(buf, 0, r.Count); } while (!r.EndOfMessage);
                var text = Encoding.UTF8.GetString(ms.ToArray()); await Handle(ws, text, ctx.RequestAborted);
            }
        }
        finally { Clients.TryRemove(id, out _); try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None); } catch { } }
    }

    private async Task Handle(WebSocket ws, string text, CancellationToken ct)
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
                case "heartbeat":
                    await Send(ws, "heartbeatAck", new { });
                    await SendCommandCenterInfo(ws);
                    await SendPower(ws);
                    return;
                case "setTrackPower":
                    ok = await CommandCenter.SetTrackPowerAsync(B(data, "on"), CommandCenterConfigStore.Current.PowerIncludesProgramming, ct);
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
                        ok = await CommandCenter.SetTurnoutAsync(a, v, ct);
                        if (ok) LayoutRuntime.SetTurnout(a, v);
                        break;
                    }
                case "setSignalAspect":
                    {
                        var a = (ushort)I(data, "address");
                        var v = I(data, "aspect");
                        ok = await CommandCenter.SetSignalAspectAsync(a, v, ct);
                        if (ok)
                        {
                            LayoutRuntime.SetSignal(a, v);
                            if (data.TryGetProperty("turnoutPhysicalValue", out var tp) &&
                                tp.ValueKind is JsonValueKind.True or JsonValueKind.False)
                                LayoutRuntime.SetTurnout(a, tp.GetBoolean());
                        }
                        break;
                    }
                case "setBasicAccessory":
                    {
                        var a = (ushort)I(data, "address");
                        var v = B(data, "active");
                        ok = await CommandCenter.SetAccessoryAsync(a, v, ct);
                        if (ok) LayoutRuntime.SetAccessory(a, v);
                        break;
                    }
                case "setVpin":
                    {
                        var a = (ushort)I(data, "vpin");
                        var v = B(data, "active");
                        ok = await CommandCenter.SetVPinAsync(a, v, ct);
                        if (ok) LayoutRuntime.SetVPin(a, v);
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

    private async Task Programming(JsonElement d, CancellationToken ct)
    {
        string id = S(d, "requestId"), action = S(d, "action");
        async Task Fail(string message) => await SendProgrammingResponse(id, action, false, message);

        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(action)) { await Fail("Invalid programming request."); return; }
        if (!CommandCenter.Connected) { await Fail("Command center is not connected."); return; }

        lock (_programmingGate)
            if (_pendingProgramming != null) { _ = Fail("Another decoder programming request is already running."); return; }

        string cmd; int expectedCv = -1; bool wait = true;
        if (action == "readAddress") cmd = "<R>";
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
        else if (action == "accessoryLearn")
        {
            int address = I(d, "address");
            if (address <= 0 || address > 2044) { await Fail("Invalid accessory address."); return; }
            bool sent = await CommandCenter.SetAccessoryAsync(address, B(d, "active"), ct);
            await SendProgrammingResponse(id, action, sent,
                sent ? "Accessory programming command sent." : "Accessory programming command could not be sent.",
                address);
            return;
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

        bool isR = raw.StartsWith("<r ", StringComparison.Ordinal);
        bool isV = raw.StartsWith("<v ", StringComparison.Ordinal);

        if (!isR && !isV) return;
        if (p.Action == "readCv" && !isV) return;
        if ((p.Action == "readAddress" || p.Action == "writeAddress" || p.Action == "writeCv") && !isR) return;

        var body = raw.Substring(3, raw.Length - 4).Trim();
        var parts = body.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);

        if (parts.Length < 1 || !long.TryParse(parts[0], out var first)) return;

        long second = -1;
        bool hasSecond = parts.Length > 1 && long.TryParse(parts[1], out second);

        if (p.Action is "readAddress" or "writeAddress")
        {
            bool ok = first >= 0;
            ClearPendingProgramming(p.Token);
            _ = SendProgrammingResponse(
                p.RequestId,
                p.Action,
                ok,
                ok ? "Decoder address operation completed." : "Decoder address operation failed.",
                ok ? (int)first : -1,
                raw);
            return;
        }

        if (p.Action is "readCv" or "writeCv")
        {
            if (!hasSecond) return;
            if (p.ExpectedCv >= 0 && first != p.ExpectedCv) return;

            bool ok = second >= 0;
            ClearPendingProgramming(p.Token);

            _ = SendProgrammingResponse(
                p.RequestId,
                p.Action,
                ok,
                ok ? "CV operation completed." : "CV operation failed.",
                ok ? (int)second : -1,
                raw);
        }
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
        try
        {
            await Broadcast(
                "commandCenterInfo",
                CommandCenterInfo());

            await BroadcastPower();
            await BroadcastStatus();

            foreach (var item in LayoutRuntime.RuntimeSnapshot())
                await Broadcast(item.Type, item.Data);
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Runtime snapshot broadcast failed");
        }
    }

    public Task BroadcastStatus() => Broadcast("dccExStatus", Status());

    private object Status()
    {
        var x =
            CommandCenterConfigStore.Current;

        return new
        {
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
            mainCurrentMa = HubState.Tracks.GetValueOrDefault(0)?.CurrentMa ?? 0,
            progCurrentMa = HubState.Tracks.GetValueOrDefault(1)?.CurrentMa ?? 0,
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

    private async Task SendSnapshot(WebSocket ws)
    {
        await SendCommandCenterInfo(ws);
        await SendPower(ws);
        await Send(ws, "dccExStatus", Status());

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
    }

    private Task SendCommandCenterInfo(WebSocket ws)
    {
        return Send(
            ws,
            "commandCenterInfo",
            CommandCenterInfo());
    }

    private Task SendPower(WebSocket ws)
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

    public async Task Broadcast(string type, object data)
    {
        foreach (var kv in Clients.ToArray())
        {
            try
            {
                await Send(kv.Value, type, data);
            }
            catch (OperationCanceledException)
            {
                Clients.TryRemove(kv.Key, out _);
                TryAbort(kv.Value);
            }
            catch
            {
                Clients.TryRemove(kv.Key, out _);
                TryAbort(kv.Value);
            }
        }
    }

    private static async Task Send(WebSocket ws, string type, object data)
    {
        if (ws.State != WebSocketState.Open)
            return;

        var bytes = JsonSerializer.SerializeToUtf8Bytes(new { type, data }, Json);

        using var timeout = new CancellationTokenSource(WebSocketSendTimeout);

        await ws.SendAsync(
            bytes,
            WebSocketMessageType.Text,
            true,
            timeout.Token);
    }

    private static void TryAbort(WebSocket ws)
    {
        try
        {
            ws.Abort();
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
