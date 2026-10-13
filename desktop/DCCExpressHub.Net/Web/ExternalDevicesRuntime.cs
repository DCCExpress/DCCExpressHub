using System.IO.Ports;
using System.Text;

namespace DCCExpressHub.Net.Web;

// The adapter is an independent feedback source, never a command station.
// Its only output is normalized (address, occupied) sensor feedback.
public sealed class ExternalDevicesRuntime : BackgroundService
{
    sealed record Worker(ExternalDeviceConfig Config, CancellationTokenSource Cancellation, Task Running);
    public sealed record DeviceStatus(
        string Id, string Port, bool Connected, int ActiveInputs,
        DateTimeOffset? LastSnapshotUtc, string Message);

    readonly ExternalDeviceStore _store;
    readonly ILogger<ExternalDevicesRuntime> _log;
    readonly object _statusGate = new();
    readonly Dictionary<string, DeviceStatus> _status = new();

    public event Action<int, bool>? SensorFeedbackChanged;
    public event Action<int, int>? SensorRangeUnavailable;

    public ExternalDevicesRuntime(ExternalDeviceStore store, ILogger<ExternalDevicesRuntime> log)
    {
        _store = store;
        _log = log;
    }

    public DeviceStatus[] Status()
    {
        lock (_statusGate)
            return _status.Values.ToArray();
    }

    public bool IsPortReserved(string serialPort) =>
        _store.List().Any(x =>
            x.Enabled && string.Equals(x.SerialPort, serialPort, StringComparison.OrdinalIgnoreCase));

    void UpdateStatus(ExternalDeviceConfig config, bool connected, int inputs, DateTimeOffset? at, string message)
    {
        lock (_statusGate)
            _status[config.Id] = new DeviceStatus(
                config.Id, config.SerialPort, connected, inputs, at, message);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var workers = new Dictionary<string, Worker>();
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                var configured = _store.List().Where(x => x.Enabled).ToDictionary(x => x.Id);
                foreach (var old in workers.ToArray())
                {
                    if (configured.TryGetValue(old.Key, out var fresh) && fresh == old.Value.Config)
                        continue;
                    old.Value.Cancellation.Cancel();
                    try { await old.Value.Running; }
                    catch (OperationCanceledException) { }
                    old.Value.Cancellation.Dispose();
                    workers.Remove(old.Key);
                    lock (_statusGate) _status.Remove(old.Key);
                }
                foreach (var device in configured.Values)
                {
                    if (workers.ContainsKey(device.Id))
                        continue;
                    var linked = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                    var work = MonitorAdapterAsync(device, linked.Token);
                    workers.Add(device.Id, new Worker(device, linked, work));
                }
                await Task.Delay(750, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally
        {
            foreach (var worker in workers.Values)
                worker.Cancellation.Cancel();
            foreach (var worker in workers.Values)
            {
                try { await worker.Running; }
                catch (OperationCanceledException) { }
                worker.Cancellation.Dispose();
            }
        }
    }

    async Task MonitorAdapterAsync(ExternalDeviceConfig config, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            SerialPort? port = null;
            try
            {
                UpdateStatus(config, false, 0, null, "Connecting");
                port = new SerialPort(config.SerialPort, 115200, Parity.None, 8, StopBits.One)
                {
                    DtrEnable = false,
                    RtsEnable = false,
                    ReadTimeout = 100,
                    WriteTimeout = 1000,
                    NewLine = "\n"
                };
                port.Open();
                // Most Uno boards reset when their USB serial port is opened.
                await Task.Delay(2000, ct);
                port.Write("LOG ON\n");
                var line = new StringBuilder(256);
                var lastSnapshot = DateTimeOffset.MinValue;
                var connectedAt = DateTimeOffset.UtcNow;
                var nextPoll = DateTimeOffset.MinValue;
                int activeInputs = 0;
                while (!ct.IsCancellationRequested)
                {
                    var now = DateTimeOffset.UtcNow;
                    if (now >= nextPoll)
                    {
                        port.Write("READ\n");
                        nextPoll = now.AddSeconds(1);
                    }
                    var incoming = port.ReadExisting();
                    foreach (var ch in incoming)
                    {
                        if (ch == '\n')
                        {
                            var value = line.ToString().Trim();
                            line.Clear();
                            if (S88SnapshotDecoder.TryParse(value, out var values))
                            {
                                if (values.Length > config.SensorCount)
                                    throw new IOException("Adapter reports more inputs than the configured address range.");
                                if (activeInputs != 0 && activeInputs != values.Length)
                                    SensorRangeUnavailable?.Invoke(config.SensorOffset + 1, config.SensorCount);
                                activeInputs = values.Length;
                                // Replay the full snapshot: after command-center disconnect,
                                // known sensor states can have been cleared.
                                for (int i = 0; i < values.Length; i++)
                                    SensorFeedbackChanged?.Invoke(config.SensorOffset + i + 1, values[i]);
                                lastSnapshot = DateTimeOffset.UtcNow;
                                UpdateStatus(config, true, values.Length, lastSnapshot, "Online");
                            }
                        }
                        else if (ch != '\r')
                        {
                            if (line.Length < 2048) line.Append(ch);
                            else line.Clear();
                        }
                    }
                    if (lastSnapshot != DateTimeOffset.MinValue &&
                        DateTimeOffset.UtcNow - lastSnapshot > TimeSpan.FromSeconds(5))
                        throw new IOException("S88 snapshot timeout.");
                    if (lastSnapshot == DateTimeOffset.MinValue &&
                        now - connectedAt > TimeSpan.FromSeconds(6))
                        throw new IOException("No valid S88 snapshot.");
                    await Task.Delay(40, ct);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException or TimeoutException)
            {
                UpdateStatus(config, false, 0, null, ex.Message);
                _log.LogWarning(ex, "External S88 adapter on {Port} disconnected", config.SerialPort);
            }
            finally
            {
                port?.Dispose();
                // Fail closed. Unknown is NOT FREE, and only this adapter's
                // address range is invalidated. Other sources stay intact.
                SensorRangeUnavailable?.Invoke(config.SensorOffset + 1, config.SensorCount);
                if (ct.IsCancellationRequested)
                    UpdateStatus(config, false, 0, null, "Stopped");
            }
            try { await Task.Delay(2000, ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        }
    }
}

public static class S88SnapshotDecoder
{
    // S88: _00000001 _00000000 ; bit zero is the rightmost character.
    public static bool TryParse(string line, out bool[] sensors)
    {
        sensors = [];
        if (!line.StartsWith("S88:", StringComparison.OrdinalIgnoreCase))
            return false;
        var tokens = line[4..].Split(
            (char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (tokens.Length is < 1 or > 32)
            return false;
        var result = new bool[tokens.Length * 8];
        for (int i = 0; i < tokens.Length; i++)
        {
            var token = tokens[i];
            if (token.Length != 9 || token[0] != '_')
                return false;
            for (int bit = 0; bit < 8; bit++)
            {
                var character = token[8 - bit];
                if (character is not ('0' or '1'))
                    return false;
                result[i * 8 + bit] = character == '1';
            }
        }
        sensors = result;
        return true;
    }
}
