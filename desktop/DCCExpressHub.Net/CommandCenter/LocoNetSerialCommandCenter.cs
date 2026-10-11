namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Standalone USB serial LocoNet receive-only command center.
/// Safety: command output is NOT emulated through Z21 UDP or LocoNet TCP.
/// All unsupported actuator operations fail closed until serial TX protocol
/// validation against a physical YD7010 has been completed.
/// </summary>
public sealed class LocoNetSerialCommandCenter : BackgroundService, ICommandCenter
{
    readonly YaMoRcLocoNetClient _client;
    readonly string _port;
    bool _connected;

    public LocoNetSerialCommandCenter(IConfiguration configuration, ILogger<LocoNetSerialCommandCenter> log)
    {
        _port = (configuration["LocoNet:SerialPort"] ?? "COM6").Trim();
        _client = new YaMoRcLocoNetClient(configuration, log);
        _client.RawInfo += message =>
        {
            RawInfo?.Invoke(message);
            if (message.StartsWith("LocoNet USB serial opened", StringComparison.Ordinal))
            {
                _connected = true;
                ConnectionChanged?.Invoke(true);
            }
        };
        _client.SensorFeedbackChanged += (address, occupied) => SensorFeedbackChanged?.Invoke(address, occupied);
    }

    public bool Connected => _connected;
    public string Type => "loconet-serial";
    public string Name => "LocoNet Serial (receive-only)";
    public string Endpoint => _port;
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
        try { await _client.RunAsync(stoppingToken); }
        finally
        {
            _connected = false;
            ConnectionChanged?.Invoke(false);
        }
    }

    static Task<bool> Unsupported() => Task.FromResult(false);
    public Task<bool> SendRawAsync(string command, bool log = true, CancellationToken ct = default) => Unsupported();
    public Task<bool> SetTrackPowerAsync(bool on, bool includeProgramming = true, CancellationToken ct = default) => Unsupported();
    public Task<bool> SetProgrammingPowerAsync(bool on, CancellationToken ct = default) => Unsupported();
    public Task<bool> EmergencyStopAsync(CancellationToken ct = default) => Unsupported();
    public Task<bool> SetLocoAsync(int address, int speed, bool forward, CancellationToken ct = default) => Unsupported();
    public Task<bool> RequestLocoAsync(int address, CancellationToken ct = default) => Unsupported();
    public Task<bool> SetLocoFunctionAsync(int address, int fn, bool active, CancellationToken ct = default) => Unsupported();
    public Task<bool> SetTurnoutAsync(int address, bool closed, CancellationToken ct = default) => Unsupported();
    public Task<bool> SetAccessoryAsync(int address, bool active, CancellationToken ct = default) => Unsupported();
    public Task<bool> SetSignalAspectAsync(int address, int aspect, CancellationToken ct = default) => Unsupported();
    public Task<bool> SetVPinAsync(int vpin, bool active, CancellationToken ct = default) => Unsupported();
    public Task<bool> RequestTrackConfigurationAsync(CancellationToken ct = default) => Unsupported();
    public Task<bool> RequestCurrentTelemetryAsync(CancellationToken ct = default) => Unsupported();
    public Task<bool> RequestTripTelemetryAsync(CancellationToken ct = default) => Unsupported();
    public Task<bool> RequestSensorSnapshotAsync(CancellationToken ct = default) => Unsupported();
}
