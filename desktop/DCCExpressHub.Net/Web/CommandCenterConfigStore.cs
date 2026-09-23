using System.Text.Json;
using System.Text.Json.Serialization;

namespace DCCExpressHub.Net.Web;

public sealed class CommandCenterSettings
{
    public string Transport { get; init; } = "tcp";
    public string TcpHost { get; init; } = "127.0.0.1";
    public int TcpPort { get; init; } = 2560;
    public string SerialPort { get; init; } = "COM3";
    public int BaudRate { get; init; } = 115200;
    public bool PowerIncludesProgramming { get; init; } = true;

    [JsonIgnore]
    public bool IsSerial =>
        string.Equals(
            Transport,
            "serial",
            StringComparison.OrdinalIgnoreCase);

    // Compatibility aliases used by the existing Program.cs.
    // TCP    -> Host/Port = host/tcp-port
    // Serial -> Host/Port = COM-port/baud-rate
    [JsonIgnore]
    public string Host =>
        IsSerial
            ? SerialPort
            : TcpHost;

    [JsonIgnore]
    public int Port =>
        IsSerial
            ? BaudRate
            : TcpPort;

    public CommandCenterSettings()
    {
    }

    // Compatibility constructor used by the existing HTTP endpoint.
    public CommandCenterSettings(
        string host,
        int port,
        bool powerIncludesProgramming)
    {
        PowerIncludesProgramming =
            powerIncludesProgramming;

        if (LooksLikeWindowsSerialPort(host))
        {
            Transport = "serial";
            SerialPort = host.Trim();
            BaudRate =
                port > 0
                    ? port
                    : 115200;
        }
        else
        {
            Transport = "tcp";
            TcpHost = host.Trim();
            TcpPort = port;
        }
    }

    public static bool LooksLikeWindowsSerialPort(
        string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return false;

        var text = value.Trim();

        if (!text.StartsWith(
                "COM",
                StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return int.TryParse(
                   text[3..],
                   out var number) &&
               number > 0;
    }
}

public sealed class CommandCenterConfigStore
{
    private readonly string _path;
    private readonly IConfiguration _configuration;
    private readonly object _gate = new();
    private CommandCenterSettings _current;

    private static readonly JsonSerializerOptions Json =
        new(JsonSerializerDefaults.Web)
        {
            PropertyNameCaseInsensitive = true,
            WriteIndented = true
        };

    public CommandCenterConfigStore(
        IWebHostEnvironment env,
        IConfiguration configuration)
    {
        _configuration =
            configuration;

        _path =
            Path.Combine(
                env.ContentRootPath,
                "data",
                "config",
                "command-center.json");

        _current =
            Load();
    }

    public CommandCenterSettings Current
    {
        get
        {
            lock (_gate)
                return _current;
        }
    }

    private string RuntimeTransport =>
        string.Equals(
            _configuration["DccEx:Transport"],
            "Serial",
            StringComparison.OrdinalIgnoreCase)
            ? "serial"
            : "tcp";

    private CommandCenterSettings Load()
    {
        // The Windows Desktop launcher explicitly supplies DccEx__Transport and
        // the endpoint through environment variables on every start. In that
        // case the launcher selection is authoritative; a stale persisted
        // command-center.json must never switch COM port/host behind its back.
        if (!string.IsNullOrWhiteSpace(
                Environment.GetEnvironmentVariable(
                    "DccEx__Transport")))
        {
            var configured =
                FromConfiguration();

            var persistedPower =
                ReadPersistedPowerPreference();

            return new CommandCenterSettings
            {
                Transport = configured.Transport,
                TcpHost = configured.TcpHost,
                TcpPort = configured.TcpPort,
                SerialPort = configured.SerialPort,
                BaudRate = configured.BaudRate,
                PowerIncludesProgramming =
                    persistedPower ??
                    configured.PowerIncludesProgramming
            };
        }

        try
        {
            if (File.Exists(_path))
            {
                var text =
                    File.ReadAllText(_path);

                using var document =
                    JsonDocument.Parse(text);

                var root =
                    document.RootElement;

                var isCurrentFormat =
                    HasProperty(
                        root,
                        "transport",
                        "Transport") ||
                    HasProperty(
                        root,
                        "tcpHost",
                        "TcpHost") ||
                    HasProperty(
                        root,
                        "serialPort",
                        "SerialPort");

                if (isCurrentFormat)
                {
                    var parsed =
                        JsonSerializer.Deserialize<CommandCenterSettings>(
                            text,
                            Json);

                    var normalized =
                        Normalize(parsed);

                    if (IsCompatibleWithRuntime(
                            normalized))
                    {
                        return normalized!;
                    }
                }
                else
                {
                    // Legacy format:
                    // { Host, Port, PowerIncludesProgramming }
                    var host =
                        GetString(
                            root,
                            "host",
                            "Host");

                    var port =
                        GetInt(
                            root,
                            "port",
                            "Port");

                    var power =
                        GetBool(
                            root,
                            true,
                            "powerIncludesProgramming",
                            "PowerIncludesProgramming");

                    if (!string.IsNullOrWhiteSpace(host) &&
                        port > 0)
                    {
                        var migrated =
                            Normalize(
                                new CommandCenterSettings(
                                    host,
                                    port,
                                    power));

                        if (IsCompatibleWithRuntime(
                                migrated))
                        {
                            return migrated!;
                        }
                    }
                }
            }
        }
        catch
        {
        }

        // The Desktop launcher supplies DccEx__Transport / endpoint settings
        // as environment variables. They are authoritative if a persisted file
        // belongs to the other transport (for example stale TCP config while
        // the user starts the backend in Serial mode).
        return FromConfiguration();
    }

    private bool? ReadPersistedPowerPreference()
    {
        try
        {
            if (!File.Exists(_path))
                return null;

            using var document =
                JsonDocument.Parse(
                    File.ReadAllText(_path));

            return GetNullableBool(
                document.RootElement,
                "powerIncludesProgramming",
                "PowerIncludesProgramming");
        }
        catch
        {
            return null;
        }
    }

    private bool IsCompatibleWithRuntime(
        CommandCenterSettings? settings) =>
        settings is not null &&
        string.Equals(
            settings.Transport,
            RuntimeTransport,
            StringComparison.OrdinalIgnoreCase);

    private CommandCenterSettings FromConfiguration()
    {
        var settings =
            new CommandCenterSettings
            {
                Transport =
                    RuntimeTransport,

                TcpHost =
                    _configuration["DccEx:Host"] ??
                    "127.0.0.1",

                TcpPort =
                    _configuration.GetValue(
                        "DccEx:Port",
                        2560),

                SerialPort =
                    _configuration["DccEx:SerialPort"] ??
                    "COM3",

                BaudRate =
                    _configuration.GetValue(
                        "DccEx:BaudRate",
                        115200),

                PowerIncludesProgramming = true
            };

        return Normalize(settings) ??
               new CommandCenterSettings
               {
                   Transport = RuntimeTransport
               };
    }

    public async Task<bool> SaveAsync(
        CommandCenterSettings settings)
    {
        var normalized =
            Normalize(settings);

        if (!IsCompatibleWithRuntime(
                normalized))
        {
            return false;
        }

        try
        {
            Directory.CreateDirectory(
                Path.GetDirectoryName(_path)!);

            var temp =
                _path + ".tmp";

            await File.WriteAllTextAsync(
                temp,
                JsonSerializer.Serialize(
                    normalized,
                    Json));

            File.Move(
                temp,
                _path,
                true);

            lock (_gate)
                _current = normalized!;

            return true;
        }
        catch
        {
            return false;
        }
    }

    private static CommandCenterSettings? Normalize(
        CommandCenterSettings? value)
    {
        if (value is null)
            return null;

        var isSerial =
            string.Equals(
                value.Transport,
                "serial",
                StringComparison.OrdinalIgnoreCase);

        var tcpHost =
            (value.TcpHost ?? "").Trim();

        var serialPort =
            (value.SerialPort ?? "").Trim();

        var tcpPort =
            value.TcpPort;

        var baud =
            value.BaudRate;

        if (tcpHost.Length == 0)
            tcpHost = "127.0.0.1";

        if (tcpPort is < 1 or > 65535)
            tcpPort = 2560;

        if (serialPort.Length == 0)
            serialPort = "COM3";

        if (baud <= 0)
            baud = 115200;

        if (isSerial &&
            !CommandCenterSettings
                .LooksLikeWindowsSerialPort(
                    serialPort))
        {
            return null;
        }

        return new CommandCenterSettings
        {
            Transport =
                isSerial
                    ? "serial"
                    : "tcp",

            TcpHost = tcpHost,
            TcpPort = tcpPort,
            SerialPort = serialPort,
            BaudRate = baud,

            PowerIncludesProgramming =
                value.PowerIncludesProgramming
        };
    }

    private static bool HasProperty(
        JsonElement root,
        params string[] names)
    {
        foreach (var name in names)
        {
            if (root.TryGetProperty(
                    name,
                    out _))
            {
                return true;
            }
        }

        return false;
    }

    private static string GetString(
        JsonElement root,
        params string[] names)
    {
        foreach (var name in names)
        {
            if (root.TryGetProperty(
                    name,
                    out var value) &&
                value.ValueKind ==
                JsonValueKind.String)
            {
                return value.GetString() ?? "";
            }
        }

        return "";
    }

    private static int GetInt(
        JsonElement root,
        params string[] names)
    {
        foreach (var name in names)
        {
            if (root.TryGetProperty(
                    name,
                    out var value) &&
                value.TryGetInt32(
                    out var number))
            {
                return number;
            }
        }

        return 0;
    }

    private static bool? GetNullableBool(
        JsonElement root,
        params string[] names)
    {
        foreach (var name in names)
        {
            if (!root.TryGetProperty(
                    name,
                    out var value))
            {
                continue;
            }

            if (value.ValueKind ==
                JsonValueKind.True)
            {
                return true;
            }

            if (value.ValueKind ==
                JsonValueKind.False)
            {
                return false;
            }
        }

        return null;
    }

    private static bool GetBool(
        JsonElement root,
        bool fallback,
        params string[] names)
    {
        foreach (var name in names)
        {
            if (!root.TryGetProperty(
                    name,
                    out var value))
            {
                continue;
            }

            if (value.ValueKind ==
                JsonValueKind.True)
            {
                return true;
            }

            if (value.ValueKind ==
                JsonValueKind.False)
            {
                return false;
            }
        }

        return fallback;
    }
}
