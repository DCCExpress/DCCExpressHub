namespace DCCExpressHub.Net.CommandCenter;

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
    event Action<bool>? ConnectionChanged;

    Task<bool> SendRawAsync(string command, bool log=true, CancellationToken ct=default);
    Task<bool> SetTrackPowerAsync(bool on, bool includeProgramming=true, CancellationToken ct=default);
    Task<bool> SetProgrammingPowerAsync(bool on, CancellationToken ct=default);
    Task<bool> EmergencyStopAsync(CancellationToken ct=default);
    Task<bool> SetLocoAsync(int address, int speed, bool forward, CancellationToken ct=default);
    Task<bool> RequestLocoAsync(int address, CancellationToken ct=default);
    Task<bool> SetLocoFunctionAsync(int address, int fn, bool active, CancellationToken ct=default);
    Task<bool> SetTurnoutAsync(int address, bool closed, CancellationToken ct=default);
    Task<bool> SetAccessoryAsync(int address, bool active, CancellationToken ct=default);
    Task<bool> SetSignalAspectAsync(int address, int aspect, CancellationToken ct=default);
    Task<bool> SetVPinAsync(int vpin, bool active, CancellationToken ct=default);
    Task<bool> RequestTrackConfigurationAsync(CancellationToken ct=default);
    Task<bool> RequestCurrentTelemetryAsync(CancellationToken ct=default);
    Task<bool> RequestTripTelemetryAsync(CancellationToken ct=default);
}
