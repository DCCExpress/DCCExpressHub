namespace DCCExpressHub.Net.CommandCenter;

public sealed record LocoNetSerialRuntimeDiagnostics(
    string Port, int BaudRate, long LinkUptimeMs, long RxPackets, long TxPackets);

/// <summary>
/// Single native LocoNet command-center protocol implementation shared by
/// serial and LBServer/TCP. All CV, slot, accessory and feedback handling
/// lives here; transport classes only encode/decode wire frames.
/// </summary>
public sealed class LocoNetCommandCenter : BackgroundService, ICommandCenter
{
    private readonly ILogger<LocoNetCommandCenter> _log;
    private readonly ILocoNetTransport _transport;
    private readonly SemaphoreSlim _accessoryPulseGate = new(1, 1);
    private readonly LocoNetStandardTelemetry _standardTelemetry = new();
    private volatile bool _connected;
    private volatile bool _emergencyPaused;
    private readonly SemaphoreSlim _slotGate = new(1, 1);
    private readonly object _slotSync = new();
    private readonly Dictionary<int, int> _slots = new();
    private readonly Dictionary<int, byte> _dirf = new();
    private readonly Dictionary<int, byte> _snd = new();
    private readonly Dictionary<int, int> _speeds = new();
    private readonly Dictionary<int, bool> _sensors = new();
    private readonly SemaphoreSlim _snapshotGate = new(1, 1);
    private readonly SemaphoreSlim _programmingGate = new(1, 1);
    // A short fixed service-track spacing replaces the previous adaptive
    // 0.9-2.0 second penalty that slowed later successful reads.
    private const int ServiceTrackSpacingMs = 100;
    // An explicit opt-in enables retries for stations that occasionally miss ACKs.
    // One read attempt by default: surface the first real NO DECODER response.
    private readonly int _serviceReadAttempts;
    private readonly object _programmingSync = new();
    private TaskCompletionSource<ProgrammingReply>? _pendingProgramming;
    private int _pendingProgrammingCv;
    private int _pendingProgrammingAddress;
    private bool _pendingProgrammingWrite;
    private sealed record ProgrammingReply(bool Ok, int Value, string Message, string Raw);
    private TaskCompletionSource<(int Address, int Slot, byte Status, byte Speed, byte Dirf, byte Snd)>? _pendingSlot;
    private int _pendingAddress;

    public LocoNetCommandCenter(
        ILocoNetTransport transport,
        ILogger<LocoNetCommandCenter> log,
        IConfiguration config)
    {
        _transport = transport;
        _log = log;
        _serviceReadAttempts = Math.Clamp(
            config.GetValue("LocoNet:ServiceReadAttempts", 1), 1, 3);
        _transport.ConnectionChanged += OnConnectionChanged;
        _transport.Information += message => RawInfo?.Invoke(message);
    }

    public bool Connected => _connected;
    public string Type => "loconet";
    public string Name => _transport.Kind == "serial" ? "LocoNet Serial" : "LocoNet TCP";
    public string Endpoint => _transport.Endpoint;
    public string Transport => _transport.Kind;
    public bool EmergencyPauseStateKnown => true;
    public bool EmergencyPaused => _emergencyPaused;
    public LocoNetStandardTelemetrySnapshot StandardTelemetry => _standardTelemetry.Snapshot();

    public LocoNetSerialRuntimeDiagnostics? SerialDiagnostics
    {
        get
        {
            if (_transport is not LocoNetSerialTransport serial) return null;
            var snapshot = _standardTelemetry.Snapshot();
            return new LocoNetSerialRuntimeDiagnostics(
                serial.Endpoint, serial.BaudRate, serial.LinkUptimeMs,
                snapshot.RxFrames, snapshot.TxFrames);
        }
    }

    public event Action<string>? RawInfo;
    public event Action<StationInfo>? StationInfoChanged;
    public event Action<TrackInfo>? TrackConfigurationChanged;
    public event Action<int[]>? CurrentTelemetryChanged;
    public event Action<int[]>? TripTelemetryChanged;
    public event Action<PowerFeedback>? PowerFeedbackChanged;
    public event Action<LocoFeedback>? LocoFeedbackChanged;
    public event Action<int, bool>? SensorFeedbackChanged;
    public event Action<int, bool>? AccessoryFeedbackChanged;
    public event Action<bool>? ConnectionChanged;

    private void OnConnectionChanged(bool connected)
    {
        _connected = connected;
        _standardTelemetry.Reset();
        if (connected)
        {
            _emergencyPaused = false;
            StationInfoChanged?.Invoke(new StationInfo(
                Processor: "LocoNet", Hardware: _transport.Kind == "serial"
                    ? "Serial interface" : "TCP interface"));
        }
        else
        {
            lock (_slotSync)
            {
                _slots.Clear();
                _dirf.Clear();
                _snd.Clear();
                _speeds.Clear();
                _sensors.Clear();
                _pendingSlot?.TrySetCanceled();
                _pendingSlot = null;
            }
            lock (_programmingSync)
            {
                _pendingProgramming?.TrySetResult(new ProgrammingReply(
                    false, -1, "LocoNet connection was lost during programming.", ""));
                _pendingProgramming = null;
            }
        }
        ConnectionChanged?.Invoke(connected);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await _transport.RunSessionAsync(
                    frame => ProcessPacket(frame), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "LocoNet {Transport} connection to {Endpoint} failed",
                    _transport.Kind, Endpoint);
                RawInfo?.Invoke($"LocoNet {_transport.Kind} FAILED {Endpoint}: {ex.Message}");
            }

            try { await Task.Delay(2000, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private void PublishLocoSlot(int slot)
    {
        LocoFeedback? feedback = null;
        lock (_slotSync)
        {
            foreach (var pair in _slots)
            {
                if (pair.Value != slot) continue;
                var dirf = _dirf.GetValueOrDefault(slot);
                var snd = _snd.GetValueOrDefault(slot);
                var speed = _speeds.GetValueOrDefault(slot);
                uint mask = (uint)(((dirf & 0x10) != 0 ? 1 : 0) |
                    ((dirf & 0x0F) << 1) | ((snd & 0x0F) << 5));
                feedback = new LocoFeedback(pair.Key, speed, (dirf & 0x20) == 0, mask);
                break;
            }
        }
        if (feedback is not null) LocoFeedbackChanged?.Invoke(feedback);
    }

    private void ProcessPacket(ReadOnlySpan<byte> rawPacket)
    {
        if (rawPacket.Length < 2) return;
        byte checksum = 0;
        foreach (var value in rawPacket) checksum ^= value;
        if (checksum != 0xFF)
        {
            _log.LogDebug("Invalid LocoNet packet checksum: {Packet}", Convert.ToHexString(rawPacket));
            return;
        }

        _standardTelemetry.ObserveReceived(rawPacket);
        var packet = rawPacket.ToArray();
        var line = Convert.ToHexString(packet);
        RawInfo?.Invoke("LocoNet RX: " + line);
        if (packet.Length == 2 && packet[0] == 0x85)
        {
            _emergencyPaused = true;
            RawInfo?.Invoke("External LocoNet OPC_IDLE received; command station may require separate recovery");
        }
        else if (packet[0] == 0xE7 && packet.Length == 14 && packet[1] == 0x0E)
        {
            if (packet[2] == 0x7C)
            {
                ProcessProgrammingReply(packet, line);
                return;
            }
            int slot = packet[2];
            int address = packet[4] | (packet[9] << 7);
            byte status = packet[3];
            bool known;
            lock (_slotSync)
            {
                if (_pendingSlot is not null && _pendingAddress == address)
                    _pendingSlot.TrySetResult((address, slot, status, packet[5], packet[6], packet[10]));
                known = _slots.TryGetValue(address, out var knownSlot) && knownSlot == slot;
                if (known)
                {
                    _dirf[slot] = packet[6];
                    _snd[slot] = packet[10];
                    // LocoNet 1 is emergency step, 0 is stopped, 2..127 are 1..126.
                    _speeds[slot] = packet[5] <= 1 ? 0 : packet[5] - 1;
                }
            }
            if (known) PublishLocoSlot(slot);
            RawInfo?.Invoke($"LocoNet slot RX: loco #{address}, slot {slot}, status {status:X2}");
        }
        else if (packet.Length == 4 && packet[0] is 0xA0 or 0xA1 or 0xA2)
        {
            var slot = (int)packet[1];
            bool known;
            lock (_slotSync)
            {
                known = _slots.ContainsValue(slot);
                if (known)
                {
                    switch (packet[0])
                    {
                        case 0xA0: _speeds[slot] = packet[2] <= 1 ? 0 : packet[2] - 1; break;
                        case 0xA1: _dirf[slot] = packet[2]; break;
                        case 0xA2: _snd[slot] = packet[2]; break;
                    }
                }
            }
            if (known) PublishLocoSlot(slot);
        }
        else if (packet[0] == 0xB4 && packet.Length == 4)
        {
            if ((packet[1] & 0xEF) == 0x6F)
                ProcessProgrammingAck(packet[2], line);
            if (packet[1] == 0x6D)
            {
                _log.LogInformation("LocoNet OPC_IMM_PACKET ACK response {Response:X2}", packet[2]);
                RawInfo?.Invoke($"LocoNet DCCext immediate-packet ACK: {packet[2]:X2}");
            }
            else
                RawInfo?.Invoke($"LocoNet long ACK: {packet[1]:X2} {packet[2]:X2}");
        }
        else if (packet.Length == 2 && packet[0] is 0x82 or 0x83)
        {
            var on = packet[0] == 0x83;
            _log.LogInformation("LocoNet track power feedback: {State}", on ? "ON" : "OFF");
            RawInfo?.Invoke("LocoNet power RX: " + (on ? "ON" : "OFF"));
            if (on && _emergencyPaused)
            {
                _emergencyPaused = false;
                RawInfo?.Invoke("LocoNet emergency resume confirmed by power ON");
            }
            PowerFeedbackChanged?.Invoke(new PowerFeedback(on, "Main"));
        }
        else if (packet[0] == 0xB2 && packet.Length == 4)
        {
            // OPC_INPUT_REP: LocoNet sensor numbering is 1-based.
            var address = ((packet[2] & 0x0F) << 7) | (packet[1] & 0x7F);
            address = (address << 1) + ((packet[2] & 0x20) != 0 ? 2 : 1);
            var occupied = (packet[2] & 0x10) != 0;
            bool changed;
            lock (_slotSync)
            {
                changed = !_sensors.TryGetValue(address, out var previous) || previous != occupied;
                _sensors[address] = occupied;
            }
            if (changed)
            {
                _log.LogInformation(
                    "LocoNet sensor RX OPC_INPUT_REP: raw={RawPacket}, address=#{Address}, state={State}",
                    Convert.ToHexString(packet.ToArray()), address, occupied ? "ON" : "OFF");
                SensorFeedbackChanged?.Invoke(address, occupied);
            }
        }
        else if (packet[0] == 0xB0 && packet.Length == 4)
        {
            var address = ((packet[2] & 0x0F) << 7 | packet[1]) + 1;
            AccessoryFeedbackChanged?.Invoke(address, (packet[2] & 0x20) != 0);
        }
    }

    private void ProcessProgrammingReply(IReadOnlyList<byte> packet, string raw)
    {
        int cvZero = ((packet[8] & 0x30) << 4) |
            ((packet[8] & 0x01) << 7) | packet[9];
        int cv = cvZero + 1;
        int address = (packet[5] << 7) | packet[6];
        int value = packet[10] | ((packet[8] & 0x02) << 6);
        // Programmer slot 124: index 3 is PCMD (the operation);
        // index 4 is PSTAT (the decoder acknowledgement/error flags).
        // Reading PCMD as a status previously produced false errors because
        // standard direct-byte commands include the reserved low bits 0x03.
        int pcmd = packet[3];
        int error = packet[4] & 0x0F;
        _log.LogInformation(
            "LocoNet programmer slot: CV {Cv}, address {Address}, PCMD 0x{Pcmd:X2}, PSTAT 0x{Status:X2}, value {Value}",
            cv, address, pcmd, packet[4], value);
        lock (_programmingSync)
        {
            if (_pendingProgramming is null ||
                cv != _pendingProgrammingCv || address != _pendingProgrammingAddress)
            {
                _log.LogDebug("Ignored unsolicited LocoNet programming-slot reply: CV {Cv}, address {Address}", cv, address);
                return;
            }
            if (error != 0)
            {
                var reason = (error & 0x01) != 0 ? "YD7010 reports NO DECODER (PSTAT bit 0). Check the isolated PROG TRACK wiring, locomotive contact and programming track current."
                    : (error & 0x02) != 0 ? "Decoder did not acknowledge CV write."
                    : (error & 0x04) != 0 ? "Decoder did not acknowledge CV read."
                    : "Programming was aborted.";
                _pendingProgramming.TrySetResult(new ProgrammingReply(false, -1, reason, raw));
            }
            else
            {
                _pendingProgramming.TrySetResult(new ProgrammingReply(true, value,
                    _pendingProgrammingWrite ? "CV programming completed (station reported success)." :
                    "CV value read successfully.", raw));
            }
        }
    }

    private void ProcessProgrammingAck(int response, string raw)
    {
        lock (_programmingSync)
        {
            if (_pendingProgramming is null) return;
            if (response == 0)
                _pendingProgramming.TrySetResult(new ProgrammingReply(false, -1,
                    "Command station programmer is busy or rejected the request.", raw));
            else if (response == 0x40 && _pendingProgrammingWrite)
                _pendingProgramming.TrySetResult(new ProgrammingReply(true, -1,
                    "Command station accepted the write without decoder confirmation.", raw));
            else if (response is not (1 or 0x23 or 0x2B or 0x6B or 0x40 or 0x7F))
                _pendingProgramming.TrySetResult(new ProgrammingReply(false, -1,
                    $"Unexpected LocoNet programming acknowledgement 0x{response:X2}.", raw));
        }
    }

    private async Task<CommandCenterProgrammingResult> ProgramCvAsync(
        int address, int cv, int value, int pcmd, bool write, CancellationToken ct)
    {
        if (!_connected) return new(false, cv, -1, "LocoNet command station is disconnected.");
        if (cv is < 1 or > 1024 || (write && value is < 0 or > 255) ||
            address is < 0 or > 10239)
            return new(false, cv, -1, "Invalid CV number, decoder address or value.");

        var totalTimer = System.Diagnostics.Stopwatch.StartNew();
        await _programmingGate.WaitAsync(ct);
        var queueMs = totalTimer.ElapsedMilliseconds;
        int attemptCount = 0;
        try
        {
            var cvZero = cv - 1;
            var command = new byte[]
            {
                0xEF, 0x0E, 0x7C, (byte)pcmd, 0x00,
                (byte)((address >> 7) & 0x7F), (byte)(address & 0x7F), 0x00,
                (byte)(((cvZero & 0x300) >> 4) |
                    ((cvZero & 0x80) >> 7) | ((value & 0x80) >> 6)),
                (byte)(cvZero & 0x7F), (byte)(value & 0x7F), 0x7F, 0x7F
            };
            // Retries are opt-in. CV writes are never retried automatically.
            // The default single read lets the UI report real YD7010 errors
            // without hiding them behind 3 station cycles and two delays.
            int attempts = !write && address == 0 ? _serviceReadAttempts : 1;
            for (int attempt = 1; attempt <= attempts; attempt++)
            {
                attemptCount = attempt;
                var attemptTimer = System.Diagnostics.Stopwatch.StartNew();
                var completion = new TaskCompletionSource<ProgrammingReply>(
                    TaskCreationOptions.RunContinuationsAsynchronously);
                lock (_programmingSync)
                {
                    _pendingProgramming = completion;
                    _pendingProgrammingCv = cv;
                    _pendingProgrammingAddress = address;
                    _pendingProgrammingWrite = write;
                }
                _log.LogInformation(
                    "LocoNet CV {Operation}: {Mode} address {Address}, CV {Cv}, attempt {Attempt}/{Attempts}",
                    write ? "write" : "read", address == 0 ? "service" : "POM",
                    address, cv, attempt, attempts);

                if (!await SendPacketAsync(command, ct))
                    return new(false, cv, -1, "Failed to send LocoNet programmer command.");

                ProgrammingReply reply;
                try
                {
                    reply = await completion.Task.WaitAsync(TimeSpan.FromSeconds(18), ct);
                }
                catch (TimeoutException)
                {
                    return new(false, cv, -1,
                        "No programming result from YD7010 (timeout). Check PROG TRACK / decoder ACK.");
                }

                var responseMs = attemptTimer.ElapsedMilliseconds;
                _log.LogInformation(
                    "LocoNet CV{Cv} attempt {Attempt}/{MaxAttempts}: transport={Transport}, response={ResponseMs} ms, ok={Ok}, message={Message}, raw={Raw}",
                    cv, attempt, attempts, _transport.Kind, responseMs, reply.Ok, reply.Message, reply.Raw);
                RawInfo?.Invoke(
                    $"LocoNet CV{cv} {(write ? "write" : "read")} {_transport.Kind}: " +
                    $"response={responseMs} ms, attempt={attempt}/{attempts}, ok={reply.Ok}");
                if (reply.Ok)
                    return new(true, cv, write ? value : reply.Value,
                        $"{reply.Message} (response {responseMs} ms; attempts {attempt}).",
                        reply.Raw);

                bool noDecoder = reply.Message.StartsWith(
                    "YD7010 reports NO DECODER", StringComparison.Ordinal);
                if (!noDecoder || attempt == attempts)
                {
                    var reason = noDecoder && attempt > 1
                        ? $"YD7010 reported NO DECODER after {attempt} read attempts. Check PROG TRACK contacts and ACK current."
                        : reply.Message;
                    return new(false, cv, -1,
                        $"{reason} (response {responseMs} ms; total {totalTimer.ElapsedMilliseconds} ms; attempts {attempt}).",
                        reply.Raw);
                }

                _log.LogWarning(
                    "LocoNet service-mode CV{Cv} returned NO DECODER on attempt {Attempt}. Retrying after recovery delay.",
                    cv, attempt);
                lock (_programmingSync)
                {
                    if (ReferenceEquals(_pendingProgramming, completion))
                        _pendingProgramming = null;
                }
                await Task.Delay(1200, ct);
            }
            return new(false, cv, -1, "LocoNet CV read retries exhausted.");
        }
        finally
        {
            lock (_programmingSync) _pendingProgramming = null;
            // Keep only a bounded 100 ms programming-track settle interval;
            // failed reads must not penalize the next successful read by seconds.
            if (address == 0 && _connected && !ct.IsCancellationRequested)
            {
                _log.LogInformation("LocoNet CV{Cv} completed: attempts={Attempts}, queue={QueueMs} ms, operation={OperationMs} ms, spacing={SpacingMs} ms",
                    cv, attemptCount, queueMs, totalTimer.ElapsedMilliseconds - queueMs,
                    ServiceTrackSpacingMs);
                await Task.Delay(ServiceTrackSpacingMs, CancellationToken.None);
            }
            _programmingGate.Release();
        }
    }

    public Task<CommandCenterProgrammingResult> ReadServiceCvAsync(
        int cv, CancellationToken ct = default) =>
        ProgramCvAsync(0, cv, 0, 0x2B, false, ct);

    public Task<CommandCenterProgrammingResult> WriteServiceCvAsync(
        int cv, int value, CancellationToken ct = default) =>
        ProgramCvAsync(0, cv, value, 0x6B, true, ct);

    public Task<CommandCenterProgrammingResult> ReadPomCvAsync(
        int address, int cv, CancellationToken ct = default) =>
        address is >= 1 and <= 10239
            ? ProgramCvAsync(address, cv, 0, 0x2F, false, ct)
            : Task.FromResult(new CommandCenterProgrammingResult(false, cv, -1, "Invalid POM decoder address."));

    public Task<CommandCenterProgrammingResult> WritePomCvAsync(
        int address, int cv, int value, CancellationToken ct = default) =>
        address is >= 1 and <= 10239
            ? ProgramCvAsync(address, cv, value, 0x67, true, ct)
            : Task.FromResult(new CommandCenterProgrammingResult(false, cv, -1, "Invalid POM decoder address."));

    public async Task<CommandCenterProgrammingResult> WriteAccessoryPomCvAsync(
        int decoderAddress, int cv, int value, CancellationToken ct = default)
    {
        if (decoderAddress is < 1 or > 511 || cv is < 1 or > 1024 || value is < 0 or > 255)
            return new(false, cv, -1, "Invalid accessory decoder address (1..511), CV or value.");

        // NMRA basic accessory decoder POM, whole decoder (CDDD=0000),
        // following JMRI NmraPacket.accDecPktOpsMode.
        // The decoder address is NOT the accessory's individual output address.
        int cvZero = cv - 1;
        int highAddress = ((~decoderAddress) >> 6) & 0x07;
        byte[] dcc =
        [
            (byte)(0x80 | (decoderAddress & 0x3F)),
            (byte)(0x80 | (highAddress << 4)),
            (byte)(0xEC | ((cvZero >> 8) & 0x03)),
            (byte)(cvZero & 0xFF),
            (byte)value
        ];
        int mask = 0;
        for (int i = 0; i < dcc.Length; i++)
            mask |= ((dcc[i] >> 7) & 1) << i;

        byte[] command =
        [
            0xED, 0x0B, 0x7F, 0x53, (byte)mask,
            (byte)(dcc[0] & 0x7F), (byte)(dcc[1] & 0x7F),
            (byte)(dcc[2] & 0x7F), (byte)(dcc[3] & 0x7F),
            (byte)(dcc[4] & 0x7F)
        ];
        bool sent = await SendPacketAsync(command, ct);
        return new(sent, cv, sent ? value : -1,
            sent
                ? "Basic accessory POM write sent on main track. Decoder write is not verified."
                : "Could not send basic accessory POM command.");
    }

    private async Task<bool> SendPacketAsync(byte[] packet, CancellationToken ct)
    {
        if (!_connected) return false;
        var checksum = (byte)0xFF;
        foreach (var b in packet) checksum ^= b;
        var frame = new byte[packet.Length + 1];
        Array.Copy(packet, frame, packet.Length);
        frame[^1] = checksum;

        if (!await _transport.SendFrameAsync(frame, ct)) return false;
        _standardTelemetry.ObserveTransmitted();
        RawInfo?.Invoke($"LocoNet {_transport.Kind.ToUpperInvariant()} TX: " + Convert.ToHexString(frame));
        return true;
    }

    public async Task<bool> SetTurnoutAsync(int address, bool closed, CancellationToken ct = default)
    {
        if (address is < 1 or > 2048) return false;
        var queuedAt = System.Diagnostics.Stopwatch.GetTimestamp();
        await _accessoryPulseGate.WaitAsync(ct);
        var queueMs = System.Diagnostics.Stopwatch.GetElapsedTime(queuedAt).TotalMilliseconds;
        try
        {
            _log.LogInformation(
                "LocoNet turnout #{Address} requested closed={Closed}; pulse-gate wait={QueueMs:F1} ms",
                address, closed, queueMs);
            int a = address - 1;
            byte low = (byte)(a & 0x7F);
            byte high = (byte)(((a >> 7) & 0x0F) | (closed ? 0x20 : 0));

            // Repeat the complete ON/OFF command pair, not just the ON edge.
            // Holding the pulse gate across both pairs prevents other turnouts
            // from interleaving their magnet pulses.
            for (var attempt = 1; attempt <= 2; attempt++)
            {
                bool activated = false;
                try
                {
                    if (!await SendPacketAsync([0xB0, low, (byte)(high | 0x10)], ct))
                        return false;
                    activated = true;
                    _log.LogInformation(
                        "LocoNet turnout #{Address}: pulse {Attempt}/2 ON sent to COM port (not decoder-confirmed)",
                        address, attempt);
                    await Task.Delay(200, ct);

                    // Always release the output even if cancellation occurs.
                    var released = await SendPacketAsync(
                        [0xB0, low, high], CancellationToken.None);
                    if (!released)
                    {
                        _log.LogWarning(
                            "LocoNet turnout #{Address}: pulse {Attempt}/2 OFF failed",
                            address, attempt);
                        return false;
                    }

                    activated = false;
                    _log.LogInformation(
                        "LocoNet turnout #{Address}: pulse {Attempt}/2 OFF sent (physical position unconfirmed)",
                        address, attempt);
                }
                finally
                {
                    if (activated &&
                        !await SendPacketAsync([0xB0, low, high], CancellationToken.None))
                        _log.LogError(
                            "LocoNet turnout #{Address}: failed to release output after interruption",
                            address);
                }

                if (attempt == 1)
                    await Task.Delay(250, ct);
            }

            return true;
        }
        finally { _accessoryPulseGate.Release(); }
    }

    public async Task<bool> SetAccessoryAsync(int address, bool active, CancellationToken ct = default)
    {
        // A basic accessory is a DCC turnout-style output selection followed
        // by an activation pulse. It must be encoded independently of the
        // layout's logical turnout state.
        if (address is < 1 or > 2048) return false;
        await _accessoryPulseGate.WaitAsync(ct);
        try
        {
            int a = address - 1;
            byte low = (byte)(a & 0x7F);
            byte high = (byte)(((a >> 7) & 0x0F) | (active ? 0x20 : 0));
            bool activated = false;
            try
            {
                if (!await SendPacketAsync([0xB0, low, (byte)(high | 0x10)], ct))
                    return false;
                activated = true;
                await Task.Delay(200, ct);
                var released = await SendPacketAsync([0xB0, low, high], CancellationToken.None);
                activated = false;
                return released;
            }
            finally
            {
                if (activated)
                    await SendPacketAsync([0xB0, low, high], CancellationToken.None);
            }
        }
        finally { _accessoryPulseGate.Release(); }
    }

    public async Task<bool> SetTrackPowerAsync(bool on, bool includeProgramming = true, CancellationToken ct = default)
    {
        if (on && _emergencyPaused && _transport.Kind == "serial") return false;
        var sent = await SendPacketAsync(new byte[] { on ? (byte)0x83 : (byte)0x82 }, ct);
        _log.LogInformation("LocoNet power {Power}: TX {Result} to {Endpoint}",
            on ? "ON" : "OFF", sent ? "sent" : "failed", Endpoint);
        // Transport write confirms transmission, not physical track power.
        return sent;
    }
    public async Task<bool> EmergencyStopAsync(CancellationToken ct = default)
    {
        // Preserve the previous TCP behavior on existing layouts: STOP/RESUME
        // acts on Hub-owned locomotive slots without changing track power.
        // Serial retains its previous global track-power-off fail-safe policy.
        if (_transport.Kind == "tcp")
            return await EmergencyStopOwnedSlotsAsync(ct);

        if (!_connected) return false;

        if (_emergencyPaused)
        {
            // Releasing the emergency latch never restores track power.
            // A separate deliberate POWER ON action is required.
            _emergencyPaused = false;
            RawInfo?.Invoke("LocoNet emergency latch cleared; track power remains OFF");
            return true;
        }

        // Fail-safe global action, even when the Hub has not acquired any loco
        // slots: OPC_GPOFF removes track power from all locomotives.
        _emergencyPaused = true;
        if (!await SendPacketAsync([0x82], ct))
        {
            _log.LogError("LocoNet emergency power OFF failed");
            return false;
        }
        PowerFeedbackChanged?.Invoke(new PowerFeedback(false, "Main"));

        int[] slots;
        lock (_slotSync) slots = _slots.Values.Distinct().ToArray();
        var allSlotsStopped = true;
        foreach (var slot in slots)
        {
            // LocoNet speed 0 clears a Hub-controlled loco's stored speed.
            if (!await SendPacketAsync([0xA0, (byte)slot, 0x00], ct))
                allSlotsStopped = false;
        }

        (int Address, int Slot, byte Dirf, byte Snd)[] stopped;
        lock (_slotSync)
        {
            stopped = _slots.Select(pair => (
                pair.Key, pair.Value,
                _dirf.GetValueOrDefault(pair.Value),
                _snd.GetValueOrDefault(pair.Value))).ToArray();
            if (allSlotsStopped)
                foreach (var loco in stopped) _speeds[loco.Slot] = 0;
        }
        if (allSlotsStopped)
            foreach (var loco in stopped)
                PublishLocoSlot(loco.Slot);

        RawInfo?.Invoke("LocoNet E-STOP: track power OFF; " +
            (allSlotsStopped ? "known loco speeds cleared" : "some loco zero-speed commands FAILED"));
        return allSlotsStopped;
    }

    private async Task<bool> EmergencyStopOwnedSlotsAsync(CancellationToken ct)
    {
        if (!_connected) return false;

        // Keep the alpha5 LocoNet TCP behavior unchanged: emergency speed for
        // Hub-owned slots, not OPC_IDLE (problematic on YD7010) or power-off.
        var resume = _emergencyPaused;
        int[] slots;
        lock (_slotSync) slots = _slots.Values.Distinct().ToArray();

        if (slots.Length == 0)
        {
            _log.LogWarning(
                "LocoNet emergency {Action}: no Hub-owned locomotive slots; cannot guarantee a global stop",
                resume ? "resume" : "stop");
            return false;
        }

        if (!resume) _emergencyPaused = true;
        foreach (var slot in slots)
        {
            var value = resume ? (byte)0 : (byte)1;
            if (!await SendPacketAsync([0xA0, (byte)slot, value], ct))
            {
                _log.LogError("LocoNet emergency {Action} failed on slot {Slot}",
                    resume ? "resume" : "stop", slot);
                return false;
            }
        }

        (int Address, int Slot, byte Dirf, byte Snd)[] stopped;
        lock (_slotSync)
        {
            stopped = _slots.Select(pair => (
                pair.Key, pair.Value,
                _dirf.GetValueOrDefault(pair.Value),
                _snd.GetValueOrDefault(pair.Value))).ToArray();
            foreach (var loco in stopped) _speeds[loco.Slot] = 0;
        }
        foreach (var loco in stopped)
            PublishLocoSlot(loco.Slot);

        if (resume) _emergencyPaused = false;
        RawInfo?.Invoke(resume
            ? "LocoNet emergency RESUME: Hub locomotive slots set to speed 0; track power unchanged"
            : "LocoNet emergency STOP: Hub locomotive slots sent emergency speed 1; track power unchanged");
        return true;
    }

    public Task<bool> SendRawAsync(string command, bool log = true, CancellationToken ct = default) =>
        Task.FromResult(false);
    public Task<bool> SetProgrammingPowerAsync(bool on, CancellationToken ct = default) =>
        Task.FromResult(false);
    private async Task<int?> AcquireSlotAsync(int address, CancellationToken ct)
    {
        if (address is < 1 or > 10239 || !_connected) return null;
        lock (_slotSync)
        {
            if (_slots.TryGetValue(address, out int cached)) return cached;
        }

        await _slotGate.WaitAsync(ct);
        try
        {
            lock (_slotSync)
            {
                if (_slots.TryGetValue(address, out int cached)) return cached;
                _pendingAddress = address;
                _pendingSlot = new TaskCompletionSource<(int Address, int Slot, byte Status, byte Speed, byte Dirf, byte Snd)>(
                    TaskCreationOptions.RunContinuationsAsynchronously);
            }
            Task<(int Address, int Slot, byte Status, byte Speed, byte Dirf, byte Snd)> response;
            lock (_slotSync) response = _pendingSlot!.Task;
            if (!await SendPacketAsync(new byte[] {
                0xBF, (byte)((address >> 7) & 0x7F), (byte)(address & 0x7F)
            }, ct)) return null;

            (int Address, int Slot, byte Status, byte Speed, byte Dirf, byte Snd) found;
            try { found = await response.WaitAsync(TimeSpan.FromSeconds(3), ct); }
            catch (TimeoutException)
            {
                _log.LogWarning("No slot response for locomotive #{Address}", address);
                return null;
            }
            if (found.Slot is < 1 or > 119) return null;
            // NULL MOVE changes common/idle slot to IN_USE; do not steal one in use.
            if ((found.Status & 0x30) != 0x30)
            {
                if (!await SendPacketAsync(new byte[] {
                    0xBA, (byte)found.Slot, (byte)found.Slot
                }, ct)) return null;
            }
            lock (_slotSync)
            {
                _slots[address] = found.Slot;
                _dirf[found.Slot] = found.Dirf;
                _snd[found.Slot] = found.Snd;
                _speeds[found.Slot] = found.Speed <= 1 ? 0 : found.Speed - 1;
            }
            PublishLocoSlot(found.Slot);
            RawInfo?.Invoke($"LocoNet slot ready: #{address} -> {found.Slot}");
            return found.Slot;
        }
        finally
        {
            lock (_slotSync) { _pendingSlot = null; }
            _slotGate.Release();
        }
    }

    public async Task<bool> SetLocoAsync(int address, int speed, bool forward, CancellationToken ct = default)
    {
        if (_emergencyPaused && speed > 0) return false;
        if (speed is < 0 or > 126) return false;
        var slot = await AcquireSlotAsync(address, ct);
        if (!slot.HasValue) return false;
        byte dirf;
        lock (_slotSync)
        {
            _dirf.TryGetValue(slot.Value, out dirf);
            dirf = (byte)((dirf & ~0x20) | (forward ? 0 : 0x20));
            _dirf[slot.Value] = dirf;
        }
        if (!await SendPacketAsync(new byte[] { 0xA1, (byte)slot.Value, dirf }, ct)) return false;
        if (!await SendPacketAsync(new byte[] {
            0xA0, (byte)slot.Value, (byte)(speed == 0 ? 0 : speed + 1)
        }, ct)) return false;
        byte snd;
        lock (_slotSync)
        {
            _speeds[slot.Value] = speed;
            snd = _snd.GetValueOrDefault(slot.Value);
        }
        var functions = (uint)(((dirf & 0x10) != 0 ? 1 : 0) |
            ((dirf & 0x0F) << 1) | ((snd & 0x0F) << 5));
        LocoFeedbackChanged?.Invoke(new LocoFeedback(address, speed, forward, functions));
        return true;
    }

    public async Task<bool> RequestLocoAsync(int address, CancellationToken ct = default) =>
        (await AcquireSlotAsync(address, ct)).HasValue;

    public async Task<bool> SetLocoFunctionAsync(int address, int fn, bool active, CancellationToken ct = default)
    {
        if (fn is < 0 or > 8) return false;
        var slot = await AcquireSlotAsync(address, ct);
        if (!slot.HasValue) return false;
        byte value;
        byte op;
        lock (_slotSync)
        {
            if (fn <= 4)
            {
                _dirf.TryGetValue(slot.Value, out value);
                int mask = fn == 0 ? 0x10 : 1 << (fn - 1);
                value = (byte)(active ? value | mask : value & ~mask);
                _dirf[slot.Value] = value;
                op = 0xA1;
            }
            else
            {
                _snd.TryGetValue(slot.Value, out value);
                int mask = 1 << (fn - 5);
                value = (byte)(active ? value | mask : value & ~mask);
                _snd[slot.Value] = value;
                op = 0xA2;
            }
        }
        if (!await SendPacketAsync(new byte[] { op, (byte)slot.Value, value }, ct))
            return false;
        PublishLocoSlot(slot.Value);
        return true;
    }

    public Task<bool> SetSignalAspectAsync(int address, int aspect, CancellationToken ct = default)
    {
        if (address is < 1 or > 2044 || aspect is < 0 or > 255)
            return Task.FromResult(false);

        // Match the Hub's existing Z21 extended-accessory addressing (+3).
        // Build a three-byte DCCext packet, then wrap it as LocoNet
        // OPC_IMM_PACKET (ED 0B 7F), as done by JMRI SlotManager.
        int output = address + 3;
        // DCC extended accessory addressing follows RCN-213:
        // 10AAAAAA / 0AAA0AA1. The +3 adjustment is applied once.
        byte dcc0 = (byte)(0x80 | ((output >> 2) & 0x3F));
        byte dcc1 = (byte)((((~output >> 4) & 0x70)) |
            ((output << 1) & 0x06) | 0x01);
        byte dcc2 = (byte)aspect;
        // Bit 7 must be represented in the LocoNet high-bit mask.
        byte highBits = (byte)(((dcc0 >> 7) & 1) |
            (((dcc1 >> 7) & 1) << 1) |
            (((dcc2 >> 7) & 1) << 2));
        byte[] command =
        [
            0xED, 0x0B, 0x7F, 0x33, highBits,
            (byte)(dcc0 & 0x7F), (byte)(dcc1 & 0x7F),
            (byte)(dcc2 & 0x7F), 0x00, 0x00
        ];
        _log.LogInformation("LocoNet DCCext TX signal #{Address}, aspect {Aspect}, DCC {Byte0:X2} {Byte1:X2} {Byte2:X2}", address, aspect, dcc0, dcc1, dcc2);
        // Four DCC repeats as used by JMRI for command-station packet sends.
        // This is a transport attempt, not proof that the signal decoder applied the aspect.
        return SendPacketAsync(command, ct);
    }
    public Task<bool> SetVPinAsync(int vpin, bool active, CancellationToken ct = default) =>
        Task.FromResult(false);
    public Task<bool> RequestTrackConfigurationAsync(CancellationToken ct = default) =>
        Task.FromResult(false);
    public Task<bool> RequestCurrentTelemetryAsync(CancellationToken ct = default) =>
        Task.FromResult(false);
    public Task<bool> RequestTripTelemetryAsync(CancellationToken ct = default) =>
        Task.FromResult(false);
    public async Task<bool> RequestSensorSnapshotAsync(CancellationToken ct = default)
    {
        if (!_connected) return false;
        if (!await _snapshotGate.WaitAsync(0, ct)) return false;
        try
        {
            // YaMoRC / JMRI use eight OPC_SW_REQ interrogations
            // for LocoNet feedback modules. Avoid flooding the shared bus.
            byte[] sw1 = [0x78, 0x79, 0x7A, 0x7B, 0x78, 0x79, 0x7A, 0x7B];
            byte[] sw2 = [0x27, 0x27, 0x27, 0x27, 0x07, 0x07, 0x07, 0x07];
            for (var i = 0; i < sw1.Length; i++)
            {
                if (!await SendPacketAsync([0xB0, sw1[i], sw2[i]], ct)) return false;
                await Task.Delay(250, ct);
            }
            _log.LogInformation(
                "LocoNet sensor interrogation: 8 requests sent; complete sensor snapshot is NOT confirmed by the protocol");
            return true;
        }
        finally { _snapshotGate.Release(); }
    }
}
