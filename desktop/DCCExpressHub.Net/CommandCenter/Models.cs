namespace DCCExpressHub.Net.CommandCenter
{

    public sealed record StationInfo(string Version = "", string Processor = "", string Hardware = "", string Build = "", int MaxLocos = 0);
    public sealed record TrackInfo(int Index, string Mode);
    public sealed record PowerFeedback(bool On, string Target, int TrackIndex = -1);
    public sealed record LocoFeedback(int Address, int Speed, bool Forward, uint FunctionsMask);

    public sealed record Z21RuntimeDiagnostics(
        string Profile,
        uint BroadcastFlags,
        long UdpUptimeMs,
        int MainCurrentMa,
        int ProgCurrentMa,
        int FilteredMainCurrentMa,
        int TemperatureC,
        int SupplyVoltageMv,
        int TrackVoltageMv,
        byte CentralState,
        byte CentralStateEx,
        byte Capabilities,
        long LastSystemStateAgeMs);

    public sealed record LocoNetRuntimeDiagnostics(
        bool LbServerEnabled,
        bool LbServerConnected,
        string Host,
        int LbServerPort,
        long LbServerUptimeMs,
        long LastLbServerRxAgeMs,
        int LbServerLinesObserved,
        string LbServerVersion,
        bool BinaryFeedbackEnabled,
        int BinaryPort,
        long SensorFeedbackCount,
        int LastSensorAddress,
        bool? LastSensorOn,
        long LastSensorFeedbackAgeMs,
        long LastInterrogateAgeMs,
        bool InterrogateEnabled);
}