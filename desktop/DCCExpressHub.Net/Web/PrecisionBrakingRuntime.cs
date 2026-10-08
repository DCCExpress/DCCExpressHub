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
        MovementRouteRefModel RouteRef, int SpeedStep,
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
    readonly MovementPlanBuilder _planBuilder;
    readonly LayoutRuntime _layout;
    readonly ILogger<PrecisionBrakingRuntime> _log;
    CancellationTokenSource? _cts;
    bool _ownsGate;
    int? _referenceSensor;
    int? _returnSensor;
    TaskCompletionSource<bool>? _returnArrival;
    TrialRequest? _active;
    double _currentSpeedMmS;
    string _status = "idle";
    string? _error;
    double? _actual;
    List<PrecisionBrakingProfile.Trial> _trials = new();
    List<PrecisionBrakingProfile.SpeedPoint> _speedPoints = new();

    public PrecisionBrakingRuntime(ICommandCenter commandCenter,
        AutomationExclusiveGate exclusive, CalibrationRuntime speedCalibration,
        MovementRuntime movement, ScriptRuntime scripts, FlowRuntime flows,
        TimetableRuntime timetable, LocoStorageCoordinator storage,
        AppPaths paths, MovementPlanBuilder planBuilder,
        LayoutRuntime layout, ILogger<PrecisionBrakingRuntime> log)
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
        _planBuilder = planBuilder;
        _layout = layout;
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
                _active?.LocoAddress, _referenceSensor,
                _active?.RouteRef.Direction, _active?.SpeedStep,
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
            request.RouteRef is null ||
            request.RouteRef.FromBlockId is < 1 or > 65535 ||
            request.RouteRef.ToBlockId is < 1 or > 65535 ||
            request.RouteRef.FromBlockId == request.RouteRef.ToBlockId ||
            request.RouteRef.Direction is not ("forward" or "reverse") ||
            request.SpeedStep is < 1 or > 126 ||
            !double.IsFinite(request.TargetDistanceMm) ||
            request.TargetDistanceMm is < 10 or > 10000)
            return (false, "invalid_braking_trial");
        lock (_sync)
            if (_cts is not null) return (false, "braking_trial_already_running");
        if (!_commandCenter.Connected || _commandCenter.EmergencyPaused)
            return (false, "command_center_not_ready");
        if (!_exclusive.TryEnterCalibration())
            return (false, "calibration_active");
        var preparing = new CancellationTokenSource();
        var preparingToken = preparing.Token;
        lock (_sync)
        {
            _ownsGate = true;
            _cts = preparing;
            _active = request;
            _status = "preparing";
            _error = null;
            _referenceSensor = null;
        }
        var started = false;
        try
        {
            preparingToken.ThrowIfCancellationRequested();
            if (Busy()) return (false, "automation_active");
            if (!File.Exists(LocoFile)) return (false, "locomotive_data_missing");
            var root = JsonNode.Parse(await File.ReadAllTextAsync(LocoFile)) as JsonArray;
            var loco = root is null ? null : FindLoco(root, request.LocoId);
            if (loco is null || loco["address"]?.GetValue<int>() != request.LocoAddress)
                return (false, "locomotive_not_found");
            // Route is selected explicitly in Precision Braking. Only the
            // authoritative persisted route graph determines its physical path.
            // Speed Calibration's saved route is not used for route authority.
            var actualRoute = request.RouteRef;
            var plan = _planBuilder.Build(new MovementPageModel
            {
                Id = "precision-braking-route-validation",
                Name = "Precision Braking",
                RouteRef = actualRoute,
                ExpectedLocoAddress = request.LocoAddress
            });
            if (plan.Legs.Length == 0 || plan.Direction != actualRoute.Direction)
                return (false, "braking_route_invalid");
            // Validate the return route before departing, not after the trial.
            var returnRoute = Reverse(actualRoute);
            var returnPlan = _planBuilder.Build(new MovementPageModel
            {
                Id = "precision-braking-return-preflight",
                Name = "Precision Braking return",
                RouteRef = returnRoute,
                ExpectedLocoAddress = request.LocoAddress
            });
            if (returnPlan.Legs.Length == 0 ||
                returnPlan.Direction != returnRoute.Direction)
                return (false, "braking_return_route_invalid");
            // Fail closed when the route's actual starting block does not
            // contain the locomotive selected in the editor.
            var startBlock = _layout.BlocksForPersistence()
                .FirstOrDefault(block => block.Id == actualRoute.FromBlockId);
            if (startBlock is null ||
                startBlock.TargetOnly ||
                startBlock.LocoAddress != request.LocoAddress ||
                !string.Equals(startBlock.LocoId, request.LocoId,
                    StringComparison.Ordinal))
                return (false, "braking_start_block_locomotive_mismatch");

            // ARRIVED reference is derived from the selected route's target
            // block occupancy sensor, never supplied as a user-entered address.
            var targetBlock = _layout.BlocksForPersistence()
                .FirstOrDefault(block => block.Id == actualRoute.ToBlockId);
            if (targetBlock is null || targetBlock.SensorAddress == 0)
                return (false, "braking_target_block_sensor_missing");
            var referenceSensor = targetBlock.SensorAddress;

            var turnoutStates = new Dictionary<ushort, bool>();
            foreach (var turnout in plan.Legs.SelectMany(leg => leg.TurnoutStates))
            {
                if (turnoutStates.TryGetValue(turnout.Address, out var previous)
                    && previous != turnout.Closed)
                    return (false, "braking_route_turnout_conflict");
                turnoutStates[turnout.Address] = turnout.Closed;
            }
            // Place and verify switches BEFORE issuing any nonzero throttle.
            // A command acknowledgment alone does not prove mechanical position.
            foreach (var turnout in turnoutStates)
            {
                preparingToken.ThrowIfCancellationRequested();
                if (!_commandCenter.Connected)
                    return (false, "command_center_disconnected");
                if (!await _commandCenter.SetTurnoutAsync(turnout.Key, turnout.Value, preparingToken))
                    return (false, "braking_turnout_command_failed");
                await Task.Delay(250, preparingToken);
                if (!_layout.TryGetTurnoutClosed(turnout.Key, out var closed)
                    || closed != turnout.Value)
                    return (false, "braking_turnout_unverified");
            }
            if (Busy() || !_commandCenter.Connected || _commandCenter.EmergencyPaused)
                return (false, "braking_start_interlock_failed");
            if (!_layout.TryGetSensorState(referenceSensor,
                    out var sensorOn) || sensorOn)
                return (false, "reference_sensor_must_be_known_and_free");

            var rows = loco["calibration"]?["results"] as JsonArray;
            if (rows is null) return (false, "speed_calibration_required");
            var points = new List<PrecisionBrakingProfile.SpeedPoint>();
            var outboundDirection = loco["calibration"]?["routeRef"]?["direction"]?.GetValue<string>();
            if (outboundDirection is not ("forward" or "reverse"))
                return (false, "calibration_direction_missing");
            var measuredLeg = actualRoute.Direction == outboundDirection ? "outbound" : "return";
            foreach (var row in rows.OfType<JsonObject>())
            {
                var step = row["speedStep"]?.GetValue<int>() ?? 0;
                var mmS = row["millimetersPerSecond"]?.GetValue<double>() ?? 0;
                if (row["direction"]?.GetValue<string>() ==
                    measuredLeg)
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

            preparingToken.ThrowIfCancellationRequested();
            lock (_sync)
            {
                preparingToken.ThrowIfCancellationRequested();
                _referenceSensor = referenceSensor;
                _currentSpeedMmS = speed.Value;
                _trials = learned;
                _speedPoints = points;
                _actual = null;
                _error = null;
                _status = "armed";
            }

            // The operator must place the locomotive BEFORE the reference sensor.
            // Stop immediately if issuing the initial speed command fails.
            preparingToken.ThrowIfCancellationRequested();
            if (!await _commandCenter.SetLocoAsync(request.LocoAddress,
                    request.SpeedStep, actualRoute.Direction == "forward", preparingToken))
            {
                await StopAsync();
                return (false, "locomotive_command_failed");
            }
            started = true;
            var watchdogToken = preparingToken;
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(30), watchdogToken);
                    bool timedOut;
                    lock (_sync) timedOut = _status == "armed" && _active == request;
                    if (timedOut)
                    {
                        await StopAsync();
                        lock (_sync)
                        {
                            _status = "error";
                            _error = "reference_sensor_timeout";
                        }
                    }
                }
                catch (OperationCanceledException) { }
                catch (ObjectDisposedException) { }
            });
            return (true, "");
        }
        catch (OperationCanceledException)
        {
            return (false, "braking_trial_cancelled");
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
                    _referenceSensor = null;
                    if (_status == "preparing")
                        _status = "error";
                }
                ReleaseGate();
            }
        }
    }

    void OnSensor(int address, bool active)
    {
        if (!active) return;
        TaskCompletionSource<bool>? returnArrival = null;
        lock (_sync)
            if (_status == "returning" && _returnSensor == address)
                returnArrival = _returnArrival;
        if (returnArrival is not null)
        {
            returnArrival.TrySetResult(true);
            return;
        }
        TrialRequest? trial;
        CancellationToken token;
        lock (_sync)
        {
            if (_status != "armed" || _referenceSensor != address || _cts is null)
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
            var seconds = 2 * trial.TargetDistanceMm / initial;
            var estimated = PrecisionBrakingProfile.EstimatedStopDistance(
                PrecisionBrakingProfile.Learn(_trials),
                trial.RouteRef.Direction, initial);
            if (estimated is > 0)
                seconds *= Math.Clamp(trial.TargetDistanceMm / estimated.Value,
                    0.6, 1.3);
            seconds = Math.Clamp(seconds, 0.35, 8.0);
            var segments = Math.Clamp(trial.SpeedStep, 1, 25);
            var previousStep = trial.SpeedStep;
            for (var i = 1; i <= segments; i++)
            {
                token.ThrowIfCancellationRequested();
                var remaining = 1 - (double)i / segments;
                var requestedMmS = initial * remaining;
                var targetStep = 0;
                if (i < segments)
                {
                    for (var candidate = 1; candidate <= previousStep; candidate++)
                    {
                        var calibratedMmS = PrecisionBrakingProfile.SpeedAtStep(
                            _speedPoints, candidate);
                        if (calibratedMmS.HasValue &&
                            calibratedMmS.Value <= requestedMmS)
                            targetStep = candidate;
                    }
                }
                previousStep = targetStep;
                if (!await _commandCenter.SetLocoAsync(trial.LocoAddress,
                        targetStep, trial.RouteRef.Direction == "forward", token))
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
                trial.RouteRef.Direction, speed, trial.TargetDistanceMm,
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
                data["routeRef"] = JsonSerializer.SerializeToNode(
                    trial.RouteRef, new JsonSerializerOptions(JsonSerializerDefaults.Web));
                data["updatedAt"] = DateTimeOffset.UtcNow.ToString("O");
                if (loco["precisionBraking"] is null)
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
                _status = "return_preparing";
            }
            // Save/OK is the operator's permission to restore the test position.
            // The gate stays held until the return has stopped.
            _ = Task.Run(() => ReturnToStartAsync(trial));
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

    async Task ReturnToStartAsync(TrialRequest trial)
    {
        try
        {
            CancellationToken token;
            lock (_sync)
                token = _cts?.Token ?? throw new OperationCanceledException();
            token.ThrowIfCancellationRequested();

            // Return must use exactly the route selected for this trial.
            var forwardRoute = trial.RouteRef;
            var reverseRoute = Reverse(forwardRoute);
            var origin = _layout.BlocksForPersistence()
                .FirstOrDefault(block => block.Id == forwardRoute.FromBlockId);
            if (origin is null || origin.SensorAddress == 0 ||
                !_layout.TryGetSensorState(origin.SensorAddress, out var occupied) ||
                occupied)
                throw new InvalidOperationException("braking_return_start_sensor_not_free");

            var plan = _planBuilder.Build(new MovementPageModel
            {
                Id = "precision-braking-return-validation",
                Name = "Precision Braking return",
                RouteRef = reverseRoute,
                ExpectedLocoAddress = trial.LocoAddress
            });
            if (plan.Legs.Length == 0 ||
                plan.Direction != reverseRoute.Direction)
                throw new InvalidOperationException("braking_return_route_invalid");

            var turnouts = new Dictionary<ushort, bool>();
            foreach (var turnout in plan.Legs.SelectMany(leg => leg.TurnoutStates))
            {
                if (turnouts.TryGetValue(turnout.Address, out var old) &&
                    old != turnout.Closed)
                    throw new InvalidOperationException("braking_return_turnout_conflict");
                turnouts[turnout.Address] = turnout.Closed;
            }
            foreach (var turnout in turnouts)
            {
                token.ThrowIfCancellationRequested();
                if (!await _commandCenter.SetTurnoutAsync(
                    turnout.Key, turnout.Value, token))
                    throw new InvalidOperationException("braking_return_turnout_command_failed");
                await Task.Delay(250, token);
                if (!_layout.TryGetTurnoutClosed(turnout.Key, out var closed) ||
                    closed != turnout.Value)
                    throw new InvalidOperationException("braking_return_turnout_unverified");
            }
            if (!_commandCenter.Connected || _commandCenter.EmergencyPaused)
                throw new InvalidOperationException("braking_return_command_center_not_ready");

            var arrival = new TaskCompletionSource<bool>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            lock (_sync)
            {
                token.ThrowIfCancellationRequested();
                _returnSensor = origin.SensorAddress;
                _returnArrival = arrival;
                _status = "returning";
            }

            // Return is positioning only, at a conservative speed.
            var speed = Math.Clamp(trial.SpeedStep / 2, 1, 15);
            if (!await _commandCenter.SetLocoAsync(
                trial.LocoAddress, speed, trial.RouteRef.Direction != "forward", token))
                throw new InvalidOperationException("braking_return_command_failed");

            // Returning must stop even if the sensor is never reported.
            await arrival.Task.WaitAsync(TimeSpan.FromSeconds(30), token);
            if (!await _commandCenter.SetLocoAsync(
                trial.LocoAddress, 0, trial.RouteRef.Direction != "forward"))
                throw new InvalidOperationException("braking_return_stop_failed");

            lock (_sync)
            {
                _status = "completed";
                _error = null;
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _log.LogError(ex, "Precision Braking return failed");
            lock (_sync)
            {
                _status = "error";
                _error = ex is TimeoutException
                    ? "braking_return_sensor_timeout" : ex.Message;
            }
            try { await _commandCenter.EmergencyStopAsync(); }
            catch (Exception stopEx)
            {
                _log.LogError(stopEx, "Precision Braking return E-STOP failed");
            }
        }
        finally
        {
            lock (_sync)
            {
                _returnArrival = null;
                _returnSensor = null;
            }
            ReleaseGate();
        }
    }

    static MovementRouteRefModel Reverse(MovementRouteRefModel route) => new()
    {
        FromBlockId = route.ToBlockId,
        ToBlockId = route.FromBlockId,
        Direction = route.Direction == "forward" ? "reverse" : "forward",
        ViaBlockIds = (route.ViaBlockIds ?? []).Reverse().ToArray()
    };

    async Task StopPowerOnlyAsync(TrialRequest trial)
    {
        try { await _commandCenter.SetLocoAsync(trial.LocoAddress, 0,
            trial.RouteRef.Direction == "forward"); }
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
        bool startStillPreparing;
        lock (_sync)
        {
            trial = _active;
            startStillPreparing = _status == "preparing";
            _cts?.Cancel();
            if (_status is "preparing" or "armed" or "braking" or "saving" or "return_preparing" or "returning")
                _status = "stopped";
        }
        if (trial is not null)
        {
            var reverse = false;
            lock (_sync) reverse = _returnSensor.HasValue;
            if (reverse)
                await _commandCenter.SetLocoAsync(trial.LocoAddress, 0,
                    trial.RouteRef.Direction != "forward");
            else
                await StopPowerOnlyAsync(trial);
        }
        // The starting task owns final cleanup while it is still preparing;
        // releasing its gate here would let a second Start overlap it.
        if (!startStillPreparing)
            ReleaseGate();
    }

    public async Task EmergencyStopAsync()
    {
        await _commandCenter.EmergencyStopAsync();
        await StopAsync();
    }
}
