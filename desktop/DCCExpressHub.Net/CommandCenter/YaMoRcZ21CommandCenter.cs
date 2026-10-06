namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// YaMoRC YD7010 specialization of the Roco Z21 LAN command center.
/// </summary>
public sealed class YaMoRcZ21CommandCenter : RocoZ21CommandCenter
{
    public const int MaxLocoNetSensorOffset = 65535 - 4096;

    private const uint YaMoRcBroadcastFlags = 0x09010103;
    private readonly bool _lbServerFeedbackEnabled;
    private readonly int _lbServerPort;
    private readonly int _locoNetSensorOffset;

    public YaMoRcZ21CommandCenter(
        IConfiguration configuration,
        ILogger<YaMoRcZ21CommandCenter> log)
        : base(
            configuration,
            log,
            true)
    {
        _lbServerFeedbackEnabled =
            configuration.GetValue(
                "Z21:LbServerFeedback",
                true);

        _lbServerPort =
            configuration.GetValue(
                "Z21:LbServerPort",
                1234);

        if (_lbServerPort is < 1 or > 65535)
            _lbServerPort = 1234;

        _locoNetSensorOffset =
            Math.Clamp(
                configuration.GetValue(
                    "Z21:LocoNetSensorOffset",
                    0),
                0,
                MaxLocoNetSensorOffset);

        _stationInfo =
            new(
                Version: "",
                Processor: Z21ProcessorName,
                Hardware: "YD7010",
                Build: "",
                MaxLocos: 0);
    }

    public override string Name => "YD7010";
    protected override string Z21Profile => "yamorc7010";
    protected override uint BroadcastFlags => YaMoRcBroadcastFlags;
    protected override bool LocoNetFeedbackEnabled =>
        Configuration.GetValue(
            "Z21:LocoNetFeedback",
            true);
    protected override bool LbServerFeedbackEnabled =>
        _lbServerFeedbackEnabled;
    protected override int LbServerPort =>
        _lbServerPort;
    protected override int LocoNetSensorOffset =>
        _locoNetSensorOffset;
    protected override string Z21ProcessorName =>
        "Z21 LAN + LocoNet LBServer";
    protected override string Z21HardwareName(
        uint hardwareType) =>
        "YD7010";
}
