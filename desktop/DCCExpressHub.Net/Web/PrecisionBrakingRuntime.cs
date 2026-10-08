using System.Text.Json;
using System.Text.Json.Nodes;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

/// <summary>
/// Operator-supervised braking trials on a physically isolated test track.
/// Never claims Movement/Dispatcher/SwitchMan route authority.
/// </summary>
public sealed class PrecisionBrakingRuntime
{
    public sealed record TrialRequest(string LocoId, int LocoAddress,
        int SensorAddress, int SpeedStep, string Direction,
        double TargetDistanceMm, bool IsolatedTestTrackConfirmed);
    public sealed record TrialMeasurement(double ActualDistanceMm);
    public sealed record TrialState(string Status, string? Error,
        string? LocoId, int? LocoAddress, int? SensorAddress,
        string? Direction, int? SpeedStep, double? SpeedMmPerSecond,
        double? TargetDistanceMm, double? ActualDistanceMm,
        IReadOnlyList<PrecisionBrakingProfile.LearnedPoint> Profile);
    readonly object _sync = new();
    readonly ICommandCenter _commandCenter;
    readonly AutomationExclusiveGate _exclusive;
    readonly CalibrationRuntime _speedCalibration;
    readonly MovementRuntime _movement;
    readonly ScriptRuntime _scripts;
    readonly FlowRuntime _flows;
    readonly TimetableRuntime _timetable;
    readonly LocoStorageCoordinator _storage;
    readonly AppPaths _paths;
    readonly ILogger<PrecisionBrakingRuntime> _log;
    CancellationTokenSource? _cts;
    bool _ownsGate;
    TrialRequest? _active;
    double _currentSpeedMmS;
    string _status = "idle";
    string? _error;
    double? _actual;
    List<PrecisionBrakingProfile.Trial> _trials = new();

    public PrecisionBrakingRuntime(ICommandCenter commandCenter,
        AutomationExclusiveGate exclusive, CalibrationRuntime speedCalibration,
        MovementRuntime movement, ScriptRuntime scripts, FlowRuntime flows,
        TimetableRuntime timetable, LocoStorageCoordinator storage,
        AppPaths paths, ILogger<PrecisionBrakingRuntime> log)
    {
        _commandCenter = commandCenter;
        _exclusive = exclusive;
        _speedCalibration = speedCalibration;
        _movement = movement;
        _scripts = scripts;
        _flows = flows;
        _timetable = timetable;
        _storage = storage;
        _paths = paths;
        _log = log;
        _commandCenter.SensorFeedbackChanged += OnSensor;
        _commandCenter.ConnectionChanged += connected =>
        {
            if (!connected) _ = StopAsync();
        };
    }

    public TrialState Snapshot()
    {
        lock (_sync)
            return new TrialState(_status, _error, _active?.LocoId,
                _active?.LocoAddress, _active?.SensorAddress,
                _active?.Direction, _active?.SpeedStep,
                _active is null ? null : _currentSpeedMmS,
                _active?.TargetDistanceMm, _actual,
                PrecisionBrakingProfile.Learn(_trials));
    }

    bool Busy() =>
        _speedCalibration.Snapshot().Status == "running" ||
        _movement.Snapshot().Any(x => x.Status is "running" or "paused" or "stopping") ||
        _scripts.Snapshot().Any(x => x.Status is "running" or "paused") ||
        _flows.Snapshot().Pages.Any(x => x.ActiveExecutions > 0) ||
        _timetable.Snapshot().Running ||
        _timetable.Snapshot().ActiveRuns.Length > 0;

    string LocoFile => Path.Combine(_paths.ContentRootPath, "data", "config", "locos.json");

    static JsonObject? FindLoco(JsonArray root, string id) =>
        root.OfType<JsonObject>().FirstOrDefault(
            loco => string.Equals(loco["id"]?.GetValue<string>(), id, StringComparison.Ordinal));

    public async Task<(bool Ok, string Error)> StartAsync(TrialRequest request)
    {
        if (!request.IsolatedTestTrackConfirmed)
            return (false, "isolated_test_track_confirmation_required");
        if (string.IsNullOrWhiteSpace(request.LocoId) ||
            request.LocoAddress is < 1 or > 9999 ||
            request.SensorAddress is < 1 or > 65535 ||
            request.SpeedStep is < 1 or > 126 ||
            request.Direction is not ("forward" or "reverse") ||
            !double.IsFinite(request.TargetDistanceMm) ||
            request.TargetDistanceMm is < 10 or > 10000)
            return (false, "invalid_braking_trial");
        lock (_sync)
            if (_cts is not null) return (false, "braking_trial_already_running");
        if (!_commandCenter.Connected || _commandCenter.EmergencyPaused)
            return (false, "command_center_not_ready");
        if (!_exclusive.TryEnterCalibration())
            return (false, "calibration_active");
        lock (_sync) _ownsGate = true;
        var started = false;
        try
        {
            if (Busy()) return (false, "automation_active");
            if (!File.Exists(LocoFile)) return (false, "locomotive_data_missing");
            var root = JsonNode.Parse(await File.ReadAllTextAsync(LocoFile)) as JsonArray;
            var loco = root is null ? null : FindLoco(root, request.LocoId);
            if (loco is null || loco["address"]?.GetValue<int>() != request.LocoAddress)
                return (false, "locomotive_not_found");
            var rows = loco["calibration"]?["results"] as JsonArray;
            if (rows is null) return (false, "speed_calibration_required");
            var points = new List<PrecisionBrakingProfile.SpeedPoint>();
            foreach (var row in rows.OfType<JsonObject>())
            {
                var step = row["speedStep"]?.GetValue<int>() ?? 0;
                var mmS = row["millimetersPerSecond"]?.GetValue<double>() ?? 0;
                if (row["direction"]?.GetValue<string>() ==
                    (request.Direction == "forward" ? "outbound" : "return"))
                    points.Add(new(step, mmS));
            }
            var speed = PrecisionBrakingProfile.SpeedAtStep(points, request.SpeedStep);
            if (!speed.HasValue || speed.Value <= 0)
                return (false, "matching_speed_calibration_required");

            var learned = new List<PrecisionBrakingProfile.Trial>();
            if (loco["precisionBraking"]?["trials"] is JsonArray saved)
                foreach (var node in saved.OfType<JsonObject>())
                    try
                    {
                        var trial = node.Deserialize<PrecisionBrakingProfile.Trial>(
                            new JsonSerializerOptions(JsonSerializerDefaults.Web));
                        if (trial is not null && PrecisionBrakingProfile.ValidTrial(trial))
                            learned.Add(trial);
                    }
                    catch (JsonException) { }

            lock (_sync)
            {
                if (_cts is not null) return (false, "braking_trial_already_running");
                _active = request;
                _currentSpeedMmS = speed.Value;
                _trials = learned;
                _actual = null;
                _error = null;
                _status = "armed";
                _cts = new CancellationTokenSource();
            }

            // The operator must place the locomotive BEFORE the reference sensor.
            // Stop immediately if issuing the initial speed command fails.
            if (!await _commandCenter.SetLocoAsync(request.LocoAddress,
                    request.SpeedStep, request.Direction == "forward"))
            {
                await StopAsync();
                return (false, "locomotive_command_failed");
            }
            started = true;
            return (true, "");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Precision braking trial could not start");
            await StopAsync();
            return (false, "braking_trial_start_failed");
        }
        finally
        {
            if (!started)
            {
                lock (_sync)
                {
                    _cts?.Cancel();
                    _cts?.Dispose();
                    _cts = null;
                    _active = null;
                }
                ReleaseGate();
            }
        }
    }

    void OnSensor(int address, bool active)
    {
        if (!active) return;
        TrialRequest? trial;
        CancellationToken token;
        lock (_sync)
        {
            if (_status != "armed" || _active?.SensorAddress != address || _cts is null)
                return;
            _status = "braking";
            trial = _active;
            token = _cts.Token;
        }
        _ = Task.Run(() => BrakeAsync(trial!, token));
    }

    async Task BrakeAsync(TrialRequest trial, CancellationToken token)
    {
        try
        {
            // v² = 2as; compute the target deceleration from measured mm/s.
            // A stepwise throttle ramp is bounded by time and commanded to zero.
            var initial = _currentSpeedMmS;
            var seconds = Math.Clamp(2 * trial.TargetDistanceMm / initial, 0.35, 8.0);
            var segments = Math.Clamp(trial.SpeedStep, 1, 25);
            for (var i = 1; i <= segments; i++)
            {
                token.ThrowIfCancellationRequested();
                var remaining = 1 - (double)i / segments;
                var targetStep = Math.Clamp(
                    (int)Math.Floor(trial.SpeedStep * remaining),
                    0, trial.SpeedStep);
                if (!await _commandCenter.SetLocoAsync(trial.LocoAddress,
                        targetStep, trial.Direction == "forward", token))
                    throw new InvalidOperationException("braking_command_failed");
                if (i < segments)
                    await Task.Delay(TimeSpan.FromSeconds(seconds / segments), token);
            }
            lock (_sync)
                if (_status == "braking") _status = "measure";
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _log.LogError(ex, "Braking ramp failed");
            lock (_sync)
            {
                _error = ex.Message;
                _status = "error";
            }
            await _commandCenter.EmergencyStopAsync();
        }
    }

    public async Task<(bool Ok, string Error)> RecordAsync(TrialMeasurement measurement)
    {
        if (!double.IsFinite(measurement.ActualDistanceMm) ||
            measurement.ActualDistanceMm is < 0 or > 20000)
            return (false, "invalid_measured_distance");
        TrialRequest trial;
        double speed;
        lock (_sync)
        {
            if (_status != "measure" || _active is null)
                return (false, "braking_trial_not_ready_for_measurement");
            trial = _active;
            speed = _currentSpeedMmS;
            _status = "saving";
        }
        try
        {
            var row = new PrecisionBrakingProfile.Trial(trial.SpeedStep,
                trial.Direction, speed, trial.TargetDistanceMm,
                measurement.ActualDistanceMm, DateTimeOffset.UtcNow);
            await _storage.ExecuteAsync(async () =>
            {
                var root = JsonNode.Parse(await File.ReadAllTextAsync(LocoFile)) as JsonArray
                    ?? throw new InvalidOperationException("invalid_locomotive_data");
                var loco = FindLoco(root, trial.LocoId)
                    ?? throw new InvalidOperationException("locomotive_not_found");
                var data = loco["precisionBraking"] as JsonObject ?? new JsonObject();
                var trials = data["trials"] as JsonArray;
                if (trials is null)
                {
                    trials = new JsonArray();
                    data["trials"] = trials;
                }
                trials.Add(JsonSerializer.SerializeToNode(row,
                    new JsonSerializerOptions(JsonSerializerDefaults.Web)));
                data["updatedAt"] = DateTimeOffset.UtcNow.ToString("O");
                loco["precisionBraking"] = data;
                var temp = LocoFile + ".precisionbraking.tmp";
                await File.WriteAllTextAsync(temp, root.ToJsonString());
                File.Move(temp, LocoFile, true);
                return true;
            });
            lock (_sync)
            {
                _trials.Add(row);
                _actual = measurement.ActualDistanceMm;
                _status = "completed";
            }
            await StopPowerOnlyAsync(trial);
            ReleaseGate();
            return (true, "");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed saving braking measurement");
            lock (_sync)
            {
                _error = "braking_measurement_save_failed";
                _status = "error";
            }
            return (false, "braking_measurement_save_failed");
        }
    }

    async Task StopPowerOnlyAsync(TrialRequest trial)
    {
        try { await _commandCenter.SetLocoAsync(trial.LocoAddress, 0,
            trial.Direction == "forward"); }
        catch (Exception ex) { _log.LogWarning(ex, "Stop command failed"); }
    }

    void ReleaseGate()
    {
        bool release;
        lock (_sync)
        {
            _cts?.Cancel();
            _cts?.Dispose();
            _cts = null;
            release = _ownsGate;
            _ownsGate = false;
        }
        if (release) _exclusive.ExitCalibration();
    }

    public async Task StopAsync()
    {
        TrialRequest? trial;
        lock (_sync)
        {
            trial = _active;
            _cts?.Cancel();
            if (_status is "armed" or "braking" or "saving")
                _status = "stopped";
        }
        if (trial is not null) await StopPowerOnlyAsync(trial);
        ReleaseGate();
    }

    public async Task EmergencyStopAsync()
    {
        await _commandCenter.EmergencyStopAsync();
        await StopAsync();
    }
}
