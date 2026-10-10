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
    public bool EmergencyPauseStateKnown => false;
    public bool EmergencyPaused => false;

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

        if (packet.Count == 2 && packet[0] is 0x82 or 0x83)
        {
            var on = packet[0] == 0x83;
            _log.LogInformation("LocoNet track power feedback: {State}", on ? "ON" : "OFF");
            RawInfo?.Invoke("LocoNet power RX: " + (on ? "ON" : "OFF"));
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
    public Task<bool> EmergencyStopAsync(CancellationToken ct = default) =>
        SetTrackPowerAsync(false, ct: ct);

    public Task<bool> SendRawAsync(string command, bool log = true, CancellationToken ct = default) =>
        Task.FromResult(false);
    public Task<bool> SetProgrammingPowerAsync(bool on, CancellationToken ct = default) =>
        Task.FromResult(false);
    public Task<bool> SetLocoAsync(int address, int speed, bool forward, CancellationToken ct = default) =>
        Task.FromResult(false);
    public Task<bool> RequestLocoAsync(int address, CancellationToken ct = default) =>
        Task.FromResult(false);
    public Task<bool> SetLocoFunctionAsync(int address, int fn, bool active, CancellationToken ct = default) =>
        Task.FromResult(false);
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
