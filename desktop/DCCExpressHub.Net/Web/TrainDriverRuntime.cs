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
            if (!_tasks.Values.Any(t => t.MovementId == movement.PageId))
                return;
            var current = _tasks.Values.First(t => t.MovementId == movement.PageId);
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
            // Keep the driver in PAUSED while the underlying Movement reports
            // intermediate RUNNING updates for sensor or route wait events.
            if (current.Status == "paused" && (status is "running" or "stopping"))
                return;
            updated = current with { Status = status, Info = movement.Info, Error = movement.Error };
            _tasks[current.TaskId] = updated;
            if (status is "completed" or "aborted" or "stopped" or "error")
                _activeByLoco.Remove(current.LocoAddress);
        }
        Changed?.Invoke(updated);
    }
}
