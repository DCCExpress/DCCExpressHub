using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using DCCExpressHub.Net.CommandCenter;
using Jint;

namespace DCCExpressHub.Net.Web;

public sealed record ScriptRuntimeState(
    string ExecutionId,
    string? ScriptId,
    string Name,
    string Type,
    string Status,
    long? StartedAt,
    long? StoppedAt,
    string? Info,
    string? Error);

public sealed record ScriptRuntimeLog(
    string ExecutionId,
    long Timestamp,
    string Message);

public sealed record ScriptAudioRequest(
    string RequestId,
    string FileName,
    bool WaitForEnd);

public sealed class ScriptRuntime
{
    sealed class Execution
    {
        public required string ExecutionId { get; init; }
        public string? ScriptId { get; init; }
        public required string Name { get; init; }
        public required string Type { get; init; }
        public required string Source { get; init; }
        public required CancellationTokenSource Cancellation { get; init; }
        public required string InfoOwnerId { get; init; }
        public required ScriptRuntimeState State { get; set; }
        public bool Paused { get; set; }
        public TaskCompletionSource<bool> ResumeSignal { get; set; } =
            NewSignal();
        public ConcurrentDictionary<string, byte> DispatcherOwners { get; } =
            new(StringComparer.Ordinal);
        public ConcurrentDictionary<string, byte> SwitchOwners { get; } =
            new(StringComparer.Ordinal);
        public ConcurrentDictionary<string, SmartRun> SmartRuns { get; } =
            new(StringComparer.Ordinal);
    }

    sealed class SmartRun
    {
        public required string Id { get; init; }
        public required Execution Execution { get; init; }
        public required MovementPlanModel Plan { get; init; }
        public required int LocoAddress { get; init; }
        public required bool Forward { get; init; }
        public required string Direction { get; init; }
        public required CancellationTokenSource Cancellation { get; init; }
        public int CurrentIndex { get; set; }
        public int DesiredSpeed { get; set; }
        public bool MotionAuthorized { get; set; }
        public bool Completed { get; set; }
        public string? ReservationOwnerId { get; set; }
        public Task? MonitorTask { get; set; }
        public TaskCompletionSource<bool> Changed { get; set; } =
            NewSignal();
        public TaskCompletionSource<bool> CompletedSignal { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    sealed record SavedScript(
        string Id,
        string Name,
        string Source,
        bool StartWithAll);

    sealed record SignalStateDef(
        string Label,
        int Aspect,
        bool[] BasicOutputs);

    sealed record SignalDef(
        int Address,
        bool Extended,
        int OutputCount,
        SignalStateDef[] States);

    sealed record RouteTurnoutDef(
        ushort Address,
        bool Closed);

    readonly object _gate = new();
    readonly LayoutRuntime _layout;
    readonly SwitchManManager _switchMan;
    readonly DispatcherRuntime _dispatcher;
    readonly MovementPlanBuilder _planBuilder;
    readonly ICommandCenter _commandCenter;
    readonly HubState _hubState;
    readonly IWebHostEnvironment _env;
    readonly ScriptInfoStore _scriptInfo;
    readonly ILogger<ScriptRuntime> _log;
    readonly Dictionary<string, Execution> _executions =
        new(StringComparer.Ordinal);
    readonly Dictionary<string, ScriptRuntimeState> _states =
        new(StringComparer.Ordinal);
    readonly ConcurrentDictionary<string, TaskCompletionSource<bool>> _pendingAudio =
        new(StringComparer.Ordinal);

    bool _finishing;

    public event Action<ScriptRuntimeState>? Changed;
    public event Action<ScriptRuntimeLog>? LogChanged;
    public event Action<ScriptAudioRequest>? AudioRequested;
    public event Action<LocoFeedback>? LocoChanged;
    public event Action? PowerStateChanged;

    public ScriptRuntime(
        LayoutRuntime layout,
        SwitchManManager switchMan,
        DispatcherRuntime dispatcher,
        MovementPlanBuilder planBuilder,
        ICommandCenter commandCenter,
        HubState hubState,
        IWebHostEnvironment env,
        ScriptInfoStore scriptInfo,
        ILogger<ScriptRuntime> log)
    {
        _layout = layout;
        _switchMan = switchMan;
        _dispatcher = dispatcher;
        _planBuilder = planBuilder;
        _commandCenter = commandCenter;
        _hubState = hubState;
        _env = env;
        _scriptInfo = scriptInfo;
        _log = log;
    }

    static TaskCompletionSource<bool> NewSignal() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    static long NowMs() =>
        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    static string AudioPath(string raw)
    {
        var value =
            (raw ?? "").Trim();

        if (value.Length == 0)
            return "";

        if (value.StartsWith("/", StringComparison.Ordinal))
            return value;

        return
            "/sd/audio/" +
            value +
            (value.Contains('.') ? "" : ".mp3");
    }

    static ScriptRuntimeState Idle(string executionId) =>
        new(
            executionId,
            null,
            executionId,
            "automation",
            "idle",
            null,
            null,
            null,
            null);

    public ScriptRuntimeState GetState(string executionId)
    {
        lock (_gate)
            return _states.TryGetValue(executionId, out var state)
                ? state
                : Idle(executionId);
    }

    public ScriptRuntimeState[] Snapshot()
    {
        lock (_gate)
            return _states.Values
                .OrderBy(x => x.StartedAt ?? 0)
                .ThenBy(x => x.ExecutionId, StringComparer.Ordinal)
                .ToArray();
    }

    public bool Finishing
    {
        get
        {
            lock (_gate)
                return _finishing;
        }
    }

    public void SetFinishing(bool finishing)
    {
        lock (_gate)
            _finishing =
                finishing;
    }

    void Publish(Execution execution, ScriptRuntimeState state)
    {
        execution.State =
            state;

        lock (_gate)
            _states[execution.ExecutionId] =
                state;

        Changed?.Invoke(
            state);
    }

    void Patch(
        Execution execution,
        string? status = null,
        string? info = null,
        bool setInfo = false,
        string? error = null,
        bool setError = false,
        long? stoppedAt = null,
        bool setStoppedAt = false)
    {
        var old =
            execution.State;

        Publish(
            execution,
            old with
            {
                Status =
                    status ??
                    old.Status,
                Info =
                    setInfo
                        ? info
                        : old.Info,
                Error =
                    setError
                        ? error
                        : old.Error,
                StoppedAt =
                    setStoppedAt
                        ? stoppedAt
                        : old.StoppedAt
            });
    }

    void WriteLog(
        Execution execution,
        string message)
    {
        var value =
            (message ?? "").TrimEnd();

        _log.LogInformation(
            "[Script {ExecutionId}] {Message}",
            execution.ExecutionId,
            value);

        LogChanged?.Invoke(
            new ScriptRuntimeLog(
                execution.ExecutionId,
                NowMs(),
                value));
    }

    void SetInfo(
        Execution execution,
        string message)
    {
        var value =
            message ?? "";

        _scriptInfo.Update(
            execution.ExecutionId,
            execution.InfoOwnerId,
            value,
            true);

        Patch(
            execution,
            info:
                value.Length == 0
                    ? null
                    : value,
            setInfo:
                true);
    }

    SavedScript[] LoadSavedScripts()
    {
        var path =
            Path.Combine(
                _env.ContentRootPath,
                "data",
                "config",
                "automations.json");

        if (!File.Exists(path))
            return [];

        using var doc =
            JsonDocument.Parse(
                File.ReadAllText(path));

        if (!doc.RootElement.TryGetProperty(
                "scripts",
                out var scripts) ||
            scripts.ValueKind !=
                JsonValueKind.Array)
            return [];

        var result =
            new List<SavedScript>();

        foreach (var item in scripts.EnumerateArray())
        {
            var id =
                item.TryGetProperty("id", out var idElement) &&
                idElement.ValueKind == JsonValueKind.String
                    ? (
                        idElement.GetString() ??
                        ""
                      ).Trim()
                    : "";

            var name =
                item.TryGetProperty("name", out var nameElement) &&
                nameElement.ValueKind == JsonValueKind.String
                    ? (
                        nameElement.GetString() ??
                        ""
                      ).Trim()
                    : "";

            var source =
                item.TryGetProperty("script", out var sourceElement) &&
                sourceElement.ValueKind == JsonValueKind.String
                    ? sourceElement.GetString() ?? ""
                    : "";

            var startWithAll =
                !item.TryGetProperty(
                    "startWithAll",
                    out var startElement) ||
                startElement.ValueKind !=
                    JsonValueKind.False;

            if (id.Length == 0)
                continue;

            result.Add(
                new SavedScript(
                    id,
                    name.Length > 0
                        ? name
                        : id,
                    source,
                    startWithAll));
        }

        return result.ToArray();
    }

    SavedScript? LoadSavedScript(string scriptId) =>
        LoadSavedScripts()
            .FirstOrDefault(script =>
                string.Equals(
                    script.Id,
                    scriptId,
                    StringComparison.Ordinal));

    public (bool Ok, string? Error, ScriptRuntimeState State) StartSaved(
        string scriptId,
        string? executionId = null,
        string type = "automation")
    {
        var script =
            LoadSavedScript(
                scriptId);

        if (script is null)
            return (
                false,
                "script_not_found",
                Idle(
                    executionId ??
                    scriptId));

        return StartSource(
            executionId ??
            "automation:" +
            script.Id,
            script.Name,
            type,
            script.Source,
            script.Id);
    }

    public (bool Ok, string? Error, ScriptRuntimeState State) StartSource(
        string executionId,
        string name,
        string type,
        string source,
        string? scriptId = null)
    {
        executionId =
            (executionId ?? "").Trim();

        source ??=
            "";

        if (executionId.Length == 0 ||
            executionId.Length > 128)
            return (
                false,
                "invalid_execution_id",
                Idle(
                    executionId));

        if (string.IsNullOrWhiteSpace(source))
            return (
                false,
                "script_empty",
                Idle(
                    executionId));

        Execution execution;

        lock (_gate)
        {
            if (_executions.ContainsKey(
                    executionId))
                return (
                    false,
                    "script_already_running",
                    _states.TryGetValue(
                        executionId,
                        out var existing)
                        ? existing
                        : Idle(
                            executionId));

            var startedAt =
                NowMs();

            var state =
                new ScriptRuntimeState(
                    executionId,
                    scriptId,
                    string.IsNullOrWhiteSpace(
                        name)
                        ? executionId
                        : name.Trim(),
                    string.IsNullOrWhiteSpace(
                        type)
                        ? "automation"
                        : type.Trim(),
                    "running",
                    startedAt,
                    null,
                    null,
                    null);

            execution =
                new Execution
                {
                    ExecutionId =
                        executionId,
                    ScriptId =
                        scriptId,
                    Name =
                        state.Name,
                    Type =
                        state.Type,
                    Source =
                        source,
                    Cancellation =
                        new CancellationTokenSource(),
                    InfoOwnerId =
                        "backend-script:" +
                        executionId +
                        ":" +
                        Guid.NewGuid().ToString("N"),
                    State =
                        state
                };

            _executions[
                executionId] =
                execution;

            _states[
                executionId] =
                state;
        }

        _scriptInfo.Update(
            execution.ExecutionId,
            execution.InfoOwnerId,
            "",
            true);

        Changed?.Invoke(
            execution.State);

        _ =
            Task.Run(
                () =>
                    RunExecution(
                        execution));

        return (
            true,
            null,
            execution.State);
    }

    public bool Pause(string executionId)
    {
        Execution? execution;

        lock (_gate)
        {
            if (!_executions.TryGetValue(
                    executionId,
                    out execution) ||
                execution.Paused)
                return false;

            execution.Paused =
                true;

            execution.ResumeSignal =
                NewSignal();
        }

        Patch(
            execution,
            status:
                "paused");

        return true;
    }

    public bool Resume(string executionId)
    {
        Execution? execution;

        lock (_gate)
        {
            if (!_executions.TryGetValue(
                    executionId,
                    out execution) ||
                !execution.Paused)
                return false;

            execution.Paused =
                false;

            execution.ResumeSignal.TrySetResult(
                true);
        }

        Patch(
            execution,
            status:
                "running");

        return true;
    }

    public bool Abort(
        string executionId,
        string reason = "Script aborted by user.")
    {
        Execution? execution;

        lock (_gate)
        {
            if (!_executions.TryGetValue(
                    executionId,
                    out execution))
                return false;
        }

        WriteLog(
            execution,
            reason);

        execution.Cancellation.Cancel();
        execution.ResumeSignal.TrySetResult(
            true);

        return true;
    }

    public int AbortAll(
        string reason = "Scripts aborted.")
    {
        string[] ids;

        lock (_gate)
            ids =
                _executions.Keys
                    .ToArray();

        var count =
            0;

        foreach (var id in ids)
            if (Abort(
                    id,
                    reason))
                count++;

        return count;
    }

    public int PauseAll()
    {
        string[] ids;

        lock (_gate)
            ids =
                _executions.Keys
                    .ToArray();

        var count =
            0;

        foreach (var id in ids)
            if (Pause(id))
                count++;

        return count;
    }

    public int ResumeAll()
    {
        string[] ids;

        lock (_gate)
            ids =
                _executions.Keys
                    .ToArray();

        var count =
            0;

        foreach (var id in ids)
            if (Resume(id))
                count++;

        return count;
    }

    public int StartAllSaved()
    {
        if (Finishing)
            return 0;

        var count =
            0;

        foreach (var script in
                 LoadSavedScripts()
                     .Where(script =>
                         script.StartWithAll))
        {
            var executionId =
                "automation:" +
                script.Id;

            var result =
                StartSource(
                    executionId,
                    script.Name,
                    "automation",
                    script.Source,
                    script.Id);

            if (result.Ok)
                count++;
        }

        return count;
    }

    async Task WaitRunnable(
        Execution execution)
    {
        while (true)
        {
            execution.Cancellation.Token.ThrowIfCancellationRequested();

            Task? wait =
                null;

            lock (_gate)
            {
                if (!execution.Paused)
                    return;

                wait =
                    execution.ResumeSignal.Task;
            }

            await wait.WaitAsync(
                execution.Cancellation.Token);
        }
    }

    async Task Delay(
        Execution execution,
        double rawMs)
    {
        var remaining =
            Math.Clamp(
                (long)Math.Round(
                    rawMs),
                0,
                86_400_000);

        while (remaining > 0)
        {
            await WaitRunnable(
                execution);

            var slice =
                (int)Math.Min(
                    250,
                    remaining);

            await Task.Delay(
                slice,
                execution.Cancellation.Token);

            remaining -=
                slice;
        }
    }

    async Task<bool> WaitSensor(
        Execution execution,
        int address,
        bool state,
        double rawTimeoutMs)
    {
        if (address is < 1 or > 65535)
            throw new ArgumentOutOfRangeException(
                nameof(address));

        var timeoutMs =
            rawTimeoutMs < 0
                ? -1L
                : Math.Clamp(
                    (long)Math.Round(
                        rawTimeoutMs),
                    0,
                    86_400_000);

        var started =
            Environment.TickCount64;

        while (true)
        {
            await WaitRunnable(
                execution);

            if (_layout.TryGetSensorState(
                    (ushort)address,
                    out var current) &&
                current ==
                    state)
                return true;

            if (timeoutMs >= 0 &&
                Environment.TickCount64 -
                    started >=
                timeoutMs)
                throw new TimeoutException(
                    "Sensor wait timed out.");

            await Task.Delay(
                50,
                execution.Cancellation.Token);
        }
    }

    async Task<bool> WaitTurnout(
        Execution execution,
        int address,
        bool closed,
        double rawTimeoutMs)
    {
        if (address is < 1 or > 2048)
            throw new ArgumentOutOfRangeException(
                nameof(address));

        var timeoutMs =
            rawTimeoutMs < 0
                ? -1L
                : Math.Clamp(
                    (long)Math.Round(
                        rawTimeoutMs),
                    0,
                    86_400_000);

        var started =
            Environment.TickCount64;

        while (true)
        {
            await WaitRunnable(
                execution);

            if (_layout.TryGetTurnoutClosed(
                    (ushort)address,
                    out var current) &&
                current ==
                    closed)
                return true;

            if (timeoutMs >= 0 &&
                Environment.TickCount64 -
                    started >=
                timeoutMs)
                throw new TimeoutException(
                    "Turnout wait timed out.");

            await Task.Delay(
                50,
                execution.Cancellation.Token);
        }
    }

    Dictionary<string, ushort> BlockNameMap()
    {
        var result =
            new Dictionary<string, ushort>(
                StringComparer.OrdinalIgnoreCase);

        var path =
            Path.Combine(
                _env.ContentRootPath,
                "data",
                "config",
                "layout.json");

        if (!File.Exists(path))
            return result;

        using var doc =
            JsonDocument.Parse(
                File.ReadAllText(path));

        if (!doc.RootElement.TryGetProperty(
                "layers",
                out var layers) ||
            layers.ValueKind !=
                JsonValueKind.Array)
            return result;

        foreach (var layer in layers.EnumerateArray())
        {
            if (!layer.TryGetProperty(
                    "elements",
                    out var elements) ||
                elements.ValueKind !=
                    JsonValueKind.Array)
                continue;

            foreach (var element in
                     elements.EnumerateArray())
            {
                if (!element.TryGetProperty(
                        "type",
                        out var typeElement) ||
                    typeElement.ValueKind !=
                        JsonValueKind.String ||
                    typeElement.GetString() !=
                        "trackblock")
                    continue;

                if (!element.TryGetProperty(
                        "id",
                        out var idElement) ||
                    !idElement.TryGetInt32(
                        out var id) ||
                    id is < 1 or > 65535)
                    continue;

                var name =
                    element.TryGetProperty(
                        "name",
                        out var nameElement) &&
                    nameElement.ValueKind ==
                        JsonValueKind.String
                        ? (
                            nameElement.GetString() ??
                            ""
                          ).Trim()
                        : "";

                if (name.Length > 0)
                    result.TryAdd(
                        name,
                        (ushort)id);
            }
        }

        return result;
    }

    ushort ResolveBlockId(string raw)
    {
        var value =
            (raw ?? "").Trim();

        if (ushort.TryParse(
                value,
                out var numeric) &&
            numeric > 0)
            return numeric;

        var map =
            BlockNameMap();

        if (!map.TryGetValue(
                value,
                out var id))
            throw new InvalidOperationException(
                "block_not_found:" +
                value);

        return id;
    }

    RuntimeBlock? FindBlock(ushort id) =>
        _layout
            .BlocksForPersistence()
            .FirstOrDefault(block =>
                block.Id ==
                id);

    int GetBlock(string raw)
    {
        var block =
            FindBlock(
                ResolveBlockId(
                    raw));

        return block?.LocoAddress ??
               0;
    }

    static int ParseTargetAddress(string locoId)
    {
        if (string.IsNullOrEmpty(
                locoId) ||
            !locoId.StartsWith(
                RuntimeBlock.TargetLocoPrefix,
                StringComparison.Ordinal))
            return 0;

        var payload =
            locoId[
                RuntimeBlock.TargetLocoPrefix.Length..];

        var separator =
            payload.IndexOf(
                ':');

        var addressText =
            separator >= 0
                ? payload[..separator]
                : payload;

        return int.TryParse(
                addressText,
                out var address) &&
               address is >= 1 and <= 10239
            ? address
            : 0;
    }

    int GetBlockTarget(string raw)
    {
        var block =
            FindBlock(
                ResolveBlockId(
                    raw));

        return block is null
            ? 0
            : ParseTargetAddress(
                block.LocoId);
    }

    void SetBlockTarget(
        Execution execution,
        string raw,
        int locoAddress)
    {
        var id =
            ResolveBlockId(
                raw);

        if (locoAddress is < 1 or > 10239)
            throw new ArgumentOutOfRangeException(
                nameof(locoAddress));

        var marker =
            RuntimeBlock.TargetLocoPrefix +
            locoAddress +
            ":" +
            Uri.EscapeDataString(
                execution.ExecutionId);

        if (!_layout.SetBlock(
                id,
                marker,
                0))
            throw new InvalidOperationException(
                "set_block_target_failed");
    }

    void ClearBlockTarget(string raw)
    {
        var id =
            ResolveBlockId(
                raw);

        var block =
            FindBlock(id);

        if (block?.TargetOnly ==
            true)
            _layout.RemoveBlock(
                id,
                block.LocoId);
    }

    async Task SetLoco(
        int address,
        int speed,
        string direction,
        CancellationToken ct)
    {
        if (address is < 1 or > 10239)
            throw new ArgumentOutOfRangeException(
                nameof(address));

        speed =
            Math.Clamp(
                speed,
                0,
                126);

        var forward =
            string.Equals(
                direction,
                "forward",
                StringComparison.Ordinal);

        if (!forward &&
            !string.Equals(
                direction,
                "reverse",
                StringComparison.Ordinal))
            throw new InvalidOperationException(
                "invalid_loco_direction");

        if (!await _commandCenter.SetLocoAsync(
                address,
                speed,
                forward,
                ct))
            throw new InvalidOperationException(
                "script_loco_command_failed");

        var old =
            _hubState.Locos.GetValueOrDefault(
                address,
                new(
                    address,
                    0,
                    forward,
                    0));

        var updated =
            old with
            {
                Speed =
                    speed,
                Forward =
                    forward
            };

        _hubState.Locos[
            address] =
            updated;

        LocoChanged?.Invoke(
            updated);
    }

    Dictionary<int, int> FunctionBindings(
        int locoAddress)
    {
        var result =
            new Dictionary<int, int>();

        var path =
            Path.Combine(
                _env.ContentRootPath,
                "data",
                "config",
                "locos.json");

        if (!File.Exists(path))
            return result;

        using var doc =
            JsonDocument.Parse(
                File.ReadAllText(path));

        if (doc.RootElement.ValueKind !=
            JsonValueKind.Array)
            return result;

        foreach (var loco in
                 doc.RootElement.EnumerateArray())
        {
            if (!loco.TryGetProperty(
                    "address",
                    out var addressElement) ||
                !addressElement.TryGetInt32(
                    out var address) ||
                address !=
                    locoAddress ||
                !loco.TryGetProperty(
                    "functions",
                    out var functions) ||
                functions.ValueKind !=
                    JsonValueKind.Array)
                continue;

            foreach (var fn in
                     functions.EnumerateArray())
            {
                if (!fn.TryGetProperty(
                        "bindingId",
                        out var bindingElement) ||
                    !bindingElement.TryGetInt32(
                        out var bindingId) ||
                    !fn.TryGetProperty(
                        "number",
                        out var numberElement) ||
                    !numberElement.TryGetInt32(
                        out var number))
                    continue;

                if (bindingId > 0 &&
                    number is >= 0 and <= 68)
                    result.TryAdd(
                        bindingId,
                        number);
            }

            break;
        }

        return result;
    }

    async Task SetLocoFunction(
        int address,
        int functionNumber,
        bool active,
        CancellationToken ct)
    {
        if (address is < 1 or > 10239 ||
            functionNumber is < 0 or > 68)
            throw new ArgumentOutOfRangeException();

        if (!await _commandCenter.SetLocoFunctionAsync(
                address,
                functionNumber,
                active,
                ct))
            throw new InvalidOperationException(
                "script_loco_function_failed");

        if (functionNumber <= 31)
        {
            var old =
                _hubState.Locos.GetValueOrDefault(
                    address,
                    new(
                        address,
                        0,
                        true,
                        0));

            var bit =
                1u <<
                functionNumber;

            var updated =
                old with
                {
                    FunctionsMask =
                        active
                            ? old.FunctionsMask |
                              bit
                            : old.FunctionsMask &
                              ~bit
                };

            _hubState.Locos[
                address] =
                updated;

            LocoChanged?.Invoke(
                updated);
        }
    }

    async Task SetLocoFunctionBinding(
        int address,
        int bindingId,
        bool active,
        CancellationToken ct)
    {
        if (!FunctionBindings(
                address)
            .TryGetValue(
                bindingId,
                out var functionNumber))
            throw new InvalidOperationException(
                "loco_function_binding_not_found:" +
                bindingId);

        await SetLocoFunction(
            address,
            functionNumber,
            active,
            ct);
    }

    async Task SetSemanticTurnout(
        int rawAddress,
        bool closed,
        string? ownerId,
        CancellationToken ct)
    {
        if (rawAddress is < 1 or > 2048)
            throw new ArgumentOutOfRangeException(
                nameof(rawAddress));

        var address =
            (ushort)rawAddress;

        var turnout =
            _layout.FindAccessory(
                RuntimeAccessoryKind.Turnout,
                address) ??
            throw new InvalidOperationException(
                "turnout_not_found:" +
                address);

        if (!_switchMan.CanOperate(
                address,
                ownerId,
                out _))
            throw new InvalidOperationException(
                "turnout_locked:" +
                address);

        if (turnout.TurnoutExtended)
        {
            var aspect =
                closed
                    ? turnout.TurnoutClosedAspect
                    : turnout.TurnoutOpenedAspect;

            if (!await _commandCenter.SetSignalAspectAsync(
                    address,
                    aspect,
                    ct))
                throw new InvalidOperationException(
                    "turnout_command_failed");

            _layout.SetSignal(
                address,
                aspect);

            return;
        }

        var physical =
            closed
                ? turnout.ClosedValue
                : !turnout.ClosedValue;

        if (turnout.TurnoutVPin)
        {
            if (!await _commandCenter.SetVPinAsync(
                    address,
                    physical,
                    ct))
                throw new InvalidOperationException(
                    "turnout_command_failed");

            _layout.SetVPin(
                address,
                physical);

            return;
        }

        if (!await _commandCenter.SetAccessoryAsync(
                address,
                physical,
                ct))
            throw new InvalidOperationException(
                "turnout_command_failed");

        _layout.SetAccessory(
            address,
            physical);
    }

    async Task SetRawTurnout(
        int rawAddress,
        bool closed,
        CancellationToken ct)
    {
        if (rawAddress is < 1 or > 2048)
            throw new ArgumentOutOfRangeException();

        var address =
            (ushort)rawAddress;

        if (!_switchMan.CanOperate(
                address,
                null,
                out _))
            throw new InvalidOperationException(
                "turnout_locked:" +
                address);

        if (!await _commandCenter.SetTurnoutAsync(
                address,
                closed,
                ct))
            throw new InvalidOperationException(
                "turnout_command_failed");

        _layout.SetTurnout(
            address,
            closed);
    }

    SignalDef? FindSignal(int address)
    {
        var path =
            Path.Combine(
                _env.ContentRootPath,
                "data",
                "config",
                "layout.json");

        if (!File.Exists(path))
            return null;

        using var doc =
            JsonDocument.Parse(
                File.ReadAllText(path));

        if (!doc.RootElement.TryGetProperty(
                "layers",
                out var layers) ||
            layers.ValueKind !=
                JsonValueKind.Array)
            return null;

        var matches =
            new List<SignalDef>();

        foreach (var layer in
                 layers.EnumerateArray())
        {
            if (!layer.TryGetProperty(
                    "elements",
                    out var elements) ||
                elements.ValueKind !=
                    JsonValueKind.Array)
                continue;

            foreach (var element in
                     elements.EnumerateArray())
            {
                if (!element.TryGetProperty(
                        "type",
                        out var typeElement) ||
                    typeElement.ValueKind !=
                        JsonValueKind.String)
                    continue;

                var type =
                    typeElement.GetString() ??
                    "";

                if (!type.StartsWith(
                        "tracksignal",
                        StringComparison.Ordinal) &&
                    type !=
                        "tracklevelcrossing")
                    continue;

                JsonElement output =
                    default;

                var hasOutput =
                    element.TryGetProperty(
                        "signalOutput",
                        out output) &&
                    output.ValueKind ==
                        JsonValueKind.Object;

                var signalAddress =
                    hasOutput &&
                    output.TryGetProperty(
                        "address",
                        out var addressElement) &&
                    addressElement.TryGetInt32(
                        out var configuredAddress)
                        ? configuredAddress
                        : element.TryGetProperty(
                                "address",
                                out addressElement) &&
                            addressElement.TryGetInt32(
                                out configuredAddress)
                            ? configuredAddress
                            : 0;

                if (signalAddress !=
                    address)
                    continue;

                var extended =
                    hasOutput &&
                    output.TryGetProperty(
                        "protocol",
                        out var protocolElement) &&
                    protocolElement.ValueKind ==
                        JsonValueKind.String
                        ? protocolElement.GetString() ==
                          "dccext"
                        : type !=
                          "tracklevelcrossing";

                var outputCount =
                    hasOutput &&
                    output.TryGetProperty(
                        "outputCount",
                        out var countElement) &&
                    countElement.TryGetInt32(
                        out var configuredCount)
                        ? Math.Clamp(
                            configuredCount,
                            1,
                            16)
                        : 1;

                var states =
                    new List<SignalStateDef>();

                if (hasOutput &&
                    output.TryGetProperty(
                        "states",
                        out var rawStates) &&
                    rawStates.ValueKind ==
                        JsonValueKind.Array)
                {
                    foreach (var state in
                             rawStates.EnumerateArray())
                    {
                        var label =
                            state.TryGetProperty(
                                "label",
                                out var labelElement) &&
                            labelElement.ValueKind ==
                                JsonValueKind.String
                                ? (
                                    labelElement.GetString() ??
                                    ""
                                  ).Trim()
                                : "";

                        if (label.Length == 0)
                            continue;

                        var aspect =
                            state.TryGetProperty(
                                "aspect",
                                out var aspectElement) &&
                            aspectElement.TryGetInt32(
                                out var rawAspect)
                                ? Math.Clamp(
                                    rawAspect,
                                    0,
                                    255)
                                : 0;

                        var outputs =
                            new bool[
                                outputCount];

                        if (state.TryGetProperty(
                                "dccOutputs",
                                out var rawOutputs) &&
                            rawOutputs.ValueKind ==
                                JsonValueKind.Array)
                        {
                            var index =
                                0;

                            foreach (var item in
                                     rawOutputs.EnumerateArray())
                            {
                                if (index >=
                                    outputs.Length)
                                    break;

                                outputs[index++] =
                                    item.ValueKind ==
                                        JsonValueKind.String &&
                                    item.GetString() ==
                                        "G";
                            }
                        }

                        states.Add(
                            new SignalStateDef(
                                label,
                                aspect,
                                outputs));
                    }
                }

                if (states.Count ==
                    0)
                {
                    states.Add(
                        new SignalStateDef(
                            "Red",
                            0,
                            [true]));
                    states.Add(
                        new SignalStateDef(
                            "Green",
                            16,
                            [false]));
                }

                matches.Add(
                    new SignalDef(
                        signalAddress,
                        extended,
                        outputCount,
                        states.ToArray()));
            }
        }

        return matches.Count == 1
            ? matches[0]
            : null;
    }

    SignalStateDef SignalState(
        int address,
        string label)
    {
        var signal =
            FindSignal(address) ??
            throw new InvalidOperationException(
                "signal_not_found:" +
                address);

        var matches =
            signal.States
                .Where(state =>
                    string.Equals(
                        state.Label.Trim(),
                        (label ?? "").Trim(),
                        StringComparison.OrdinalIgnoreCase))
                .ToArray();

        if (matches.Length != 1)
            throw new InvalidOperationException(
                "signal_state_not_found:" +
                label);

        return matches[0];
    }

    string GetSignalState(int address)
    {
        var signal =
            FindSignal(address) ??
            throw new InvalidOperationException(
                "signal_not_found:" +
                address);

        if (signal.Extended)
        {
            if (!_layout.TryGetExtendedAccessoryState(
                    (ushort)address,
                    out var aspect))
                return "";

            return signal.States
                       .Where(state =>
                           state.Aspect ==
                           aspect)
                       .Select(state =>
                           state.Label)
                       .SingleOrDefault() ??
                   "";
        }

        var bits =
            new bool[
                signal.OutputCount];

        for (var index = 0;
             index < bits.Length;
             index++)
        {
            if (!_layout.TryGetBasicAccessoryState(
                    (ushort)(
                        address +
                        index),
                    out bits[index]))
                return "";
        }

        return signal.States
                   .Where(state =>
                       state.BasicOutputs
                           .SequenceEqual(
                               bits))
                   .Select(state =>
                       state.Label)
                   .SingleOrDefault() ??
               "";
    }

    async Task SetSignalState(
        int address,
        string label,
        CancellationToken ct)
    {
        var signal =
            FindSignal(address) ??
            throw new InvalidOperationException(
                "signal_not_found:" +
                address);

        var state =
            SignalState(
                address,
                label);

        if (signal.Extended)
        {
            if (!await _commandCenter.SetSignalAspectAsync(
                    address,
                    state.Aspect,
                    ct))
                throw new InvalidOperationException(
                    "signal_command_failed");

            _layout.SetSignal(
                (ushort)address,
                state.Aspect);

            return;
        }

        for (var index = 0;
             index < signal.OutputCount;
             index++)
        {
            var outputAddress =
                address +
                index;

            var active =
                index <
                    state.BasicOutputs.Length &&
                state.BasicOutputs[index];

            if (!await _commandCenter.SetAccessoryAsync(
                    outputAddress,
                    active,
                    ct))
                throw new InvalidOperationException(
                    "signal_command_failed");

            _layout.SetAccessory(
                (ushort)outputAddress,
                active);
        }
    }

    async Task<bool> WaitSignalState(
        Execution execution,
        int address,
        string label,
        double rawTimeoutMs)
    {
        var timeoutMs =
            rawTimeoutMs < 0
                ? -1L
                : Math.Clamp(
                    (long)Math.Round(
                        rawTimeoutMs),
                    0,
                    86_400_000);

        var started =
            Environment.TickCount64;

        while (true)
        {
            await WaitRunnable(
                execution);

            var current =
                GetSignalState(
                    address);

            if (string.Equals(
                    current,
                    label,
                    StringComparison.OrdinalIgnoreCase))
                return true;

            if (timeoutMs >= 0 &&
                Environment.TickCount64 -
                    started >=
                timeoutMs)
                throw new TimeoutException(
                    "Signal wait timed out.");

            await Task.Delay(
                50,
                execution.Cancellation.Token);
        }
    }

    RouteTurnoutDef[] LoadRouteButton(string name)
    {
        var path =
            Path.Combine(
                _env.ContentRootPath,
                "data",
                "config",
                "layout.json");

        if (!File.Exists(path))
            throw new InvalidOperationException(
                "layout_not_found");

        using var doc =
            JsonDocument.Parse(
                File.ReadAllText(path));

        if (!doc.RootElement.TryGetProperty(
                "layers",
                out var layers) ||
            layers.ValueKind !=
                JsonValueKind.Array)
            throw new InvalidOperationException(
                "route_not_found:" +
                name);

        JsonElement? found =
            null;

        foreach (var layer in
                 layers.EnumerateArray())
        {
            if (!layer.TryGetProperty(
                    "elements",
                    out var elements) ||
                elements.ValueKind !=
                    JsonValueKind.Array)
                continue;

            foreach (var element in
                     elements.EnumerateArray())
            {
                if (!element.TryGetProperty(
                        "type",
                        out var typeElement) ||
                    typeElement.ValueKind !=
                        JsonValueKind.String ||
                    typeElement.GetString() !=
                        "routebutton")
                    continue;

                var routeName =
                    element.TryGetProperty(
                        "name",
                        out var nameElement) &&
                    nameElement.ValueKind ==
                        JsonValueKind.String
                        ? nameElement.GetString() ??
                          ""
                        : "";

                var label =
                    element.TryGetProperty(
                        "label",
                        out var labelElement) &&
                    labelElement.ValueKind ==
                        JsonValueKind.String
                        ? labelElement.GetString() ??
                          ""
                        : "";

                if (string.Equals(
                        routeName,
                        name,
                        StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(
                        label,
                        name,
                        StringComparison.OrdinalIgnoreCase))
                {
                    if (found.HasValue)
                        throw new InvalidOperationException(
                            "route_ambiguous:" +
                            name);

                    found =
                        element.Clone();
                }
            }
        }

        if (!found.HasValue ||
            !found.Value.TryGetProperty(
                "routeTurnouts",
                out var rawTurnouts) ||
            rawTurnouts.ValueKind !=
                JsonValueKind.Array)
            throw new InvalidOperationException(
                "route_not_found:" +
                name);

        var result =
            new List<RouteTurnoutDef>();

        foreach (var item in
                 rawTurnouts.EnumerateArray())
        {
            if (!item.TryGetProperty(
                    "turnoutId",
                    out var idElement) ||
                !idElement.TryGetInt32(
                    out var id) ||
                id is < 1 or > 65535)
                continue;

            var firstClosed =
                item.TryGetProperty(
                    "closed",
                    out var closedElement) &&
                closedElement.ValueKind ==
                    JsonValueKind.True;

            var first =
                _layout.FindAccessoryById(
                    RuntimeAccessoryKind.Turnout,
                    (ushort)id,
                    0);

            if (first is not null)
                result.Add(
                    new RouteTurnoutDef(
                        first.Address,
                        firstClosed));

            if (item.TryGetProperty(
                    "secondClosed",
                    out var secondElement) &&
                secondElement.ValueKind is
                    JsonValueKind.True or
                    JsonValueKind.False)
            {
                var second =
                    _layout.FindAccessoryById(
                        RuntimeAccessoryKind.Turnout,
                        (ushort)id,
                        1);

                if (second is not null)
                    result.Add(
                        new RouteTurnoutDef(
                            second.Address,
                            secondElement.ValueKind ==
                            JsonValueKind.True));
            }
        }

        return result
            .GroupBy(item =>
                item.Address)
            .Select(group =>
                group.Last())
            .ToArray();
    }

    async Task<string> SwitchAcquire(
        Execution execution,
        string addressesJson,
        double rawTimeoutMs)
    {
        var addresses =
            JsonSerializer.Deserialize<int[]>(
                addressesJson) ??
            [];

        var valid =
            addresses
                .Where(address =>
                    address is >= 1 and <= 2048)
                .Select(address =>
                    (ushort)address)
                .Distinct()
                .ToArray();

        var ownerId =
            "script-switch:" +
            execution.ExecutionId +
            ":" +
            Guid.NewGuid().ToString("N");

        var result =
            await _switchMan.AcquireAsync(
                valid,
                ownerId,
                "Script: " +
                    execution.Name,
                Math.Clamp(
                    (int)Math.Round(
                        rawTimeoutMs),
                    0,
                    600_000),
                execution.Cancellation.Token);

        if (!result.Ok)
            throw new InvalidOperationException(
                result.Error ??
                "switchman_acquire_failed");

        execution.SwitchOwners.TryAdd(
            ownerId,
            0);

        return ownerId;
    }

    async Task<bool> SwitchSet(
        Execution execution,
        string ownerId,
        int address,
        bool closed)
    {
        await SetSemanticTurnout(
            address,
            closed,
            ownerId,
            execution.Cancellation.Token);

        return true;
    }

    bool SwitchRelease(
        Execution execution,
        string ownerId)
    {
        _switchMan.ReleaseOwned(
            null,
            ownerId);

        execution.SwitchOwners.TryRemove(
            ownerId,
            out _);

        return true;
    }

    async Task<bool> SetRouteButton(
        Execution execution,
        string name,
        double rawDelayMs)
    {
        var turnouts =
            LoadRouteButton(
                name);

        var ownerId =
            await SwitchAcquire(
                execution,
                JsonSerializer.Serialize(
                    turnouts.Select(x =>
                        (int)x.Address)),
                60_000);

        try
        {
            var delayMs =
                Math.Clamp(
                    (int)Math.Round(
                        rawDelayMs),
                    0,
                    60_000);

            for (var index = 0;
                 index < turnouts.Length;
                 index++)
            {
                await SwitchSet(
                    execution,
                    ownerId,
                    turnouts[index].Address,
                    turnouts[index].Closed);

                if (delayMs > 0 &&
                    index + 1 <
                        turnouts.Length)
                    await Delay(
                        execution,
                        delayMs);
            }

            return true;
        }
        finally
        {
            SwitchRelease(
                execution,
                ownerId);
        }
    }

    static string[] ParseBlockNames(
        string blocksJson)
    {
        var names =
            JsonSerializer.Deserialize<string[]>(
                blocksJson) ??
            [];

        return names
            .Select(name =>
                (name ?? "").Trim())
            .Where(name =>
                name.Length > 0)
            .ToArray();
    }

    RuntimeBlock? SourceBlock(
        MovementPlanModel plan)
    {
        var sourceId =
            plan.Blocks
                .FirstOrDefault()?
                .BlockId;

        if (!sourceId.HasValue ||
            sourceId.Value is < 1 or > 65535)
            return null;

        return FindBlock(
            (ushort)sourceId.Value);
    }

    static ushort[] RouteSafetySensors(
        MovementPlanModel plan) =>
        plan.Legs
            .SelectMany(leg =>
                leg.Resources
                    .SelectMany(resource =>
                        resource.Detectors)
                    .Concat(
                        leg.To.SensorAddress.HasValue
                            ? [
                                leg.To.SensorAddress.Value
                              ]
                            : []))
            .Where(sensor =>
                sensor is >= 1 and <= 65535)
            .Distinct()
            .Select(sensor =>
                (ushort)sensor)
            .ToArray();

    static DispatcherTurnoutRequirement[] RouteTurnouts(
        MovementPlanModel plan) =>
        plan.Resources
            .SelectMany(resource =>
                resource.TurnoutStates)
            .GroupBy(turnout =>
                turnout.Address)
            .Select(group =>
            {
                var values =
                    group
                        .Select(item =>
                            item.Closed)
                        .Distinct()
                        .ToArray();

                if (values.Length != 1)
                    throw new InvalidOperationException(
                        "dispatcher_route_conflicting_turnout_state");

                return new DispatcherTurnoutRequirement(
                    group.Key,
                    values[0]);
            })
            .ToArray();

    static string[] RouteResourceKeys(
        MovementPlanModel plan) =>
        plan.Resources
            .Where(resource =>
                resource.Kind ==
                "segment")
            .Select(resource =>
                "segment:" +
                resource.Name)
            .Distinct(
                StringComparer.Ordinal)
            .ToArray();

    async Task<string> AcquireDispatcherRoute(
        Execution execution,
        string blocksJson,
        string optionsJson)
    {
        var names =
            ParseBlockNames(
                blocksJson);

        var plan =
            _planBuilder.BuildForBlockNames(
                names);

        var source =
            SourceBlock(
                plan);

        if (source is null ||
            source.TargetOnly)
            throw new InvalidOperationException(
                "dispatcher_invalid_source");

        if (source.LocoAddress == 0)
            return JsonSerializer.Serialize(
                new
                {
                    status =
                        "empty",
                    direction =
                        plan.Direction
                });

        using var options =
            JsonDocument.Parse(
                string.IsNullOrWhiteSpace(
                    optionsJson)
                    ? "{}"
                    : optionsJson);

        var timeoutMs =
            options.RootElement.TryGetProperty(
                "timeoutMs",
                out var timeoutElement) &&
            timeoutElement.TryGetInt32(
                out var timeout)
                ? Math.Clamp(
                    timeout,
                    0,
                    600_000)
                : -1;

        var pollMs =
            options.RootElement.TryGetProperty(
                "blockPollMs",
                out var pollElement) &&
            pollElement.TryGetInt32(
                out var poll)
                ? Math.Clamp(
                    poll,
                    25,
                    5000)
                : 250;

        var setDelayMs =
            options.RootElement.TryGetProperty(
                "setDelayMs",
                out var setDelayElement) &&
            setDelayElement.TryGetInt32(
                out var setDelay)
                ? Math.Clamp(
                    setDelay,
                    0,
                    600_000)
                : 250;

        var downstream =
            plan.Blocks
                .Skip(1)
                .Where(block =>
                    block.BlockId.HasValue)
                .Select(block =>
                    new DispatcherRouteBlockRequirement(
                        (ushort)block.BlockId!.Value,
                        block.SensorAddress is >= 1 and <= 65535
                            ? (ushort)block.SensorAddress.Value
                            : (ushort)0))
                .ToArray();

        var ownerId =
            "script-route:" +
            execution.ExecutionId +
            ":" +
            Guid.NewGuid().ToString("N");

        var started =
            Environment.TickCount64;

        while (true)
        {
            await WaitRunnable(
                execution);

            var result =
                await _dispatcher.AcquireRouteAsync(
                    new DispatcherRouteRequest(
                        ownerId,
                        "Script: " +
                            execution.Name,
                        (ushort)source.LocoAddress,
                        source.Id,
                        downstream,
                        RouteTurnouts(
                            plan),
                        RouteResourceKeys(
                            plan),
                        0,
                        setDelayMs),
                    execution.Cancellation.Token);

            if (result.Ok &&
                result.Lease is not null)
            {
                execution.DispatcherOwners.TryAdd(
                    ownerId,
                    0);

                return JsonSerializer.Serialize(
                    new
                    {
                        status =
                            "acquired",
                        ownerId,
                        loco =
                            source.LocoAddress,
                        direction =
                            plan.Direction
                    });
            }

            var error =
                result.Error ??
                "dispatcher_failed";

            if (error.StartsWith(
                    "dispatcher_resource_locked:",
                    StringComparison.Ordinal))
            {
                if (timeoutMs >= 0 &&
                    Environment.TickCount64 -
                        started >=
                    timeoutMs)
                    throw new TimeoutException(
                        "dispatcher_timeout");

                await Delay(
                    execution,
                    pollMs);

                continue;
            }

            if (error is
                    "destination_block_busy" or
                    "safety_sensor_not_free" or
                    "turnout_locked" or
                    "turnout_lock_timeout")
                return JsonSerializer.Serialize(
                    new
                    {
                        status =
                            "blocked",
                        loco =
                            source.LocoAddress,
                        direction =
                            plan.Direction,
                        error,
                        blockingSensor =
                            result.BlockingSensor,
                        blockingBlock =
                            result.BlockingBlock,
                        turnoutConflicts =
                            result.TurnoutConflicts
                    });

            throw new InvalidOperationException(
                error);
        }
    }

    bool CommitDispatcherRoute(
        Execution execution,
        string ownerId)
    {
        var ok =
            _dispatcher.CommitRoute(
                ownerId);

        if (ok)
            execution.DispatcherOwners.TryRemove(
                ownerId,
                out _);

        return ok;
    }

    bool ReleaseDispatcherRoute(
        Execution execution,
        string ownerId)
    {
        var ok =
            _dispatcher.ReleaseRoute(
                ownerId);

        execution.DispatcherOwners.TryRemove(
            ownerId,
            out _);

        return ok;
    }

    async Task ApplySmartSpeed(
        SmartRun run)
    {
        var speed =
            run.MotionAuthorized
                ? Math.Clamp(
                    run.DesiredSpeed,
                    0,
                    126)
                : 0;

        await SetLoco(
            run.LocoAddress,
            speed,
            run.Direction,
            run.Cancellation.Token);
    }

    void PulseSmart(
        SmartRun run)
    {
        var old =
            run.Changed;

        run.Changed =
            NewSignal();

        old.TrySetResult(
            true);
    }

    async Task WaitSmartChanged(
        SmartRun run,
        CancellationToken ct)
    {
        var task =
            run.Changed.Task;

        await task.WaitAsync(
            ct);
    }

    async Task<string> StartSmart(
        Execution execution,
        string blocksJson,
        string optionsJson)
    {
        var names =
            ParseBlockNames(
                blocksJson);

        var plan =
            _planBuilder.BuildForBlockNames(
                names);

        var source =
            SourceBlock(
                plan) ??
            throw new InvalidOperationException(
                "smart_dispatcher_source_not_found");

        if (source.LocoAddress == 0)
            return JsonSerializer.Serialize(
                new
                {
                    status =
                        "empty",
                    direction =
                        plan.Direction
                });

        if (plan.Direction is not
            ("forward" or "reverse"))
            throw new InvalidOperationException(
                "smart_dispatcher_direction_unknown");

        var linked =
            CancellationTokenSource
                .CreateLinkedTokenSource(
                    execution.Cancellation.Token);

        var run =
            new SmartRun
            {
                Id =
                    "smart:" +
                    execution.ExecutionId +
                    ":" +
                    Guid.NewGuid().ToString("N"),
                Execution =
                    execution,
                Plan =
                    plan,
                LocoAddress =
                    source.LocoAddress,
                Direction =
                    plan.Direction,
                Forward =
                    plan.Direction ==
                    "forward",
                Cancellation =
                    linked
            };

        execution.SmartRuns[
            run.Id] =
            run;

        run.MonitorTask =
            Task.Run(
                () =>
                    MonitorSmart(
                        run),
                CancellationToken.None);

        return JsonSerializer.Serialize(
            new
            {
                status =
                    "started",
                runId =
                    run.Id,
                loco =
                    run.LocoAddress,
                direction =
                    run.Direction
            });
    }

    async Task MonitorSmart(
        SmartRun run)
    {
        try
        {
            await ApplySmartSpeed(
                run);

            for (var index = 0;
                 index < run.Plan.Legs.Length;
                 index++)
            {
                var leg =
                    run.Plan.Legs[index];

                DispatcherLegLeaseInfo? lease =
                    null;

                while (lease is null)
                {
                    run.Cancellation.Token.ThrowIfCancellationRequested();

                    run.MotionAuthorized =
                        false;

                    await ApplySmartSpeed(
                        run);

                    var ownerId =
                        "script-smart:" +
                        run.Execution.ExecutionId +
                        ":" +
                        run.Id +
                        ":" +
                        index;

                    var safety =
                        leg.Resources
                            .SelectMany(resource =>
                                resource.Detectors)
                            .Concat(
                                leg.To.SensorAddress.HasValue
                                    ? [
                                        leg.To.SensorAddress.Value
                                      ]
                                    : [])
                            .Where(sensor =>
                                sensor is >= 1 and <= 65535)
                            .Distinct()
                            .Select(sensor =>
                                (ushort)sensor)
                            .ToArray();

                    var resources =
                        leg.Resources
                            .Where(resource =>
                                resource.Kind ==
                                "segment")
                            .Select(resource =>
                                "segment:" +
                                resource.Name)
                            .Distinct(
                                StringComparer.Ordinal)
                            .ToArray();

                    var attempt =
                        await _dispatcher.AcquireLegAsync(
                            new DispatcherLegRequest(
                                ownerId,
                                "SmartDispatcher: " +
                                    run.Execution.Name,
                                (ushort)run.LocoAddress,
                                (ushort)leg.From.BlockId!.Value,
                                (ushort)leg.To.BlockId!.Value,
                                leg.TurnoutStates,
                                safety,
                                resources,
                                0,
                                250),
                            run.Cancellation.Token);

                    if (attempt.Ok &&
                        attempt.Lease is not null)
                    {
                        lease =
                            attempt.Lease;

                        run.ReservationOwnerId =
                            ownerId;

                        run.Execution.DispatcherOwners.TryAdd(
                            ownerId,
                            0);

                        break;
                    }

                    var error =
                        attempt.Error ??
                        "smart_dispatcher_failed";

                    if (error is
                            "destination_block_busy" or
                            "safety_sensor_not_free" or
                            "turnout_locked" or
                            "turnout_lock_timeout" ||
                        error.StartsWith(
                            "dispatcher_resource_locked:",
                            StringComparison.Ordinal))
                    {
                        SetInfo(
                            run.Execution,
                            "SmartDispatcher waiting: " +
                            leg.From.Name +
                            " -> " +
                            leg.To.Name +
                            " (" +
                            error +
                            ")");

                        await Task.Delay(
                            150,
                            run.Cancellation.Token);

                        continue;
                    }

                    throw new InvalidOperationException(
                        error);
                }

                run.MotionAuthorized =
                    true;

                PulseSmart(
                    run);

                await ApplySmartSpeed(
                    run);

                while (true)
                {
                    run.Cancellation.Token.ThrowIfCancellationRequested();

                    var arrived =
                        leg.ArrivedWhen.Length >
                        0
                            ? leg.ArrivedWhen.All(
                                condition =>
                                    condition.Sensor is >= 1 and <= 65535 &&
                                    _layout.TryGetSensorState(
                                        (ushort)condition.Sensor,
                                        out var state) &&
                                    state ==
                                        condition.State)
                            : leg.To.SensorAddress is >= 1 and <= 65535 &&
                              _layout.TryGetSensorState(
                                  (ushort)leg.To.SensorAddress.Value,
                                  out var on) &&
                              on;

                    if (arrived)
                        break;

                    await Task.Delay(
                        75,
                        run.Cancellation.Token);
                }

                if (leg.To.BlockId is >= 1 and <= 65535)
                {
                    if (!_layout.SetBlock(
                            (ushort)leg.To.BlockId.Value,
                            "",
                            (ushort)run.LocoAddress))
                        throw new InvalidOperationException(
                            "smart_dispatcher_block_commit_failed");
                }

                if (run.ReservationOwnerId is not null)
                {
                    _dispatcher.ReleaseLeg(
                        run.ReservationOwnerId);

                    run.Execution.DispatcherOwners.TryRemove(
                        run.ReservationOwnerId,
                        out _);

                    run.ReservationOwnerId =
                        null;
                }

                run.CurrentIndex =
                    index +
                    1;

                PulseSmart(
                    run);
            }

            run.Completed =
                true;

            run.MotionAuthorized =
                false;

            run.DesiredSpeed =
                0;

            await ApplySmartSpeed(
                run);

            run.CompletedSignal.TrySetResult(
                true);

            PulseSmart(
                run);
        }
        catch (OperationCanceledException)
        {
            run.MotionAuthorized =
                false;

            run.DesiredSpeed =
                0;

            try
            {
                await SetLoco(
                    run.LocoAddress,
                    0,
                    run.Direction,
                    CancellationToken.None);
            }
            catch
            {
            }

            run.CompletedSignal.TrySetCanceled(
                run.Cancellation.Token);
        }
        catch (Exception ex)
        {
            run.MotionAuthorized =
                false;

            try
            {
                await SetLoco(
                    run.LocoAddress,
                    0,
                    run.Direction,
                    CancellationToken.None);
            }
            catch
            {
            }

            run.CompletedSignal.TrySetException(
                ex);

            WriteLog(
                run.Execution,
                "SmartDispatcher error: " +
                ex.Message);
        }
        finally
        {
            if (run.ReservationOwnerId is not null)
            {
                _dispatcher.ReleaseLeg(
                    run.ReservationOwnerId);

                run.Execution.DispatcherOwners.TryRemove(
                    run.ReservationOwnerId,
                    out _);

                run.ReservationOwnerId =
                    null;
            }
        }
    }

    SmartRun SmartRunFor(
        Execution execution,
        string runId)
    {
        if (!execution.SmartRuns.TryGetValue(
                runId,
                out var run))
            throw new InvalidOperationException(
                "smart_dispatcher_run_not_found");

        return run;
    }

    int SmartSetSpeed(
        Execution execution,
        string runId,
        int speed)
    {
        var run =
            SmartRunFor(
                execution,
                runId);

        run.DesiredSpeed =
            Math.Clamp(
                speed,
                0,
                126);

        _ =
            ApplySmartSpeed(
                run);

        return run.DesiredSpeed;
    }

    async Task<bool> SmartWaitBlock(
        Execution execution,
        string runId,
        string blockName,
        double rawTimeoutMs)
    {
        var run =
            SmartRunFor(
                execution,
                runId);

        var targetIndex =
            Array.FindIndex(
                run.Plan.Blocks,
                block =>
                    string.Equals(
                        block.Name,
                        blockName,
                        StringComparison.OrdinalIgnoreCase));

        if (targetIndex < 0)
            throw new InvalidOperationException(
                "smart_dispatcher_block_not_in_route:" +
                blockName);

        var timeoutMs =
            rawTimeoutMs < 0
                ? -1L
                : Math.Clamp(
                    (long)Math.Round(
                        rawTimeoutMs),
                    0,
                    86_400_000);

        var started =
            Environment.TickCount64;

        while (run.CurrentIndex <
               targetIndex)
        {
            if (timeoutMs >= 0 &&
                Environment.TickCount64 -
                    started >=
                timeoutMs)
                throw new TimeoutException(
                    "smart_dispatcher_wait_block_timeout");

            await WaitSmartChanged(
                run,
                run.Cancellation.Token);
        }

        return true;
    }

    async Task<bool> SmartWaitClearance(
        Execution execution,
        string runId,
        double rawTimeoutMs)
    {
        var run =
            SmartRunFor(
                execution,
                runId);

        var timeoutMs =
            rawTimeoutMs < 0
                ? -1L
                : Math.Clamp(
                    (long)Math.Round(
                        rawTimeoutMs),
                    0,
                    86_400_000);

        var started =
            Environment.TickCount64;

        while (!run.MotionAuthorized &&
               !run.Completed)
        {
            if (timeoutMs >= 0 &&
                Environment.TickCount64 -
                    started >=
                timeoutMs)
                throw new TimeoutException(
                    "smart_dispatcher_wait_clearance_timeout");

            await WaitSmartChanged(
                run,
                run.Cancellation.Token);
        }

        return true;
    }

    async Task<bool> SmartWaitComplete(
        Execution execution,
        string runId)
    {
        var run =
            SmartRunFor(
                execution,
                runId);

        await run.CompletedSignal.Task.WaitAsync(
            execution.Cancellation.Token);

        return true;
    }

    bool SmartAbort(
        Execution execution,
        string runId)
    {
        if (!execution.SmartRuns.TryRemove(
                runId,
                out var run))
            return false;

        run.Cancellation.Cancel();

        return true;
    }

    async Task<bool> RequestAudio(
        Execution execution,
        string rawSource)
    {
        var fileName =
            AudioPath(
                rawSource);

        if (fileName.Length == 0)
            return false;

        var requestId =
            "script-backend:" +
            execution.ExecutionId +
            ":" +
            Guid.NewGuid().ToString("N");

        var tcs =
            new TaskCompletionSource<bool>(
                TaskCreationOptions.RunContinuationsAsynchronously);

        if (!_pendingAudio.TryAdd(
                requestId,
                tcs))
            return false;

        using var registration =
            execution.Cancellation.Token.Register(
                () =>
                    tcs.TrySetCanceled(
                        execution.Cancellation.Token));

        AudioRequested?.Invoke(
            new ScriptAudioRequest(
                requestId,
                fileName,
                true));

        try
        {
            return await tcs.Task;
        }
        finally
        {
            _pendingAudio.TryRemove(
                requestId,
                out _);
        }
    }

    public bool CompleteAudio(
        string requestId,
        bool ok) =>
        _pendingAudio.TryGetValue(
            requestId,
            out var pending) &&
        pending.TrySetResult(
            ok);

    public void FailPendingAudio()
    {
        foreach (var pending in
                 _pendingAudio.Values)
            pending.TrySetResult(
                false);
    }

    string Bootstrap()
    {
        return """
const dcc = Object.freeze({
  setPower: on => __dccSetPower(Boolean(on)),
  setProgrammingPower: on => __dccSetProgrammingPower(Boolean(on)),
  emergencyStop: () => __dccEmergencyStop(),
  setLoco: (address, speed, direction = "forward") =>
    __dccSetLoco(Number(address), Number(speed), String(direction)),
  setLocoFunction: (address, fn, active) =>
    __dccSetLocoFunction(Number(address), Number(fn), Boolean(active)),
  setLocoFunctionBinding: (address, bindingId, active) =>
    __dccSetLocoFunctionBinding(Number(address), Number(bindingId), Boolean(active)),
  setTurnout: (address, closed) =>
    __dccSetTurnout(Number(address), Boolean(closed)),
  setTurnoutRaw: (address, closed) =>
    __dccSetTurnoutRaw(Number(address), Boolean(closed)),
  getTurnout: address => __dccGetTurnout(Number(address)),
  isClosed: address => __dccGetTurnout(Number(address)),
  isThrown: address => !__dccGetTurnout(Number(address)),
  setClosed: address => __dccSetTurnout(Number(address), true),
  setThrown: address => __dccSetTurnout(Number(address), false),
  waitForTurnout: (address, closed, timeoutMs = -1) =>
    __dccWaitTurnout(Number(address), Boolean(closed), Number(timeoutMs ?? -1)),
  waitForClosed: (address, timeoutMs = -1) =>
    __dccWaitTurnout(Number(address), true, Number(timeoutMs ?? -1)),
  waitForThrown: (address, timeoutMs = -1) =>
    __dccWaitTurnout(Number(address), false, Number(timeoutMs ?? -1)),
  setSensor: (address, on) =>
    __dccSetSensor(Number(address), Boolean(on)),
  getSensor: address => __dccGetSensor(Number(address)),
  waitForSensor: (address, on, timeoutMs = -1) =>
    __dccWaitSensor(Number(address), Boolean(on), Number(timeoutMs ?? -1)),
  setAccessory: (address, active) =>
    __dccSetAccessory(Number(address), Boolean(active)),
  setSignalAspect: (address, aspect) =>
    __dccSetSignalAspect(Number(address), Number(aspect)),
  getSignalState: address => __dccGetSignalState(Number(address)),
  isSignalState: (address, stateName) =>
    String(__dccGetSignalState(Number(address))).toLowerCase() === String(stateName).trim().toLowerCase(),
  setSignalState: (address, stateName) =>
    __dccSetSignalState(Number(address), String(stateName)),
  setRed: address => __dccSetSignalState(Number(address), "Red"),
  setGreen: address => __dccSetSignalState(Number(address), "Green"),
  setYellow: address => __dccSetSignalState(Number(address), "Yellow"),
  setWhite: address => __dccSetSignalState(Number(address), "White"),
  isRed: address => String(__dccGetSignalState(Number(address))).toLowerCase() === "red",
  isGreen: address => String(__dccGetSignalState(Number(address))).toLowerCase() === "green",
  isYellow: address => String(__dccGetSignalState(Number(address))).toLowerCase() === "yellow",
  isWhite: address => String(__dccGetSignalState(Number(address))).toLowerCase() === "white",
  waitForSignalState: (address, stateName, timeoutMs = -1) =>
    __dccWaitSignalState(Number(address), String(stateName), Number(timeoutMs ?? -1)),
  waitForRed: (address, timeoutMs = -1) =>
    __dccWaitSignalState(Number(address), "Red", Number(timeoutMs ?? -1)),
  waitForGreen: (address, timeoutMs = -1) =>
    __dccWaitSignalState(Number(address), "Green", Number(timeoutMs ?? -1)),
  waitForYellow: (address, timeoutMs = -1) =>
    __dccWaitSignalState(Number(address), "Yellow", Number(timeoutMs ?? -1)),
  waitForWhite: (address, timeoutMs = -1) =>
    __dccWaitSignalState(Number(address), "White", Number(timeoutMs ?? -1)),
  getBlock: block => __dccGetBlock(String(block)),
  getBlockTargetLoco: block => __dccGetBlockTarget(String(block)),
  setBlockTargetLoco: (block, loco) => __dccSetBlockTarget(String(block), Number(loco)),
  clearBlockTargetLoco: block => __dccClearBlockTarget(String(block)),
  setBlock: (block, loco) => __dccSetBlock(String(block), Number(loco)),
  block: (block, locoId, locoAddress) => __dccBlock(String(block), locoId == null ? "" : String(locoId), locoAddress == null ? 0 : Number(locoAddress)),
  clearBlock: block => __dccClearBlock(String(block)),
  resetBlocks: () => __dccResetBlocks(),
  playAudio: source => __dccPlayAudio(String(source)),
  sendRaw: command => __dccSendRaw(String(command)),
  power(on) { return this.setPower(on); },
  programmingPower(on) { return this.setProgrammingPower(on); },
  loco(address, speed, direction = "forward") { return this.setLoco(address, speed, direction); },
  locoFunction(address, fn, active) { return this.setLocoFunction(address, fn, active); },
  turnout(address, closed) { return this.setTurnoutRaw(address, closed); },
  sensor(address, on) { return this.setSensor(address, on); },
  accessory(address, active) { return this.setAccessory(address, active); },
  signal(address, aspect) { return this.setSignalAspect(address, aspect); },
  raw(command) { return this.sendRaw(command); },
});

const delay = ms => __delay(Number(ms));
const playAudio = source => dcc.playAudio(source);
const log = (...values) => __log(JSON.stringify(values));
const setInfo = value => __setInfo(value == null ? "" : String(value));
const isRunning = () => !__isFinishing();
const isFinishing = () => __isFinishing();

const __taskStates = new Map();
function startTask(name, taskFunction) {
  const key = String(name);
  const existing = __taskStates.get(key);
  if (existing && existing.running) {
    return Object.freeze({ started: false, reason: "already-running" });
  }
  if (isFinishing()) {
    return Object.freeze({ started: false, reason: "finishing" });
  }
  const state = {
    name: key,
    running: true,
    status: "running",
    runCount: (existing?.runCount ?? 0) + 1,
    startedAt: Date.now(),
    finishedAt: null,
    lastResult: null,
    lastError: null,
  };
  __taskStates.set(key, state);
  Promise.resolve()
    .then(() => taskFunction())
    .then(result => {
      state.running = false;
      state.status = "completed";
      state.finishedAt = Date.now();
      state.lastResult = result ?? null;
    })
    .catch(error => {
      state.running = false;
      state.status = "error";
      state.finishedAt = Date.now();
      state.lastError = error instanceof Error ? error.message : String(error);
      log("Task error", key, state.lastError);
    });
  return Object.freeze({ started: true, reason: null });
}
function isTaskRunning(name) {
  return Boolean(__taskStates.get(String(name))?.running);
}
function getTaskState(name) {
  const state = __taskStates.get(String(name));
  return state ? Object.freeze({ ...state }) : null;
}

async function switchMan(addresses, callback, timeoutMs = 0) {
  if (!Array.isArray(addresses) || typeof callback !== "function") {
    throw new Error("switchMan(addresses, callback, timeoutMs?): invalid arguments.");
  }
  const ownerId = await __switchAcquire(JSON.stringify(addresses), Number(timeoutMs ?? 0));
  const sw = Object.freeze({
    setTurnout: (address, closed) =>
      __switchSet(ownerId, Number(address), Boolean(closed)),
  });
  try {
    return await callback(sw);
  } finally {
    __switchRelease(ownerId);
  }
}

async function setRoute(name, delayMs = 250) {
  return await __setRoute(String(name), Number(delayMs ?? 250));
}

async function dispatcher(blocks, callback, options = {}) {
  if (!Array.isArray(blocks) || typeof callback !== "function") {
    throw new Error("dispatcher(blocks, callback, options?): invalid arguments.");
  }
  const safeOptions = {
    timeoutMs: Number.isFinite(options?.timeoutMs) ? Number(options.timeoutMs) : undefined,
    setDelayMs: Number.isFinite(options?.setDelayMs) ? Number(options.setDelayMs) : 250,
    blockPollMs: Number.isFinite(options?.blockPollMs) ? Number(options.blockPollMs) : 250,
  };
  const result = JSON.parse(await __dispatcherAcquire(JSON.stringify(blocks), JSON.stringify(safeOptions)));
  if (result.status === "empty") {
    if (typeof options?.onEmpty === "function") {
      await options.onEmpty(result.direction);
      return Object.freeze({ status: "empty", loco: 0, dir: result.direction });
    }
    throw new Error("dispatcher_empty_source");
  }
  if (result.status === "blocked") {
    if (typeof options?.onBlocked === "function") {
      await options.onBlocked(result.loco, result.direction, result);
    }
    return Object.freeze({ status: "blocked", loco: result.loco, dir: result.direction, conflicts: result });
  }
  let committed = false;
  try {
    await callback(result.loco, result.direction);
    if (!__dispatcherCommit(result.ownerId)) {
      throw new Error("dispatcher_route_commit_failed");
    }
    committed = true;
    return Object.freeze({ status: "completed", loco: result.loco, dir: result.direction });
  } finally {
    if (!committed) {
      __dispatcherRelease(result.ownerId);
    }
  }
}

async function smartDispatcher(blocks, callback, options = {}) {
  if (!Array.isArray(blocks) || typeof callback !== "function") {
    throw new Error("smartDispatcher(blocks, callback, options?): invalid arguments.");
  }
  const started = JSON.parse(await __smartStart(JSON.stringify(blocks), JSON.stringify({})));
  if (started.status === "empty") {
    if (typeof options?.onEmpty === "function") {
      await options.onEmpty(started.direction);
      return Object.freeze({ status: "empty", loco: 0, dir: started.direction });
    }
    throw new Error("smart_dispatcher_empty_source");
  }
  const runId = started.runId;
  const run = Object.freeze({
    setSpeed: speed => __smartSetSpeed(runId, Number(speed)),
    waitForBlock: (blockName, timeoutMs = -1) =>
      __smartWaitBlock(runId, String(blockName), Number(timeoutMs ?? -1)),
    waitForClearance: (timeoutMs = -1) =>
      __smartWaitClearance(runId, Number(timeoutMs ?? -1)),
  });
  try {
    await Promise.all([
      __smartWaitComplete(runId),
      Promise.resolve().then(() => callback(started.loco, started.direction, run)),
    ]);
    return Object.freeze({
      status: "completed",
      loco: started.loco,
      dir: started.direction,
      block: Array.isArray(blocks) ? String(blocks[blocks.length - 1]) : "",
    });
  } finally {
    __smartAbort(runId);
  }
}
""";
    }

    void ConfigureEngine(
        Engine engine,
        Execution execution)
    {
        engine.SetValue(
            "__delay",
            new Func<double, Task>(
                ms =>
                    Delay(
                        execution,
                        ms)));

        engine.SetValue(
            "__log",
            new Action<string>(
                raw =>
                {
                    try
                    {
                        var values =
                            JsonSerializer.Deserialize<object[]>(
                                raw) ??
                            [];

                        WriteLog(
                            execution,
                            string.Join(
                                " ",
                                values.Select(value =>
                                    value?.ToString() ??
                                    "null")));
                    }
                    catch
                    {
                        WriteLog(
                            execution,
                            raw);
                    }
                }));

        engine.SetValue(
            "__setInfo",
            new Action<string>(
                value =>
                    SetInfo(
                        execution,
                        value)));

        engine.SetValue(
            "__isFinishing",
            new Func<bool>(
                () =>
                    Finishing));

        engine.SetValue(
            "__dccSetPower",
            new Func<bool, Task<bool>>(
                async on =>
                {
                    await WaitRunnable(
                        execution);

                    var ok =
                        await _commandCenter.SetTrackPowerAsync(
                            on,
                            true,
                            execution.Cancellation.Token);

                    if (!ok)
                        throw new InvalidOperationException(
                            "script_power_command_failed");

                    return true;
                }));

        engine.SetValue(
            "__dccSetProgrammingPower",
            new Func<bool, Task<bool>>(
                async on =>
                {
                    await WaitRunnable(
                        execution);

                    var ok =
                        await _commandCenter.SetProgrammingPowerAsync(
                            on,
                            execution.Cancellation.Token);

                    if (!ok)
                        throw new InvalidOperationException(
                            "script_programming_power_failed");

                    return true;
                }));

        engine.SetValue(
            "__dccEmergencyStop",
            new Func<Task<bool>>(
                async () =>
                {
                    var ok =
                        await _commandCenter.EmergencyStopAsync(
                            execution.Cancellation.Token);

                    if (ok)
                    {
                        _hubState.EmergencyStop =
                            _commandCenter.EmergencyPauseStateKnown
                                ? _commandCenter.EmergencyPaused
                                : true;

                        PowerStateChanged?.Invoke();
                    }

                    return ok;
                }));

        engine.SetValue(
            "__dccSetLoco",
            new Func<double, double, string, Task<bool>>(
                async (address, speed, direction) =>
                {
                    await WaitRunnable(
                        execution);

                    await SetLoco(
                        (int)Math.Round(address),
                        (int)Math.Round(speed),
                        direction,
                        execution.Cancellation.Token);

                    return true;
                }));

        engine.SetValue(
            "__dccSetLocoFunction",
            new Func<double, double, bool, Task<bool>>(
                async (address, fn, active) =>
                {
                    await WaitRunnable(
                        execution);

                    await SetLocoFunction(
                        (int)Math.Round(address),
                        (int)Math.Round(fn),
                        active,
                        execution.Cancellation.Token);

                    return true;
                }));

        engine.SetValue(
            "__dccSetLocoFunctionBinding",
            new Func<double, double, bool, Task<bool>>(
                async (address, bindingId, active) =>
                {
                    await WaitRunnable(
                        execution);

                    await SetLocoFunctionBinding(
                        (int)Math.Round(address),
                        (int)Math.Round(bindingId),
                        active,
                        execution.Cancellation.Token);

                    return true;
                }));

        engine.SetValue(
            "__dccSetTurnout",
            new Func<double, bool, Task<bool>>(
                async (address, closed) =>
                {
                    await SetSemanticTurnout(
                        (int)Math.Round(address),
                        closed,
                        null,
                        execution.Cancellation.Token);

                    return true;
                }));

        engine.SetValue(
            "__dccSetTurnoutRaw",
            new Func<double, bool, Task<bool>>(
                async (address, closed) =>
                {
                    await SetRawTurnout(
                        (int)Math.Round(address),
                        closed,
                        execution.Cancellation.Token);

                    return true;
                }));

        engine.SetValue(
            "__dccGetTurnout",
            new Func<double, bool>(
                address =>
                    _layout.TryGetTurnoutClosed(
                        (ushort)Math.Clamp(
                            (int)Math.Round(address),
                            1,
                            2048),
                        out var closed) &&
                    closed));

        engine.SetValue(
            "__dccWaitTurnout",
            new Func<double, bool, double, Task<bool>>(
                (address, closed, timeout) =>
                    WaitTurnout(
                        execution,
                        (int)Math.Round(address),
                        closed,
                        timeout)));

        engine.SetValue(
            "__dccSetSensor",
            new Func<double, bool, bool>(
                (address, on) =>
                    _layout.SetSensor(
                        (ushort)Math.Clamp(
                            (int)Math.Round(address),
                            1,
                            65535),
                        on)));

        engine.SetValue(
            "__dccGetSensor",
            new Func<double, bool>(
                address =>
                    _layout.TryGetSensorState(
                        (ushort)Math.Clamp(
                            (int)Math.Round(address),
                            1,
                            65535),
                        out var on) &&
                    on));

        engine.SetValue(
            "__dccWaitSensor",
            new Func<double, bool, double, Task<bool>>(
                (address, on, timeout) =>
                    WaitSensor(
                        execution,
                        (int)Math.Round(address),
                        on,
                        timeout)));

        engine.SetValue(
            "__dccSetAccessory",
            new Func<double, bool, Task<bool>>(
                async (address, active) =>
                {
                    var a =
                        (ushort)Math.Clamp(
                            (int)Math.Round(address),
                            1,
                            2048);

                    if (!_switchMan.CanOperate(
                            a,
                            null,
                            out _))
                        throw new InvalidOperationException(
                            "turnout_locked:" +
                            a);

                    if (!await _commandCenter.SetAccessoryAsync(
                            a,
                            active,
                            execution.Cancellation.Token))
                        throw new InvalidOperationException(
                            "accessory_command_failed");

                    _layout.SetAccessory(
                        a,
                        active);

                    return true;
                }));

        engine.SetValue(
            "__dccSetSignalAspect",
            new Func<double, double, Task<bool>>(
                async (address, aspect) =>
                {
                    var a =
                        (ushort)Math.Clamp(
                            (int)Math.Round(address),
                            1,
                            2048);

                    var value =
                        Math.Clamp(
                            (int)Math.Round(aspect),
                            0,
                            255);

                    if (!await _commandCenter.SetSignalAspectAsync(
                            a,
                            value,
                            execution.Cancellation.Token))
                        throw new InvalidOperationException(
                            "signal_command_failed");

                    _layout.SetSignal(
                        a,
                        value);

                    return true;
                }));

        engine.SetValue(
            "__dccGetSignalState",
            new Func<double, string>(
                address =>
                    GetSignalState(
                        (int)Math.Round(address))));

        engine.SetValue(
            "__dccSetSignalState",
            new Func<double, string, Task<bool>>(
                async (address, stateName) =>
                {
                    await SetSignalState(
                        (int)Math.Round(address),
                        stateName,
                        execution.Cancellation.Token);

                    return true;
                }));

        engine.SetValue(
            "__dccWaitSignalState",
            new Func<double, string, double, Task<bool>>(
                (address, stateName, timeout) =>
                    WaitSignalState(
                        execution,
                        (int)Math.Round(address),
                        stateName,
                        timeout)));

        engine.SetValue(
            "__dccGetBlock",
            new Func<string, int>(
                GetBlock));

        engine.SetValue(
            "__dccGetBlockTarget",
            new Func<string, int>(
                GetBlockTarget));

        engine.SetValue(
            "__dccSetBlockTarget",
            new Action<string, double>(
                (block, loco) =>
                    SetBlockTarget(
                        execution,
                        block,
                        (int)Math.Round(loco))));

        engine.SetValue(
            "__dccClearBlockTarget",
            new Action<string>(
                ClearBlockTarget));

        engine.SetValue(
            "__dccSetBlock",
            new Action<string, double>(
                (block, loco) =>
                {
                    var id =
                        ResolveBlockId(
                            block);

                    if (!_layout.SetBlock(
                            id,
                            "",
                            (ushort)Math.Clamp(
                                (int)Math.Round(loco),
                                1,
                                10239)))
                        throw new InvalidOperationException(
                            "set_block_failed");
                }));

        engine.SetValue(
            "__dccBlock",
            new Action<string, string, double>(
                (block, locoId, loco) =>
                {
                    var id =
                        ResolveBlockId(
                            block);

                    if (!_layout.SetBlock(
                            id,
                            locoId,
                            (ushort)Math.Clamp(
                                (int)Math.Round(loco),
                                0,
                                10239)))
                        throw new InvalidOperationException(
                            "block_command_failed");
                }));

        engine.SetValue(
            "__dccClearBlock",
            new Action<string>(
                block =>
                    _layout.RemoveBlock(
                        ResolveBlockId(
                            block))));

        engine.SetValue(
            "__dccResetBlocks",
            new Func<bool>(
                _layout.ClearBlocks));

        engine.SetValue(
            "__dccPlayAudio",
            new Func<string, Task<bool>>(
                source =>
                    RequestAudio(
                        execution,
                        source)));

        engine.SetValue(
            "__dccSendRaw",
            new Func<string, Task<bool>>(
                command =>
                    _commandCenter.SendRawAsync(
                        command,
                        true,
                        execution.Cancellation.Token)));

        engine.SetValue(
            "__switchAcquire",
            new Func<string, double, Task<string>>(
                (addresses, timeout) =>
                    SwitchAcquire(
                        execution,
                        addresses,
                        timeout)));

        engine.SetValue(
            "__switchSet",
            new Func<string, double, bool, Task<bool>>(
                (ownerId, address, closed) =>
                    SwitchSet(
                        execution,
                        ownerId,
                        (int)Math.Round(address),
                        closed)));

        engine.SetValue(
            "__switchRelease",
            new Func<string, bool>(
                ownerId =>
                    SwitchRelease(
                        execution,
                        ownerId)));

        engine.SetValue(
            "__setRoute",
            new Func<string, double, Task<bool>>(
                (name, delayMs) =>
                    SetRouteButton(
                        execution,
                        name,
                        delayMs)));

        engine.SetValue(
            "__dispatcherAcquire",
            new Func<string, string, Task<string>>(
                (blocks, options) =>
                    AcquireDispatcherRoute(
                        execution,
                        blocks,
                        options)));

        engine.SetValue(
            "__dispatcherCommit",
            new Func<string, bool>(
                ownerId =>
                    CommitDispatcherRoute(
                        execution,
                        ownerId)));

        engine.SetValue(
            "__dispatcherRelease",
            new Func<string, bool>(
                ownerId =>
                    ReleaseDispatcherRoute(
                        execution,
                        ownerId)));

        engine.SetValue(
            "__smartStart",
            new Func<string, string, Task<string>>(
                (blocks, options) =>
                    StartSmart(
                        execution,
                        blocks,
                        options)));

        engine.SetValue(
            "__smartSetSpeed",
            new Func<string, double, int>(
                (runId, speed) =>
                    SmartSetSpeed(
                        execution,
                        runId,
                        (int)Math.Round(speed))));

        engine.SetValue(
            "__smartWaitBlock",
            new Func<string, string, double, Task<bool>>(
                (runId, blockName, timeout) =>
                    SmartWaitBlock(
                        execution,
                        runId,
                        blockName,
                        timeout)));

        engine.SetValue(
            "__smartWaitClearance",
            new Func<string, double, Task<bool>>(
                (runId, timeout) =>
                    SmartWaitClearance(
                        execution,
                        runId,
                        timeout)));

        engine.SetValue(
            "__smartWaitComplete",
            new Func<string, Task<bool>>(
                runId =>
                    SmartWaitComplete(
                        execution,
                        runId)));

        engine.SetValue(
            "__smartAbort",
            new Func<string, bool>(
                runId =>
                    SmartAbort(
                        execution,
                        runId)));
    }

    async Task RunExecution(
        Execution execution)
    {
        try
        {
            var engine =
                new Engine(
                    options =>
                    {
                        options.ExperimentalFeatures =
                            ExperimentalFeature.TaskInterop;

                        options.Constraints.PromiseTimeout =
                            TimeSpan.FromDays(
                                7);
                    });

            ConfigureEngine(
                engine,
                execution);

            await engine.ExecuteAsync(
                Bootstrap(),
                cancellationToken:
                    execution.Cancellation.Token);

            var wrapped =
                "(async () => {\n" +
                "\"use strict\";\n" +
                execution.Source +
                "\n})()";

            await engine.EvaluateAsync(
                wrapped,
                cancellationToken:
                    execution.Cancellation.Token);

            Patch(
                execution,
                status:
                    "idle",
                error:
                    null,
                setError:
                    true,
                stoppedAt:
                    NowMs(),
                setStoppedAt:
                    true);
        }
        catch (OperationCanceledException)
        {
            Patch(
                execution,
                status:
                    "idle",
                error:
                    null,
                setError:
                    true,
                stoppedAt:
                    NowMs(),
                setStoppedAt:
                    true);
        }
        catch (Exception ex)
        {
            WriteLog(
                execution,
                "ERROR: " +
                ex.Message);

            Patch(
                execution,
                status:
                    "error",
                error:
                    ex.Message,
                setError:
                    true,
                stoppedAt:
                    NowMs(),
                setStoppedAt:
                    true);
        }
        finally
        {
            foreach (var smart in
                     execution.SmartRuns.Values)
            {
                try
                {
                    smart.Cancellation.Cancel();
                }
                catch
                {
                }
            }

            foreach (var ownerId in
                     execution.DispatcherOwners.Keys)
            {
                _dispatcher.ReleaseLeg(
                    ownerId);

                _dispatcher.ReleaseRoute(
                    ownerId);
            }

            foreach (var ownerId in
                     execution.SwitchOwners.Keys)
                _switchMan.ReleaseOwned(
                    null,
                    ownerId);

            execution.SwitchOwners.Clear();

            _scriptInfo.Update(
                execution.ExecutionId,
                execution.InfoOwnerId,
                "",
                true);

            lock (_gate)
                _executions.Remove(
                    execution.ExecutionId);

            execution.Cancellation.Dispose();
        }
    }
}
