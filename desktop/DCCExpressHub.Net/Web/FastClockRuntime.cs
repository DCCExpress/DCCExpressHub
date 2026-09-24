namespace DCCExpressHub.Net.Web;

public sealed record FastClockSnapshot(
    long TimeMs,
    bool Running,
    double Speed,
    long ServerNowMs);

public sealed class FastClockRuntime
{
    private const double DayMs = 24d * 60d * 60d * 1000d;

    private readonly object _gate = new();

    private double _timeMs = CurrentSystemDayTimeMs();
    private double _speed = 1d;
    private bool _running = true;
    private long _lastRealTimestampMs = Environment.TickCount64;

    public FastClockSnapshot GetSnapshot()
    {
        lock (_gate)
        {
            SyncFromRealTime();
            return CreateSnapshot();
        }
    }

    public FastClockSnapshot Run()
    {
        lock (_gate)
        {
            SyncFromRealTime();
            _running = true;
            _lastRealTimestampMs = Environment.TickCount64;
            return CreateSnapshot();
        }
    }

    public FastClockSnapshot Pause()
    {
        lock (_gate)
        {
            SyncFromRealTime();
            _running = false;
            _lastRealTimestampMs = Environment.TickCount64;
            return CreateSnapshot();
        }
    }

    public FastClockSnapshot Reset()
    {
        lock (_gate)
        {
            _timeMs = CurrentSystemDayTimeMs();
            _running = true;
            _lastRealTimestampMs = Environment.TickCount64;
            return CreateSnapshot();
        }
    }

    public FastClockSnapshot SetSpeed(double speed)
    {
        lock (_gate)
        {
            SyncFromRealTime();

            _speed =
                double.IsFinite(speed)
                    ? Math.Max(1d, speed)
                    : 1d;

            _lastRealTimestampMs = Environment.TickCount64;
            return CreateSnapshot();
        }
    }

    private void SyncFromRealTime()
    {
        var now = Environment.TickCount64;

        if (_running)
        {
            var elapsedRealMs =
                Math.Max(
                    0L,
                    now - _lastRealTimestampMs);

            _timeMs =
                NormalizeDayTime(
                    _timeMs +
                    elapsedRealMs * _speed);
        }

        _lastRealTimestampMs = now;
    }

    private FastClockSnapshot CreateSnapshot()
    {
        return new FastClockSnapshot(
            (long)Math.Floor(NormalizeDayTime(_timeMs)),
            _running,
            _speed,
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    private static double CurrentSystemDayTimeMs()
    {
        return DateTimeOffset.Now.TimeOfDay.TotalMilliseconds;
    }

    private static double NormalizeDayTime(double value)
    {
        var normalized = value % DayMs;

        return normalized < 0d
            ? normalized + DayMs
            : normalized;
    }
}
