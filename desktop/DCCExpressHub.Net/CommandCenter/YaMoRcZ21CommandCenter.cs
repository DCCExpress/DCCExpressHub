namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// YaMoRC YD7010 composition root.
///
/// The YD7010 exposes two independent protocols to the Hub:
///   - Z21 LAN for command-station control and R-BUS feedback;
///   - LocoNet/LBServer for LocoNet and bridged S88 feedback.
///
/// The protocol implementations stay separate and are only aggregated here
/// because they belong to the same physical command station.
/// </summary>
public sealed class YaMoRcZ21CommandCenter : RocoZ21CommandCenter
{
    private readonly YaMoRcLocoNetClient _locoNet;

    public YaMoRcZ21CommandCenter(
        IConfiguration configuration,
        ILogger<YaMoRcZ21CommandCenter> log)
        : base(
            configuration,
            log,
            true)
    {
        _locoNet =
            new YaMoRcLocoNetClient(
                configuration,
                log);

        _locoNet.RawInfo +=
            PublishRawInfo;

        _locoNet.SensorFeedbackChanged +=
            PublishSensorFeedback;

        _stationInfo =
            new(
                Version: "",
                Processor: "Z21 LAN",
                Hardware: "YD7010",
                Build: "",
                MaxLocos: 0);
    }

    public override string Name => "YD7010";

    protected override string Z21Profile =>
        "yamorc7010";

    protected override string Z21ProcessorName =>
        "Z21 LAN";

    protected override string Z21HardwareName(
        uint hardwareType) =>
        "YD7010";

    public LocoNetRuntimeDiagnostics LocoNetDiagnostics =>
        _locoNet.Diagnostics;

    public Task<LocoNetConnectionTestResult> TestLocoNetConnectionAsync(
        string? hostOverride = null,
        CancellationToken ct = default) =>
        _locoNet.TestConnectionAsync(
            hostOverride,
            ct);

    protected override async Task ExecuteAsync(
        CancellationToken stoppingToken)
    {
        var locoNetTask =
            _locoNet.RunAsync(
                stoppingToken);

        try
        {
            await base.ExecuteAsync(
                stoppingToken);
        }
        finally
        {
            try
            {
                await locoNetTask;
            }
            catch (OperationCanceledException)
                when (stoppingToken.IsCancellationRequested)
            {
            }
        }
    }

    public override async Task<bool> RequestSensorSnapshotAsync(
        CancellationToken ct = default)
    {
        var z21 =
            await base.RequestSensorSnapshotAsync(
                ct);

        var locoNet =
            await _locoNet.RequestSensorSnapshotAsync(
                ct);

        return
            z21 ||
            locoNet;
    }
}
