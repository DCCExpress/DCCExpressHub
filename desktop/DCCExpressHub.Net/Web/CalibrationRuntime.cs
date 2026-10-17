using System.Text.Json;
using System.Text.Json.Nodes;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed record CalibrationStartRequest(
    string LocoId,
    int LocoAddress,
    MovementRouteRefModel RouteRef,
    string RouteLabel,
    double RouteLengthMm,
    int MaxSpeed,
    int SpeedStep,
    bool RouteConfirmed = false);

public sealed record CalibrationResultRow(
    int SpeedStep,
    string Direction,
    long ElapsedMs,
    double MillimetersPerSecond);

public sealed record CalibrationRuntimeState(
    string Status,
    string? LocoId,
    int? LocoAddress,
    MovementRouteRefModel? RouteRef,
    string? RouteLabel,
    double RouteLengthMm,
    int MaxSpeed,
    int SpeedStep,
    int? CurrentSpeed,
    string? CurrentDirection,
    string? Info,
    string? Error,
    CalibrationResultRow[] Results);

public sealed class CalibrationRuntime
{
    readonly object _gate = new();
    readonly MovementRuntime _movement;
    readonly MovementPlanBuilder _planBuilder;
    readonly DispatcherRuntime _dispatcher;
    readonly LayoutRuntime _layout;
    readonly ICommandCenter _commandCenter;
    readonly ScriptRuntime _scripts;
    readonly FlowRuntime _flows;
    readonly TimetableRuntime _timetable;
    readonly AutomationExclusiveGate _exclusiveGate;
    readonly LocoStorageCoordinator _locoStorage;
    readonly AppPaths _env;
    readonly ILogger<CalibrationRuntime> _log;

    CancellationTokenSource? _cancellation;
    string? _currentPageId;
    bool _forward;
    CalibrationStartRequest? _request;
    readonly List<CalibrationResultRow> _results = [];

    CalibrationRuntimeState _state =
        Idle();

    static CalibrationRuntimeState Idle() =>
        new(
            "idle",
            null,
            null,
            null,
            null,
            0,
            126,
            10,
            null,
            null,
            null,
            null,
            []);

    public CalibrationRuntime(
        MovementRuntime movement,
        MovementPlanBuilder planBuilder,
        DispatcherRuntime dispatcher,
        LayoutRuntime layout,
        ICommandCenter commandCenter,
        ScriptRuntime scripts,
        FlowRuntime flows,
        TimetableRuntime timetable,
        AutomationExclusiveGate exclusiveGate,
        LocoStorageCoordinator locoStorage,
        AppPaths env,
        ILogger<CalibrationRuntime> log)
    {
        _movement = movement;
        _planBuilder = planBuilder;
        _dispatcher = dispatcher;
        _layout = layout;
        _commandCenter = commandCenter;
        _scripts = scripts;
        _flows = flows;
        _timetable = timetable;
        _exclusiveGate = exclusiveGate;
        _locoStorage = locoStorage;
        _env = env;
        _log = log;
    }

    public CalibrationRuntimeState Snapshot()
    {
        lock (_gate)
            return _state with
            {
                Results =
                    _results.ToArray()
            };
    }

    static bool ActiveStatus(string status) =>
        status is
            "running" or
            "paused" or
            "stopping";

    bool OtherAutomationActive()
    {
        if (_movement.Snapshot().Any(state =>
                ActiveStatus(
                    state.Status)))
            return true;

        if (_scripts.Snapshot().Any(state =>
                state.Status is
                    "running" or
                    "paused"))
            return true;

        if (_flows.Snapshot().Pages.Any(page =>
                page.ActiveExecutions >
                0))
            return true;

        var timetable =
            _timetable.Snapshot();

        return
            timetable.Running ||
            timetable.ActiveRuns.Length >
                0;
    }

    public (bool Ok, string? Error) Start(
        CalibrationStartRequest request)
    {
        if (!request.RouteConfirmed)
            return (false, "calibration_route_confirmation_required");
        if (request.LocoAddress is < 1 or > 9999)
            return (
                false,
                "invalid_loco_address");

        if (string.IsNullOrWhiteSpace(
                request.LocoId) ||
            !ValidRouteRef(
                request.RouteRef))
            return (
                false,
                "calibration_route_missing");

        if (!double.IsFinite(
                request.RouteLengthMm) ||
            request.RouteLengthMm <= 0)
            return (
                false,
                "invalid_route_length");

        if (request.MaxSpeed is < 1 or > 126 ||
            request.SpeedStep is < 1 or > 126)
            return (
                false,
                "invalid_calibration_speed");

        if (request.SpeedStep > request.MaxSpeed)
            return (
                false,
                "calibration_speed_step_exceeds_max");

        lock (_gate)
        {
            if (_cancellation is not null)
                return (
                    false,
                    "calibration_already_running");
        }

        if (!_exclusiveGate.TryEnterCalibration())
            return (
                false,
                "calibration_already_running");

        if (OtherAutomationActive())
        {
            _exclusiveGate.ExitCalibration();

            return (
                false,
                "automation_or_timetable_running");
        }

        var normalized =
            request with
            {
                LocoId =
                    request.LocoId.Trim(),
                RouteRef =
                    NormalizeRouteRef(
                        request.RouteRef),
                RouteLabel =
                    (
                        request.RouteLabel ??
                        ""
                    ).Trim(),
                RouteLengthMm =
                    Math.Round(
                        request.RouteLengthMm,
                        3),
                MaxSpeed =
                    Math.Clamp(
                        request.MaxSpeed,
                        1,
                        126),
                SpeedStep =
                    Math.Clamp(
                        request.SpeedStep,
                        1,
                        126)
            };

        var cancellation =
            new CancellationTokenSource();

        lock (_gate)
        {
            _request =
                normalized;

            _cancellation =
                cancellation;

            _currentPageId =
                null;

            _results.Clear();

            _state =
                new CalibrationRuntimeState(
                    "running",
                    normalized.LocoId,
                    normalized.LocoAddress,
                    normalized.RouteRef,
                    normalized.RouteLabel,
                    normalized.RouteLengthMm,
                    normalized.MaxSpeed,
                    normalized.SpeedStep,
                    null,
                    null,
                    "Calibration started",
                    null,
                    []);
        }

        _ =
            Task.Run(
                () =>
                    RunCalibration(
                        normalized,
                        cancellation));

        return (
            true,
            null);
    }

    // One fixed route, one speed measurement, no implicit return journey.
    async Task RunCalibration(
        CalibrationStartRequest request,
        CancellationTokenSource cancellation)
    {
        var token = cancellation.Token;
        string? owner = null;
        bool moving = false;
        try
        {
            var page = new MovementPageModel
            {
                Id = "calibration:" + Guid.NewGuid().ToString("N"),
                Name = "Speed Calibration",
                Enabled = true,
                Speed = request.SpeedStep,
                RouteRef = request.RouteRef,
                ExpectedLocoAddress = request.LocoAddress,
                BlockRules = [],
                ResourceEventRules = [],
                SafetyRules = [],
                Actions = []
            };
            var plan = _planBuilder.Build(page);
            if (plan.Direction is not ("forward" or "reverse") ||
                plan.Blocks.Length < 2 || plan.Legs.Length == 0)
                throw new InvalidOperationException("calibration_invalid_route");
            var source = plan.Blocks[0];
            var destination = plan.Blocks[^1];
            if (source.BlockId is not > 0 || destination.BlockId is not > 0 ||
                source.SensorAddress is not > 0 || destination.SensorAddress is not > 0)
                throw new InvalidOperationException("calibration_endpoint_sensor_missing");

            var groupedTurnouts = plan.Legs.SelectMany(leg => leg.TurnoutStates)
                .GroupBy(turnout => turnout.Address).ToArray();
            if (groupedTurnouts.Any(group => group.Select(t => t.Closed).Distinct().Count() > 1))
                throw new InvalidOperationException("calibration_conflicting_turnouts");
            var turnouts = groupedTurnouts.Select(group => group.First()).ToArray();
            var blocks = plan.Blocks.Skip(1).Select(block =>
            {
                if (block.BlockId is not > 0 || block.SensorAddress is not > 0)
                    throw new InvalidOperationException("calibration_route_block_sensor_missing");
                return new DispatcherRouteBlockRequirement(
                    checked((ushort)block.BlockId.Value),
                    checked((ushort)block.SensorAddress.Value));
            }).ToArray();
            var tokens = plan.Legs.SelectMany(leg => leg.Resources)
                .Where(resource => resource.Kind == "segment")
                .Select(resource => DispatcherRuntime.ResourceToken("segment:" + resource.Name))
                .Distinct().ToArray();

            owner = page.Id;
            _forward = plan.Direction == "forward";
            lock (_gate)
                _state = Snapshot() with { Info = "Preparing full route and locking turnouts" };
            var reservation = await _dispatcher.AcquireRouteAsync(
                new DispatcherRouteRequest(owner, "Speed Calibration",
                    checked((ushort)request.LocoAddress),
                    checked((ushort)source.BlockId.Value),
                    blocks, turnouts, tokens), token);
            if (!reservation.Ok || reservation.Lease is null)
                throw new InvalidOperationException(
                    reservation.Error ?? "calibration_route_reservation_failed");
            token.ThrowIfCancellationRequested();

            var startSensor = checked((ushort)source.SensorAddress.Value);
            var endSensor = checked((ushort)destination.SensorAddress.Value);
            if (!_layout.TryGetSensorState(startSensor, out var sourceOn) || !sourceOn ||
                !_layout.TryGetSensorState(endSensor, out var endOn) || endOn)
                throw new InvalidOperationException("calibration_endpoint_sensors_not_ready");

            var speed = request.SpeedStep;
            lock (_gate)
                _state = Snapshot() with {
                    CurrentSpeed = speed, CurrentDirection = "outbound",
                    Info = "Full route locked: one-way calibration running"
                };
            if (!await _commandCenter.SetLocoAsync(
                    request.LocoAddress, speed, _forward, token))
                throw new InvalidOperationException("calibration_loco_start_failed");
            moving = true;
            long? departedAt = null;
            long? elapsed = null;
            var deadline = Environment.TickCount64 + 10 * 60 * 1000;
            while (Environment.TickCount64 < deadline)
            {
                token.ThrowIfCancellationRequested();
                if (!_layout.TryGetSensorState(startSensor, out sourceOn) ||
                    !_layout.TryGetSensorState(endSensor, out endOn))
                    throw new InvalidOperationException("calibration_endpoint_sensor_unknown");
                if (!sourceOn && departedAt is null)
                    departedAt = Environment.TickCount64;
                if (endOn)
                {
                    if (departedAt is null)
                        throw new InvalidOperationException("calibration_arrived_before_departure");
                    elapsed = Math.Max(1, Environment.TickCount64 - departedAt.Value);
                    break;
                }
                await Task.Delay(10, token);
            }
            if (elapsed is null)
                throw new TimeoutException("calibration_endpoint_timeout");

            // Stop before publishing a result or releasing turnout authority.
            if (!await _commandCenter.SetLocoAsync(
                    request.LocoAddress, 0, _forward, CancellationToken.None))
                throw new InvalidOperationException("calibration_loco_stop_failed");
            moving = false;
            var row = new CalibrationResultRow(speed, "outbound", elapsed.Value,
                Math.Round(request.RouteLengthMm * 1000d / elapsed.Value, 3));
            lock (_gate)
            {
                _results.Add(row);
                _state = Snapshot() with {
                    Status = "completed", CurrentSpeed = null, CurrentDirection = null,
                    Info = "Measured " + row.MillimetersPerSecond.ToString("0.###") + " mm/s",
                    Error = null
                };
            }
        }
        catch (OperationCanceledException)
        {
            lock (_gate)
                _state = Snapshot() with {
                    Status = "idle", CurrentSpeed = null,
                    CurrentDirection = null, Info = "Calibration stopped"
                };
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Calibration failed");
            lock (_gate)
                _state = Snapshot() with {
                    Status = "error", CurrentSpeed = null,
                    CurrentDirection = null, Error = ex.Message, Info = "Calibration failed"
                };
        }
        finally
        {
            if (moving)
            {
                try
                {
                    if (!await _commandCenter.SetLocoAsync(
                            request.LocoAddress, 0, _forward, CancellationToken.None))
                        _movement.EmergencyStop();
                }
                catch (Exception ex)
                {
                    _log.LogError(ex, "Calibration stop failed; E-STOP requested");
                    _movement.EmergencyStop();
                }
            }
            try { await PersistResults(request); }
            catch (Exception ex) { _log.LogWarning(ex, "Calibration persistence failed"); }
            if (owner is not null) _dispatcher.ReleaseRoute(owner);
            lock (_gate)
            {
                _cancellation?.Dispose();
                _cancellation = null;
            }
            _exclusiveGate.ExitCalibration();
        }
    }

    static bool ValidRouteRef(
        MovementRouteRefModel? routeRef) =>
        routeRef is not null &&
        routeRef.FromBlockId is >= 1 and <= 65535 &&
        routeRef.ToBlockId is >= 1 and <= 65535 &&
        routeRef.FromBlockId != routeRef.ToBlockId &&
        routeRef.Direction is "forward" or "reverse";

    static MovementRouteRefModel NormalizeRouteRef(
        MovementRouteRefModel routeRef) =>
        new()
        {
            FromBlockId =
                routeRef.FromBlockId,
            ToBlockId =
                routeRef.ToBlockId,
            Direction =
                routeRef.Direction,
            ViaBlockIds =
                (routeRef.ViaBlockIds ?? [])
                    .Where(id =>
                        id is >= 1 and <= 65535 &&
                        id != routeRef.FromBlockId &&
                        id != routeRef.ToBlockId)
                    .Distinct()
                    .ToArray()
        };

    async Task PersistResults(
        CalibrationStartRequest request)
    {
        await _locoStorage.ExecuteAsync(
            async () =>
            {
                var path =
                    Path.Combine(
                        _env.ContentRootPath,
                        "data",
                        "config",
                        "locos.json");

                if (!File.Exists(path))
                    return false;

                JsonArray? root;

                try
                {
                    root =
                        JsonNode.Parse(
                            await File.ReadAllTextAsync(
                                path)) as
                        JsonArray;
                }
                catch
                {
                    return false;
                }

                if (root is null)
                    return false;

                JsonObject? target =
                    null;

                foreach (var node in root)
                {
                    if (node is not JsonObject loco)
                        continue;

                    var id =
                        loco["id"]?
                            .GetValue<string>();

                    if (string.Equals(
                            id,
                            request.LocoId,
                            StringComparison.Ordinal))
                    {
                        target =
                            loco;
                        break;
                    }
                }

                if (target is null)
                    return false;

                CalibrationResultRow[] results;

                lock (_gate)
                    results =
                        _results.ToArray();

                var resultNodes =
                    new JsonArray();

                foreach (var row in results)
                    resultNodes.Add(
                        new JsonObject
                        {
                            ["speedStep"] =
                                row.SpeedStep,
                            ["direction"] =
                                row.Direction,
                            ["elapsedMs"] =
                                row.ElapsedMs,
                            ["millimetersPerSecond"] =
                                row.MillimetersPerSecond
                        });

                target["calibration"] =
                    new JsonObject
                    {
                        ["routeRef"] =
                            new JsonObject
                            {
                                ["fromBlockId"] =
                                    request.RouteRef.FromBlockId,
                                ["toBlockId"] =
                                    request.RouteRef.ToBlockId,
                                ["direction"] =
                                    request.RouteRef.Direction,
                                ["viaBlockIds"] =
                                    new JsonArray(
                                        (request.RouteRef.ViaBlockIds ?? [])
                                            .Select(id =>
                                                JsonValue.Create(id))
                                            .ToArray())
                            },
                        ["routeLabel"] =
                            request.RouteLabel,
                        ["routeLengthMm"] =
                            request.RouteLengthMm,
                        ["maxSpeed"] =
                            request.MaxSpeed,
                        ["speedStep"] =
                            request.SpeedStep,
                        ["updatedAt"] =
                            DateTimeOffset.UtcNow
                                .ToString("O"),
                        ["results"] =
                            resultNodes
                    };

                var temp =
                    path +
                    ".calibration.tmp";

                await File.WriteAllTextAsync(
                    temp,
                    root.ToJsonString(
                        new System.Text.Json.JsonSerializerOptions
                        {
                            WriteIndented =
                                false
                        }));

                File.Move(
                    temp,
                    path,
                    true);

                return true;
            });
    }

    public bool Stop()
    {
        CancellationTokenSource? cancellation;
        lock (_gate) cancellation = _cancellation;
        if (cancellation is null) return false;
        cancellation.Cancel();
        return true;
    }

    public bool Abort(bool emergencyStop)
    {
        CancellationTokenSource? cancellation;
        lock (_gate) cancellation = _cancellation;
        if (emergencyStop) _movement.EmergencyStop();
        if (cancellation is null) return emergencyStop;
        cancellation.Cancel();
        return true;
    }
}
