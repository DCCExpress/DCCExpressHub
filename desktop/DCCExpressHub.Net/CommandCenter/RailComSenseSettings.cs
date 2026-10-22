using System.Text.Json;
using DCCExpressHub.Net.Web;

namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Interpretation of direction encoded in OPC_MULTI_SENSE (D0).
/// Not a command to the detector or the YD7010, which must be configured
/// separately. OPC_MULTI_SENSE_LONG (E0) provides its own direction bit.
/// </summary>
public enum RailComSenseMode { Off, Block, Loco }

public sealed class RailComSenseSettings
{
    private readonly object _gate = new();
    private readonly string _path;
    private RailComSenseMode _mode;

    public RailComSenseSettings(IConfiguration configuration, AppPaths paths)
    {
        _path = Path.Combine(paths.ConfigRootPath, "railcom.json");
        var configured = configuration["LocoNet:RailComSenseDirection"];
        _mode = Parse(configured) ??
            (configuration.GetValue("LocoNet:RailComDirectionInBlockAddress", true)
                ? RailComSenseMode.Block : RailComSenseMode.Off);

        if (!File.Exists(_path)) return;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(_path));
            if (doc.RootElement.TryGetProperty("senseMode", out var value) &&
                value.ValueKind == JsonValueKind.String &&
                Parse(value.GetString()) is { } saved)
                _mode = saved;
        }
        catch (Exception)
        {
            // Corrupt or unavailable preferences never block the command center.
            // Fall back to the configured/default mode.
        }
    }

    public RailComSenseMode Mode
    {
        get { lock (_gate) return _mode; }
    }

    public string ModeName => WireName(Mode);

    public static string WireName(RailComSenseMode mode) => mode switch
    {
        RailComSenseMode.Block => "block",
        RailComSenseMode.Loco => "loco",
        _ => "off"
    };

    public static RailComSenseMode? Parse(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        "off" => RailComSenseMode.Off,
        "block" or "inblockaddress" => RailComSenseMode.Block,
        "loco" or "inlocoaddress" => RailComSenseMode.Loco,
        _ => null
    };

    public bool TrySetMode(string? value)
    {
        if (Parse(value) is not { } mode) return false;
        lock (_gate)
        {
            if (_mode == mode) return true;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
                var temp = _path + ".tmp";
                File.WriteAllText(temp, JsonSerializer.Serialize(new { senseMode = WireName(mode) }));
                File.Move(temp, _path, true);
                _mode = mode;
                return true;
            }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
        }
    }
}
