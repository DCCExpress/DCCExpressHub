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
    }

    readonly object _gate = new();
    readonly MovementRuntime _movement;
    readonly HubState _hubState;
    readonly AppPaths _paths;
    readonly ILogger<SequentialMovementRuntime> _logger;
    readonly Dictionary<string, Run> _running = new(StringComparer.Ordinal);
    readonly Dictionary<string, State> _states = new(StringComparer.Ordinal);
    readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);
    public event Action<State>? Changed;

    public SequentialMovementRuntime(
        MovementRuntime movement, HubState hubState, AppPaths paths, ILogger<SequentialMovementRuntime> logger)
    {
        _movement = movement;
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
            RouteRef = segment.RouteRef,
        };
    }

    public (bool Ok, string? Error, State? State) Start(string id)
    {
        Definition? definition;
        try { definition = Load(id); }
        catch (Exception ex) { return (false, "sequence_load_failed: " + ex.Message, null); }
        if (definition is null) return (false, "sequence_not_found", null);
        if (_hubState.EmergencyStop) return (false, "emergency_stop_active", null);
        var invalid = Validate(definition);
        if (invalid is not null) return (false, invalid, null);

        var firstSource = _movement.TimetableSourceStatus(definition.Segments[0].RouteRef!.FromBlockId);
        if (firstSource.Skip || firstSource.LocoAddress <= 0)
            return (false, firstSource.Reason, null);
        var run = new Run
        {
            Definition = definition,
            Cancel = new CancellationTokenSource(),
            LocoAddress = firstSource.LocoAddress
        };
        lock (_gate)
        {
            if (_running.ContainsKey(id))
            {
                run.Cancel.Dispose();
                return (false, "sequence_already_running", null);
            }
            _running.Add(id, run);
        }
        if (!_movement.ReserveSequentialLocomotive(firstSource.LocoAddress, run.Prefix))
        {
            lock (_gate) _running.Remove(id);
            run.Cancel.Dispose();
            return (false, "locomotive_already_managed", null);
        }
        run.ChildId = run.Prefix + "-0";
        var first = _movement.StartTransient(ChildPage(run, 0), calibrationBypass: false);
        if (!first.Ok)
        {
            _movement.ReleaseSequentialLocomotive(firstSource.LocoAddress, run.Prefix);
            lock (_gate) _running.Remove(id);
            run.Cancel.Dispose();
            return (false, first.Error, null);
        }
        Publish(run, "running", 1, "Running route 1/" + definition.Segments.Length);
        _ = Task.Run(() => Execute(run));
        return (true, null, run.State);
    }

    async Task Execute(Run run)
    {
        try
        {
            for (var index = 0; index < run.Definition.Segments.Length; index++)
            {
                var token = run.Cancel.Token;
                token.ThrowIfCancellationRequested();
                if (_hubState.EmergencyStop) throw new InvalidOperationException("emergency_stop_active");
                var childId = run.ChildId ?? throw new InvalidOperationException("missing_child");
                // Movement publishes idle only after the physical zero-speed command;
                // additionally wait for execution cleanup and Dispatcher lease release.
                while (true)
                {
                    token.ThrowIfCancellationRequested();
                    var state = _movement.GetState(childId);
                    if (state.Status == "error") throw new InvalidOperationException(state.Error ?? "movement_failed");
                    if (state.Status == "idle" && state.StoppedAt.HasValue)
                    {
                        if (state.Info != "Movement completed")
                            throw new InvalidOperationException(state.Info ?? "movement_interrupted");
                        if (run.LocoAddress is > 0 && !_movement.IsLocoExecutionRunning(run.LocoAddress.Value))
                            break;
                    }
                    await Task.Delay(100, token);
                }

                var endIndex = run.Definition.Segments[index].EndStepIndex;
                var step = run.Definition.Steps[endIndex];
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
                    await Task.Delay(TimeSpan.FromSeconds(seconds), token);
                }

                // The final block always stops; if a wait was configured there,
                // complete only after its timer expires rather than silently
                // skipping the last row's stop/wait setting.
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
            Publish(run, "error", run.State.StepIndex, "Sequence failed", ex.Message);
        }
        finally
        {
            if (run.LocoAddress is > 0)
                _movement.ReleaseSequentialLocomotive(run.LocoAddress.Value, run.Prefix);
            lock (_gate) _running.Remove(run.Definition.Id);
            run.Cancel.Dispose();
        }
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
