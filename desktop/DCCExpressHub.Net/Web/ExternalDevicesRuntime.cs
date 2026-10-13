using System.IO.Ports;
using System.Text;
using System.Text.RegularExpressions;

namespace DCCExpressHub.Net.Web;

// Independent hardware feedback sources. Never feed external S88 bytes into a
// DCC-EX command-station transport; only publish normalized sensor feedback.
public sealed class ExternalDevicesRuntime : BackgroundService
{
    sealed record Worker(ExternalDeviceConfig Config, CancellationTokenSource Cancellation, Task Running);

    public sealed record DeviceStatus(
        string Id, string Port, bool Connected, int ActiveInputs,
        DateTimeOffset? LastSnapshotUtc, string Message, bool[] Snapshot,
        int ConfiguredBytes, int? AdapterBytes);

    readonly ExternalDeviceStore _store;
    readonly ILogger<ExternalDevicesRuntime> _log;
    readonly object _statusGate = new();
    readonly Dictionary<string, DeviceStatus> _status = new();
    readonly Dictionary<string, Worker> _workers = new();
    readonly SemaphoreSlim _reconcileGate = new(1, 1);

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

    // A command-station disconnect invalidates the shared sensor cache.
    // External adapters are independent and remain connected, so replay
    // their latest verified snapshot exactly once after that invalidation.
    public void ReplayLiveSensorStates()
    {
        var configs = _store.List().ToDictionary(x => x.Id);
        foreach (var status in Status())
        {
            if (!status.Connected || !configs.TryGetValue(status.Id, out var config) ||
                !config.Enabled || !string.Equals(config.SerialPort, status.Port,
                    StringComparison.OrdinalIgnoreCase))
                continue;
            for (var i = 0; i < status.Snapshot.Length; i++)
                SensorFeedbackChanged?.Invoke(config.SensorOffset + i + 1, status.Snapshot[i]);
        }
    }

    void UpdateStatus(
        ExternalDeviceConfig config, bool connected, int inputs, DateTimeOffset? at,
        string message, bool[]? snapshot = null, int? adapterBytes = null)
    {
        lock (_statusGate)
            _status[config.Id] = new DeviceStatus(
                config.Id, config.SerialPort, connected, inputs, at, message,
                snapshot ?? [], config.S88Bytes, adapterBytes);
    }

    // Called after saving/removing a device AND periodically for recovery.
    // A changed COM port cannot be opened until the old worker has exited,
    // disposed its SerialPort and invalidated its previous sensor range.
    public async Task ApplyConfigurationAsync(CancellationToken ct = default)
    {
        await _reconcileGate.WaitAsync(ct);
        try
        {
            var configured = _store.List()
                .Where(x => x.Enabled)
                .ToDictionary(x => x.Id);

            foreach (var existing in _workers.ToArray())
            {
                if (configured.TryGetValue(existing.Key, out var latest) &&
                    latest == existing.Value.Config)
                    continue;

                existing.Value.Cancellation.Cancel();
                try { await existing.Value.Running; }
                catch (OperationCanceledException) { }
                finally
                {
                    existing.Value.Cancellation.Dispose();
                    _workers.Remove(existing.Key);
                    lock (_statusGate) _status.Remove(existing.Key);
                }
            }

            foreach (var device in configured.Values)
            {
                if (_workers.ContainsKey(device.Id))
                    continue;
                var linked = new CancellationTokenSource();
                // The hosted service calls ApplyConfigurationAsync with its
                // cancellation token; workers are independently owned/cancelled.
                var running = MonitorAdapterAsync(device, linked.Token);
                _workers.Add(device.Id, new Worker(device, linked, running));
            }
        }
        finally { _reconcileGate.Release(); }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await ApplyConfigurationAsync(stoppingToken);
                await Task.Delay(750, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally
        {
            await _reconcileGate.WaitAsync(CancellationToken.None);
            try
            {
                foreach (var worker in _workers.Values)
                    worker.Cancellation.Cancel();
                foreach (var worker in _workers.Values)
                {
                    try { await worker.Running; }
                    catch (OperationCanceledException) { }
                    worker.Cancellation.Dispose();
                }
                _workers.Clear();
            }
            finally { _reconcileGate.Release(); }
        }
    }

    // The S88Adapter firmware reports its current, staged and EEPROM byte
    // count in STATUS. Write EEPROM only if the desired configuration differs.
    public static bool TryParseByteStatus(
        string response, out int active, out int staged, out int saved)
    {
        active = GetStatusNumber(response, "Active S88 bytes:");
        staged = GetStatusNumber(response, "Serial staged bytes:");
        saved = GetStatusNumber(response, "EEPROM saved bytes:");
        return active is >= 1 and <= 32 &&
               staged is >= 1 and <= 32 &&
               saved is >= 1 and <= 32;
    }

    static int GetStatusNumber(string response, string label)
    {
        var match = Regex.Match(
            response,
            @"(?m)^\s*" + Regex.Escape(label) + @"\s*(\d+)\b",
            RegexOptions.CultureInvariant);
        return match.Success && int.TryParse(match.Groups[1].Value, out var value)
            ? value
            : 0;
    }

    static async Task<string> ExchangeAsync(
        SerialPort port, string command, Func<string, bool> complete,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        port.DiscardInBuffer();
        port.Write(command + "\n");
        var result = new StringBuilder();
        var deadline = DateTimeOffset.UtcNow.AddSeconds(3);
        while (DateTimeOffset.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            var chunk = port.ReadExisting();
            if (chunk.Length > 0)
            {
                result.Append(chunk);
                if (result.Length > 8192)
                    throw new IOException("Adapter response too long.");
                var output = result.ToString();
                if (Regex.IsMatch(output, @"(?m)^\s*ERR:", RegexOptions.IgnoreCase))
                    throw new IOException("Adapter rejected " + command + ": " + output.Trim());
                if (complete(output))
                    return output;
            }
            await Task.Delay(30, ct);
        }
        throw new IOException("No valid response to adapter command " + command + ".");
    }

    static async Task ConfigureAdapterAsync(
        SerialPort port, ExternalDeviceConfig config, CancellationToken ct)
    {
        await ExchangeAsync(port, "LOG OFF",
            output => output.Contains("OK: periodic S88 log OFF", StringComparison.Ordinal), ct);

        async Task<(int Active, int Staged, int Saved)> StatusAsync()
        {
            var response = await ExchangeAsync(port, "STATUS",
                output => TryParseByteStatus(output, out _, out _, out _), ct);
            if (!TryParseByteStatus(response, out var active, out var staged, out var saved))
                throw new IOException("Invalid S88 adapter STATUS response.");
            return (active, staged, saved);
        }

        var status = await StatusAsync();
        if (status.Active != config.S88Bytes ||
            status.Staged != config.S88Bytes ||
            status.Saved != config.S88Bytes)
        {
            await ExchangeAsync(port, "SET BYTES " + config.S88Bytes,
                output => output.Contains(
                    "NOTE: SAVE stores this byte length for the next boot.",
                    StringComparison.Ordinal), ct);

            await ExchangeAsync(port, "SAVE",
                output => output.Contains(
                    "OK: configuration saved to EEPROM", StringComparison.Ordinal), ct);

            status = await StatusAsync();
            if (status.Active != config.S88Bytes ||
                status.Staged != config.S88Bytes ||
                status.Saved != config.S88Bytes)
                throw new IOException("Adapter S88 bytes were not saved/verified.");
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
                // Arduino Uno-class boards can reboot on USB serial open.
                await Task.Delay(2200, ct);
                UpdateStatus(config, false, 0, null, "Configuring S88 bytes/groups");
                await ConfigureAdapterAsync(port, config, ct);
                ct.ThrowIfCancellationRequested();
                _log.LogInformation(
                    "External S88 adapter {Name} on {Port} configured: {Bytes} bytes / {Inputs} inputs",
                    config.Name, config.SerialPort, config.S88Bytes, config.SensorCount);

                var line = new StringBuilder(256);
                var lastSnapshot = DateTimeOffset.MinValue;
                bool[]? previous = null;
                var connectedAt = DateTimeOffset.UtcNow;
                var nextPoll = DateTimeOffset.MinValue;
                while (!ct.IsCancellationRequested)
                {
                    var now = DateTimeOffset.UtcNow;
                    if (now >= nextPoll)
                    {
                        port.Write("READ\n");
                        nextPoll = now.AddMilliseconds(250);
                    }

                    foreach (var ch in port.ReadExisting())
                    {
                        if (ch == '\n')
                        {
                            var value = line.ToString().Trim();
                            line.Clear();
                            if (!S88SnapshotDecoder.TryParse(value, out var values))
                                continue;
                            ct.ThrowIfCancellationRequested();

                            // Never mark a partial/mismatched S88 frame as valid:
                            // missing sensors must stay UNKNOWN, not FREE.
                            if (values.Length != config.SensorCount)
                                throw new IOException(
                                    "S88 snapshot length differs from the configured byte count.");

                            // First snapshot initializes all sensors, then only
                            // physical transitions produce runtime events.
                            for (var i = 0; i < values.Length; i++)
                            {
                                if (previous is null || previous[i] != values[i])
                                    SensorFeedbackChanged?.Invoke(config.SensorOffset + i + 1, values[i]);
                            }
                            previous = values;

                            lastSnapshot = DateTimeOffset.UtcNow;
                            UpdateStatus(config, true, values.Length, lastSnapshot,
                                "Online", values, config.S88Bytes);
                        }
                        else if (ch != '\r')
                        {
                            if (line.Length < 2048)
                                line.Append(ch);
                            else
                                line.Clear();
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
            catch (Exception ex) when (
                ex is IOException or UnauthorizedAccessException or
                      InvalidOperationException or TimeoutException or ArgumentException)
            {
                UpdateStatus(config, false, 0, null, ex.Message);
                _log.LogWarning(ex, "External S88 adapter on {Port} disconnected", config.SerialPort);
            }
            finally
            {
                port?.Dispose();
                // A disconnected adapter's states become UNKNOWN, never OFF.
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
            (char[]?)null,
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
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
