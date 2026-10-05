using System.Text.Json;
using System.Text.Json.Nodes;

namespace DCCExpressHub.Net.Web;

public sealed record CalibrationStartRequest(
    string LocoId,
    int LocoAddress,
    MovementRouteRefModel RouteRef,
    string RouteLabel,
    double RouteLengthMm,
    int MaxSpeed,
    int SpeedStep);

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
    readonly ScriptRuntime _scripts;
    readonly FlowRuntime _flows;
    readonly TimetableRuntime _timetable;
    readonly AutomationExclusiveGate _exclusiveGate;
    readonly LocoStorageCoordinator _locoStorage;
    readonly IWebHostEnvironment _env;
    readonly ILogger<CalibrationRuntime> _log;

    CancellationTokenSource? _cancellation;
    string? _currentPageId;
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
        ScriptRuntime scripts,
        FlowRuntime flows,
        TimetableRuntime timetable,
        AutomationExclusiveGate exclusiveGate,
        LocoStorageCoordinator locoStorage,
        IWebHostEnvironment env,
        ILogger<CalibrationRuntime> log)
    {
        _movement = movement;
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

    async Task RunCalibration(
        CalibrationStartRequest request,
        CancellationTokenSource cancellation)
    {
        try
        {
            for (
                var speed =
                    request.SpeedStep;
                speed <=
                    request.MaxSpeed;
                speed +=
                    request.SpeedStep)
            {
                cancellation.Token.ThrowIfCancellationRequested();

                await RunPass(
                    request,
                    speed,
                    "outbound",
                    request.RouteRef,
                    cancellation.Token);

                cancellation.Token.ThrowIfCancellationRequested();

                await Task.Delay(
                    350,
                    cancellation.Token);

                await RunPass(
                    request,
                    speed,
                    "return",
                    ReverseRouteRef(
                        request.RouteRef),
                    cancellation.Token);

                cancellation.Token.ThrowIfCancellationRequested();

                await PersistResults(
                    request);

                await Task.Delay(
                    350,
                    cancellation.Token);
            }

            lock (_gate)
                _state =
                    Snapshot() with
                    {
                        Status =
                            "completed",
                        CurrentSpeed =
                            null,
                        CurrentDirection =
                            null,
                        Info =
                            "Calibration completed",
                        Error =
                            null
                    };

            await PersistResults(
                request);
        }
        catch (OperationCanceledException)
        {
            lock (_gate)
                _state =
                    Snapshot() with
                    {
                        Status =
                            "idle",
                        CurrentSpeed =
                            null,
                        CurrentDirection =
                            null,
                        Info =
                            "Calibration stopped"
                    };
        }
        catch (Exception ex)
        {
            _log.LogError(
                ex,
                "Locomotive calibration failed");

            lock (_gate)
                _state =
                    Snapshot() with
                    {
                        Status =
                            "error",
                        CurrentSpeed =
                            null,
                        CurrentDirection =
                            null,
                        Info =
                            "Calibration failed",
                        Error =
                            ex.Message
                    };
        }
        finally
        {
            try
            {
                await PersistResults(
                    request);
            }
            catch (Exception ex)
            {
                _log.LogWarning(
                    ex,
                    "Partial locomotive calibration results could not be persisted");
            }

            string? pageId;

            lock (_gate)
                pageId =
                    _currentPageId;

            if (!string.IsNullOrWhiteSpace(
                    pageId))
                _movement.Stop(
                    pageId);

            lock (_gate)
            {
                _currentPageId =
                    null;

                _cancellation?.Dispose();
                _cancellation =
                    null;
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

    static MovementRouteRefModel ReverseRouteRef(
        MovementRouteRefModel routeRef) =>
        new()
        {
            FromBlockId =
                routeRef.ToBlockId,
            ToBlockId =
                routeRef.FromBlockId,
            Direction =
                routeRef.Direction == "forward"
                    ? "reverse"
                    : "forward",
            ViaBlockIds =
                (routeRef.ViaBlockIds ?? [])
                    .Reverse()
                    .ToArray()
        };

    async Task RunPass(
        CalibrationStartRequest request,
        int speed,
        string direction,
        MovementRouteRefModel routeRef,
        CancellationToken cancellationToken)
    {
        var pageId =
            "calibration:" +
            Guid.NewGuid()
                .ToString("N");

        lock (_gate)
        {
            _currentPageId =
                pageId;

            _state =
                Snapshot() with
                {
                    Status =
                        "running",
                    CurrentSpeed =
                        speed,
                    CurrentDirection =
                        direction,
                    Info =
                        "Running " +
                        direction +
                        " at speed " +
                        speed,
                    Error =
                        null
                };
        }

        var started =
            new TaskCompletionSource<long>(
                TaskCreationOptions.RunContinuationsAsynchronously);

        var arrived =
            new TaskCompletionSource<long>(
                TaskCreationOptions.RunContinuationsAsynchronously);

        var terminal =
            new TaskCompletionSource<MovementRuntimeState>(
                TaskCreationOptions.RunContinuationsAsynchronously);

        void OnMotionStarted(
            string id,
            long timestamp)
        {
            if (id == pageId)
                started.TrySetResult(
                    timestamp);
        }

        void OnDestinationArrived(
            string id,
            long timestamp)
        {
            if (id == pageId)
                arrived.TrySetResult(
                    timestamp);
        }

        void OnChanged(
            MovementRuntimeState state)
        {
            if (state.PageId != pageId)
                return;

            if (state.Status ==
                    "error" ||
                (
                    state.Status ==
                        "idle" &&
                    state.StoppedAt.HasValue
                ))
                terminal.TrySetResult(
                    state);
        }

        _movement.MotionStarted +=
            OnMotionStarted;
        _movement.DestinationArrived +=
            OnDestinationArrived;
        _movement.Changed +=
            OnChanged;

        try
        {
            using var registration =
                cancellationToken.Register(
                    () =>
                    {
                        started.TrySetCanceled(
                            cancellationToken);

                        arrived.TrySetCanceled(
                            cancellationToken);

                        terminal.TrySetCanceled(
                            cancellationToken);
                    });

            var page =
                new MovementPageModel
                {
                    Id =
                        pageId,
                    Name =
                        "Calibration",
                    Enabled =
                        true,
                    Speed =
                        speed,
                    RouteRef =
                        routeRef,
                    ExpectedLocoAddress =
                        request.LocoAddress,
                    BlockRules =
                        [],
                    ResourceEventRules =
                        [],
                    SafetyRules =
                        [],
                    Actions =
                        []
                };

            var result =
                _movement.StartTransient(
                    page);

            if (!result.Ok)
                throw new InvalidOperationException(
                    result.Error ??
                    "calibration_movement_start_failed");

            var startedAt =
                await started.Task.WaitAsync(
                    cancellationToken);

            var arrivedAt =
                await arrived.Task.WaitAsync(
                    cancellationToken);

            var terminalState =
                await terminal.Task.WaitAsync(
                    cancellationToken);

            if (terminalState.Status ==
                "error")
                throw new InvalidOperationException(
                    terminalState.Error ??
                    "calibration_movement_failed");

            var elapsedMs =
                Math.Max(
                    1,
                    arrivedAt -
                    startedAt);

            var mmPerSecond =
                request.RouteLengthMm /
                (
                    elapsedMs /
                    1000d
                );

            var row =
                new CalibrationResultRow(
                    speed,
                    direction,
                    elapsedMs,
                    Math.Round(
                        mmPerSecond,
                        3));

            lock (_gate)
            {
                _results.Add(
                    row);

                _state =
                    Snapshot() with
                    {
                        Info =
                            "Measured " +
                            direction +
                            " speed " +
                            speed +
                            ": " +
                            row.MillimetersPerSecond
                                .ToString("0.###") +
                            " mm/s"
                    };
            }
        }
        finally
        {
            _movement.MotionStarted -=
                OnMotionStarted;
            _movement.DestinationArrived -=
                OnDestinationArrived;
            _movement.Changed -=
                OnChanged;

            lock (_gate)
                if (_currentPageId ==
                    pageId)
                    _currentPageId =
                        null;
        }
    }

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
        string? pageId;
        CancellationTokenSource? cancellation;

        lock (_gate)
        {
            pageId =
                _currentPageId;
            cancellation =
                _cancellation;
        }

        if (cancellation is null)
            return false;

        if (!string.IsNullOrWhiteSpace(
                pageId))
            _movement.Stop(
                pageId);

        cancellation.Cancel();
        return true;
    }

    public bool Abort(
        bool emergencyStop)
    {
        string? pageId;
        CancellationTokenSource? cancellation;

        lock (_gate)
        {
            pageId =
                _currentPageId;
            cancellation =
                _cancellation;
        }

        if (emergencyStop &&
            cancellation is null)
        {
            /*
             * E-STOP is a global safety command. It must remain available
             * after a normal calibration Stop because a locomotive can still
             * be coasting physically even though the calibration runtime is
             * already idle.
             */
            _movement.EmergencyStop();
            return true;
        }

        if (cancellation is null)
            return false;

        if (!string.IsNullOrWhiteSpace(
                pageId))
        {
            _movement.Abort(
                pageId,
                emergencyStop);
        }
        else if (emergencyStop)
        {
            /*
             * Between outbound/return passes there is no active transient
             * Movement to abort, but E-STOP must still reach the command
             * station immediately.
             */
            _movement.EmergencyStop();
        }

        cancellation.Cancel();

        return true;
    }
}
