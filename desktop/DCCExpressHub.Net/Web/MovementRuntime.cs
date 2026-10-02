using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed record MovementRuntimeState(
    string PageId,
    string MovementName,
    string Status,
    long? StartedAt,
    long? StoppedAt,
    int? LocoAddress,
    string? Direction,
    int DesiredSpeed,
    bool Moving,
    int? CurrentBlockId,
    int? TargetBlockId,
    string? CurrentResourceKey,
    string? ActiveRouteResourceKey,
    string? Info,
    string? Error);

public sealed record MovementAudioRequest(
    string RequestId,
    string FileName,
    bool WaitForEnd);

public sealed class MovementSensorCondition
{
    public string Id { get; set; } = "";
    public int Sensor { get; set; }
    public bool State { get; set; } = true;
}

public sealed class MovementResourceEventRule
{
    public string ResourceKey { get; set; } = "";
    public string Event { get; set; } = "";
    public string Match { get; set; } = "all";
    public MovementSensorCondition[] Conditions { get; set; } = [];
}

public sealed class MovementBlockRule
{
    public int BlockId { get; set; }
    public MovementSensorCondition[] ApproachWhen { get; set; } = [];
    public MovementSensorCondition[] ArrivedWhen { get; set; } = [];
    public MovementSensorCondition[] DepartWhen { get; set; } = [];
    public MovementSensorCondition[] LeaveWhen { get; set; } = [];
}

public sealed class MovementSafetyRule
{
    public int FromBlockId { get; set; }
    public int ToBlockId { get; set; }
    public int[] IgnoredSensors { get; set; } = [];
}

public sealed class MovementActionModel
{
    public string Id { get; set; } = "";
    public string ResourceKey { get; set; } = "";
    public string When { get; set; } = "";
    public string SequenceId { get; set; } = "";
    public string SequenceMode { get; set; } = "blocking";
    public string Kind { get; set; } = "log";
    public int Speed { get; set; } = 20;
    public int FunctionNumber { get; set; } = 2;
    public int? FunctionBindingId { get; set; }
    public bool FunctionActive { get; set; } = true;
    public int PulseMs { get; set; } = 700;
    public int DelayMs { get; set; } = 500;
    public int MinDelayMs { get; set; } = 500;
    public int MaxDelayMs { get; set; } = 1500;
    public string AudioName { get; set; } = "";
    public bool AudioWaitForEnd { get; set; }
    public int RandomPlayChancePercent { get; set; } = 30;
    public int AccessoryAddress { get; set; } = 1;
    public bool AccessoryActive { get; set; } = true;
    public int AccessoryAspect { get; set; }
    public string Message { get; set; } = "";
}

public sealed class MovementPageModel
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public int Speed { get; set; } = 20;
    public string RouteKey { get; set; } = "";
    public int? FromBlockId { get; set; }
    public int[] ViaBlockIds { get; set; } = [];
    public int? ToBlockId { get; set; }
    public int? ExpectedLocoAddress { get; set; }
    public MovementBlockRule[] BlockRules { get; set; } = [];
    public MovementResourceEventRule[] ResourceEventRules { get; set; } = [];
    public MovementSafetyRule[] SafetyRules { get; set; } = [];
    public MovementActionModel[] Actions { get; set; } = [];
}

public sealed class MovementPlanResourceModel
{
    public string Key { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Name { get; set; } = "";
    public string Label { get; set; } = "";
    public int? BlockId { get; set; }
    public int? SensorAddress { get; set; }
    public int? NodeIndex { get; set; }
    public int[] Detectors { get; set; } = [];
    public DispatcherTurnoutRequirement[] TurnoutStates { get; set; } = [];
}

public sealed class MovementPlanLegModel
{
    public int Index { get; set; }
    public MovementPlanResourceModel From { get; set; } = new();
    public MovementPlanResourceModel To { get; set; } = new();
    public MovementPlanResourceModel[] Resources { get; set; } = [];
    public DispatcherTurnoutRequirement[] TurnoutStates { get; set; } = [];
    public MovementSensorCondition[] ApproachWhen { get; set; } = [];
    public int ApproachDelayMs { get; set; }
    public MovementSensorCondition[] DepartWhen { get; set; } = [];
    public MovementSensorCondition[] LeaveWhen { get; set; } = [];
    public bool LeaveWhenExplicit { get; set; }
    public int LeaveDelayMs { get; set; }
    public MovementSensorCondition[] ArrivedWhen { get; set; } = [];
    public int ArrivedDelayMs { get; set; }
}

public sealed class MovementPlanModel
{
    public string Direction { get; set; } = "unknown";
    public MovementPlanResourceModel[] Resources { get; set; } = [];
    public MovementPlanResourceModel[] Blocks { get; set; } = [];
    public MovementPlanLegModel[] Legs { get; set; } = [];
}

/// <summary>
/// Windows authoritative Movement executor.
///
/// The browser is intentionally NOT part of the safety loop. It may request
/// start/stop/abort and render state, but route authority, turnout locking,
/// sensor conditions, throttle, block transitions and action execution live
/// here in the backend.
/// </summary>
public sealed class MovementRuntime
{
    sealed class ResourceLeaveState
    {
        public required MovementPlanResourceModel Resource { get; init; }
    }

    sealed class BlockApproachState
    {
        public bool Fired { get; set; }
        public bool NextLegTurnoutBlocked { get; set; }
        public ushort? BlockingTurnout { get; set; }
        public string? BlockingOwnerName { get; set; }
    }

    sealed class BlockLeaveState
    {
        public bool SeenOccupied { get; set; }
        public bool Fired { get; set; }
    }

    sealed class Execution
    {
        public required MovementPageModel Page { get; init; }
        public required MovementPlanModel Plan { get; init; }
        public required int LocoAddress { get; init; }
        public required bool Forward { get; init; }
        public required CancellationTokenSource Cancellation { get; init; }
        public required MovementRuntimeState State { get; set; }
        public int DesiredSpeed { get; set; }
        public bool Moving { get; set; }
        public bool EmergencyAbort { get; set; }
        public bool MotionStartedPublished { get; set; }
        public int? CurrentBlockId { get; set; }
        public int? TargetBlockId { get; set; }
        public ConcurrentBag<Task> BackgroundTasks { get; } = [];
        public Dictionary<int, int> FunctionNumbersByBindingId { get; } = [];
        public Dictionary<string, ResourceLeaveState> ResourceLeaves { get; } =
            new(StringComparer.Ordinal);
        public HashSet<string> ResourceLeaveFired { get; } =
            new(StringComparer.Ordinal);
        public Dictionary<int, DispatcherLegLeaseInfo> PreparedLegLeases { get; } =
            [];
    }

    readonly object _gate = new();
    readonly LayoutRuntime _layout;
    readonly DispatcherRuntime _dispatcher;
    readonly SwitchManManager _switchMan;
    readonly MovementPlanBuilder _planBuilder;
    readonly ICommandCenter _commandCenter;
    readonly HubState _hubState;
    readonly IWebHostEnvironment _env;
    readonly AutomationStorageCoordinator _automationStorage;
    readonly AutomationExclusiveGate _exclusiveGate;
    readonly ILogger<MovementRuntime> _log;
    readonly Dictionary<string, Execution> _executions = new(StringComparer.Ordinal);
    readonly Dictionary<string, MovementRuntimeState> _states = new(StringComparer.Ordinal);
    readonly ConcurrentDictionary<string, TaskCompletionSource<bool>> _pendingAudio = new(StringComparer.Ordinal);
    readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);

    public event Action<MovementRuntimeState>? Changed;
    public event Action<string, long>? MotionStarted;
    public event Action<string, long>? DestinationArrived;
    public event Action<MovementAudioRequest>? AudioRequested;
    public event Action<LocoFeedback>? LocoChanged;
    public event Action? PowerStateChanged;

    public MovementRuntime(
        LayoutRuntime layout,
        DispatcherRuntime dispatcher,
        SwitchManManager switchMan,
        MovementPlanBuilder planBuilder,
        ICommandCenter commandCenter,
        HubState hubState,
        IWebHostEnvironment env,
        AutomationStorageCoordinator automationStorage,
        AutomationExclusiveGate exclusiveGate,
        ILogger<MovementRuntime> log)
    {
        _layout = layout;
        _dispatcher = dispatcher;
        _switchMan = switchMan;
        _planBuilder = planBuilder;
        _commandCenter = commandCenter;
        _hubState = hubState;
        _env = env;
        _automationStorage = automationStorage;
        _exclusiveGate = exclusiveGate;
        _log = log;
    }

    static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    static MovementRuntimeState Idle(string pageId) =>
        new(
            pageId,
            "",
            "idle",
            null,
            null,
            null,
            null,
            0,
            false,
            null,
            null,
            null,
            null,
            null,
            null);

    public MovementRuntimeState GetState(string pageId)
    {
        lock (_gate)
            return _states.TryGetValue(pageId, out var state)
                ? state
                : Idle(pageId);
    }

    public MovementRuntimeState[] Snapshot()
    {
        lock (_gate)
            return _states.Values
                .OrderBy(x => x.PageId, StringComparer.Ordinal)
                .ToArray();
    }

    void Publish(Execution execution, MovementRuntimeState state)
    {
        execution.State = state;

        lock (_gate)
            _states[execution.Page.Id] = state;

        Changed?.Invoke(state);
    }

    void Patch(
        Execution execution,
        string? status = null,
        int? desiredSpeed = null,
        string? currentResourceKey = null,
        bool setCurrentResource = false,
        string? activeRouteResourceKey = null,
        bool setActiveRoute = false,
        string? info = null,
        bool setInfo = false,
        string? error = null,
        bool setError = false,
        long? stoppedAt = null,
        bool setStoppedAt = false)
    {
        var s = execution.State;

        Publish(
            execution,
            s with
            {
                Status = status ?? s.Status,
                DesiredSpeed = desiredSpeed ?? s.DesiredSpeed,
                Moving = execution.Moving,
                CurrentBlockId = execution.CurrentBlockId,
                TargetBlockId = execution.TargetBlockId,
                CurrentResourceKey = setCurrentResource ? currentResourceKey : s.CurrentResourceKey,
                ActiveRouteResourceKey = setActiveRoute ? activeRouteResourceKey : s.ActiveRouteResourceKey,
                Info = setInfo ? info : s.Info,
                Error = setError ? error : s.Error,
                StoppedAt = setStoppedAt ? stoppedAt : s.StoppedAt
            });
    }

    RuntimeBlock? Block(int id) =>
        id is >= 1 and <= 65535
            ? _layout.BlocksForPersistence()
                .FirstOrDefault(x => x.Id == (ushort)id)
            : null;

    bool ConditionsSatisfied(IEnumerable<MovementSensorCondition> conditions)
    {
        var any = false;

        foreach (var condition in conditions)
        {
            any = true;

            if (condition.Sensor is < 1 or > 65535 ||
                !_layout.TryGetSensorState((ushort)condition.Sensor, out var state) ||
                state != condition.State)
                return false;
        }

        return any;
    }

    bool ArrivalSatisfied(
        MovementPlanLegModel leg) =>
        ConditionsSatisfied(
            leg.ArrivedWhen);

    MovementResourceEventRule EffectiveResourceRule(
        MovementPageModel page,
        MovementPlanResourceModel resource,
        string eventName)
    {
        var explicitRule =
            page.ResourceEventRules.FirstOrDefault(x =>
                string.Equals(x.ResourceKey, resource.Key, StringComparison.Ordinal) &&
                string.Equals(x.Event, eventName, StringComparison.Ordinal));

        if (explicitRule is not null)
            return explicitRule;

        var leaving =
            string.Equals(
                eventName,
                "leave",
                StringComparison.Ordinal);

        return new MovementResourceEventRule
        {
            ResourceKey =
                resource.Key,
            Event =
                eventName,
            Match =
                leaving
                    ? "all"
                    : "any",
            Conditions =
                resource.Detectors
                    .Where(sensor =>
                        sensor is >= 1 and <= 65535)
                    .Distinct()
                    .OrderBy(sensor =>
                        sensor)
                    .Select(sensor =>
                        new MovementSensorCondition
                        {
                            Id =
                                "default-" +
                                resource.Key +
                                "-" +
                                eventName +
                                "-" +
                                sensor,
                            Sensor =
                                sensor,
                            State =
                                !leaving
                        })
                    .ToArray()
        };
    }

    bool ResourceEventSatisfied(
        MovementPageModel page,
        MovementPlanResourceModel resource,
        string eventName)
    {
        var rule =
            EffectiveResourceRule(
                page,
                resource,
                eventName);

        if (rule.Conditions.Length == 0)
            return false;

        bool Matches(
            MovementSensorCondition condition) =>
            condition.Sensor is >= 1 and <= 65535 &&
            _layout.TryGetSensorState(
                (ushort)condition.Sensor,
                out var state) &&
            state == condition.State;

        return string.Equals(
                rule.Match,
                "any",
                StringComparison.Ordinal)
            ? rule.Conditions.Any(
                Matches)
            : rule.Conditions.All(
                Matches);
    }

    ushort[] EffectiveSafetySensors(
        MovementPageModel page,
        MovementPlanLegModel leg)
    {
        var ignored = page.SafetyRules
            .FirstOrDefault(x =>
                x.FromBlockId == leg.From.BlockId &&
                x.ToBlockId == leg.To.BlockId)?
            .IgnoredSensors
            .Where(x => x is >= 1 and <= 65535)
            .ToHashSet() ?? [];

        var sourceSensor = leg.From.SensorAddress;
        var sourceNode = leg.From.NodeIndex;
        var result = new HashSet<ushort>();

        foreach (var resource in leg.Resources)
        {
            var safetyResource =
                string.Equals(resource.Kind, "turnout", StringComparison.Ordinal) ||
                (string.Equals(resource.Kind, "segment", StringComparison.Ordinal) &&
                 resource.NodeIndex.HasValue &&
                 resource.NodeIndex != sourceNode);

            if (!safetyResource)
                continue;

            foreach (var detector in resource.Detectors)
            {
                if (detector is < 1 or > 65535 ||
                    detector == sourceSensor ||
                    ignored.Contains(detector))
                    continue;

                result.Add((ushort)detector);
            }
        }

        if (leg.To.SensorAddress is >= 1 and <= 65535 &&
            !ignored.Contains(leg.To.SensorAddress.Value))
            result.Add((ushort)leg.To.SensorAddress.Value);

        return result.OrderBy(x => x).ToArray();
    }

    bool SafetyFree(IEnumerable<ushort> sensors)
    {
        foreach (var sensor in sensors)
            if (!_layout.TryGetSensorState(sensor, out var on) || on)
                return false;

        return true;
    }

    async Task WaitUntil(
        Execution execution,
        Func<bool> predicate,
        string info,
        bool stopWhileWaiting = true,
        int pollMs = 75)
    {
        while (!predicate())
        {
            execution.Cancellation.Token.ThrowIfCancellationRequested();

            if (stopWhileWaiting)
            {
                execution.Moving = false;
                await ApplySpeed(
                    execution,
                    force: false);
            }

            Patch(
                execution,
                info: info,
                setInfo: true);

            await Task.Delay(
                pollMs,
                execution.Cancellation.Token);
        }
    }

    async Task ApplySpeed(
        Execution execution,
        bool force,
        CancellationToken? cancellationToken = null)
    {
        var speed =
            execution.Moving
                ? Math.Clamp(execution.DesiredSpeed, 0, 126)
                : 0;

        var live = _hubState.Locos.GetValueOrDefault(
            execution.LocoAddress,
            new(execution.LocoAddress, 0, execution.Forward, 0));

        if (!force &&
            live.Speed == speed &&
            live.Forward == execution.Forward)
            return;

        if (!await _commandCenter.SetLocoAsync(
                execution.LocoAddress,
                speed,
                execution.Forward,
                cancellationToken ??
                    execution.Cancellation.Token))
            throw new InvalidOperationException("movement_loco_command_failed");

        var updated =
            live with
            {
                Speed = speed,
                Forward = execution.Forward
            };

        _hubState.Locos[
            execution.LocoAddress] =
            updated;

        LocoChanged?.Invoke(
            updated);
    }

    void ApplyFunctionState(
        Execution execution,
        int functionNumber,
        bool active)
    {
        if (functionNumber is < 0 or > 31)
            return;

        var live =
            _hubState.Locos.GetValueOrDefault(
                execution.LocoAddress,
                new(
                    execution.LocoAddress,
                    0,
                    execution.Forward,
                    0));

        var bit =
            1u <<
            functionNumber;

        var updated =
            live with
            {
                FunctionsMask =
                    active
                        ? live.FunctionsMask |
                          bit
                        : live.FunctionsMask &
                          ~bit
            };

        _hubState.Locos[
            execution.LocoAddress] =
            updated;

        LocoChanged?.Invoke(
            updated);
    }

    async Task ArmDirection(Execution execution)
    {
        execution.Moving = false;
        await ApplySpeed(execution, force: true);
        await Task.Delay(150, execution.Cancellation.Token);
    }

    async Task PersistMovementTimingAsync(
        string pageId,
        long? startedAt,
        long? stoppedAt)
    {
        var path =
            Path.Combine(
                _env.ContentRootPath,
                "data",
                "config",
                "automations.json");

        if (!File.Exists(path))
            return;

        await _automationStorage.ExecuteAsync(
            async () =>
            {
                try
                {
                    var root =
                        JsonNode.Parse(
                            await File.ReadAllTextAsync(
                                path)) as
                            JsonObject;

                    var pages =
                        root?["movement"]?["pages"] as
                            JsonArray;

                    if (root is null ||
                        pages is null)
                        return false;

                    JsonObject? target =
                        null;

                    foreach (var node in pages)
                    {
                        if (node is not JsonObject page)
                            continue;

                        var id =
                            page["id"]?
                                .GetValue<string>();

                        if (string.Equals(
                                id,
                                pageId,
                                StringComparison.Ordinal))
                        {
                            target =
                                page;
                            break;
                        }
                    }

                    if (target is null)
                        return false;

                    target["startedAt"] =
                        startedAt.HasValue
                            ? JsonValue.Create(
                                startedAt.Value)
                            : null;

                    target["stoppedAt"] =
                        stoppedAt.HasValue
                            ? JsonValue.Create(
                                stoppedAt.Value)
                            : null;

                    var tempPath =
                        path +
                        ".movement-timing.tmp";

                    Directory.CreateDirectory(
                        Path.GetDirectoryName(
                            path)!);

                    await File.WriteAllTextAsync(
                        tempPath,
                        root.ToJsonString(
                            new JsonSerializerOptions
                            {
                                WriteIndented =
                                    false
                            }));

                    File.Move(
                        tempPath,
                        path,
                        true);

                    return true;
                }
                catch (Exception ex)
                {
                    _log.LogWarning(
                        ex,
                        "Movement timing could not be persisted for {PageId}",
                        pageId);

                    return false;
                }
            });
    }

    Dictionary<int, int> LoadFunctionBindingMap(int locoAddress)
    {
        var result = new Dictionary<int, int>();
        var path = Path.Combine(_env.ContentRootPath, "data", "config", "locos.json");

        if (!File.Exists(path))
            return result;

        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));

            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return result;

            foreach (var loco in doc.RootElement.EnumerateArray())
            {
                if (!loco.TryGetProperty("address", out var a) ||
                    !a.TryGetInt32(out var address) ||
                    address != locoAddress ||
                    !loco.TryGetProperty("functions", out var functions) ||
                    functions.ValueKind != JsonValueKind.Array)
                    continue;

                foreach (var fn in functions.EnumerateArray())
                {
                    if (!fn.TryGetProperty("bindingId", out var binding) ||
                        !binding.TryGetInt32(out var bindingId) ||
                        !fn.TryGetProperty("number", out var number) ||
                        !number.TryGetInt32(out var functionNumber))
                        continue;

                    if (bindingId > 0 && functionNumber is >= 0 and <= 68)
                        result.TryAdd(bindingId, functionNumber);
                }

                break;
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Movement could not load locomotive function bindings");
        }

        return result;
    }

    static string AudioPath(string name)
    {
        var value =
            (name ?? "")
                .Trim();

        if (value.Length == 0)
            return "";

        if (value.StartsWith(
                "/",
                StringComparison.Ordinal))
            return value;

        return
            "/sd/audio/" +
            value +
            (
                value.Contains(
                    '.')
                    ? ""
                    : ".mp3"
            );
    }

    async Task<bool> RequestAudio(
        Execution execution,
        string fileName,
        bool waitForEnd)
    {
        var requestId =
            "movement-backend:" +
            execution.Page.Id +
            ":" +
            Guid.NewGuid().ToString("N");

        if (!waitForEnd)
        {
            AudioRequested?.Invoke(
                new MovementAudioRequest(
                    requestId,
                    fileName,
                    false));

            return true;
        }

        var tcs =
            new TaskCompletionSource<bool>(
                TaskCreationOptions.RunContinuationsAsynchronously);

        if (!_pendingAudio.TryAdd(requestId, tcs))
            return false;

        using var registration =
            execution.Cancellation.Token.Register(
                () => tcs.TrySetCanceled(execution.Cancellation.Token));

        AudioRequested?.Invoke(
            new MovementAudioRequest(
                requestId,
                fileName,
                true));

        try
        {
            return await tcs.Task;
        }
        finally
        {
            _pendingAudio.TryRemove(requestId, out _);
        }
    }

    public bool CompleteAudio(
        string requestId,
        bool ok)
    {
        return _pendingAudio.TryGetValue(requestId, out var pending) &&
               pending.TrySetResult(ok);
    }

    public void FailPendingAudio()
    {
        foreach (var pending in _pendingAudio.Values)
            pending.TrySetResult(false);
    }


    async Task<string?> AcquireActionTurnoutLock(
        Execution execution,
        ushort address,
        bool required)
    {
        if (!required)
            return null;

        var ownerId =
            "movement-action:" +
            execution.Page.Id +
            ":" +
            Guid.NewGuid().ToString("N");

        var lease =
            await _switchMan.AcquireAsync(
                [address],
                ownerId,
                "Movement action: " +
                    execution.Page.Name,
                0,
                execution.Cancellation.Token);

        if (!lease.Ok)
            throw new InvalidOperationException(
                lease.Error ??
                "movement_action_turnout_locked");

        return ownerId;
    }

    async Task SetBasicAccessoryAction(
        Execution execution,
        int rawAddress,
        bool active)
    {
        var address =
            (ushort)Math.Clamp(
                rawAddress,
                1,
                2048);

        var turnout =
            _layout.FindAccessory(
                RuntimeAccessoryKind.Turnout,
                address);

        var lockOwner =
            await AcquireActionTurnoutLock(
                execution,
                address,
                turnout is not null &&
                !turnout.TurnoutExtended &&
                !turnout.TurnoutVPin);

        try
        {
            if (!await _commandCenter.SetAccessoryAsync(
                    address,
                    active,
                    execution.Cancellation.Token))
                throw new InvalidOperationException(
                    "movement_accessory_command_failed");

            _layout.SetAccessory(
                address,
                active);
        }
        finally
        {
            if (lockOwner is not null)
                _switchMan.ReleaseOwned(
                    [address],
                    lockOwner);
        }
    }

    async Task SetExtendedAccessoryAction(
        Execution execution,
        int rawAddress,
        int rawAspect)
    {
        var address =
            (ushort)Math.Clamp(
                rawAddress,
                1,
                2048);

        var aspect =
            Math.Clamp(
                rawAspect,
                0,
                255);

        var turnout =
            _layout.FindAccessory(
                RuntimeAccessoryKind.Turnout,
                address);

        var lockOwner =
            await AcquireActionTurnoutLock(
                execution,
                address,
                turnout?.TurnoutExtended ==
                    true);

        try
        {
            if (!await _commandCenter.SetSignalAspectAsync(
                    address,
                    aspect,
                    execution.Cancellation.Token))
                throw new InvalidOperationException(
                    "movement_extended_accessory_command_failed");

            _layout.SetSignal(
                address,
                aspect);
        }
        finally
        {
            if (lockOwner is not null)
                _switchMan.ReleaseOwned(
                    [address],
                    lockOwner);
        }
    }

    int ResolveFunctionNumber(
        Execution execution,
        MovementActionModel action)
    {
        if (!action.FunctionBindingId.HasValue)
            return Math.Clamp(
                action.FunctionNumber,
                0,
                68);

        if (!execution.FunctionNumbersByBindingId.TryGetValue(
                action.FunctionBindingId.Value,
                out var functionNumber))
            throw new InvalidOperationException(
                "movement_function_binding_not_found:" +
                action.FunctionBindingId.Value);

        return Math.Clamp(
            functionNumber,
            0,
            68);
    }

    async Task ExecuteAction(
        Execution execution,
        MovementActionModel action)
    {
        execution.Cancellation.Token.ThrowIfCancellationRequested();

        switch (action.Kind)
        {
            case "speed":
                execution.DesiredSpeed = Math.Clamp(action.Speed, 0, 126);
                Patch(
                    execution,
                    desiredSpeed: execution.DesiredSpeed);
                await ApplySpeed(execution, force: true);
                return;

            case "function":
                {
                    var fn =
                        ResolveFunctionNumber(
                            execution,
                            action);

                    if (!await _commandCenter.SetLocoFunctionAsync(
                            execution.LocoAddress,
                            fn,
                            action.FunctionActive,
                            execution.Cancellation.Token))
                        throw new InvalidOperationException("movement_function_command_failed");

                    ApplyFunctionState(
                        execution,
                        fn,
                        action.FunctionActive);

                    return;
                }

            case "horn":
                {
                    var fn =
                        ResolveFunctionNumber(
                            execution,
                            action);

                    if (!await _commandCenter.SetLocoFunctionAsync(
                            execution.LocoAddress,
                            fn,
                            true,
                            execution.Cancellation.Token))
                        throw new InvalidOperationException("movement_horn_on_failed");

                    ApplyFunctionState(
                        execution,
                        fn,
                        true);

                    try
                    {
                        await Task.Delay(
                            Math.Clamp(action.PulseMs, 1, 600000),
                            execution.Cancellation.Token);
                    }
                    finally
                    {
                        if (await _commandCenter.SetLocoFunctionAsync(
                                execution.LocoAddress,
                                fn,
                                false,
                                CancellationToken.None))
                            ApplyFunctionState(
                                execution,
                                fn,
                                false);
                    }

                    return;
                }

            case "delay":
                await Task.Delay(
                    Math.Clamp(action.DelayMs, 0, 600000),
                    execution.Cancellation.Token);
                return;

            case "randomDelay":
                {
                    var min = Math.Clamp(Math.Min(action.MinDelayMs, action.MaxDelayMs), 0, 600000);
                    var max = Math.Clamp(Math.Max(action.MinDelayMs, action.MaxDelayMs), min, 600000);
                    var ms = Random.Shared.Next(min, max + 1);
                    await Task.Delay(ms, execution.Cancellation.Token);
                    return;
                }

            case "playAudio":
                {
                    var path = AudioPath(action.AudioName);
                    if (path.Length == 0)
                        return;

                    if (!await RequestAudio(
                            execution,
                            path,
                            action.AudioWaitForEnd))
                        throw new InvalidOperationException("movement_audio_failed");

                    return;
                }

            case "randomPlay":
                {
                    var roll =
                        Random.Shared.Next(
                            1,
                            11);

                    var threshold =
                        Math.Clamp(
                            (int)Math.Round(
                                action.RandomPlayChancePercent /
                                10d,
                                MidpointRounding.AwayFromZero),
                            1,
                            9);

                    if (roll > threshold)
                    {
                        Patch(
                            execution,
                            info:
                                "Random audio skipped: " +
                                roll +
                                "/" +
                                threshold,
                            setInfo:
                                true);

                        return;
                    }

                    Patch(
                        execution,
                        info:
                            "Random audio playing: " +
                            roll +
                            "/" +
                            threshold,
                        setInfo:
                            true);

                    var path =
                        AudioPath(
                            action.AudioName);

                    if (path.Length == 0)
                        return;

                    if (!await RequestAudio(
                            execution,
                            path,
                            action.AudioWaitForEnd))
                        throw new InvalidOperationException(
                            "movement_audio_failed");

                    return;
                }

            case "setAccessory":
                await SetBasicAccessoryAction(
                    execution,
                    action.AccessoryAddress,
                    action.AccessoryActive);
                return;

            case "setExtendedAccessory":
                await SetExtendedAccessoryAction(
                    execution,
                    action.AccessoryAddress,
                    action.AccessoryAspect);
                return;

            case "log":
                _log.LogInformation(
                    "Movement {Movement}: {Message}",
                    execution.Page.Name,
                    action.Message);
                return;
        }
    }

    async Task RunActionSequence(
        Execution execution,
        IEnumerable<MovementActionModel> actions)
    {
        foreach (var action in actions)
            await ExecuteAction(execution, action);
    }

    async Task RunActions(
        Execution execution,
        string resourceKey,
        string when)
    {
        var matching = execution.Page.Actions
            .Where(x =>
                string.Equals(x.ResourceKey, resourceKey, StringComparison.Ordinal) &&
                string.Equals(x.When, when, StringComparison.Ordinal))
            .ToArray();

        var sequenceOrder = new List<string>();
        var groups = new Dictionary<string, List<MovementActionModel>>(StringComparer.Ordinal);
        var modes = new Dictionary<string, string>(StringComparer.Ordinal);

        foreach (var action in matching)
        {
            var id = string.IsNullOrWhiteSpace(action.SequenceId)
                ? "legacy:" + resourceKey + ":" + when
                : action.SequenceId;

            if (!groups.TryGetValue(id, out var items))
            {
                items = [];
                groups[id] = items;
                modes[id] = action.SequenceMode;
                sequenceOrder.Add(id);
            }

            items.Add(action);
        }

        foreach (var id in sequenceOrder)
        {
            var items = groups[id];

            if (string.Equals(modes[id], "background", StringComparison.Ordinal))
            {
                var task = RunActionSequence(execution, items)
                    .ContinueWith(
                        t =>
                        {
                            if (t.IsFaulted)
                                _log.LogError(
                                    t.Exception,
                                    "Movement background sequence failed: {Movement}",
                                    execution.Page.Name);
                        },
                        CancellationToken.None,
                        TaskContinuationOptions.ExecuteSynchronously,
                        TaskScheduler.Default);

                execution.BackgroundTasks.Add(task);
            }
            else
            {
                await RunActionSequence(execution, items);
            }
        }
    }

    bool ArmResourceLeave(
        Execution execution,
        MovementPlanResourceModel resource)
    {
        execution.ResourceLeaveFired.Remove(
            resource.Key);

        var rule =
            EffectiveResourceRule(
                execution.Page,
                resource,
                "leave");

        if (rule.Conditions.Length == 0)
            return false;

        execution.ResourceLeaves[
            resource.Key] =
            new ResourceLeaveState
            {
                Resource =
                    resource
            };

        return true;
    }

    async Task DrainReadyResourceLeaves(
        Execution execution)
    {
        var ready =
            execution.ResourceLeaves
                .Where(pair =>
                    ResourceEventSatisfied(
                        execution.Page,
                        pair.Value.Resource,
                        "leave"))
                .Select(pair =>
                    pair.Key)
                .ToArray();

        foreach (var key in ready)
        {
            if (!execution.ResourceLeaves.Remove(
                    key,
                    out var state))
                continue;

            execution.ResourceLeaveFired.Add(
                key);

            await RunActions(
                execution,
                state.Resource.Key,
                "leave");
        }
    }

    async Task RunLegacyResourceLeaveIfNeeded(
        Execution execution,
        MovementPlanResourceModel resource)
    {
        await DrainReadyResourceLeaves(
            execution);

        if (execution.ResourceLeaveFired.Contains(
                resource.Key) ||
            execution.ResourceLeaves.ContainsKey(
                resource.Key))
            return;

        execution.ResourceLeaveFired.Add(
            resource.Key);

        await RunActions(
            execution,
            resource.Key,
            "leave");
    }

    async Task WaitResourceEntry(
        Execution execution,
        MovementPlanLegModel leg,
        MovementPlanResourceModel resource,
        BlockLeaveState blockLeaveState,
        BlockApproachState blockApproachState)
    {
        var eventName =
            string.Equals(resource.Kind, "turnout", StringComparison.Ordinal)
                ? "approach"
                : "enter";

        var rule =
            EffectiveResourceRule(
                execution.Page,
                resource,
                eventName);

        if (rule.Conditions.Length == 0)
            return;

        while (!ResourceEventSatisfied(
                   execution.Page,
                   resource,
                   eventName))
        {
            execution.Cancellation.Token.ThrowIfCancellationRequested();

            await DrainReadyResourceLeaves(
                execution);

            await MaybeRunBlockLeave(
                execution,
                leg,
                blockLeaveState);

            await MaybeRunBlockApproach(
                execution,
                leg,
                blockApproachState);

            Patch(
                execution,
                info:
                    "Waiting for " +
                    resource.Name,
                setInfo:
                    true);

            await Task.Delay(
                75,
                execution.Cancellation.Token);
        }
    }

    BlockLeaveState CreateBlockLeaveState(
        MovementPlanLegModel leg)
    {
        var sensor =
            leg.From.SensorAddress;

        return new BlockLeaveState
        {
            SeenOccupied =
                sensor is >= 1 and <= 65535 &&
                _layout.TryGetSensorState(
                    (ushort)sensor.Value,
                    out var occupied) &&
                occupied,
            Fired =
                false
        };
    }

    void EvaluateNextLegTurnoutAvailability(
        Execution execution,
        MovementPlanLegModel leg,
        BlockApproachState state)
    {
        state.NextLegTurnoutBlocked =
            false;

        state.BlockingTurnout =
            null;

        state.BlockingOwnerName =
            null;

        var next =
            execution.Plan.Legs.ElementAtOrDefault(
                leg.Index + 1);

        if (next is null)
            return;

        var ownOwnerPrefix =
            "movement:" +
            execution.Page.Id +
            ":leg:";

        foreach (var requirement in
                 next.TurnoutStates)
        {
            if (!_switchMan.IsLocked(
                    requirement.Address,
                    out var lockInfo) ||
                lockInfo is null)
                continue;

            if (lockInfo.OwnerId.StartsWith(
                    ownOwnerPrefix,
                    StringComparison.Ordinal))
                continue;

            state.NextLegTurnoutBlocked =
                true;

            state.BlockingTurnout =
                requirement.Address;

            state.BlockingOwnerName =
                lockInfo.OwnerName;

            Patch(
                execution,
                info:
                    "Next leg blocked by turnout #" +
                    requirement.Address +
                    " owned by " +
                    lockInfo.OwnerName +
                    "; train will stop at " +
                    leg.To.Name,
                setInfo:
                    true);

            return;
        }
    }

    async Task WaitBlockEventDelay(
        Execution execution,
        int delayMs,
        string label)
    {
        var remaining =
            Math.Clamp(
                delayMs,
                0,
                600000);

        if (remaining <= 0)
            return;

        Patch(
            execution,
            info:
                label +
                " delay: " +
                remaining +
                " ms",
            setInfo:
                true);

        while (remaining > 0)
        {
            execution.Cancellation.Token.ThrowIfCancellationRequested();

            var slice =
                Math.Min(
                    remaining,
                    100);

            await Task.Delay(
                slice,
                execution.Cancellation.Token);

            remaining -=
                slice;
        }
    }

    async Task MaybeRunBlockApproach(
        Execution execution,
        MovementPlanLegModel leg,
        BlockApproachState state)
    {
        if (state.Fired ||
            leg.ApproachWhen.Length == 0 ||
            !ConditionsSatisfied(
                leg.ApproachWhen))
            return;

        state.Fired =
            true;

        await WaitBlockEventDelay(
            execution,
            leg.ApproachDelayMs,
            "Approach " +
            leg.To.Name);

        EvaluateNextLegTurnoutAvailability(
            execution,
            leg,
            state);

        await RunActions(
            execution,
            leg.To.Key,
            "approach");

        Patch(
            execution,
            info:
                "Approaching: " +
                leg.To.Name,
            setInfo:
                true);
    }

    async Task MaybeRunBlockLeave(
        Execution execution,
        MovementPlanLegModel leg,
        BlockLeaveState state)
    {
        if (state.Fired ||
            leg.LeaveWhen.Length == 0)
            return;

        if (leg.LeaveWhenExplicit)
        {
            if (!ConditionsSatisfied(
                    leg.LeaveWhen))
                return;
        }
        else
        {
            var sensor =
                leg.From.SensorAddress;

            if (sensor is null ||
                sensor is < 1 or > 65535)
                return;

            if (!_layout.TryGetSensorState(
                    (ushort)sensor.Value,
                    out var occupied))
                return;

            if (occupied)
            {
                state.SeenOccupied =
                    true;
                return;
            }

            if (!state.SeenOccupied)
                return;
        }

        state.Fired =
            true;

        await WaitBlockEventDelay(
            execution,
            leg.LeaveDelayMs,
            "Leave " +
            leg.From.Name);

        await RunActions(
            execution,
            leg.From.Key,
            "leave");

        Patch(
            execution,
            info:
                "Left block: " +
                leg.From.Name,
            setInfo:
                true);
    }

    async Task WaitForBlockLeave(
        Execution execution,
        MovementPlanLegModel leg,
        BlockLeaveState state)
    {
        if (state.Fired ||
            leg.LeaveWhen.Length == 0)
            return;

        while (!state.Fired)
        {
            execution.Cancellation.Token.ThrowIfCancellationRequested();

            await DrainReadyResourceLeaves(
                execution);

            await MaybeRunBlockLeave(
                execution,
                leg,
                state);

            if (state.Fired)
                return;

            Patch(
                execution,
                info:
                    "Waiting to leave " +
                    leg.From.Name,
                setInfo:
                    true);

            await Task.Delay(
                100,
                execution.Cancellation.Token);
        }
    }

    async Task RunBlockLeaveFallback(
        Execution execution,
        MovementPlanLegModel leg,
        BlockLeaveState state)
    {
        if (state.Fired)
            return;

        state.Fired =
            true;

        await RunActions(
            execution,
            leg.From.Key,
            "leave");

        Patch(
            execution,
            info:
                "Left block: " +
                leg.From.Name,
            setInfo:
                true);
    }

    bool TargetBlockBasicallyFree(
        MovementPlanLegModel leg)
    {
        if (leg.To.BlockId is null)
            return false;

        var block =
            Block(
                leg.To.BlockId.Value);

        /*
         * Simple baseline rule: the target may be used only when it has no
         * real locomotive and no target marker from anybody else.
         */
        return block is not null &&
               block.LocoAddress == 0 &&
               string.IsNullOrEmpty(
                   block.LocoId);
    }

    static bool HasBlockingAction(
        MovementPageModel page,
        string resourceKey,
        string when) =>
        page.Actions.Any(action =>
            string.Equals(
                action.ResourceKey,
                resourceKey,
                StringComparison.Ordinal) &&
            string.Equals(
                action.When,
                when,
                StringComparison.Ordinal) &&
            string.Equals(
                action.SequenceMode,
                "blocking",
                StringComparison.Ordinal));

    async Task WaitPreDepartureAvailability(
        Execution execution,
        MovementPlanLegModel leg)
    {
        var sensors =
            EffectiveSafetySensors(
                execution.Page,
                leg);

        await WaitUntil(
            execution,
            () =>
                TargetBlockBasicallyFree(
                    leg) &&
                SafetyFree(
                    sensors),
            "Waiting for next leg availability",
            stopWhileWaiting:
                true,
            pollMs:
                150);
    }

    static bool RetryableDispatcherFailure(
        DispatcherAcquireResult result)
    {
        if (result.BlockingSensor.HasValue ||
            result.BlockingBlock.HasValue &&
            string.Equals(
                result.Error,
                "destination_block_busy",
                StringComparison.Ordinal))
            return true;

        var error =
            result.Error ??
            "";

        return
            string.Equals(
                error,
                "safety_sensor_not_free",
                StringComparison.Ordinal) ||
            string.Equals(
                error,
                "destination_block_busy",
                StringComparison.Ordinal) ||
            string.Equals(
                error,
                "turnout_locked",
                StringComparison.Ordinal) ||
            string.Equals(
                error,
                "turnout_lock_timeout",
                StringComparison.Ordinal) ||
            error.StartsWith(
                "dispatcher_resource_locked:",
                StringComparison.Ordinal);
    }

    async Task<DispatcherLegLeaseInfo> AcquireLeg(
        Execution execution,
        MovementPlanLegModel leg)
    {
        if (leg.From.BlockId is null ||
            leg.To.BlockId is null)
            throw new InvalidOperationException("movement_leg_block_missing");

        var ownerId =
            "movement:" +
            execution.Page.Id +
            ":leg:" +
            leg.Index +
            ":" +
            Guid.NewGuid().ToString("N");

        while (true)
        {
            execution.Cancellation.Token.ThrowIfCancellationRequested();

            var result =
                await _dispatcher.AcquireLegAsync(
                    new DispatcherLegRequest(
                        ownerId,
                        "Movement: " + execution.Page.Name,
                        (ushort)execution.LocoAddress,
                        (ushort)leg.From.BlockId.Value,
                        (ushort)leg.To.BlockId.Value,
                        leg.TurnoutStates,
                        EffectiveSafetySensors(
                            execution.Page,
                            leg),
                        leg.Resources
                            .Where(resource =>
                                string.Equals(
                                    resource.Kind,
                                    "segment",
                                    StringComparison.Ordinal))
                            .Select(resource =>
                                "segment:" +
                                resource.Name)
                            .Distinct(
                                StringComparer.Ordinal)
                            .OrderBy(
                                key => key,
                                StringComparer.Ordinal)
                            .ToArray(),
                        0),
                    execution.Cancellation.Token);

            if (result.Ok && result.Lease is not null)
            {
                execution.TargetBlockId = leg.To.BlockId;

                Patch(
                    execution,
                    info:
                        "Route authority acquired to " +
                        leg.To.Name,
                    setInfo:
                        true);

                return result.Lease;
            }

            if (!RetryableDispatcherFailure(
                    result))
                throw new InvalidOperationException(
                    result.Error ??
                    "dispatcher_acquire_failed");

            execution.Moving = false;
            await ApplySpeed(execution, force: false);

            Patch(
                execution,
                info:
                    result.BlockingSensor.HasValue
                        ? "Waiting for safety sensor #" + result.BlockingSensor.Value
                        : result.BlockingBlock.HasValue
                            ? "Waiting for block " + result.BlockingBlock.Value
                            : result.Error == "turnout_locked"
                                ? "Waiting for turnout lock"
                                : "Waiting for route authority",
                setInfo: true);

            await Task.Delay(
                150,
                execution.Cancellation.Token);
        }
    }

    async Task WaitForHeldLegReady(
        Execution execution,
        DispatcherLegLeaseInfo lease,
        MovementPlanLegModel leg)
    {
        while (true)
        {
            execution.Cancellation.Token.ThrowIfCancellationRequested();

            var authority =
                _dispatcher.ValidateHeldLeg(
                    lease.OwnerId);

            if (authority.Ok)
                return;

            if (!string.Equals(
                    authority.Error,
                    "safety_sensor_not_free",
                    StringComparison.Ordinal))
                throw new InvalidOperationException(
                    authority.Error ??
                    "movement_authority_lost_before_departure");

            execution.Moving =
                false;

            await ApplySpeed(
                execution,
                force:
                    false);

            Patch(
                execution,
                info:
                    authority.BlockingSensor.HasValue
                        ? "Waiting for safety sensor #" +
                          authority.BlockingSensor.Value +
                          " before departure"
                        : "Waiting for held route safety before departure",
                setInfo:
                    true);

            await Task.Delay(
                100,
                execution.Cancellation.Token);
        }
    }

    async Task TraverseLeg(
        Execution execution,
        MovementPlanLegModel leg)
    {
        execution.CurrentBlockId = leg.From.BlockId;

        Patch(
            execution,
            currentResourceKey: leg.From.Key,
            setCurrentResource: true,
            activeRouteResourceKey: leg.From.Key,
            setActiveRoute: true);

        execution.PreparedLegLeases.Remove(
            leg.Index,
            out var preparedLease);

        if (leg.DepartWhen.Length > 0)
        {
            await WaitUntil(
                execution,
                () => ConditionsSatisfied(leg.DepartWhen),
                "Waiting for departure condition at " + leg.From.Name);
        }

        /*
         * BEFORE DEPART intentionally runs before route authority is acquired
         * for normal/station starts. A through leg may already have been
         * prepared at the previous ARRIVED boundary; that fast path is only
         * used when there is no blocking ARRIVED/BEFORE DEPART sequence.
         */
        if (preparedLease is null)
        {
            await WaitPreDepartureAvailability(
                execution,
                leg);
        }

        await RunActions(
            execution,
            leg.From.Key,
            "beforeDepart");

        /*
         * Keep rolling while acquiring/setting the next leg when the simple
         * movement authority is already clear. The dispatcher still validates
         * the destination block, every effective safety sensor, resource
         * ownership and turnout ownership before granting the lease.
         */
        var lease =
            preparedLease ??
            await AcquireLeg(
                execution,
                leg);

        try
        {
            if (leg.DepartWhen.Length > 0)
            {
                await WaitUntil(
                    execution,
                    () => ConditionsSatisfied(leg.DepartWhen),
                    "Waiting for departure condition at " + leg.From.Name);
            }

            await RunActions(
                execution,
                leg.From.Key,
                "depart");

            await WaitForHeldLegReady(
                execution,
                lease,
                leg);

            execution.Moving = true;
            await ApplySpeed(execution, force: true);

            if (!execution.MotionStartedPublished &&
                execution.DesiredSpeed > 0)
            {
                execution.MotionStartedPublished = true;
                MotionStarted?.Invoke(
                    execution.Page.Id,
                    NowMs());
            }

            var blockApproachState =
                new BlockApproachState();

            await MaybeRunBlockApproach(
                execution,
                leg,
                blockApproachState);

            var approachSegments =
                leg.Resources
                    .Where(resource =>
                        string.Equals(
                            resource.Kind,
                            "segment",
                            StringComparison.Ordinal))
                    .ToArray();

            var approachSegment =
                approachSegments.LastOrDefault();

            if (approachSegment is null &&
                leg.ApproachWhen.Length == 0)
            {
                EvaluateNextLegTurnoutAvailability(
                    execution,
                    leg,
                    blockApproachState);

                await RunActions(
                    execution,
                    leg.To.Key,
                    "approach");

                blockApproachState.Fired =
                    true;
            }

            var blockLeaveState =
                CreateBlockLeaveState(
                    leg);

            MovementPlanResourceModel? previousSegment =
                execution.Plan.Resources.FirstOrDefault(resource =>
                    string.Equals(resource.Kind, "segment", StringComparison.Ordinal) &&
                    resource.NodeIndex == leg.From.NodeIndex);

            var pendingTurnouts =
                new List<MovementPlanResourceModel>();

            foreach (var resource in leg.Resources)
            {
                execution.Cancellation.Token.ThrowIfCancellationRequested();

                await WaitResourceEntry(
                    execution,
                    leg,
                    resource,
                    blockLeaveState,
                    blockApproachState);

                Patch(
                    execution,
                    activeRouteResourceKey: resource.Key,
                    setActiveRoute: true);

                if (string.Equals(resource.Kind, "turnout", StringComparison.Ordinal))
                {
                    ArmResourceLeave(
                        execution,
                        resource);

                    await RunActions(
                        execution,
                        resource.Key,
                        "approach");

                    pendingTurnouts.Add(
                        resource);
                }
                else if (string.Equals(resource.Kind, "segment", StringComparison.Ordinal))
                {
                    ArmResourceLeave(
                        execution,
                        resource);

                    await DrainReadyResourceLeaves(
                        execution);

                    foreach (var turnout in pendingTurnouts.ToArray())
                    {
                        await RunLegacyResourceLeaveIfNeeded(
                            execution,
                            turnout);
                    }

                    pendingTurnouts.Clear();

                    if (previousSegment is not null &&
                        !string.Equals(
                            previousSegment.Key,
                            resource.Key,
                            StringComparison.Ordinal))
                    {
                        await RunLegacyResourceLeaveIfNeeded(
                            execution,
                            previousSegment);
                    }

                    await RunActions(
                        execution,
                        resource.Key,
                        "enter");

                    previousSegment =
                        resource;
                }

                await MaybeRunBlockLeave(
                    execution,
                    leg,
                    blockLeaveState);

                await MaybeRunBlockApproach(
                    execution,
                    leg,
                    blockApproachState);

                if (!blockApproachState.Fired &&
                    leg.ApproachWhen.Length == 0 &&
                    string.Equals(
                        approachSegment?.Key,
                        resource.Key,
                        StringComparison.Ordinal))
                {
                    EvaluateNextLegTurnoutAvailability(
                        execution,
                        leg,
                        blockApproachState);

                    await RunActions(
                        execution,
                        leg.To.Key,
                        "approach");

                    blockApproachState.Fired =
                        true;
                }
            }

            if (leg.ArrivedWhen.Length == 0)
                throw new InvalidOperationException(
                    "movement_destination_has_no_arrival_condition");

            while (!ArrivalSatisfied(
                       leg))
            {
                execution.Cancellation.Token.ThrowIfCancellationRequested();

                await DrainReadyResourceLeaves(
                    execution);

                await MaybeRunBlockLeave(
                    execution,
                    leg,
                    blockLeaveState);

                await MaybeRunBlockApproach(
                    execution,
                    leg,
                    blockApproachState);

                Patch(
                    execution,
                    info:
                        "Waiting for arrival at " +
                        leg.To.Name,
                    setInfo:
                        true);

                await Task.Delay(
                    100,
                    execution.Cancellation.Token);
            }

            await WaitBlockEventDelay(
                execution,
                leg.ArrivedDelayMs,
                "Arrived " +
                leg.To.Name);

            var finalLegForMeasurement =
                ReferenceEquals(
                    execution.Plan.Legs.LastOrDefault(),
                    leg) ||
                leg.Index ==
                    execution.Plan.Legs.Length - 1;

            if (finalLegForMeasurement)
                DestinationArrived?.Invoke(
                    execution.Page.Id,
                    NowMs());

            await DrainReadyResourceLeaves(
                execution);

            await MaybeRunBlockLeave(
                execution,
                leg,
                blockLeaveState);

            await MaybeRunBlockApproach(
                execution,
                leg,
                blockApproachState);

            Patch(
                execution,
                activeRouteResourceKey: leg.To.Key,
                setActiveRoute: true);

            var destinationCommitted =
                false;

            var finalLeg =
                ReferenceEquals(
                    execution.Plan.Legs.LastOrDefault(),
                    leg) ||
                leg.Index == execution.Plan.Legs.Length - 1;

            if (finalLeg)
            {
                // ARRIVED blocking actions are allowed to roll the train a bit
                // farther before the automatic final stop.
                await RunActions(
                    execution,
                    leg.To.Key,
                    "arrived");

                execution.Moving = false;
                execution.DesiredSpeed = 0;

                Patch(
                    execution,
                    desiredSpeed: 0);

                await ApplySpeed(execution, force: true);
            }
            else
            {
                var next =
                    execution.Plan.Legs.ElementAtOrDefault(
                        leg.Index + 1);

                /*
                 * Commit ARRIVED immediately. This deliberately decouples
                 * next-leg preparation from the previous block's LEAVE edge:
                 * the train may already be safely inside B1 while A1's leave
                 * detector/action is still catching up.
                 */
                if (leg.To.BlockId is >= 1 and <= 65535)
                {
                    if (!_layout.SetBlock(
                            (ushort)leg.To.BlockId.Value,
                            "",
                            (ushort)execution.LocoAddress))
                        throw new InvalidOperationException(
                            "movement_destination_commit_failed");

                    execution.CurrentBlockId =
                        leg.To.BlockId;

                    execution.TargetBlockId =
                        null;

                    destinationCommitted =
                        true;
                }

                /*
                 * The committed destination is now the source of the next leg,
                 * so release the old leg before trying to reserve it again.
                 */
                _dispatcher.ReleaseLeg(
                    lease.OwnerId);

                var mayKeepRolling =
                    next is not null &&
                    !blockApproachState.NextLegTurnoutBlocked &&
                    next.DepartWhen.Length == 0 &&
                    TargetBlockBasicallyFree(
                        next) &&
                    SafetyFree(
                        EffectiveSafetySensors(
                            execution.Page,
                            next));

                execution.DesiredSpeed =
                    execution.Page.Speed;

                execution.Moving =
                    mayKeepRolling;

                Patch(
                    execution,
                    desiredSpeed:
                        execution.DesiredSpeed);

                await ApplySpeed(
                    execution,
                    force: true);

                /*
                 * Fast through-block preparation. Do not pre-hold the next
                 * route across a blocking ARRIVED or BEFORE DEPART sequence;
                 * that preserves station dwell semantics.
                 */
                if (mayKeepRolling &&
                    next is not null &&
                    !HasBlockingAction(
                        execution.Page,
                        leg.To.Key,
                        "arrived") &&
                    !HasBlockingAction(
                        execution.Page,
                        next.From.Key,
                        "beforeDepart"))
                {
                    var nextLease =
                        await AcquireLeg(
                            execution,
                            next);

                    execution.PreparedLegLeases[
                        next.Index] =
                        nextLease;

                    Patch(
                        execution,
                        info:
                            "Next leg prepared: " +
                            next.From.Name +
                            " -> " +
                            next.To.Name,
                        setInfo:
                            true);
                }

                await RunActions(
                    execution,
                    leg.To.Key,
                    "arrived");
            }

            await MaybeRunBlockLeave(
                execution,
                leg,
                blockLeaveState);

            await WaitForBlockLeave(
                execution,
                leg,
                blockLeaveState);

            foreach (var turnout in pendingTurnouts.ToArray())
            {
                await RunLegacyResourceLeaveIfNeeded(
                    execution,
                    turnout);
            }

            pendingTurnouts.Clear();

            if (previousSegment is not null)
            {
                await RunLegacyResourceLeaveIfNeeded(
                    execution,
                    previousSegment);
            }

            await DrainReadyResourceLeaves(
                execution);

            if (leg.LeaveWhen.Length == 0)
            {
                await RunBlockLeaveFallback(
                    execution,
                    leg,
                    blockLeaveState);
            }

            if (leg.From.BlockId is >= 1 and <= 65535)
                _layout.RemoveBlock(
                    (ushort)leg.From.BlockId.Value);

            await RunActions(
                execution,
                leg.From.Key,
                "afterLeave");

            if (!destinationCommitted &&
                leg.To.BlockId is >= 1 and <= 65535)
            {
                if (!_layout.SetBlock(
                        (ushort)leg.To.BlockId.Value,
                        "",
                        (ushort)execution.LocoAddress))
                    throw new InvalidOperationException(
                        "movement_destination_commit_failed");

                execution.CurrentBlockId =
                    leg.To.BlockId;

                execution.TargetBlockId =
                    null;
            }

            Patch(
                execution,
                info: "Arrived: " + leg.To.Name,
                setInfo: true);
        }
        finally
        {
            _dispatcher.ReleaseLeg(
                lease.OwnerId);

            /*
             * When ARRIVED already prepared the next leg, keep that target
             * visible/authoritative. The next TraverseLeg owns clearing it.
             */
            if (execution.PreparedLegLeases.Count == 0)
                execution.TargetBlockId =
                    null;
        }
    }

    async Task RunExecution(Execution execution)
    {
        try
        {
            await ArmDirection(execution);

            await RunActions(
                execution,
                "movement",
                "start");

            foreach (var leg in execution.Plan.Legs)
                await TraverseLeg(execution, leg);

            await DrainReadyResourceLeaves(
                execution);

            execution.Moving = false;
            execution.DesiredSpeed = 0;
            await ApplySpeed(execution, force: true);

            await RunActions(
                execution,
                "movement",
                "complete");

            if (!execution.BackgroundTasks.IsEmpty)
                await Task.WhenAll(
                    execution.BackgroundTasks.ToArray());

            var stoppedAt = NowMs();

            Publish(
                execution,
                execution.State with
                {
                    Status = "idle",
                    StoppedAt = stoppedAt,
                    DesiredSpeed = 0,
                    Moving = false,
                    CurrentBlockId = execution.CurrentBlockId,
                    TargetBlockId = null,
                    CurrentResourceKey = null,
                    ActiveRouteResourceKey = null,
                    Info = "Movement completed",
                    Error = null
                });
        }
        catch (OperationCanceledException)
        {
            execution.Moving = false;
            execution.DesiredSpeed = 0;

            try
            {
                await ApplySpeed(
                    execution,
                    force: true,
                    cancellationToken:
                        CancellationToken.None);
            }
            catch
            {
            }

            Publish(
                execution,
                execution.State with
                {
                    Status = "idle",
                    StoppedAt = NowMs(),
                    DesiredSpeed = 0,
                    Moving = false,
                    CurrentBlockId = execution.CurrentBlockId,
                    TargetBlockId = null,
                    CurrentResourceKey = null,
                    ActiveRouteResourceKey = null,
                    Info = execution.EmergencyAbort
                        ? "Movement aborted"
                        : "Movement stopped",
                    Error = null
                });
        }
        catch (Exception ex)
        {
            execution.Moving = false;
            execution.DesiredSpeed = 0;

            try
            {
                await ApplySpeed(
                    execution,
                    force: true,
                    cancellationToken:
                        CancellationToken.None);
            }
            catch
            {
            }

            _log.LogError(
                ex,
                "Movement {Movement} failed",
                execution.Page.Name);

            Publish(
                execution,
                execution.State with
                {
                    Status = "error",
                    StoppedAt = NowMs(),
                    DesiredSpeed = 0,
                    Moving = false,
                    CurrentBlockId = execution.CurrentBlockId,
                    TargetBlockId = execution.TargetBlockId,
                    ActiveRouteResourceKey = null,
                    Info = "Movement failed",
                    Error = ex.Message
                });
        }
        finally
        {
            foreach (var prepared in
                     execution.PreparedLegLeases.Values.ToArray())
                _dispatcher.ReleaseLeg(
                    prepared.OwnerId);

            execution.PreparedLegLeases.Clear();

            await PersistMovementTimingAsync(
                execution.Page.Id,
                execution.State.StartedAt,
                execution.State.StoppedAt);

            lock (_gate)
                _executions.Remove(
                    execution.Page.Id);

            execution.Cancellation.Dispose();
        }
    }

    static MovementPageModel NormalizeSavedPage(
        MovementPageModel page)
    {
        page.Id =
            (page.Id ?? "")
                .Trim();

        page.Name =
            string.IsNullOrWhiteSpace(
                page.Name)
                ? "Movement"
                : page.Name.Trim();

        page.Speed =
            Math.Clamp(
                page.Speed,
                0,
                126);

        page.RouteKey =
            (page.RouteKey ?? "")
                .Trim();

        page.ViaBlockIds =
            (page.ViaBlockIds ?? [])
                .Where(id =>
                    id is >= 1 and <= 65535)
                .Distinct()
                .ToArray();

        page.BlockRules ??= [];
        page.ResourceEventRules ??= [];
        page.SafetyRules ??= [];
        page.Actions ??= [];

        foreach (var rule in page.BlockRules)
        {
            rule.ApproachWhen ??= [];
            rule.ArrivedWhen ??= [];
            rule.DepartWhen ??= [];
            rule.LeaveWhen ??= [];
        }

        foreach (var rule in page.ResourceEventRules)
            rule.Conditions ??= [];

        foreach (var rule in page.SafetyRules)
            rule.IgnoredSensors ??= [];

        return page;
    }

    MovementPageModel? LoadSavedMovementPage(
        string pageId)
    {
        if (string.IsNullOrWhiteSpace(
                pageId))
            return null;

        var path =
            Path.Combine(
                _env.ContentRootPath,
                "data",
                "config",
                "automations.json");

        if (!File.Exists(path))
            return null;

        try
        {
            using var document =
                JsonDocument.Parse(
                    File.ReadAllText(
                        path));

            var root =
                document.RootElement;

            if (!root.TryGetProperty(
                    "movement",
                    out var movement) ||
                movement.ValueKind !=
                    JsonValueKind.Object ||
                !movement.TryGetProperty(
                    "pages",
                    out var pages) ||
                pages.ValueKind !=
                    JsonValueKind.Array)
                return null;

            foreach (var pageJson in
                     pages.EnumerateArray())
            {
                if (!pageJson.TryGetProperty(
                        "id",
                        out var idElement) ||
                    idElement.ValueKind !=
                        JsonValueKind.String ||
                    !string.Equals(
                        idElement.GetString(),
                        pageId,
                        StringComparison.Ordinal))
                    continue;

                var page =
                    JsonSerializer.Deserialize<MovementPageModel>(
                        pageJson.GetRawText(),
                        _json);

                return page is null
                    ? null
                    : NormalizeSavedPage(
                        page);
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(
                ex,
                "Movement definition could not be loaded: {PageId}",
                pageId);
        }

        return null;
    }

    public (bool Ok, string? Error) Start(
        string pageId)
    {
        var page =
            LoadSavedMovementPage(
                pageId);

        if (page is null)
            return (
                false,
                "movement_not_found");

        return StartSavedPage(
            page,
            false);
    }

    public (bool Ok, string? Error) StartTransient(
        MovementPageModel page) =>
        StartSavedPage(
            page,
            true);

    (bool Ok, string? Error) StartSavedPage(
        MovementPageModel page,
        bool calibrationBypass)
    {
        if (!calibrationBypass &&
            _exclusiveGate.CalibrationActive)
            return (
                false,
                "calibration_active");

        MovementPlanModel plan;

        try
        {
            plan = _planBuilder.Build(page);
        }
        catch (Exception ex)
        {
            _log.LogWarning(
                ex,
                "Movement plan build failed for {Movement}",
                page.Name);

            return (
                false,
                ex.Message);
        }

        if (string.IsNullOrWhiteSpace(page.Id) ||
            string.IsNullOrWhiteSpace(page.Name))
            return (false, "invalid_movement");

        if (!page.Enabled)
            return (false, "movement_disabled");

        if (!_hubState.TrackPower)
            return (false, "track_power_off");

        if (plan.Direction is not ("forward" or "reverse"))
            return (false, "movement_direction_unknown");

        var source =
            plan.Blocks.FirstOrDefault();

        if (source?.BlockId is null)
            return (false, "movement_source_missing");

        var sourceBlock =
            Block(source.BlockId.Value);

        if (sourceBlock is null ||
            sourceBlock.LocoAddress == 0)
            return (false, "movement_source_loco_missing");

        if (page.ExpectedLocoAddress is > 0 &&
            sourceBlock.LocoAddress !=
                page.ExpectedLocoAddress.Value)
            return (
                false,
                "movement_source_loco_mismatch");

        lock (_gate)
        {
            if (_executions.ContainsKey(page.Id))
                return (false, "movement_already_running");
        }

        var execution =
            new Execution
            {
                Page = page,
                Plan = plan,
                LocoAddress =
                    sourceBlock.LocoAddress,
                Forward =
                    plan.Direction == "forward",
                Cancellation =
                    new CancellationTokenSource(),
                DesiredSpeed =
                    Math.Clamp(page.Speed, 0, 126),
                Moving = false,
                CurrentBlockId =
                    source.BlockId,
                State =
                    new MovementRuntimeState(
                        page.Id,
                        page.Name,
                        "running",
                        NowMs(),
                        null,
                        sourceBlock.LocoAddress,
                        plan.Direction,
                        Math.Clamp(page.Speed, 0, 126),
                        false,
                        source.BlockId,
                        null,
                        source.Key,
                        source.Key,
                        "Starting from " + source.Name,
                        null)
            };

        foreach (var pair in LoadFunctionBindingMap(execution.LocoAddress))
            execution.FunctionNumbersByBindingId[pair.Key] = pair.Value;

        lock (_gate)
        {
            _executions[page.Id] = execution;
            _states[page.Id] = execution.State;
        }

        Changed?.Invoke(execution.State);

        _ = PersistMovementTimingAsync(
            page.Id,
            execution.State.StartedAt,
            null);

        _ = Task.Run(
            () => RunExecution(execution));

        return (true, null);
    }

    public bool Stop(string pageId)
    {
        Execution? execution;

        lock (_gate)
            _executions.TryGetValue(
                pageId,
                out execution);

        if (execution is null)
            return false;

        execution.Moving = false;
        execution.DesiredSpeed = 0;

        Patch(
            execution,
            status: "stopping",
            desiredSpeed: 0,
            info: "Stopping Movement...",
            setInfo: true);

        _ = _commandCenter.SetLocoAsync(
            execution.LocoAddress,
            0,
            execution.Forward,
            CancellationToken.None)
            .ContinueWith(
                task =>
                {
                    if (task.IsCompletedSuccessfully &&
                        task.Result)
                    {
                        var old =
                            _hubState.Locos.GetValueOrDefault(
                                execution.LocoAddress,
                                new(
                                    execution.LocoAddress,
                                    0,
                                    execution.Forward,
                                    0));

                        var updated =
                            old with
                            {
                                Speed = 0,
                                Forward =
                                    execution.Forward
                            };

                        _hubState.Locos[
                            execution.LocoAddress] =
                            updated;

                        LocoChanged?.Invoke(
                            updated);
                    }
                },
                CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);

        execution.Cancellation.Cancel();

        return true;
    }

    async Task EnsureEmergencyStopAsync()
    {
        /*
         * DccExCommandCenter.EmergencyStopAsync() is deliberately a toggle:
         * when pause is already active it performs the safe resume sequence.
         * Movement Abort must NEVER resume an existing emergency stop.
         */
        if (
            (
                _commandCenter.EmergencyPauseStateKnown &&
                _commandCenter.EmergencyPaused
            ) ||
            _hubState.EmergencyStop
        )
        {
            _hubState.EmergencyStop =
                true;

            PowerStateChanged?.Invoke();
            return;
        }

        var ok =
            await _commandCenter.EmergencyStopAsync(
                CancellationToken.None);

        if (!ok)
            return;

        _hubState.EmergencyStop =
            _commandCenter.EmergencyPauseStateKnown
                ? _commandCenter.EmergencyPaused
                : true;

        PowerStateChanged?.Invoke();
    }

    public bool Abort(
        string pageId,
        bool emergencyStop)
    {
        Execution? execution;

        lock (_gate)
            _executions.TryGetValue(
                pageId,
                out execution);

        if (execution is null)
            return false;

        execution.EmergencyAbort = true;

        var stopped =
            Stop(pageId);

        if (stopped && emergencyStop)
            _ = EnsureEmergencyStopAsync();

        return stopped;
    }

    public int StopAll(bool emergencyStop)
    {
        string[] pageIds;

        lock (_gate)
            pageIds =
                _executions.Keys.ToArray();

        var count = 0;

        foreach (var pageId in pageIds)
        {
            if (emergencyStop)
            {
                Execution? execution;

                lock (_gate)
                    _executions.TryGetValue(
                        pageId,
                        out execution);

                if (execution is not null)
                    execution.EmergencyAbort =
                        true;
            }

            if (Stop(pageId))
                count++;
        }

        if (emergencyStop &&
            count > 0)
            _ = EnsureEmergencyStopAsync();

        return count;
    }
}
