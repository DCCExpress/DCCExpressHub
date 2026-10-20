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

        // Both protocols publish absolute Hub sensor addresses. When offsets
        // overlap, different physical inputs can write the very same address.
        var rbusFirst = RBusOffset + 1;
        var rbusLast = RBusOffset + 160;
        var loconetFirst = _locoNet.SensorOffset + 1;
        var loconetLast = _locoNet.SensorOffset + 4096;
        if (rbusFirst <= loconetLast && loconetFirst <= rbusLast)
        {
            log.LogWarning(
                "YD7010 R-BUS/LocoNet SENSOR ADDRESS RANGE OVERLAP: R-BUS #{RbusFirst}-#{RbusLast}, LocoNet #{LocoNetFirst}-#{LocoNetLast}. Distinct inputs may report against the same Hub sensor; check both configured offsets.",
                rbusFirst, rbusLast, loconetFirst, loconetLast);
        }

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

        // The LBServer feedback stream may have stayed connected during
        // the Z21 UDP outage. Its known states are still live, but the Hub
        // dropped their shared sensor cache on disconnect. Replay them.
        var replayed = _locoNet.ReplayLiveSensorStates();

        return
            z21 ||
            locoNet ||
            replayed > 0;
    }
}
