using System.Text.Json.Nodes;

namespace DCCExpressHub.Net.Web;

public sealed record CalibrationStartRequest(
    string LocoId,
    int LocoAddress,
    string RouteKey,
    string ReverseRouteKey,
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
    string? RouteKey,
    string? ReverseRouteKey,
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
        IWebHostEnvironment env,
        ILogger<CalibrationRuntime> log)
    {
        _movement = movement;
        _scripts = scripts;
        _flows = flows;
        _timetable = timetable;
        _exclusiveGate = exclusiveGate;
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
            string.IsNullOrWhiteSpace(
                request.RouteKey) ||
            string.IsNullOrWhiteSpace(
                request.ReverseRouteKey))
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
                RouteKey =
                    request.RouteKey.Trim(),
                ReverseRouteKey =
                    request.ReverseRouteKey.Trim(),
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
                    normalized.RouteKey,
                    normalized.ReverseRouteKey,
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
                    request.RouteKey,
                    cancellation.Token);

                cancellation.Token.ThrowIfCancellationRequested();

                await Task.Delay(
                    350,
                    cancellation.Token);

                await RunPass(
                    request,
                    speed,
                    "return",
                    request.ReverseRouteKey,
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

    async Task RunPass(
        CalibrationStartRequest request,
        int speed,
        string direction,
        string routeKey,
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
                        _movement.Stop(
                            pageId);

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
                    RouteKey =
                        routeKey,
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
        var path =
            Path.Combine(
                _env.ContentRootPath,
                "data",
                "config",
                "locos.json");

        if (!File.Exists(
                path))
            return;

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
            return;
        }

        if (root is null)
            return;

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
            return;

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
                ["routeKey"] =
                    request.RouteKey,
                ["reverseRouteKey"] =
                    request.ReverseRouteKey,
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
    }

    public bool Stop()
    {
        CancellationTokenSource? cancellation;

        lock (_gate)
            cancellation =
                _cancellation;

        if (cancellation is null)
            return false;

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

        if (cancellation is null)
            return false;

        if (!string.IsNullOrWhiteSpace(
                pageId))
            _movement.Abort(
                pageId,
                emergencyStop);

        cancellation.Cancel();

        return true;
    }
}
