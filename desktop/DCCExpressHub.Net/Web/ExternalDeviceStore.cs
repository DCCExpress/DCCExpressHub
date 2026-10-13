using System.Text.Json;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed record ExternalDeviceConfig
{
    public string Id { get; init; } = "";
    public string Type { get; init; } = "dcc-express-s88-adapter";
    public string Name { get; init; } = "DCCExpressS88Adapter";
    public bool Enabled { get; init; } = true;
    public string SerialPort { get; init; } = "";
    // S88 input 1 maps to SensorOffset + 1.
    public int SensorOffset { get; init; } = 2000;
    public int SensorCount { get; init; } = 32;
}

public sealed class ExternalDeviceStore
{
    readonly AppPaths _paths;
    readonly ILogger<ExternalDeviceStore> _log;
    readonly SemaphoreSlim _saveGate = new(1, 1);
    readonly object _gate = new();
    readonly string _file;
    List<ExternalDeviceConfig> _devices;

    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    public ExternalDeviceStore(AppPaths paths, ILogger<ExternalDeviceStore> log)
    {
        _paths = paths;
        _log = log;
        _file = Path.Combine(paths.ConfigRootPath, "external-devices.json");
        _devices = Load();
    }

    public ExternalDeviceConfig[] List()
    {
        lock (_gate)
            return _devices.ToArray();
    }

    List<ExternalDeviceConfig> Load()
    {
        try
        {
            if (!File.Exists(_file))
                return [];
            var devices = JsonSerializer.Deserialize<List<ExternalDeviceConfig>>(
                File.ReadAllText(_file), Json) ?? [];
            // A malformed persisted file cannot open overlapping serial ports/ranges.
            var accepted = new List<ExternalDeviceConfig>();
            foreach (var device in devices)
            {
                if (accepted.Count >= 16)
                    break;
                if (Validate(device, accepted, device.Id) is null &&
                    accepted.All(x => x.Id != device.Id))
                    accepted.Add(device);
                else
                    _log.LogWarning("Ignoring invalid external device {DeviceId}", device.Id);
            }
            return accepted;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to load external devices; no external devices will be activated");
            return [];
        }
    }

    public async Task<string?> UpsertAsync(ExternalDeviceConfig proposed, CancellationToken ct)
    {
        await _saveGate.WaitAsync(ct);
        try
        {
            var id = string.IsNullOrWhiteSpace(proposed.Id)
                ? Guid.NewGuid().ToString("N") : proposed.Id.Trim();
            var normalized = proposed with
            {
                Id = id,
                Type = (proposed.Type ?? "").Trim(),
                Name = (proposed.Name ?? "").Trim(),
                SerialPort = (proposed.SerialPort ?? "").Trim()
            };
            var current = List().ToList();
            var error = Validate(normalized, current, id);
            if (error is not null)
                throw new ArgumentException(error);
            var index = current.FindIndex(x => x.Id == id);
            if (index < 0 && current.Count >= 16)
                throw new ArgumentException("Maximum 16 external devices.");
            if (index >= 0)
                current[index] = normalized;
            else
                current.Add(normalized);
            await PersistAsync(current, ct);
            lock (_gate) _devices = current;
            return id;
        }
        finally { _saveGate.Release(); }
    }

    public async Task<bool> RemoveAsync(string id, CancellationToken ct)
    {
        await _saveGate.WaitAsync(ct);
        try
        {
            var current = List().Where(x => x.Id != id).ToList();
            if (current.Count == List().Length)
                return false;
            await PersistAsync(current, ct);
            lock (_gate) _devices = current;
            return true;
        }
        finally { _saveGate.Release(); }
    }

    async Task PersistAsync(List<ExternalDeviceConfig> devices, CancellationToken ct)
    {
        Directory.CreateDirectory(_paths.ConfigRootPath);
        var temp = _file + ".tmp";
        try
        {
            await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(devices, Json), ct);
            File.Move(temp, _file, true);
        }
        finally
        {
            if (File.Exists(temp))
                File.Delete(temp);
        }
    }

    static string? Validate(ExternalDeviceConfig d, List<ExternalDeviceConfig> current, string self)
    {
        if (string.IsNullOrWhiteSpace(d.Id) || d.Id.Length > 80)
            return "Invalid device ID.";
        if (d.Type != "dcc-express-s88-adapter")
            return "Unsupported external device type.";
        if (string.IsNullOrWhiteSpace(d.Name) || d.Name.Length > 80)
            return "Device name must be 1–80 characters.";
        if (string.IsNullOrWhiteSpace(d.SerialPort) ||
            !SerialPortName.IsValidForCurrentPlatform(d.SerialPort))
            return "Invalid serial port for this operating system.";
        if (d.SensorCount is < 8 or > 256 || d.SensorCount % 8 != 0)
            return "Sensor count must be 8–256, in multiples of 8.";
        if (d.SensorOffset < 0 || d.SensorOffset + d.SensorCount > ushort.MaxValue)
            return "Sensor address range exceeds 1–65535.";
        if (!d.Enabled)
            return null;
        var first = d.SensorOffset + 1;
        var last = d.SensorOffset + d.SensorCount;
        foreach (var other in current.Where(x => x.Enabled && x.Id != self))
        {
            if (string.Equals(d.SerialPort, other.SerialPort, StringComparison.OrdinalIgnoreCase))
                return "An enabled external device already owns this serial port.";
            if (first <= other.SensorOffset + other.SensorCount &&
                last >= other.SensorOffset + 1)
                return "External sensor address ranges overlap.";
        }
        return null;
    }
}
