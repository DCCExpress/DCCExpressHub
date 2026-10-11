using System.Text.Json;

namespace DCCExpressHub.Net.CommandCenter;

public sealed record YaMoRcLocoNetSerialSettings(
    bool Enabled = false,
    string Port = "COM16",
    int BaudRate = 115200)
{
    // A dedicated file keeps the serial feedback port independent of the
    // command station Z21 UDP endpoint and of DCC-EX USB transport.
    public static string FilePath => Path.Combine(
        AppContext.BaseDirectory, "data", "state", "loconet-serial.json");

    public static YaMoRcLocoNetSerialSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var settings = JsonSerializer.Deserialize<YaMoRcLocoNetSerialSettings>(
                    File.ReadAllText(FilePath));
                if (settings is not null && settings.IsValid())
                    return settings;
            }
        }
        catch { /* Invalid optional serial settings leave transport disabled. */ }
        return new();
    }

    public bool IsValid() =>
        !string.IsNullOrWhiteSpace(Port) &&
        Port.Length <= 128 &&
        BaudRate is >= 1200 and <= 1000000;

    public bool Save()
    {
        if (!IsValid()) return false;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            var temp = FilePath + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(this));
            File.Move(temp, FilePath, true);
            return true;
        }
        catch { return false; }
    }
}
