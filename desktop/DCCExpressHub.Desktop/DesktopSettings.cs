using System.IO;
using System.Text.Json;

namespace DCCExpressHub.Desktop;

public sealed class DesktopSettings
{
    public string Language { get; set; } = "en";
    public string Protocol { get; set; } = "";
    public string TcpHost { get; set; } = "127.0.0.1";
    public int TcpPort { get; set; } = 2560;
    public string SerialPort { get; set; } = "";
    public int SerialBaudRate { get; set; } = 115200;
    public string RunMode { get; set; } = "local";
    public int HttpPort { get; set; } = 8080;
    public string WorkspaceDirectory { get; set; } = DefaultWorkspaceDirectory;

    public static string DefaultWorkspaceDirectory =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "DCCExpressHub",
            "workspace");

    public DesktopSettings Clone() => new()
    {
        Language = Language,
        Protocol = Protocol,
        TcpHost = TcpHost,
        TcpPort = TcpPort,
        SerialPort = SerialPort,
        SerialBaudRate = SerialBaudRate,
        RunMode = RunMode,
        HttpPort = HttpPort,
        WorkspaceDirectory = WorkspaceDirectory
    };
}

public static class DesktopSettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    public static string SettingsPath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "DCCExpressHub",
            "desktop-settings.json");

    public static bool Exists => File.Exists(SettingsPath);

    public static DesktopSettings Load()
    {
        try
        {
            if (!File.Exists(SettingsPath))
                return new DesktopSettings();

            var settings = JsonSerializer.Deserialize<DesktopSettings>(
                File.ReadAllText(SettingsPath),
                JsonOptions);

            if (settings is null)
                return new DesktopSettings();

            settings.Language = DesktopLocalization.NormalizeLanguage(settings.Language);

            if (string.IsNullOrWhiteSpace(settings.WorkspaceDirectory))
                settings.WorkspaceDirectory = DesktopSettings.DefaultWorkspaceDirectory;

            if (settings.HttpPort is < 1 or > 65535)
                settings.HttpPort = 8080;

            if (settings.TcpPort is < 1 or > 65535)
                settings.TcpPort = 2560;

            if (settings.SerialBaudRate <= 0)
                settings.SerialBaudRate = 115200;

            if (settings.RunMode is not ("local" or "server"))
                settings.RunMode = "local";

            if (settings.Protocol is not ("tcp" or "serial"))
                settings.Protocol = "";

            return settings;
        }
        catch
        {
            return new DesktopSettings();
        }
    }

    public static void Save(DesktopSettings settings)
    {
        var directory = Path.GetDirectoryName(SettingsPath)!;
        Directory.CreateDirectory(directory);

        var temp = SettingsPath + ".tmp";
        File.WriteAllText(
            temp,
            JsonSerializer.Serialize(settings, JsonOptions));

        File.Move(temp, SettingsPath, true);
    }
}
