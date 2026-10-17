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
        double TargetDistanceMm, bool IsolatedTestTrackConfirmed, int ReturnSpeedStep = 20,
        double? TargetFrontClearanceMm = null, double SensorDistanceMm = 0);
    public sealed record TrialMeasurement(double ActualDistanceMm,
        double? FrontClearanceMm = null, double? RearClearanceMm = null,
        bool Approve = false, double? FrontFromSensorMm = null,
        double? RearFromSensorMm = null);
    public sealed record TrialState(string Status, string? Error,
        string? LocoId, int? LocoAddress, int? SensorAddress,
        string? Direction, int? SpeedStep, double? SpeedMmPerSecond,
        double? TargetDistanceMm, double? ActualDistanceMm,
        IReadOnlyList<PrecisionBrakingProfile.LearnedPoint> Profile,
        double CommandedRampSeconds);
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
    double? _targetBlockLengthMm;
    double? _trainLengthMm;
    readonly ILogger<PrecisionBrakingRuntime> _log;
    CancellationTokenSource? _cts;
    bool _ownsGate;
    int? _referenceSensor;
    int? _returnSensor;
    TaskCompletionSource<bool>? _returnArrival;
    bool _returnTrial;
    TrialRequest? _active;
    double _currentSpeedMmS;
    string _status = "idle";
    string? _error;
    double? _actual;
    double _commandedRampSeconds;
    int? _startSensor;
    long? _startOffTicks;
    double _sensorDistanceMm;
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
                PrecisionBrakingProfile.Learn(_trials), _commandedRampSeconds);
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

    public async Task<(bool Ok, string Error)> ResetProfileAsync(string locoId)
    {
        if (string.IsNullOrWhiteSpace(locoId))
            return (false, "invalid_locomotive_id");
        // Never erase a live trial, its return run, or an in-flight save.
        lock (_sync)
            if (_cts is not null || _status is "preparing" or "armed"
                or "braking" or "measure" or "saving" or "return_preparing"
                or "returning")
                return (false, "braking_trial_active");

        try
        {
            return await _storage.ExecuteAsync(async () =>
            {
                if (!File.Exists(LocoFile))
                    return (false, "locomotive_data_missing");
                var root = JsonNode.Parse(await File.ReadAllTextAsync(LocoFile)) as JsonArray;
                var loco = root is null ? null : FindLoco(root, locoId);
                if (loco is null)
                    return (false, "locomotive_not_found");

                // Preserve the selected route and all other locomotive data.
                var data = loco["precisionBraking"] as JsonObject;
                if (data is not null)
                {
                    data["trials"] = new JsonArray();
                    data["updatedAt"] = DateTimeOffset.UtcNow.ToString("O");
                    var temp = LocoFile + ".precisionbraking-reset.tmp";
                    await File.WriteAllTextAsync(temp, root!.ToJsonString());
                    File.Move(temp, LocoFile, true);
                }
                lock (_sync)
                {
                    // Do not let an old locomotive's profile bleed into the next one.
                    _trials.Clear();
                    _actual = null;
                    if (_active?.LocoId == locoId) _active = null;
                    _error = null;
                    _status = "idle";
                }
                return (true, "");
            });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed resetting braking profile for {LocoId}", locoId);
            return (false, "braking_profile_reset_failed");
        }
    }

    // Physical length belongs to the selected destination block in layout.json.
    // Never use screen pixel dimensions as a substitute for millimetres.
    double? ReadBlockLengthMm(int blockId)
    {
        var path = Path.Combine(_paths.ConfigRootPath, "layout.json");
        if (!File.Exists(path)) return null;
        var root = JsonNode.Parse(File.ReadAllText(path));
        if (root?["layers"] is not JsonArray layers) return null;
        foreach (var layer in layers.OfType<JsonObject>())
            if (layer["elements"] is JsonArray elements)
                foreach (var element in elements.OfType<JsonObject>())
                {
                    if (element["type"]?.ToString() != "trackblock" ||
                        !int.TryParse(element["id"]?.ToString(), out var id) || id != blockId)
                        continue;
                    return double.TryParse(element["length"]?.ToString(),
                        System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture, out var length) &&
                        double.IsFinite(length) && length > 0 ? length : null;
                }
        return null;
    }

    // Route plans carry logical Closed/Open; command stations expect the
    // physical output value configured on the layout accessory. Match Dispatcher.
    async Task<bool> CommandRouteTurnoutAsync(
        ushort address, bool closed, CancellationToken token)
    {
        var turnout = _layout.FindAccessory(RuntimeAccessoryKind.Turnout, address);
        if (turnout is null) return false;
        var physicalValue = closed ? turnout.ClosedValue : !turnout.ClosedValue;
        if (turnout.TurnoutExtended)
        {
            var aspect = closed ? turnout.TurnoutClosedAspect : turnout.TurnoutOpenedAspect;
            var ok = await _commandCenter.SetSignalAspectAsync(address, aspect, token);
            if (ok) _layout.SetSignal(address, aspect);
            return ok;
        }
        if (turnout.TurnoutVPin)
        {
            var ok = await _commandCenter.SetVPinAsync(address, physicalValue, token);
            if (ok) _layout.SetVPin(address, physicalValue);
            return ok;
        }
        var success = await _commandCenter.SetTurnoutAsync(address, physicalValue, token);
        if (success) _layout.SetTurnout(address, physicalValue);
        return success;
    }

    // Feedback can arrive asynchronously after the command acknowledgement.
    // Never mistake the first 250 ms without feedback for a verified mismatch.
    async Task<(bool Verified, string Reason)> WaitForTurnoutAsync(
        ushort address, bool expectedClosed, CancellationToken token)
    {
        var deadline = DateTime.UtcNow.AddSeconds(3);
        bool hadFeedback = false;
        bool lastClosed = false;
        while (DateTime.UtcNow < deadline)
        {
            token.ThrowIfCancellationRequested();
            if (!_commandCenter.Connected)
                return (false, $"braking_turnout_{address}_disconnected");
            if (_layout.TryGetTurnoutClosed(address, out var closed))
            {
                hadFeedback = true;
                lastClosed = closed;
                if (closed == expectedClosed) return (true, "");
            }
            await Task.Delay(100, token);
        }
        _log.LogWarning(
            "Precision Braking turnout #{Address}: expected closed={Expected}, feedbackKnown={Known}, lastClosed={Actual}",
            address, expectedClosed, hadFeedback, lastClosed);
        return (false, hadFeedback
            ? $"braking_turnout_{address}_position_mismatch_expected_{(expectedClosed ? "closed" : "open")}"
            : $"braking_turnout_{address}_feedback_unknown");
    }

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
            request.ReturnSpeedStep is < 1 or > 126 ||
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
            _returnTrial = false;
            _returnSensor = null;
            _returnArrival = null;
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
            // Identify the physical starting end of the selected A-C route.
            // The trial direction follows the occupied block, never a stale UI direction.
            var currentBlocks = _layout.BlocksForPersistence();
            var occupiedByLoco = currentBlocks.Where(block =>
                !block.TargetOnly && block.LocoAddress == request.LocoAddress)
                .ToArray();
            // Some layouts track by address but have no persistent LocoId binding.
            // A matching, nonempty different LocoId is still a conflict.
            var matching = occupiedByLoco.Where(block =>
                string.IsNullOrWhiteSpace(block.LocoId) ||
                string.Equals(block.LocoId, request.LocoId, StringComparison.Ordinal))
                .ToArray();
            if (matching.Length != 1 || occupiedByLoco.Length != 1)
                return (false, matching.Length == 0
                    ? "braking_locomotive_block_unknown_assign_locomotive_to_layout"
                    : "braking_locomotive_block_ambiguous");

            var pathBlocks = new[] { request.RouteRef.FromBlockId }
                .Concat(request.RouteRef.ViaBlockIds ?? [])
                .Append(request.RouteRef.ToBlockId).ToArray();
            var position = Array.IndexOf(pathBlocks, (int)matching[0].Id);
            if (position < 0)
                return (false, "braking_locomotive_outside_selected_route");

            // For a middle block (B), continue toward the selected route's
            // destination. At C, reverse the complete route toward A.
            MovementRouteRefModel actualRoute;
            if (position == pathBlocks.Length - 1)
                actualRoute = Reverse(request.RouteRef);
            else
                actualRoute = new MovementRouteRefModel
                {
                    FromBlockId = pathBlocks[position],
                    ToBlockId = request.RouteRef.ToBlockId,
                    Direction = request.RouteRef.Direction,
                    ViaBlockIds = pathBlocks.Skip(position + 1)
                        .Take(pathBlocks.Length - position - 2).ToArray()
                };
            var destinationLength = ReadBlockLengthMm(actualRoute.ToBlockId);
            if (request.TargetFrontClearanceMm.HasValue)
            {
                var clearance = request.TargetFrontClearanceMm.Value;
                if (destinationLength is null || !double.IsFinite(clearance) ||
                    clearance < 0 || destinationLength.Value - clearance is < 10 or > 10000)
                    return (false, "braking_invalid_destination_geometry");
                request = request with {
                    RouteRef = actualRoute,
                    TargetDistanceMm = destinationLength.Value - clearance
                };
            }
            else request = request with { RouteRef = actualRoute };
            lock (_sync) _active = request;
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
                (!string.IsNullOrWhiteSpace(startBlock.LocoId) &&
                 !string.Equals(startBlock.LocoId, request.LocoId,
                    StringComparison.Ordinal)))
                return (false, "braking_start_block_locomotive_mismatch");

            // ARRIVED reference is derived from the selected route's target
            // block occupancy sensor, never supplied as a user-entered address.
            var targetBlock = _layout.BlocksForPersistence()
                .FirstOrDefault(block => block.Id == actualRoute.ToBlockId);
            if (targetBlock is null || targetBlock.SensorAddress == 0)
                return (false, "braking_target_block_sensor_missing");
            var referenceSensor = targetBlock.SensorAddress;
            var blockLengthMm = ReadBlockLengthMm(actualRoute.ToBlockId);
            var locomotiveLengthMm = double.TryParse(loco["locomotiveLengthMm"]?.ToString(),
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var locomotiveLength)
                ? locomotiveLength : 0;
            var wagonLengthMm = double.TryParse(loco["wagonsLengthMm"]?.ToString(),
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var wagonLength)
                ? wagonLength : 0;
            var trainLengthMm = locomotiveLengthMm + wagonLengthMm;
            if (request.TargetFrontClearanceMm.HasValue)
            {
                if (blockLengthMm is null || locomotiveLengthMm <= 0 || wagonLengthMm < 0 ||
                    !double.IsFinite(trainLengthMm) ||
                    !double.IsFinite(request.TargetFrontClearanceMm.Value) ||
                    request.TargetFrontClearanceMm.Value < 0 ||
                    blockLengthMm.Value <= trainLengthMm + request.TargetFrontClearanceMm.Value)
                    return (false, "braking_train_does_not_fit_block");
                var expected = blockLengthMm.Value - request.TargetFrontClearanceMm.Value;
                if (Math.Abs(expected - request.TargetDistanceMm) > 1)
                    return (false, "braking_target_geometry_mismatch");
            }
            lock (_sync)
            {
                _targetBlockLengthMm = blockLengthMm;
                _trainLengthMm = trainLengthMm > 0 ? trainLengthMm : null;
            }

            // Reject missing feedback before touching any turnouts. The same
            // state is rechecked below immediately before sending throttle.
            if (!_layout.TryGetSensorState(referenceSensor, out var initialSensorOn))
            {
                _log.LogWarning(
                    "Precision Braking preflight: reference sensor #{Sensor} is UNKNOWN before turnout commands",
                    referenceSensor);
                return (false, $"reference_sensor_unknown_{referenceSensor}");
            }
            if (initialSensorOn)
            {
                _log.LogWarning(
                    "Precision Braking preflight: reference sensor #{Sensor} is ON before turnout commands",
                    referenceSensor);
                return (false, $"reference_sensor_occupied_{referenceSensor}");
            }

            // Each training run measures its own speed between sensor OFF and ON.
            // No Speed Calibration dependency and no guessed fallback velocity.
            if (!double.IsFinite(request.SensorDistanceMm) || request.SensorDistanceMm <= 0)
                return (false, "braking_sensor_distance_required");
            var points = new List<PrecisionBrakingProfile.SpeedPoint>();

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
                if (!await CommandRouteTurnoutAsync(turnout.Key, turnout.Value, preparingToken))
                    return (false, "braking_turnout_command_failed");
                var verification = await WaitForTurnoutAsync(
                    turnout.Key, turnout.Value, preparingToken);
                if (!verification.Verified)
                    return (false, verification.Reason);
            }
            if (Busy() || !_commandCenter.Connected || _commandCenter.EmergencyPaused)
                return (false, "braking_start_interlock_failed");
            // A supervised trial still requires live, known, FREE
            // reference feedback before starting any locomotive movement.
            if (!_layout.TryGetSensorState(referenceSensor, out var sensorOn))
            {
                _log.LogWarning(
                    "Precision Braking start rejected: reference sensor #{Sensor} is UNKNOWN (no live feedback received)",
                    referenceSensor);
                return (false, $"reference_sensor_unknown_{referenceSensor}");
            }
            if (sensorOn)
            {
                _log.LogWarning(
                    "Precision Braking start rejected: reference sensor #{Sensor} is ON (occupied)",
                    referenceSensor);
                return (false, $"reference_sensor_occupied_{referenceSensor}");
            }

            var learned = new List<PrecisionBrakingProfile.Trial>();

            preparingToken.ThrowIfCancellationRequested();
            lock (_sync)
            {
                preparingToken.ThrowIfCancellationRequested();
                _referenceSensor = referenceSensor;
                _currentSpeedMmS = 0;
                _sensorDistanceMm = request.SensorDistanceMm;
                _startSensor = startBlock.SensorAddress;
                _startOffTicks = null;
                _trials = learned;
                _speedPoints = points;
                _actual = null;
                _commandedRampSeconds = 0;
                _error = null;
                _status = "armed";
            }

            // Starting fresh training immediately invalidates the old profile.
            // No previous approved profile may remain available if training
            // stops early or the process crashes before operator approval.
            await InvalidateProfileAsync();

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
            // Supervised calibration: the operator retains Stop and E-STOP
            // control while waiting for a physical reference-sensor report.
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
        if (!active)
        {
            lock (_sync)
                if ((_status is "armed" or "returning") &&
                    _startSensor == address && _startOffTicks is null)
                    _startOffTicks = System.Diagnostics.Stopwatch.GetTimestamp();
            return;
        }
        lock (_sync)
        {
            if ((_status == "armed" || _status == "returning") &&
                _referenceSensor == address && _startOffTicks.HasValue)
            {
                var elapsed = System.Diagnostics.Stopwatch.GetElapsedTime(_startOffTicks.Value).TotalSeconds;
                if (elapsed > 0.05 && elapsed < 600)
                    _currentSpeedMmS = _sensorDistanceMm / elapsed;
            }
        }
        TaskCompletionSource<bool>? returnArrival = null;
        lock (_sync)
            if (_status == "returning" && _returnSensor == address)
                returnArrival = _returnArrival;
        if (returnArrival is not null)
        {
            TrialRequest? reverseTrial;
            CancellationToken reverseToken;
            lock (_sync)
            {
                reverseTrial = _active;
                reverseToken = _cts?.Token ?? CancellationToken.None;
                _returnSensor = null;
                _returnArrival = null;
                _referenceSensor = address;
                _status = "braking";
            }
            returnArrival.TrySetResult(true);
            if (reverseTrial is not null && !reverseToken.IsCancellationRequested)
                _ = Task.Run(() => BrakeAsync(reverseTrial, reverseToken));
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
            // Establish the physical minimum stopping distance first.
            // Never run the old multi-second step ramp here: it can create
            // artificial overshoot even when the decoder brakes promptly.
            // A normal speed=0 is NOT a global emergency stop.
            token.ThrowIfCancellationRequested();
            double seconds;
            lock (_sync)
            {
                seconds = _currentSpeedMmS > 0
                    ? PrecisionBrakingProfile.NextRampSeconds(
                        _trials, trial.SpeedStep, trial.RouteRef.Direction,
                        _currentSpeedMmS, trial.TargetDistanceMm)
                    : 0;
                _commandedRampSeconds = seconds;
            }
            _log.LogInformation(
                "Precision braking loco {Loco}: DCC {Step}, target {Target}mm, hold {Seconds:F3}s before zero",
                trial.LocoAddress, trial.SpeedStep, trial.TargetDistanceMm, seconds);
            if (seconds > 0)
                await Task.Delay(TimeSpan.FromSeconds(seconds), token);
            token.ThrowIfCancellationRequested();
            if (!await _commandCenter.SetLocoAsync(
                    trial.LocoAddress, 0,
                    trial.RouteRef.Direction == "forward", token))
                throw new InvalidOperationException("braking_command_failed");
            lock (_sync)
                if (_status == "braking") _status = "measure";
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _log.LogError(ex, "Precision braking stop command failed");
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
        if (measurement.RearFromSensorMm.HasValue &&
            !measurement.FrontFromSensorMm.HasValue)
        {
            double? trainLength;
            lock (_sync) trainLength = _trainLengthMm;
            var rear = measurement.RearFromSensorMm.Value;
            if (trainLength is null || !double.IsFinite(rear) ||
                rear < -trainLength.Value ||
                !double.IsFinite(rear + trainLength.Value) ||
                rear + trainLength.Value < 0)
                return (false, "braking_invalid_rear_distance");
            measurement = measurement with {
                ActualDistanceMm = rear + trainLength.Value,
                RearFromSensorMm = null
            };
        }
        if (measurement.FrontFromSensorMm.HasValue || measurement.RearFromSensorMm.HasValue)
        {
            double? trainLength;
            lock (_sync) trainLength = _trainLengthMm;
            if (trainLength is null ||
                !measurement.FrontFromSensorMm.HasValue || !measurement.RearFromSensorMm.HasValue ||
                !double.IsFinite(measurement.FrontFromSensorMm.Value) ||
                !double.IsFinite(measurement.RearFromSensorMm.Value) ||
                measurement.FrontFromSensorMm.Value < 0 ||
                Math.Abs(measurement.FrontFromSensorMm.Value -
                    measurement.RearFromSensorMm.Value - trainLength.Value) > 10)
                return (false, "braking_front_rear_geometry_inconsistent");
            measurement = measurement with {
                ActualDistanceMm = measurement.FrontFromSensorMm.Value,
                FrontClearanceMm = null,
                RearClearanceMm = null
            };
        }
        // One physical measurement: distance from the entry sensor to the
        // rear of the entire consist. The front is rear + whole train length.
        // Keep the old two-clearance API compatible with older clients.
        if (measurement.RearClearanceMm.HasValue && !measurement.FrontClearanceMm.HasValue)
        {
            double? trainLength;
            lock (_sync) trainLength = _trainLengthMm;
            if (trainLength is null || !double.IsFinite(measurement.RearClearanceMm.Value) ||
                measurement.RearClearanceMm.Value < -20000)
                return (false, "braking_invalid_sensor_to_tail_distance");
            measurement = measurement with
            {
                ActualDistanceMm = measurement.RearClearanceMm.Value + trainLength.Value
            };
        }
        else if (measurement.FrontClearanceMm.HasValue || measurement.RearClearanceMm.HasValue)
        {
            double? blockLength, trainLength;
            lock (_sync) { blockLength = _targetBlockLengthMm; trainLength = _trainLengthMm; }
            if (!measurement.FrontClearanceMm.HasValue ||
                !measurement.RearClearanceMm.HasValue ||
                blockLength is null || trainLength is null ||
                !double.IsFinite(measurement.FrontClearanceMm.Value) ||
                !double.IsFinite(measurement.RearClearanceMm.Value) ||
                measurement.FrontClearanceMm.Value < 0)
                return (false, "braking_invalid_train_clearances");
            var fromFront = blockLength.Value - measurement.FrontClearanceMm.Value;
            var fromRear = measurement.RearClearanceMm.Value + trainLength.Value;
            if (fromFront < 0 || fromFront > blockLength.Value ||
                Math.Abs(fromFront - fromRear) > 10)
                return (false, "braking_train_geometry_inconsistent");
            measurement = measurement with { ActualDistanceMm = fromFront };
        }
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
            if (!double.IsFinite(speed) || speed <= 0)
                return (false, "braking_sensor_timing_missing_or_invalid");
            _status = "saving";
        }
        try
        {
            var row = new PrecisionBrakingProfile.Trial(trial.SpeedStep,
                trial.RouteRef.Direction, speed, trial.TargetDistanceMm,
                measurement.ActualDistanceMm, DateTimeOffset.UtcNow,
                _commandedRampSeconds);
            lock (_sync)
            {
                _trials.Add(row);
                _actual = measurement.ActualDistanceMm;
                _status = measurement.Approve ? "measure" : "return_preparing";
            }
            // Approval includes the just-recorded physical measurement.
            if (measurement.Approve)
                return await ApproveAsync();
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
                if (!await CommandRouteTurnoutAsync(
                    turnout.Key, turnout.Value, token))
                    throw new InvalidOperationException("braking_return_turnout_command_failed");
                var verification = await WaitForTurnoutAsync(
                    turnout.Key, turnout.Value, token);
                if (!verification.Verified)
                    throw new InvalidOperationException(verification.Reason);
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
                _returnTrial = !_returnTrial;
                var reverseTargetLength = ReadBlockLengthMm(reverseRoute.ToBlockId);
                if (reverseTargetLength is null || _trainLengthMm is null ||
                    !trial.TargetFrontClearanceMm.HasValue ||
                    reverseTargetLength.Value < _trainLengthMm.Value + trial.TargetFrontClearanceMm.Value)
                    throw new InvalidOperationException("braking_return_block_geometry_invalid");
                _targetBlockLengthMm = reverseTargetLength;
                _active = trial with {
                    RouteRef = reverseRoute,
                    TargetDistanceMm = reverseTargetLength.Value - trial.TargetFrontClearanceMm.Value,
                    SpeedStep = trial.SpeedStep
                };
                _actual = null;
                _startSensor = forwardRoute.ToBlockId == reverseRoute.FromBlockId
                    ? _layout.BlocksForPersistence().FirstOrDefault(b => b.Id == reverseRoute.FromBlockId)?.SensorAddress
                    : null;
                _startOffTicks = null;
                _currentSpeedMmS = 0;
                _referenceSensor = origin.SensorAddress;
                _status = "returning";
            }

            // Same cruise speed in both directions; braking profile is direction-specific.
            var speed = trial.SpeedStep;
            if (!await _commandCenter.SetLocoAsync(
                trial.LocoAddress, speed, trial.RouteRef.Direction != "forward", token))
                throw new InvalidOperationException("braking_return_command_failed");

            // The return sensor triggers BrakeAsync, including the learned
            // speed-zero delay. The resulting stop must be measured by the
            // operator; never mark the return as completed on sensor ON.
            await arrival.Task.WaitAsync(token);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _log.LogError(ex, "Precision Braking return failed");
            lock (_sync)
            {
                _status = "error";
                _error = ex.Message;
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
            // Preserve exclusive calibration ownership until the reverse
            // physical stopping measurement is recorded (or Stop/E-STOP).
            if (_status == "error") ReleaseGate();
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
            // _active always contains the actual travel direction, including
            // the return trip. Never invert it a second time during Stop.
            await StopPowerOnlyAsync(trial);
        }
        // The starting task owns final cleanup while it is still preparing;
        // releasing its gate here would let a second Start overlap it.
        if (!startStillPreparing)
            ReleaseGate();
    }

    public async Task<(bool Ok, string Error)> ApproveAsync()
    {
        TrialRequest? trial;
        PrecisionBrakingProfile.Trial[] samples;
        lock (_sync)
        {
            if (_status != "measure" || _active is null || _trials.Count == 0)
                return (false, "braking_training_not_ready_for_approval");
            trial = _active;
            samples = _trials.ToArray();
            _status = "saving";
        }
        try
        {
            await _storage.ExecuteAsync(async () =>
            {
                var root = JsonNode.Parse(await File.ReadAllTextAsync(LocoFile)) as JsonArray
                    ?? throw new InvalidOperationException("invalid_locomotive_data");
                var loco = FindLoco(root, trial.LocoId)
                    ?? throw new InvalidOperationException("locomotive_not_found");
                var data = loco["precisionBraking"] as JsonObject ?? new JsonObject();
                data["trials"] = JsonSerializer.SerializeToNode(samples,
                    new JsonSerializerOptions(JsonSerializerDefaults.Web));
                data["validated"] = true;
                data["updatedAt"] = DateTimeOffset.UtcNow.ToString("O");
                loco["precisionBraking"] = data;
                var temp = LocoFile + ".braking-approve.tmp";
                await File.WriteAllTextAsync(temp, root.ToJsonString());
                File.Move(temp, LocoFile, true);
                return true;
            });
            lock (_sync) _status = "completed";
            ReleaseGate();
            return (true, "");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Braking profile approval failed");
            lock (_sync) { _status = "error"; _error = "braking_approval_failed"; }
            ReleaseGate();
            return (false, "braking_approval_failed");
        }
    }

    public async Task AbortTrainingAsync()
    {
        await StopAsync();
        lock (_sync)
        {
            _trials.Clear();
            _status = "aborted";
        }
        await InvalidateProfileAsync();
    }

    async Task InvalidateProfileAsync()
    {
        TrialRequest? trial;
        lock (_sync) trial = _active;
        if (trial is null) return;
        await _storage.ExecuteAsync(async () =>
        {
            var root = JsonNode.Parse(await File.ReadAllTextAsync(LocoFile)) as JsonArray;
            var loco = root is null ? null : FindLoco(root, trial.LocoId);
            if (loco is null) return false;
            var data = loco["precisionBraking"] as JsonObject ?? new JsonObject();
            data["validated"] = false;
            data["trials"] = new JsonArray();
            loco["precisionBraking"] = data;
            var temp = LocoFile + ".braking-abort.tmp";
            await File.WriteAllTextAsync(temp, root!.ToJsonString());
            File.Move(temp, LocoFile, true);
            return true;
        });
    }

    public async Task EmergencyStopAsync()
    {
        await _commandCenter.EmergencyStopAsync();
        await StopAsync();
    }
}
