namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Transport-independent monitor of documented, checksum-valid LocoNet frames.
/// Shared by the raw USB/serial and LBServer/TCP transports.
///
/// General-purpose LocoNet has no universally supported numeric current,
/// voltage, or temperature dataset. Digitrax Query Mode measurements and
/// vendor-specific messages must not be guessed or treated as DCC track current.
/// </summary>
public sealed record LocoNetStandardTelemetrySnapshot(
    long RxFrames,
    long TxFrames,
    long SensorReports,
    long TurnoutReports,
    long PowerReports,
    bool? ReportedTrackPowerOn,
    long LastRxAgeMs,
    long LastPowerReportAgeMs,
    int? TrackCurrentMa,
    double? TrackVoltageV,
    double? TemperatureC);

public sealed class LocoNetStandardTelemetry
{
    private readonly object _gate = new();
    private long _rxFrames, _txFrames, _sensorReports, _turnoutReports, _powerReports;
    private long _lastRxTick = -1, _lastPowerTick = -1;
    private bool? _reportedTrackPowerOn;

    public void Reset()
    {
        lock (_gate)
        {
            _rxFrames = _txFrames = _sensorReports = _turnoutReports = _powerReports = 0;
            _lastRxTick = _lastPowerTick = -1;
            _reportedTrackPowerOn = null;
        }
    }

    public void ObserveReceived(ReadOnlySpan<byte> packet)
    {
        if (packet.Length < 2) return;
        byte checksum = 0;
        foreach (var b in packet) checksum ^= b;
        if (checksum != 0xFF) return;

        lock (_gate)
        {
            _rxFrames++;
            _lastRxTick = Environment.TickCount64;

            if (packet.Length == 2 && packet[0] is 0x82 or 0x83)
            {
                _reportedTrackPowerOn = packet[0] == 0x83;
                _powerReports++;
                _lastPowerTick = _lastRxTick;
            }
            // OPC_IDLE (0x85) is not equivalent to a measured loss of
            // track voltage; do not set a false OFF reading from it.
            else if (packet.Length == 4 && packet[0] == 0xB2)
                _sensorReports++;
            else if (packet.Length == 4 && packet[0] is 0xB0 or 0xB1)
                _turnoutReports++;
        }
    }

    public void ObserveTransmitted()
    {
        lock (_gate) _txFrames++;
    }

    public LocoNetStandardTelemetrySnapshot Snapshot()
    {
        lock (_gate)
        {
            var now = Environment.TickCount64;
            return new(
                _rxFrames,
                _txFrames,
                _sensorReports,
                _turnoutReports,
                _powerReports,
                _reportedTrackPowerOn,
                _lastRxTick < 0 ? -1 : Math.Max(0, now - _lastRxTick),
                _lastPowerTick < 0 ? -1 : Math.Max(0, now - _lastPowerTick),
                TrackCurrentMa: null,
                TrackVoltageV: null,
                TemperatureC: null);
        }
    }
}
