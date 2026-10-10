using System.Globalization;
using System.Net.Sockets;
using System.Text;

namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Experimental, independent LocoNet-over-TCP command-station driver.
/// First milestone supports an LBServer connection and accessory switch commands.
/// Locomotive/automation and CV operations intentionally fail closed until slot
/// ownership and acknowledgement have been implemented and tested on hardware.
/// </summary>
public sealed class LocoNetTcpCommandCenter : BackgroundService, ICommandCenter
{
    private readonly ILogger<LocoNetTcpCommandCenter> _log;
    private readonly string _host;
    private readonly int _port;
    private readonly SemaphoreSlim _txGate = new(1, 1);
    private readonly object _connectionGate = new();
    private StreamWriter? _writer;
    private volatile bool _connected;
    private volatile bool _emergencyPaused;
    private readonly SemaphoreSlim _slotGate = new(1, 1);
    private readonly object _slotSync = new();
    private readonly Dictionary<int, int> _slots = new();
    private readonly Dictionary<int, byte> _dirf = new();
    private readonly Dictionary<int, byte> _snd = new();
    private TaskCompletionSource<(int Address, int Slot, byte Status)>? _pendingSlot;
    private int _pendingAddress;

    public LocoNetTcpCommandCenter(IConfiguration config, ILogger<LocoNetTcpCommandCenter> log)
    {
        _log = log;
        _host = (config["LocoNet:Host"] ?? config["Z21:Host"] ?? "127.0.0.1").Trim();
        _port = config.GetValue("LocoNet:LbServerPort", 1234);
    }

    public bool Connected => _connected;
    public string Type => "loconet";
    public string Name => "LocoNet TCP (experimental)";
    public string Endpoint => $"{_host}:{_port}";
    public bool EmergencyPauseStateKnown => true;
    public bool EmergencyPaused => _emergencyPaused;

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

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var client = new TcpClient();
                await client.ConnectAsync(_host, _port, stoppingToken);
                using var stream = client.GetStream();
                using var reader = new StreamReader(stream, Encoding.ASCII, leaveOpen: true);
                using var writer = new StreamWriter(stream, Encoding.ASCII, leaveOpen: true)
                { AutoFlush = true, NewLine = "\n" };

                lock (_connectionGate) _writer = writer;
                _connected = true;
                ConnectionChanged?.Invoke(true);
                RawInfo?.Invoke($"LocoNet TCP connected: {Endpoint}");
                StationInfoChanged?.Invoke(new StationInfo(Processor: "LocoNet TCP", Hardware: "YD7010 (experimental)"));

                while (!stoppingToken.IsCancellationRequested)
                {
                    var line = await reader.ReadLineAsync(stoppingToken);
                    if (line is null) break;
                    ProcessLine(line);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "LocoNet TCP connection to {Endpoint} failed", Endpoint);
            }
            finally
            {
                _connected = false;
                lock (_slotSync)
                {
                    _slots.Clear();
                    _dirf.Clear();
                    _snd.Clear();
                    _pendingSlot?.TrySetCanceled();
                    _pendingSlot = null;
                }
                lock (_connectionGate) _writer = null;
                ConnectionChanged?.Invoke(false);
            }

            try { await Task.Delay(2000, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private void ProcessLine(string line)
    {
        if (line.StartsWith("RECEIVE ", StringComparison.OrdinalIgnoreCase))
            RawInfo?.Invoke("LocoNet RX: " + line);
        else
            return;
        var fields = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (fields.Length < 3) return;
        var packet = new List<byte>();
        foreach (var field in fields.Skip(1))
        {
            if (!byte.TryParse(field, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var value))
                return;
            packet.Add(value);
        }
        byte checksum = 0;
        foreach (var item in packet) checksum ^= item;
        if (checksum != 0xFF) return;

        if (packet.Count == 2 && packet[0] == 0x85)
        {
            _emergencyPaused = true;
            RawInfo?.Invoke("External LocoNet OPC_IDLE received; command station may require separate recovery");
        }
        else if (packet[0] == 0xE7 && packet.Count == 14 && packet[1] == 0x0E)
        {
            int slot = packet[2];
            int address = packet[4] | (packet[9] << 7);
            byte status = packet[3];
            lock (_slotSync)
            {
                if (_pendingSlot is not null && _pendingAddress == address)
                    _pendingSlot.TrySetResult((address, slot, status));
                if (_slots.TryGetValue(address, out var knownSlot) && knownSlot == slot)
                {
                    _dirf[slot] = packet[6];
                    _snd[slot] = packet[10];
                }
            }
            RawInfo?.Invoke($"LocoNet slot RX: loco #{address}, slot {slot}, status {status:X2}");
        }
        else if (packet[0] == 0xB4 && packet.Count == 4)
        {
            RawInfo?.Invoke($"LocoNet long ACK: {packet[1]:X2} {packet[2]:X2}");
        }
        else if (packet.Count == 2 && packet[0] is 0x82 or 0x83)
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
        else if (packet[0] == 0xB2 && packet.Count == 4)
        {
            // OPC_INPUT_REP: LocoNet sensor numbering is 1-based.
            var address = ((packet[2] & 0x0F) << 7) | (packet[1] & 0x7F);
            address = (address << 1) + ((packet[2] & 0x20) != 0 ? 2 : 1);
            var occupied = (packet[2] & 0x10) != 0;
            SensorFeedbackChanged?.Invoke(address, occupied);
        }
        else if (packet[0] == 0xB0 && packet.Count == 4)
        {
            var address = ((packet[2] & 0x0F) << 7 | packet[1]) + 1;
            AccessoryFeedbackChanged?.Invoke(address, (packet[2] & 0x20) != 0);
        }
    }

    private async Task<bool> SendPacketAsync(byte[] packet, CancellationToken ct)
    {
        if (!_connected) return false;
        var checksum = (byte)0xFF;
        foreach (var b in packet) checksum ^= b;
        var line = "SEND " + string.Join(" ", packet.Append(checksum).Select(b => b.ToString("X2")));
        await _txGate.WaitAsync(ct);
        try
        {
            StreamWriter? writer;
            lock (_connectionGate) writer = _writer;
            if (writer is null) return false;
            await writer.WriteLineAsync(line.AsMemory(), ct);
            RawInfo?.Invoke("LocoNet TX: " + line);
            return true;
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException)
        {
            _log.LogWarning(ex, "LocoNet TX failed");
            return false;
        }
        finally { _txGate.Release(); }
    }

    public async Task<bool> SetTurnoutAsync(int address, bool closed, CancellationToken ct = default)
    {
        if (address is < 1 or > 2048) return false;
        int a = address - 1;
        byte low = (byte)(a & 0x7F);
        byte high = (byte)(((a >> 7) & 0x0F) | (closed ? 0x20 : 0));
        // JMRI LnTurnout sends an ON pulse followed by OFF. The previous
        // implementation kept the accessory activation asserted indefinitely.
        if (!await SendPacketAsync(new byte[] { 0xB0, low, (byte)(high | 0x10) }, ct))
            return false;
        await Task.Delay(200, ct);
        return await SendPacketAsync(new byte[] { 0xB0, low, high }, ct);
    }

    public Task<bool> SetAccessoryAsync(int address, bool active, CancellationToken ct = default) =>
        SetTurnoutAsync(address, active, ct);
    public async Task<bool> SetTrackPowerAsync(bool on, bool includeProgramming = true, CancellationToken ct = default)
    {
        var sent = await SendPacketAsync(new byte[] { on ? (byte)0x83 : (byte)0x82 }, ct);
        _log.LogInformation("LocoNet power {Power}: TX {Result} to {Endpoint}",
            on ? "ON" : "OFF", sent ? "sent" : "failed", Endpoint);
        // TCP write success does not guarantee the command station changed power.
        return sent;
    }
    public async Task<bool> EmergencyStopAsync(CancellationToken ct = default)
    {
        // Do not send OPC_IDLE here: on the YD7010 it leaves locomotive slots
        // unresponsive until a command-station power cycle.
        // LocoNet slot speed 1 = DCC emergency stop; 0 = stopped.
        // Only slots owned by this Hub connection are under our control.
        if (!_connected) return false;

        var resume = _emergencyPaused;
        int[] slots;
        lock (_slotSync) slots = _slots.Values.Distinct().ToArray();

        if (slots.Length == 0)
        {
            _log.LogWarning("LocoNet emergency {Action}: no Hub-owned locomotive slots; cannot guarantee a global stop",
                resume ? "resume" : "stop");
            return false;
        }

        // Latch before transmitting so other HUB speed requests cannot race a STOP.
        if (!resume) _emergencyPaused = true;
        foreach (var slot in slots)
        {
            var value = resume ? (byte)0 : (byte)1;
            if (!await SendPacketAsync(new byte[] { 0xA0, (byte)slot, value }, ct))
            {
                _log.LogError("LocoNet emergency {Action} failed on slot {Slot}",
                    resume ? "resume" : "stop", slot);
                return false;
            }
        }
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
                _pendingSlot = new TaskCompletionSource<(int Address, int Slot, byte Status)>(
                    TaskCreationOptions.RunContinuationsAsynchronously);
            }
            Task<(int Address, int Slot, byte Status)> response;
            lock (_slotSync) response = _pendingSlot!.Task;
            if (!await SendPacketAsync(new byte[] {
                0xBF, (byte)((address >> 7) & 0x7F), (byte)(address & 0x7F)
            }, ct)) return null;

            (int Address, int Slot, byte Status) found;
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
                _dirf.TryAdd(found.Slot, 0);
                _snd.TryAdd(found.Slot, 0);
            }
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
        return await SendPacketAsync(new byte[] {
            0xA0, (byte)slot.Value, (byte)(speed == 0 ? 0 : speed + 1)
        }, ct);
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
        return await SendPacketAsync(new byte[] { op, (byte)slot.Value, value }, ct);
    }

    public Task<bool> SetSignalAspectAsync(int address, int aspect, CancellationToken ct = default) =>
        Task.FromResult(false);
    public Task<bool> SetVPinAsync(int vpin, bool active, CancellationToken ct = default) =>
        Task.FromResult(false);
    public Task<bool> RequestTrackConfigurationAsync(CancellationToken ct = default) =>
        Task.FromResult(false);
    public Task<bool> RequestCurrentTelemetryAsync(CancellationToken ct = default) =>
        Task.FromResult(false);
    public Task<bool> RequestTripTelemetryAsync(CancellationToken ct = default) =>
        Task.FromResult(false);
    public Task<bool> RequestSensorSnapshotAsync(CancellationToken ct = default) =>
        Task.FromResult(false);
}
