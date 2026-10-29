using System.Text.Json;

namespace DCCExpressHub.Android;

/// <summary>Android launcher preferences. Kept separate from runtime-owned command-center configuration.</summary>
public sealed class AndroidStartupSettings
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
    public static string FilePath => Path.Combine(FileSystem.AppDataDirectory, "android-startup.json");

    public static AndroidStartupSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<AndroidStartupSettings>(File.ReadAllText(FilePath))
                    ?? new AndroidStartupSettings();
        }
        catch { /* Fall back to defaults if previous preferences are corrupt. */ }
        return new AndroidStartupSettings();
    }

    public void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}
