namespace DCCExpressHub.Net.Web;

/// <summary>
/// One active driver per locomotive. Owns task lifetime; MovementRuntime remains
/// responsible for track authority, SwitchMan locks, throttle and sensor safety.
/// Driver tasks are transient and never modify Saved Movements.
/// </summary>
public sealed class TrainDriverRuntime
{
    public sealed record DriverState(
        string TaskId,
        string MovementId,
        int LocoAddress,
        string Name,
        string Status,
        string? Info,
        string? Error,
        long CreatedAt);

    readonly object _gate = new();
    readonly MovementRuntime _movement;
    readonly Dictionary<string, DriverState> _tasks = new(StringComparer.Ordinal);
    readonly Dictionary<int, string> _activeByLoco = new();

    public event Action<DriverState>? Changed;

    public TrainDriverRuntime(MovementRuntime movement)
    {
        _movement = movement;
        _movement.Changed += OnMovementChanged;
    }

    public DriverState[] Snapshot()
    {
        lock (_gate)
            return _tasks.Values.OrderBy(x => x.CreatedAt).ToArray();
    }

    public (bool Ok, string? Error, DriverState? State) Start(
        string taskId,
        MovementPageModel page)
    {
        if (string.IsNullOrWhiteSpace(taskId) || page is null ||
            string.IsNullOrWhiteSpace(page.Id) || !page.ExpectedLocoAddress.HasValue ||
            page.ExpectedLocoAddress <= 0 || page.RouteRef is null)
            return (false, "invalid_train_driver_request", null);

        var address = page.ExpectedLocoAddress.Value;
        DriverState pending;
        lock (_gate)
        {
            if (_tasks.ContainsKey(taskId))
                return (false, "train_driver_task_exists", null);
            if (_tasks.Values.Any(task =>
                task.MovementId == page.Id &&
                _activeByLoco.TryGetValue(task.LocoAddress, out var owner) &&
                owner == task.TaskId))
                return (false, "train_driver_movement_already_managed", null);
            if (_activeByLoco.ContainsKey(address) || _movement.IsLocoManaged(address))
                return (false, "locomotive_already_managed", null);

            pending = new DriverState(taskId, page.Id, address, page.Name,
                "created", "Preparing movement", null, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            _tasks.Add(taskId, pending);
            _activeByLoco.Add(address, taskId);
        }

        Changed?.Invoke(pending);
        // Existing MovementRuntime validates physical source, track power,
        // safety sensors, Dispatcher and calibration exclusivity.
        (bool Ok, string? Error) result;
        try
        {
            result = _movement.StartTransient(page, calibrationBypass: false);
        }
        catch (Exception ex)
        {
            result = (false, ex.Message);
        }
        if (!result.Ok)
        {
            DriverState failed;
            lock (_gate)
            {
                failed = _tasks[taskId] with { Status = "error", Info = null, Error = result.Error };
                _tasks[taskId] = failed;
                _activeByLoco.Remove(address);
            }
            Changed?.Invoke(failed);
            return (false, result.Error, failed);
        }

        // Movement.Changed can fire synchronously during StartTransient.
        // Never overwrite a terminal/advanced state with a stale "running".
        DriverState state;
        lock (_gate)
        {
            state = _tasks[taskId];
            if (state.Status == "created")
            {
                state = state with { Status = "running", Info = "Movement started" };
                _tasks[taskId] = state;
            }
        }
        Changed?.Invoke(state);
        return (true, null, state);
    }

    // AUTO Drive to Block: the backend evaluates every candidate against
    // current sensor feedback before choosing the concrete Movement route.
    // This avoids binding to the first topology route merely by table order.
    public (bool Ok, string? Error, DriverState? State) StartAuto(
        string taskId, MovementPageModel[] candidates)
    {
        if (candidates is null || candidates.Length == 0 || candidates.Length > 128)
            return (false, "invalid_auto_route_candidates", null);
        var first = candidates[0];
        if (first.ExpectedLocoAddress is not > 0 || first.RouteRef is null)
            return (false, "invalid_auto_route_candidates", null);
        var source = first.RouteRef.FromBlockId;
        var destination = first.RouteRef.ToBlockId;
        var address = first.ExpectedLocoAddress.Value;
        if (source == destination || candidates.Any(page =>
                page.ExpectedLocoAddress != address || page.RouteRef is null ||
                page.RouteRef.FromBlockId != source ||
                page.RouteRef.ToBlockId != destination))
            return (false, "auto_route_candidates_mismatch", null);

        var viable = candidates
            .Select(page => (Page: page, Check: _movement.EvaluateAutoRoute(page)))
            .Where(item => item.Check.Available)
            .OrderBy(item => item.Check.Cost)
            .ThenBy(item => item.Page.RouteRef!.Direction, StringComparer.Ordinal)
            .ToArray();
        // An occupied intermediate block or a temporary SwitchMan/Dispatcher
        // lease must not reject the Drive to Block task. MovementRuntime starts
        // at speed zero until AcquireLeg obtains authority, then continues.
        // Prefer a fully clear route when possible; otherwise accept a topology
        // candidate and let the Dispatcher wait safely for its first leg.
        var selected = viable.Length > 0 ? viable[0].Page : candidates[0];
        // StartTransient still performs all authoritative Movement validation,
        // Dispatcher reservations and SwitchMan turnout acquisition.
        return Start(taskId, selected);
    }

    const string PauseOwnerPrefix = "train-driver-pause:";

    // Stop is a reversible pause, not MovementRuntime.Stop (which cancels the task).
    // MovementRuntime.Hold commands speed zero and retains the current leg authority.
    public bool Stop(string taskId)
    {
        DriverState current;
        lock (_gate)
        {
            if (!_tasks.TryGetValue(taskId, out var state) ||
                !_activeByLoco.TryGetValue(state.LocoAddress, out var owner) ||
                owner != taskId)
                return false;
            if (state.Status == "paused")
                return true;
            current = state;
        }

        if (!_movement.Hold(current.MovementId, PauseOwnerPrefix + taskId))
            return false;

        DriverState updated;
        lock (_gate)
        {
            updated = _tasks[taskId] with
            {
                Status = "paused",
                Info = "Paused by train driver; speed zero requested",
                Error = null
            };
            _tasks[taskId] = updated;
        }
        Changed?.Invoke(updated);
        return true;
    }

    public bool Resume(string taskId)
    {
        DriverState current;
        lock (_gate)
        {
            if (!_tasks.TryGetValue(taskId, out var state) ||
                state.Status != "paused" ||
                !_activeByLoco.TryGetValue(state.LocoAddress, out var owner) ||
                owner != taskId)
                return false;
            current = state;
        }

        // Release only our own hold. Other holds remain in force.
        // MovementRuntime revalidates held Dispatcher authority before applying speed.
        if (!_movement.Release(current.MovementId, PauseOwnerPrefix + taskId))
            return false;

        DriverState updated;
        lock (_gate)
        {
            updated = _tasks[taskId] with
            {
                Status = "running",
                Info = "Resume requested; awaiting movement authority",
                Error = null
            };
            _tasks[taskId] = updated;
        }
        Changed?.Invoke(updated);
        return true;
    }

    public bool Abort(string taskId)
    {
        DriverState state;
        lock (_gate)
        {
            if (!_tasks.TryGetValue(taskId, out var found) ||
                !_activeByLoco.TryGetValue(found.LocoAddress, out var current) ||
                current != taskId)
                return false;
            state = found;
        }
        return _movement.Abort(state.MovementId, true);
    }

    void OnMovementChanged(MovementRuntimeState movement)
    {
        DriverState? updated = null;
        lock (_gate)
        {
            // All Movement entry points (Timetable, Automation, direct Start,
            // Drive to Block) share one locomotive-owned driver. An explicit
            // driver task is already registered before Movement.StartTransient.
            if (movement.LocoAddress is not > 0)
                return;
            var address = movement.LocoAddress.Value;
            DriverState? current = null;
            var created = false;
            if (_activeByLoco.TryGetValue(address, out var taskId) &&
                _tasks.TryGetValue(taskId, out var active) &&
                active.MovementId == movement.PageId)
                current = active;

            if (current is null)
            {
                if (movement.Status != "running" || _activeByLoco.ContainsKey(address))
                    return;
                current = new DriverState(
                    "movement:" + movement.PageId + ":" +
                        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    movement.PageId, address, movement.MovementName,
                    "running", movement.Info, movement.Error,
                    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                _tasks[current.TaskId] = current;
                _activeByLoco[address] = current.TaskId;
                created = true;
            }

            var status = movement.Status switch
            {
                "running" => "running",
                "stopping" => "stopping",
                "idle" when movement.Info == "Movement aborted" => "aborted",
                "idle" when movement.Info == "Movement stopped" => "stopped",
                "idle" => "completed",
                "error" => "error",
                "aborted" => "aborted",
                "completed" => "completed",
                _ => movement.Status
            };
            // Stop means PAUSED: intermediate Movement status updates must
            // not remove the stop until Resume is explicitly requested.
            if (current.Status == "paused" && (status is "running" or "stopping"))
                return;
            updated = current with
            {
                Status = status, Info = movement.Info, Error = movement.Error
            };
            if (!created && updated == current)
                return;
            _tasks[current.TaskId] = updated;
            if (status is "completed" or "aborted" or "stopped" or "error")
                _activeByLoco.Remove(address);
        }
        Changed?.Invoke(updated);
    }
}
