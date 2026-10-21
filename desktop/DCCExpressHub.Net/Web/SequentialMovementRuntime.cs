using System.Text.Json;

namespace DCCExpressHub.Net.Web;

/// <summary>
/// Runs a saved block sequence on the server. Each uninterrupted section is a
/// normal MovementRuntime route; occupancy, turnout locks and E-STOP remain
/// authoritative in MovementRuntime/Dispatcher/SwitchMan.
/// </summary>
public sealed class SequentialMovementRuntime
{
    public sealed class Step
    {
        public int BlockId { get; set; }
        // Direction of departure FROM this block (the final row is not departed).
        public string Direction { get; set; } = "forward";
        public string WaitMode { get; set; } = "pass";
        public int WaitSeconds { get; set; }
        public int MinSeconds { get; set; }
        public int MaxSeconds { get; set; }
    }
    public sealed class Segment
    {
        public MovementRouteRefModel? RouteRef { get; set; }
        public int EndStepIndex { get; set; }
    }
    public sealed class Definition
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string DirectionMode { get; set; } = "";
        public bool Enabled { get; set; } = true;
        public int Speed { get; set; } = 20;
        public Step[] Steps { get; set; } = [];
        public Segment[] Segments { get; set; } = [];
    }
    public sealed record State(
        string SequenceId, string Name, string Status, int StepIndex,
        int StepCount, int? LocoAddress, string? Info, string? Error);

    sealed class Run
    {
        public required Definition Definition { get; init; }
        public string Prefix { get; init; } = "sequence-step-" + Guid.NewGuid().ToString("N");
        public required CancellationTokenSource Cancel { get; init; }
        public int? LocoAddress;
        public string? ChildId;
        public State State = new("", "", "idle", 0, 0, null, null, null);
        public bool EmergencyAbort;
        public volatile bool FinishRequested;
        public int StartSegmentIndex;
        public int StartStepIndex;
        public MovementRouteRefModel? OverrideFirstRoute;
        public MovementRouteRefModel? ApproachRoute;
        public readonly CancellationTokenSource FinishWake = new();
    }

    readonly object _gate = new();
    readonly MovementRuntime _movement;
    readonly LayoutRuntime _layout;
    readonly HubState _hubState;
    readonly AppPaths _paths;
    readonly ILogger<SequentialMovementRuntime> _logger;
    readonly Dictionary<string, Run> _running = new(StringComparer.Ordinal);
    readonly Dictionary<string, State> _states = new(StringComparer.Ordinal);
    readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);
    public event Action<State>? Changed;

    public SequentialMovementRuntime(
        MovementRuntime movement, LayoutRuntime layout, HubState hubState, AppPaths paths, ILogger<SequentialMovementRuntime> logger)
    {
        _movement = movement;
        _layout = layout;
        _hubState = hubState;
        _paths = paths;
        _logger = logger;
    }

    public State[] Snapshot()
    {
        lock (_gate) return _states.Values.ToArray();
    }

    void Publish(Run run, string status, int index, string? info, string? error = null)
    {
        var state = new State(run.Definition.Id, run.Definition.Name, status,
            index, run.Definition.Steps.Length, run.LocoAddress, info, error);
        lock (_gate)
        {
            run.State = state;
            _states[state.SequenceId] = state;
        }
        Changed?.Invoke(state);
    }

    Definition? Load(string id)
    {
        var path = Path.Combine(_paths.ConfigRootPath, "automations.json");
        if (!File.Exists(path)) return null;
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var root = doc.RootElement;
        if (!root.TryGetProperty("movement", out var movement) ||
            !movement.TryGetProperty("sequences", out var list) ||
            list.ValueKind != JsonValueKind.Array) return null;
        foreach (var raw in list.EnumerateArray())
        {
            if (!raw.TryGetProperty("id", out var key) || key.GetString() != id) continue;
            return JsonSerializer.Deserialize<Definition>(raw.GetRawText(), _json);
        }
        return null;
    }

    static string? Validate(Definition definition)
    {
        // Older saved sequences used direction INTO a block. Never silently
        // run one as a departure-direction sequence with reversed meaning.
        if (definition.DirectionMode != "departure")
            return "sequence_requires_resave_with_departure_direction";
        var steps = definition.Steps;
        var segments = definition.Segments;
        if (steps is null || segments is null) return "invalid_sequence";
        if (!definition.Enabled) return "sequence_disabled";
        if (string.IsNullOrWhiteSpace(definition.Id) || steps.Length is < 2 or > 64 ||
            segments.Length is < 1 or > 63 || definition.Speed is < 1 or > 126)
            return "invalid_sequence";
        if (steps.Any(s => s is null || s.BlockId is < 1 or > 65535 ||
            s.Direction is not ("forward" or "reverse") ||
            s.WaitMode is not ("pass" or "fixed" or "random") ||
            s.WaitSeconds is < 0 or > 86400 ||
            s.MinSeconds is < 0 or > 86400 ||
            s.MaxSeconds is < 0 or > 86400 ||
            s.MinSeconds > s.MaxSeconds))
            return "invalid_sequence_step";
        if (steps.Zip(steps.Skip(1)).Any(pair => pair.First.BlockId == pair.Second.BlockId))
            return "sequence_adjacent_blocks_same";

        var fromIndex = 0;
        foreach (var segment in segments)
        {
            if (segment is null) return "invalid_sequence_segment";
            var route = segment.RouteRef;
            if (route is null || segment.EndStepIndex <= fromIndex ||
                segment.EndStepIndex >= steps.Length ||
                route.FromBlockId != steps[fromIndex].BlockId ||
                route.ToBlockId != steps[segment.EndStepIndex].BlockId ||
                route.Direction != steps[fromIndex].Direction ||
                (route.ViaBlockIds ?? []).Any(id => id is < 1 or > 65535))
                return "invalid_sequence_segment";
            // Intermediate blocks must be passed without stopping and must
            // depart in the same direction. The destination's departure
            // direction belongs to the NEXT segment, not this one.
            for (var index = fromIndex + 1; index < segment.EndStepIndex; index++)
            {
                if (steps[index].WaitMode != "pass" ||
                    steps[index].Direction != route.Direction ||
                    !(route.ViaBlockIds ?? []).Contains(steps[index].BlockId))
                    return "invalid_sequence_segment";
            }
            // A direction change on arrival requires a stop in that block.
            if (segment.EndStepIndex < steps.Length - 1 &&
                steps[segment.EndStepIndex].Direction != route.Direction &&
                steps[segment.EndStepIndex].WaitMode == "pass")
                return "sequence_reverse_requires_stop";
            fromIndex = segment.EndStepIndex;
        }
        if (fromIndex != steps.Length - 1) return "incomplete_sequence";
        // No artificial stop at a Pass checkpoint: every transient Movement
        // stops at its destination, so only an explicitly stopped checkpoint
        // may terminate a non-final segment.
        for (var i = 0; i < segments.Length - 1; i++)
        {
            var end = segments[i].EndStepIndex;
            if (steps[end].WaitMode == "pass")
                return "sequence_segment_requires_stop";
        }
        return null;
    }

    static MovementPageModel ChildPage(Run run, int segmentIndex)
    {
        var segment = run.Definition.Segments[segmentIndex];
        return new MovementPageModel
        {
            Id = run.ChildId!,
            Name = run.Definition.Name + " · " + (segmentIndex + 1) +
                "/" + run.Definition.Segments.Length,
            Enabled = true,
            Speed = run.Definition.Speed,
            ExpectedLocoAddress = run.LocoAddress,
            RouteRef = segmentIndex == run.StartSegmentIndex
                ? run.OverrideFirstRoute ?? segment.RouteRef
                : segment.RouteRef,
        };
    }

    static MovementPageModel ApproachPage(Run run) => new()
    {
        Id = run.ChildId!,
        Name = run.Definition.Name + " · approach to start",
        Enabled = true,
        Speed = run.Definition.Speed,
        ExpectedLocoAddress = run.LocoAddress,
        RouteRef = run.ApproachRoute,
    };

    // Only build a suffix of an already validated physical route. A new
    // route will still be validated against the persisted graph by Movement.
    static MovementRouteRefModel? RouteSuffix(MovementRouteRefModel route, int blockId)
    {
        var ids = new List<int> { route.FromBlockId };
        ids.AddRange(route.ViaBlockIds ?? []);
        ids.Add(route.ToBlockId);
        var sourcePosition = ids.IndexOf(blockId);
        if (sourcePosition < 0 || sourcePosition >= ids.Count - 1) return null;
        return new MovementRouteRefModel
        {
            FromBlockId = blockId,
            ToBlockId = route.ToBlockId,
            Direction = route.Direction,
            ViaBlockIds = ids.Skip(sourcePosition + 1).Take(ids.Count - sourcePosition - 2).ToArray()
        };
    }

    MovementRouteRefModel? ApproachRoute(int fromId, int toId, int locoAddress)
    {
        var layoutPath = Path.Combine(_paths.ConfigRootPath, "layout.json");
        if (!File.Exists(layoutPath)) return null;
        using var doc = JsonDocument.Parse(File.ReadAllText(layoutPath));
        if (!doc.RootElement.TryGetProperty("routeTopology", out var topology) ||
            !topology.TryGetProperty("routeTable", out var routes) ||
            routes.ValueKind != JsonValueKind.Array) return null;
        var candidates = new List<(MovementRouteRefModel Route, int Cost, bool Available)>();
        foreach (var route in routes.EnumerateArray())
        {
            if (!route.TryGetProperty("fromBlockId", out var from) ||
                !route.TryGetProperty("toBlockId", out var to) ||
                from.GetInt32() != fromId || to.GetInt32() != toId ||
                !route.TryGetProperty("locoDirection", out var directionEl) ||
                !route.TryGetProperty("blockPath", out var path) ||
                path.ValueKind != JsonValueKind.Array) continue;
            var direction = directionEl.GetString();
            if (direction is not ("forward" or "reverse")) continue;
            var ids = path.EnumerateArray().Select(block => block.GetProperty("id").GetInt32()).ToArray();
            if (ids.Length < 2) continue;
            var reference = new MovementRouteRefModel
            {
                FromBlockId = fromId,
                ToBlockId = toId,
                Direction = direction,
                ViaBlockIds = ids.Skip(1).Take(ids.Length - 2).ToArray()
            };
            var check = _movement.EvaluateAutoRoute(new MovementPageModel
            {
                Id = "sequential-approach-check",
                Name = "Sequence approach",
                ExpectedLocoAddress = locoAddress,
                RouteRef = reference
            });
            candidates.Add((reference, check.Cost, check.Available));
        }
        // Prefer an immediately safe candidate, but retain the existing
        // dispatcher waiting semantics for routes temporarily blocked.
        return candidates.OrderByDescending(item => item.Available)
            .ThenBy(item => item.Available ? item.Cost : item.Route.ViaBlockIds.Length)
            .Select(item => item.Route).FirstOrDefault();
    }

    public (bool Ok, string? Error, State? State) Start(
        string id, string? startMode = null, int locoAddress = 0, int startStepIndex = -1)
    {
        Definition? definition;
        try { definition = Load(id); }
        catch (Exception ex) { return (false, "sequence_load_failed: " + ex.Message, null); }
        if (definition is null) return (false, "sequence_not_found", null);
        if (_hubState.EmergencyStop) return (false, "emergency_stop_active", null);
        var invalid = Validate(definition);
        if (invalid is not null) return (false, invalid, null);

        var mode = string.IsNullOrWhiteSpace(startMode) ? "normal" : startMode;
        if (mode is not ("normal" or "current" or "approach"))
            return (false, "invalid_sequence_start_mode", null);

        var firstId = definition.Steps[0].BlockId;
        var startBlockId = firstId;
        var segmentIndex = 0;
        MovementRouteRefModel? overrideFirst = null;
        MovementRouteRefModel? approachRoute = null;
        if (mode == "normal")
        {
            var firstSource = _movement.TimetableSourceStatus(firstId);
            if (firstSource.Skip || firstSource.LocoAddress <= 0)
                return (false, firstSource.Reason, null);
            if (locoAddress > 0 && locoAddress != firstSource.LocoAddress)
                return (false, "sequence_loco_mismatch", null);
            locoAddress = firstSource.LocoAddress;
        }
        else
        {
            if (locoAddress is < 1 or > 10239)
                return (false, "sequence_select_locomotive", null);
            var matchingBlocks = _layout.BlocksForPersistence()
                .Where(block => block.LocoAddress == locoAddress).ToArray();
            if (matchingBlocks.Length != 1)
                return (false, "sequence_locomotive_location_ambiguous", null);
            startBlockId = matchingBlocks[0].Id;
            var source = _movement.TimetableSourceStatus(startBlockId);
            if (source.Skip || source.LocoAddress != locoAddress)
                return (false, source.Reason ?? "sequence_source_not_ready", null);

            if (mode == "current")
            {
                // Repeated blocks must be resolved by explicit occurrence.
                // The editor sends a 0-based checkpoint index (not block ID).
                var possibilities = definition.Steps.Select((step, index) => (step, index))
                    .Where(item => item.step.BlockId == startBlockId &&
                                   item.index < definition.Steps.Length - 1)
                    .Select(item => item.index).ToArray();
                if (possibilities.Length == 0)
                    return (false, "sequence_current_block_not_in_route", null);
                if (startStepIndex < 0)
                {
                    if (possibilities.Length != 1)
                        return (false, "sequence_select_block_occurrence", null);
                    startStepIndex = possibilities[0];
                }
                if (!possibilities.Contains(startStepIndex))
                    return (false, "sequence_start_step_mismatch", null);

                segmentIndex = Array.FindIndex(definition.Segments,
                    item => item.EndStepIndex > startStepIndex);
                if (segmentIndex < 0)
                    return (false, "sequence_start_segment_missing", null);
                var segmentStartIndex = segmentIndex == 0
                    ? 0 : definition.Segments[segmentIndex - 1].EndStepIndex;
                if (startStepIndex != segmentStartIndex)
                {
                    overrideFirst = RouteSuffix(
                        definition.Segments[segmentIndex].RouteRef!, startBlockId);
                    if (overrideFirst is null)
                        return (false, "sequence_partial_route_unavailable", null);
                }
            }
            else if (startBlockId != firstId)
            {
                try { approachRoute = ApproachRoute(startBlockId, firstId, locoAddress); }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Sequential approach route lookup failed");
                    return (false, "sequence_approach_route_lookup_failed", null);
                }
                if (approachRoute is null)
                    return (false, "sequence_no_route_to_start_block", null);
            }
        }

        var run = new Run
        {
            Definition = definition,
            Cancel = new CancellationTokenSource(),
            LocoAddress = locoAddress,
            StartStepIndex = mode == "current" ? startStepIndex : 0,
            StartSegmentIndex = segmentIndex,
            OverrideFirstRoute = overrideFirst,
            ApproachRoute = approachRoute,
        };
        lock (_gate)
        {
            if (_running.ContainsKey(id))
            {
                run.Cancel.Dispose();
                run.FinishWake.Dispose();
                return (false, "sequence_already_running", null);
            }
            _running.Add(id, run);
        }
        if (!_movement.ReserveSequentialLocomotive(locoAddress, run.Prefix))
        {
            lock (_gate) _running.Remove(id);
            run.Cancel.Dispose();
            run.FinishWake.Dispose();
            return (false, "locomotive_already_managed", null);
        }

        run.ChildId = run.Prefix + (approachRoute is null ? "-" + segmentIndex : "-approach");
        var firstPage = approachRoute is null ? ChildPage(run, segmentIndex) : ApproachPage(run);
        var first = _movement.StartTransient(firstPage, calibrationBypass: false);
        if (!first.Ok)
        {
            _movement.ReleaseSequentialLocomotive(locoAddress, run.Prefix);
            lock (_gate) _running.Remove(id);
            run.Cancel.Dispose();
            run.FinishWake.Dispose();
            return (false, first.Error, null);
        }
        Publish(run, "running", run.StartStepIndex + 1,
            approachRoute is null
                ? "Running route " + (segmentIndex + 1) + "/" + definition.Segments.Length
                : "Approaching sequence start block");
        _ = Task.Run(() => Execute(run));
        return (true, null, run.State);
    }

    async Task<MovementRuntimeState> WaitForChild(Run run, CancellationToken token)
    {
        var childId = run.ChildId ?? throw new InvalidOperationException("missing_child");
        // Only accept a confirmed completed Movement after its throttle has
        // reached zero and Dispatcher/Movement cleanup has finished.
        while (true)
        {
            token.ThrowIfCancellationRequested();
            var state = _movement.GetState(childId);
            if (state.Status == "error")
                throw new InvalidOperationException(state.Error ?? "movement_failed");
            if (state.Status == "idle" && state.StoppedAt.HasValue)
            {
                if (state.Info != "Movement completed")
                    throw new InvalidOperationException(state.Info ?? "movement_interrupted");
                if (run.LocoAddress is > 0 && !_movement.IsLocoExecutionRunning(run.LocoAddress.Value))
                    return state;
            }
            await Task.Delay(100, token);
        }
    }

    async Task Execute(Run run)
    {
        try
        {
            var token = run.Cancel.Token;
            if (run.ApproachRoute is not null)
            {
                var approachState = await WaitForChild(run, token);
                if (run.FinishRequested)
                {
                    Publish(run, "completed", run.StartStepIndex + 1,
                        "Finished safely at block #" + (approachState.CurrentBlockId ?? run.ApproachRoute.ToBlockId));
                    return;
                }
                token.ThrowIfCancellationRequested();
                if (_hubState.EmergencyStop) throw new InvalidOperationException("emergency_stop_active");
                run.ChildId = run.Prefix + "-0";
                var first = _movement.StartTransient(ChildPage(run, 0), calibrationBypass: false);
                if (!first.Ok)
                    throw new InvalidOperationException(first.Error ?? "sequence_segment_start_failed");
                Publish(run, "running", 1, "Running route 1/" + run.Definition.Segments.Length);
            }

            for (var index = run.StartSegmentIndex; index < run.Definition.Segments.Length; index++)
            {
                token.ThrowIfCancellationRequested();
                if (_hubState.EmergencyStop) throw new InvalidOperationException("emergency_stop_active");
                var state = await WaitForChild(run, token);
                var endIndex = run.Definition.Segments[index].EndStepIndex;
                var step = run.Definition.Steps[endIndex];

                if (run.FinishRequested)
                {
                    var firstIndex = index == run.StartSegmentIndex
                        ? run.StartStepIndex
                        : run.Definition.Segments[index - 1].EndStepIndex;
                    var currentIndex = Enumerable.Range(firstIndex, endIndex - firstIndex + 1)
                        .Where(i => run.Definition.Steps[i].BlockId == state.CurrentBlockId)
                        .DefaultIfEmpty(firstIndex).Last();
                    Publish(run, "completed", currentIndex + 1,
                        "Finished safely at block #" +
                        (state.CurrentBlockId ?? step.BlockId));
                    return;
                }

                var seconds = step.WaitMode switch
                {
                    "fixed" => step.WaitSeconds,
                    "random" => Random.Shared.Next(step.MinSeconds, step.MaxSeconds + 1),
                    _ => 0
                };
                if (seconds > 0)
                {
                    Publish(run, "waiting", endIndex + 1,
                        "Stopped at block #" + step.BlockId + " · waiting " + seconds + " s");
                    using var waitCancellation =
                        CancellationTokenSource.CreateLinkedTokenSource(token, run.FinishWake.Token);
                    try
                    {
                        await Task.Delay(TimeSpan.FromSeconds(seconds), waitCancellation.Token);
                    }
                    catch (OperationCanceledException) when (run.FinishRequested && !token.IsCancellationRequested)
                    {
                        Publish(run, "completed", endIndex + 1,
                            "Finished safely at block #" + step.BlockId);
                        return;
                    }
                }

                if (run.FinishRequested)
                {
                    Publish(run, "completed", endIndex + 1,
                        "Finished safely at block #" + step.BlockId);
                    return;
                }

                // The final block always stops; the final wait has completed.
                if (index == run.Definition.Segments.Length - 1)
                {
                    token.ThrowIfCancellationRequested();
                    Publish(run, "completed", endIndex + 1, "Sequence completed");
                    return;
                }

                token.ThrowIfCancellationRequested();
                if (_hubState.EmergencyStop) throw new InvalidOperationException("emergency_stop_active");
                run.ChildId = run.Prefix + "-" + (index + 1);
                var next = _movement.StartTransient(ChildPage(run, index + 1), calibrationBypass: false);
                if (!next.Ok)
                    throw new InvalidOperationException(next.Error ?? "sequence_segment_start_failed");
                Publish(run, "running", endIndex + 1, "Running route " +
                    (index + 2) + "/" + run.Definition.Segments.Length);
            }
        }
        catch (OperationCanceledException)
        {
            // Do not release locomotive ownership before MovementRuntime
            // confirms zero speed and completes its own cleanup.
            if (run.LocoAddress is > 0)
                while (_movement.IsLocoExecutionRunning(run.LocoAddress.Value))
                    await Task.Delay(100);
            Publish(run, run.EmergencyAbort ? "aborted" : "stopped",
                run.State.StepIndex, run.EmergencyAbort ? "Sequence aborted" : "Sequence stopped");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Sequential Movement {Id} failed", run.Definition.Id);
            // Movement may publish an error before its physical stop/cleanup
            // completes. Keep exclusive loco ownership until cleanup finishes.
            if (run.ChildId is { } child && run.LocoAddress is > 0 &&
                _movement.IsLocoExecutionRunning(run.LocoAddress.Value))
            {
                _movement.Stop(child);
                while (_movement.IsLocoExecutionRunning(run.LocoAddress.Value))
                    await Task.Delay(100);
            }
            Publish(run, "error", run.State.StepIndex, "Sequence failed", ex.Message);
        }
        finally
        {
            if (run.LocoAddress is > 0)
                _movement.ReleaseSequentialLocomotive(run.LocoAddress.Value, run.Prefix);
            lock (_gate) _running.Remove(run.Definition.Id);
            run.Cancel.Dispose();
            run.FinishWake.Dispose();
        }
    }

    public bool Finish(string id)
    {
        Run? run;
        lock (_gate)
        {
            if (!_running.TryGetValue(id, out run)) return false;
            if (run.State.Status is "completed" or "stopped" or "aborted" or "error")
                return false;
            if (run.FinishRequested) return true;
            run.FinishRequested = true;
            // Transition atomically with respect to the terminal state.
            Publish(run, "finishing", run.State.StepIndex,
                "Finishing at next safe block");
            // Wake a timed wait while Run is still owned by _running.
            run.FinishWake.Cancel();
        }
        // The child Movement decides when the next block has actually
        // arrived; no premature zero-speed command or authority release.
        if (run.ChildId is { } child)
            _movement.FinishAtNextBlock(child);
        return true;
    }

    public int StopAll(bool abort)
    {
        string[] ids;
        lock (_gate) ids = _running.Keys.ToArray();
        var count = 0;
        foreach (var id in ids)
            if (Stop(id, abort)) count++;
        return count;
    }

    public bool Stop(string id, bool abort)
    {
        Run? run;
        lock (_gate) _running.TryGetValue(id, out run);
        if (run is null) return false;
        run.EmergencyAbort = abort;
        run.Cancel.Cancel();
        if (run.ChildId is { } child)
        {
            if (abort) _movement.Abort(child, true);
            else _movement.Stop(child);
        }
        return true;
    }
}
