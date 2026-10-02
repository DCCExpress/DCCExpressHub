namespace DCCExpressHub.Net.Web;

public sealed class AutomationExclusiveGate
{
    readonly object _gate = new();
    bool _calibrationActive;

    public bool CalibrationActive
    {
        get
        {
            lock (_gate)
                return _calibrationActive;
        }
    }

    public bool TryEnterCalibration()
    {
        lock (_gate)
        {
            if (_calibrationActive)
                return false;

            _calibrationActive = true;
            return true;
        }
    }

    public void ExitCalibration()
    {
        lock (_gate)
            _calibrationActive = false;
    }
}
