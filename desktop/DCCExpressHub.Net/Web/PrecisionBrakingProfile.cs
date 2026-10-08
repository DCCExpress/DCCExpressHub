namespace DCCExpressHub.Net.Web;

/// <summary>
/// Pure, locomotive-specific brake learning mathematics. This class never issues
/// a locomotive command and does not modify Movement, Dispatcher or SwitchMan.
/// A trial is accepted only after a human has measured its actual stop offset.
/// </summary>
public static class PrecisionBrakingProfile
{
    public sealed record SpeedPoint(int DccStep, double MillimetersPerSecond);

    public sealed record Trial(
        int DccStep,
        string Direction,
        double ApproachMillimetersPerSecond,
        double TargetDistanceMm,
        double ActualDistanceMm,
        DateTimeOffset MeasuredAt,
        double? CommandedRampSeconds = null);

    public sealed record LearnedPoint(
        int DccStep,
        string Direction,
        double MillimetersPerSecond,
        double EstimatedStoppingDistanceMm,
        int Samples);

    // Every experiment must record the speed-hold time that caused its stop.
    // Legacy measurements without this field cannot be used for control.
    public static double NextRampSeconds(IEnumerable<Trial> trials,
        int dccStep, string direction, double speedMmS, double targetMm)
    {
        const double maxRamp = 5.0;
        if (speedMmS <= 0 || !double.IsFinite(speedMmS))
            return 0;
        var samples = trials.Where(t => t.DccStep == dccStep &&
            t.Direction == direction && t.CommandedRampSeconds.HasValue &&
            ValidTrial(t)).OrderBy(t => t.MeasuredAt).ToArray();
        if (samples.Length == 0) return 0; // Measure actual zero-command stop first.

        var last = samples[^1];
        var lastTime = last.CommandedRampSeconds!.Value;
        var errorMm = targetMm - last.ActualDistanceMm;
        if (Math.Abs(errorMm) <= 5) return lastTime;
        // Adjust the physically observed delay, not a predicted braking distance.
        // Limit each increase to avoid large untested overshoots.
        var delta = 0.65 * errorMm / speedMmS;
        delta = Math.Clamp(delta, -1.25, 0.75);
        return Math.Clamp(lastTime + delta, 0, maxRamp);
    }

    public static bool ValidSpeedPoint(SpeedPoint point) =>
        point.DccStep is >= 1 and <= 126 &&
        double.IsFinite(point.MillimetersPerSecond) &&
        point.MillimetersPerSecond > 0;

    public static double? SpeedAtStep(
        IEnumerable<SpeedPoint> speedCalibration,
        int dccStep)
    {
        if (dccStep is < 1 or > 126)
            return null;

        var points = speedCalibration
            .Where(ValidSpeedPoint)
            .GroupBy(point => point.DccStep)
            .Select(group => new SpeedPoint(
                group.Key,
                group.Average(point => point.MillimetersPerSecond)))
            .OrderBy(point => point.DccStep)
            .ToArray();

        if (points.Length == 0)
            return null;

        if (dccStep <= points[0].DccStep)
            return points[0].MillimetersPerSecond;

        if (dccStep >= points[^1].DccStep)
            return points[^1].MillimetersPerSecond;

        for (var i = 1; i < points.Length; i++)
        {
            if (dccStep > points[i].DccStep)
                continue;

            var before = points[i - 1];
            var after = points[i];
            var fraction = (double)(dccStep - before.DccStep) /
                           (after.DccStep - before.DccStep);
            return before.MillimetersPerSecond +
                   fraction * (after.MillimetersPerSecond -
                               before.MillimetersPerSecond);
        }

        return null;
    }

    public static bool ValidTrial(Trial trial) =>
        trial.DccStep is >= 1 and <= 126 &&
        trial.Direction is "forward" or "reverse" &&
        double.IsFinite(trial.ApproachMillimetersPerSecond) &&
        trial.ApproachMillimetersPerSecond > 0 &&
        double.IsFinite(trial.TargetDistanceMm) &&
        trial.TargetDistanceMm > 0 &&
        double.IsFinite(trial.ActualDistanceMm) &&
        trial.ActualDistanceMm >= 0;

    /// <summary>
    /// Learns stopping distance with conservative asymmetric adaptation:
    /// overshoots raise the estimate immediately, while shorter stops reduce
    /// it gradually. Separate points are retained for each direction.
    /// </summary>
    public static IReadOnlyList<LearnedPoint> Learn(
        IEnumerable<Trial> trials)
    {
        var learned = new Dictionary<(int Step, string Direction), LearnedPoint>();
        foreach (var trial in trials.Where(ValidTrial).OrderBy(t => t.MeasuredAt))
        {
            var key = (trial.DccStep, trial.Direction);
            if (!learned.TryGetValue(key, out var previous))
            {
                learned[key] = new LearnedPoint(
                    trial.DccStep,
                    trial.Direction,
                    trial.ApproachMillimetersPerSecond,
                    trial.ActualDistanceMm,
                    1);
                continue;
            }

            var alpha = trial.ActualDistanceMm >
                        previous.EstimatedStoppingDistanceMm
                ? 0.65 : 0.20;

            learned[key] = previous with
            {
                MillimetersPerSecond =
                    previous.MillimetersPerSecond * (1 - alpha) +
                    trial.ApproachMillimetersPerSecond * alpha,
                EstimatedStoppingDistanceMm =
                    previous.EstimatedStoppingDistanceMm * (1 - alpha) +
                    trial.ActualDistanceMm * alpha,
                Samples = previous.Samples + 1
            };
        }

        return learned.Values
            .OrderBy(point => point.Direction, StringComparer.Ordinal)
            .ThenBy(point => point.MillimetersPerSecond)
            .ToArray();
    }

    /// <summary>
    /// Estimates the distance needed to stop from the measured physical speed.
    /// Does not extrapolate to unmeasured higher speeds (fail closed).
    /// </summary>
    public static double? EstimatedStopDistance(
        IEnumerable<LearnedPoint> learned,
        string direction,
        double speedMmPerSecond)
    {
        if (direction is not ("forward" or "reverse") ||
            !double.IsFinite(speedMmPerSecond) ||
            speedMmPerSecond <= 0)
            return null;

        var points = learned
            .Where(p => p.Direction == direction &&
                        double.IsFinite(p.MillimetersPerSecond) &&
                        p.MillimetersPerSecond > 0 &&
                        double.IsFinite(p.EstimatedStoppingDistanceMm) &&
                        p.EstimatedStoppingDistanceMm >= 0 &&
                        p.Samples > 0)
            .OrderBy(p => p.MillimetersPerSecond)
            .ToArray();

        if (points.Length == 0 ||
            speedMmPerSecond > points[^1].MillimetersPerSecond)
            return null;

        if (speedMmPerSecond <= points[0].MillimetersPerSecond)
            return points[0].EstimatedStoppingDistanceMm;

        for (var i = 1; i < points.Length; i++)
        {
            if (speedMmPerSecond > points[i].MillimetersPerSecond)
                continue;
            var low = points[i - 1];
            var high = points[i];
            var span = high.MillimetersPerSecond - low.MillimetersPerSecond;
            if (span <= 0)
                return Math.Max(low.EstimatedStoppingDistanceMm,
                                high.EstimatedStoppingDistanceMm);

            var fraction =
                (speedMmPerSecond - low.MillimetersPerSecond) / span;
            return Math.Max(0,
                low.EstimatedStoppingDistanceMm +
                fraction * (high.EstimatedStoppingDistanceMm -
                            low.EstimatedStoppingDistanceMm));
        }

        return null;
    }

    /// <summary>
    /// Positive value means the model predicts stopping beyond the target.
    /// Caller must not infer route authority or clearance from this result.
    /// </summary>
    public static double? PredictedStopErrorMm(
        IEnumerable<LearnedPoint> learned,
        string direction,
        double speedMmPerSecond,
        double targetDistanceMm)
    {
        if (!double.IsFinite(targetDistanceMm) || targetDistanceMm <= 0)
            return null;
        var predicted = EstimatedStopDistance(
            learned, direction, speedMmPerSecond);
        return predicted.HasValue
            ? predicted.Value - targetDistanceMm
            : null;
    }
}
