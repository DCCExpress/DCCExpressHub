namespace DCCExpressHub.Net.CommandCenter
{
    public sealed record CommandCenterProgrammingResult(
        bool Ok,
        int Cv,
        int Value,
        string Message,
        string Raw = "");

    public interface ICommandCenter
    {
        bool Connected { get; }
        string Type { get; }
        string Name { get; }
        string Endpoint { get; }
        bool EmergencyPauseStateKnown { get; }
        bool EmergencyPaused { get; }

        event Action<string>? RawInfo;
        event Action<StationInfo>? StationInfoChanged;
        event Action<TrackInfo>? TrackConfigurationChanged;
        event Action<int[]>? CurrentTelemetryChanged;
        event Action<int[]>? TripTelemetryChanged;
        event Action<PowerFeedback>? PowerFeedbackChanged;
        event Action<LocoFeedback>? LocoFeedbackChanged;
        event Action<int, bool>? SensorFeedbackChanged;
        event Action<int, bool>? AccessoryFeedbackChanged;
        event Action<bool>? ConnectionChanged;

        Task<bool> SendRawAsync(string command, bool log = true, CancellationToken ct = default);
        Task<bool> SetTrackPowerAsync(bool on, bool includeProgramming = true, CancellationToken ct = default);
        Task<bool> SetProgrammingPowerAsync(bool on, CancellationToken ct = default);
        Task<bool> EmergencyStopAsync(CancellationToken ct = default);
        Task<bool> SetLocoAsync(int address, int speed, bool forward, CancellationToken ct = default);
        Task<bool> RequestLocoAsync(int address, CancellationToken ct = default);
        Task<bool> SetLocoFunctionAsync(int address, int fn, bool active, CancellationToken ct = default);
        Task<bool> SetTurnoutAsync(int address, bool closed, CancellationToken ct = default);
        Task<bool> SetAccessoryAsync(int address, bool active, CancellationToken ct = default);
        Task<bool> SetSignalAspectAsync(int address, int aspect, CancellationToken ct = default);
        Task<bool> SetVPinAsync(int vpin, bool active, CancellationToken ct = default);
        Task<bool> RequestTrackConfigurationAsync(CancellationToken ct = default);
        Task<bool> RequestCurrentTelemetryAsync(CancellationToken ct = default);
        Task<bool> RequestTripTelemetryAsync(CancellationToken ct = default);
        Task<bool> RequestSensorSnapshotAsync(CancellationToken ct = default);
        Task<CommandCenterProgrammingResult> ReadServiceCvAsync(
            int cv,
            CancellationToken ct = default) =>
            Task.FromResult(
                new CommandCenterProgrammingResult(
                    false,
                    cv,
                    -1,
                    "Service-mode programming is not supported."));

        Task<CommandCenterProgrammingResult> WriteServiceCvAsync(
            int cv,
            int value,
            CancellationToken ct = default) =>
            Task.FromResult(
                new CommandCenterProgrammingResult(
                    false,
                    cv,
                    -1,
                    "Service-mode programming is not supported."));

        Task<CommandCenterProgrammingResult> ReadPomCvAsync(
            int address,
            int cv,
            CancellationToken ct = default) =>
            Task.FromResult(
                new CommandCenterProgrammingResult(
                    false,
                    cv,
                    -1,
                    "POM read is not supported."));

        Task<CommandCenterProgrammingResult> WritePomCvAsync(
            int address,
            int cv,
            int value,
            CancellationToken ct = default) =>
            Task.FromResult(
                new CommandCenterProgrammingResult(
                    false,
                    cv,
                    -1,
                    "POM write is not supported."));

        Task<CommandCenterProgrammingResult> ReadAccessoryPomCvAsync(
            int decoderAddress,
            int cv,
            CancellationToken ct = default) =>
            Task.FromResult(
                new CommandCenterProgrammingResult(
                    false,
                    cv,
                    -1,
                    "Accessory POM read is not supported."));

        Task<CommandCenterProgrammingResult> WriteAccessoryPomCvAsync(
            int decoderAddress,
            int cv,
            int value,
            CancellationToken ct = default) =>
            Task.FromResult(
                new CommandCenterProgrammingResult(
                    false,
                    cv,
                    -1,
                    "Accessory POM write is not supported."));
    }
}