namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// YaMoRC YD7010 composition root.
///
/// The YD7010 exposes independent network protocols to the Hub:
///   - Z21 LAN for command-station control;
///   - XpressNet-LAN for XBus/R-BUS feedback;
///   - LocoNet/LBServer for LocoNet and bridged S88 feedback.
///
/// The protocol implementations stay separate and are only aggregated here
/// because they belong to the same physical command station.
/// </summary>
public sealed class YaMoRcZ21CommandCenter : RocoZ21CommandCenter
{
    private readonly YaMoRcLocoNetClient _locoNet;
    private readonly YaMoRcXpressNetClient _xpressNet;

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

        _xpressNet =
            new YaMoRcXpressNetClient(
                configuration,
                log);

        _locoNet.RawInfo +=
            PublishRawInfo;

        _locoNet.SensorFeedbackChanged +=
            PublishSensorFeedback;

        _xpressNet.RawInfo +=
            PublishRawInfo;

        _xpressNet.SensorFeedbackChanged +=
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

    protected override async Task ExecuteAsync(
        CancellationToken stoppingToken)
    {
        var z21Task =
            base.ExecuteAsync(
                stoppingToken);

        var locoNetTask =
            _locoNet.RunAsync(
                stoppingToken);

        var xpressNetTask =
            _xpressNet.RunAsync(
                stoppingToken);

        try
        {
            await Task.WhenAll(
                z21Task,
                locoNetTask,
                xpressNetTask);
        }
        catch (OperationCanceledException)
            when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    public override async Task<bool> RequestSensorSnapshotAsync(
        CancellationToken ct = default)
    {
        // YaMoRC physical R-BUS feedback belongs to XpressNet-LAN, not to
        // the Z21 UDP R-BUS transport. Keep the three protocols independent.
        var xpressNet =
            await _xpressNet.RequestSensorSnapshotAsync(
                ct);

        var locoNet =
            await _locoNet.RequestSensorSnapshotAsync(
                ct);

        return
            xpressNet ||
            locoNet;
    }
}
