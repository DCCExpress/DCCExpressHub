using System.Text.Json;

namespace DCCExpressHub.App;

/// <summary>Platform launcher preferences, separate from runtime-owned command-center configuration.</summary>
public sealed class HubStartupSettings
{
    public string Protocol { get; set; } = "tcp";
    public string TcpHost { get; set; } = "192.168.1.100";
    public int TcpPort { get; set; } = 2560;
    public string SerialPort { get; set; } = "";
    public int SerialBaudRate { get; set; } = 115200;
    public int RBusOffset { get; set; }
    public int LocoNetSensorOffset { get; set; }
    public int HttpPort { get; set; } = 5174;
    public bool AllowLan { get; set; }
    public string WorkspaceDirectory { get; set; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DCCExpressHub", "workspace");
    public static string FilePath => Path.Combine(FileSystem.AppDataDirectory,
#if WINDOWS
        "windows-startup.json");
#else
        "android-startup.json");
#endif

    public static HubStartupSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<HubStartupSettings>(File.ReadAllText(FilePath))
                    ?? new HubStartupSettings();
        }
        catch { /* Fall back to defaults if previous preferences are corrupt. */ }
        return new HubStartupSettings();
    }

    public void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}
