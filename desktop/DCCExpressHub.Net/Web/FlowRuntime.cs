using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed record FlowRuntimePageState(
    string PageId,
    string Name,
    bool Enabled,
    int ActiveExecutions);

public sealed record FlowRuntimeSnapshot(
    FlowRuntimePageState[] Pages);

public sealed record FlowRuntimeLog(
    string PageId,
    long Timestamp,
    string Level,
    object?[] Values);

/// <summary>
/// Backend-authoritative visual Flow runtime.
///
/// The WebUI persists/edits the graph only. Event matching, interval timing,
/// branch selection and execution live here. Action branches are compiled into
/// the same backend ScriptRuntime API used by hand-written automation scripts,
/// so Flow and Script cannot drift into separate DCC/SwitchMan semantics.
/// </summary>
public sealed class FlowRuntime : BackgroundService
{
    sealed record PageDef(
        string Id,
        string Name,
        bool Enabled);

    sealed record NodeDef(
        string Id,
        string PageId,
        string Kind,
        JsonElement Data);

    sealed record EdgeDef(
        string Source,
        string Target);

    sealed record DocumentDef(
        PageDef[] Pages,
        NodeDef[] Nodes,
        EdgeDef[] Edges);

    readonly object _gate = new();
    readonly IWebHostEnvironment _env;
    readonly LayoutRuntime _layout;
    readonly HubState _hubState;
    readonly ICommandCenter _commandCenter;
    readonly ScriptRuntime _scripts;
    readonly TrainEventRuntime _trainEvents;
    readonly AutomationExclusiveGate _exclusiveGate;
    readonly ILogger<FlowRuntime> _log;

    readonly Dictionary<string, string> _blockSignatures =
        new(StringComparer.Ordinal);
    readonly Dictionary<int, string> _locoSignatures =
        [];
    readonly Dictionary<string, long> _nextIntervals =
        new(StringComparer.Ordinal);
    readonly ConcurrentDictionary<string, string> _executionPages =
        new(StringComparer.Ordinal);
    readonly ConcurrentDictionary<string, string> _executionInputs =
        new(StringComparer.Ordinal);

    long _manualSequence;

    public event Action<FlowRuntimeSnapshot>? Changed;
    public event Action<FlowRuntimeLog>? LogChanged;

    public FlowRuntime(
        IWebHostEnvironment env,
        LayoutRuntime layout,
        HubState hubState,
        ICommandCenter commandCenter,
        ScriptRuntime scripts,
        TrainEventRuntime trainEvents,
        AutomationExclusiveGate exclusiveGate,
        ILogger<FlowRuntime> log)
    {
        _env = env;
        _layout = layout;
        _hubState = hubState;
        _commandCenter = commandCenter;
        _scripts = scripts;
        _trainEvents = trainEvents;
        _exclusiveGate = exclusiveGate;
        _log = log;

        SeedBlockSignatures();

        foreach (var loco in
                 _hubState.Locos.Values)
            _locoSignatures[
                loco.Address] =
                LocoSignature(
                    loco);

        _layout.Changed +=
            OnLayoutChanged;

        _commandCenter.LocoFeedbackChanged +=
            OnLocoChanged;

        _scripts.Changed +=
            OnScriptStateChanged;

        _scripts.LogChanged +=
            OnScriptLog;

        _trainEvents.Changed +=
            OnTrainEvent;

        _trainEvents.Blocking +=
            OnBlockingTrainEventAsync;
    }

    static long NowMs() =>
        DateTimeOffset.UtcNow
            .ToUnixTimeMilliseconds();

    static string S(
        JsonElement element,
        string property,
        string fallback = "")
    {
        if (element.ValueKind !=
                JsonValueKind.Object ||
            !element.TryGetProperty(
                property,
                out var value) ||
            value.ValueKind !=
                JsonValueKind.String)
            return fallback;

        return value.GetString() ??
               fallback;
    }

    static int I(
        JsonElement element,
        string property,
        int fallback = 0)
    {
        if (element.ValueKind !=
                JsonValueKind.Object ||
            !element.TryGetProperty(
                property,
                out var value))
            return fallback;

        if (value.ValueKind ==
                JsonValueKind.Number &&
            value.TryGetInt32(
                out var number))
            return number;

        if (value.ValueKind ==
                JsonValueKind.String &&
            int.TryParse(
                value.GetString(),
                out number))
            return number;

        return fallback;
    }

    static bool B(
        JsonElement element,
        string property,
        bool fallback = false)
    {
        if (element.ValueKind !=
                JsonValueKind.Object ||
            !element.TryGetProperty(
                property,
                out var value))
            return fallback;

        return value.ValueKind switch
        {
            JsonValueKind.True =>
                true,
            JsonValueKind.False =>
                false,
            _ =>
                fallback
        };
    }

    static string[] StringArray(
        JsonElement element,
        string property)
    {
        if (element.ValueKind !=
                JsonValueKind.Object ||
            !element.TryGetProperty(
                property,
                out var value) ||
            value.ValueKind !=
                JsonValueKind.Array)
            return [];

        return value
            .EnumerateArray()
            .Where(item =>
                item.ValueKind ==
                    JsonValueKind.String)
            .Select(item =>
                (item.GetString() ?? "")
                    .Trim())
            .Where(item =>
                item.Length > 0)
            .Distinct(
                StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    static int[] IntArray(
        JsonElement element,
        string property)
    {
        if (element.ValueKind !=
                JsonValueKind.Object ||
            !element.TryGetProperty(
                property,
                out var value) ||
            value.ValueKind !=
                JsonValueKind.Array)
            return [];

        return value
            .EnumerateArray()
            .Select(item =>
                item.ValueKind ==
                    JsonValueKind.Number &&
                item.TryGetInt32(
                    out var number)
                    ? number
                    : 0)
            .Where(number =>
                number > 0)
            .Distinct()
            .ToArray();
    }

    static bool MatchesTrainEvent(
        NodeDef node,
        TrainEventPayload trainEvent)
    {
        var eventTypes =
            StringArray(
                node.Data,
                "trainEventTypes");

        if (eventTypes.Length > 0 &&
            !eventTypes.Contains(
                trainEvent.Event,
                StringComparer.OrdinalIgnoreCase))
            return false;

        var trainTypes =
            StringArray(
                node.Data,
                "trainTypeFilters");

        if (trainTypes.Length > 0 &&
            (string.IsNullOrWhiteSpace(
                 trainEvent.TrainType) ||
             !trainTypes.Contains(
                 trainEvent.TrainType,
                 StringComparer.OrdinalIgnoreCase)))
            return false;

        var resourceTypes =
            StringArray(
                node.Data,
                "trainResourceTypes");

        if (resourceTypes.Length > 0 &&
            !resourceTypes.Contains(
                trainEvent.ResourceType,
                StringComparer.OrdinalIgnoreCase))
            return false;

        var blockFilters =
            IntArray(
                node.Data,
                "trainBlockFilters");

        if (blockFilters.Length > 0)
        {
            if (!string.Equals(
                    trainEvent.ResourceType,
                    "block",
                    StringComparison.OrdinalIgnoreCase) ||
                trainEvent.ResourceId is not int blockId ||
                !blockFilters.Contains(
                    blockId))
                return false;
        }

        var sensorFilters =
            IntArray(
                node.Data,
                "trainSensorFilters");

        if (sensorFilters.Length > 0 &&
            !sensorFilters.Any(sensor =>
                trainEvent.SensorAddress ==
                    sensor ||
                trainEvent.Sensors.Contains(
                    sensor)))
            return false;

        var resourceFilters =
            StringArray(
                node.Data,
                "trainResourceFilters");

        if (resourceFilters.Length > 0 &&
            !resourceFilters.Any(filter =>
                string.Equals(
                    filter,
                    trainEvent.ResourceName,
                    StringComparison.OrdinalIgnoreCase) ||
                string.Equals(
                    filter,
                    trainEvent.ResourceKey,
                    StringComparison.OrdinalIgnoreCase) ||
                string.Equals(
                    filter,
                    trainEvent.ResourceId?.ToString(),
                    StringComparison.OrdinalIgnoreCase)))
            return false;

        var locoFilters =
            IntArray(
                node.Data,
                "trainLocoAddressFilters");

        if (locoFilters.Length > 0 &&
            !locoFilters.Contains(
                trainEvent.LocoAddress))
            return false;

        return true;
    }

    static string Js(
        string value) =>
        JsonSerializer.Serialize(
            value ?? "");

    static string Json(
        object? value) =>
        JsonSerializer.Serialize(
            value);

    string StoragePath() =>
        Path.Combine(
            _env.ContentRootPath,
            "data",
            "config",
            "automations.json");

    DocumentDef LoadDocument()
    {
        var path =
            StoragePath();

        if (!File.Exists(path))
            return new(
                [],
                [],
                []);

        using var doc =
            JsonDocument.Parse(
                File.ReadAllText(
                    path));

        if (!doc.RootElement.TryGetProperty(
                "visualFlow",
                out var flow) ||
            flow.ValueKind !=
                JsonValueKind.Object)
            return new(
                [],
                [],
                []);

        var pages =
            new List<PageDef>();

        if (flow.TryGetProperty(
                "pages",
                out var rawPages) &&
            rawPages.ValueKind ==
                JsonValueKind.Array)
        {
            foreach (var page in
                     rawPages.EnumerateArray())
            {
                var id =
                    S(
                        page,
                        "id")
                        .Trim();

                if (id.Length == 0)
                    continue;

                pages.Add(
                    new PageDef(
                        id,
                        S(
                            page,
                            "name",
                            id),
                        B(
                            page,
                            "enabled",
                            true)));
            }
        }

        var pageIds =
            pages
                .Select(page =>
                    page.Id)
                .ToHashSet(
                    StringComparer.Ordinal);

        var nodes =
            new List<NodeDef>();

        if (flow.TryGetProperty(
                "nodes",
                out var rawNodes) &&
            rawNodes.ValueKind ==
                JsonValueKind.Array)
        {
            foreach (var node in
                     rawNodes.EnumerateArray())
            {
                var id =
                    S(
                        node,
                        "id")
                        .Trim();

                if (id.Length == 0 ||
                    !node.TryGetProperty(
                        "data",
                        out var data) ||
                    data.ValueKind !=
                        JsonValueKind.Object)
                    continue;

                var pageId =
                    S(
                        data,
                        "pageId")
                        .Trim();

                var kind =
                    S(
                        data,
                        "kind")
                        .Trim();

                if (!pageIds.Contains(
                        pageId) ||
                    kind.Length ==
                        0)
                    continue;

                // Backward-compatibility migrations mirrored from the WebUI
                // normalizer.
                if (kind == "accessoryInput")
                    kind =
                        "basicAccessoryInput";

                if (kind == "trigger" &&
                    S(
                        data,
                        "triggerMode") ==
                    "sensor")
                    kind =
                        "sensorInput";

                nodes.Add(
                    new NodeDef(
                        id,
                        pageId,
                        kind,
                        data.Clone()));
            }
        }

        var nodeIds =
            nodes
                .Select(node =>
                    node.Id)
                .ToHashSet(
                    StringComparer.Ordinal);

        var nodePages =
            nodes.ToDictionary(
                node =>
                    node.Id,
                node =>
                    node.PageId,
                StringComparer.Ordinal);

        var edges =
            new List<EdgeDef>();

        if (flow.TryGetProperty(
                "edges",
                out var rawEdges) &&
            rawEdges.ValueKind ==
                JsonValueKind.Array)
        {
            foreach (var edge in
                     rawEdges.EnumerateArray())
            {
                var source =
                    S(
                        edge,
                        "source")
                        .Trim();

                var target =
                    S(
                        edge,
                        "target")
                        .Trim();

                if (!nodeIds.Contains(
                        source) ||
                    !nodeIds.Contains(
                        target) ||
                    nodePages[source] !=
                    nodePages[target])
                    continue;

                edges.Add(
                    new EdgeDef(
                        source,
                        target));
            }
        }

        return new(
            pages.ToArray(),
            nodes.ToArray(),
            edges.ToArray());
    }

    static bool InputKind(string kind) =>
        kind is
            "trigger" or
            "sensorInput" or
            "blockInput" or
            "turnoutInput" or
            "basicAccessoryInput" or
            "extendedAccessoryInput" or
            "locoInput" or
            "trainEventInput";

    static string LocoSignature(
        LocoFeedback loco) =>
        string.Join(
            "|",
            loco.Address,
            loco.Speed,
            loco.Forward,
            loco.FunctionsMask);

    void SeedBlockSignatures()
    {
        var snapshot =
            JsonSerializer.SerializeToElement(
                _layout.BlockSnapshot());

        if (snapshot.ValueKind !=
            JsonValueKind.Object)
            return;

        lock (_gate)
        {
            _blockSignatures.Clear();

            foreach (var property in
                     snapshot.EnumerateObject())
                _blockSignatures[
                    property.Name] =
                    property.Value
                        .GetRawText();
        }
    }

    FlowRuntimeSnapshot BuildSnapshot()
    {
        DocumentDef document;

        try
        {
            document =
                LoadDocument();
        }
        catch
        {
            document =
                new(
                    [],
                    [],
                    []);
        }

        var pages =
            document.Pages
                .Select(page =>
                    new FlowRuntimePageState(
                        page.Id,
                        page.Name,
                        page.Enabled,
                        _executionPages.Values.Count(
                            current =>
                                string.Equals(
                                    current,
                                    page.Id,
                                    StringComparison.Ordinal))))
                .ToArray();

        return new(
            pages);
    }

    public FlowRuntimeSnapshot Snapshot() =>
        BuildSnapshot();

    void Publish() =>
        Changed?.Invoke(
            BuildSnapshot());

    void WriteLog(
        string pageId,
        string level,
        params object?[] values)
    {
        _log.LogInformation(
            "[Flow {PageId}] {Message}",
            pageId,
            string.Join(
                " ",
                values.Select(value =>
                    value?.ToString() ??
                    "null")));

        LogChanged?.Invoke(
            new FlowRuntimeLog(
                pageId,
                NowMs(),
                level,
                values));
    }

    static JsonElement ObjectPayload(
        object value) =>
        JsonSerializer.SerializeToElement(
            value);

    async Task OnBlockingTrainEventAsync(
        TrainEventPayload trainEvent,
        CancellationToken cancellationToken)
    {
        if (_scripts.Finishing)
            return;

        var payload =
            ObjectPayload(
                new
                {
                    eventType =
                        "trainEvent",
                    id =
                        trainEvent.Id,
                    timestamp =
                        trainEvent.Timestamp,
                    source =
                        trainEvent.Source,
                    movementId =
                        trainEvent.MovementId,
                    movementName =
                        trainEvent.MovementName,
                    locoId =
                        trainEvent.LocoId,
                    locoAddress =
                        trainEvent.LocoAddress,
                    locoName =
                        trainEvent.LocoName,
                    trainType =
                        trainEvent.TrainType,
                    direction =
                        trainEvent.Direction,
                    @event =
                        trainEvent.Event,
                    resourceType =
                        trainEvent.ResourceType,
                    resourceKey =
                        trainEvent.ResourceKey,
                    resourceId =
                        trainEvent.ResourceId,
                    resourceName =
                        trainEvent.ResourceName,
                    resourceLabel =
                        trainEvent.ResourceLabel,
                    sensorAddress =
                        trainEvent.SensorAddress,
                    sensors =
                        trainEvent.Sensors
                });

        DocumentDef document;

        try
        {
            document =
                LoadDocument();
        }
        catch (Exception ex)
        {
            _log.LogWarning(
                ex,
                "Flow runtime could not load saved graph for blocking TrainEvent");

            throw;
        }

        var executionIds =
            new List<string>();

        try
        {
            foreach (var page in
                     document.Pages)
            {
                if (!page.Enabled)
                    continue;

                foreach (var input in
                         document.Nodes.Where(node =>
                             node.PageId ==
                                 page.Id &&
                             node.Kind ==
                                 "trainEventInput" &&
                             MatchesTrainEvent(
                                 node,
                                 trainEvent)))
                {
                    var executionId =
                        "flow-block:" +
                        Interlocked.Increment(
                            ref _manualSequence);

                    var run =
                        RunInput(
                            document,
                            page,
                            input,
                            payload,
                            false,
                            "blocking-event",
                            executionId);

                    if (run.Started &&
                        run.ExecutionId is not null)
                    {
                        executionIds.Add(
                            run.ExecutionId);

                        continue;
                    }

                    if (run.Error ==
                        "flow_branch_empty")
                        continue;

                    throw new InvalidOperationException(
                        run.Error ??
                        "blocking_flow_start_failed");
                }
            }

            foreach (var executionId in
                     executionIds)
            {
                while (true)
                {
                    cancellationToken.ThrowIfCancellationRequested();

                    var state =
                        _scripts.GetState(
                            executionId);

                    if (state.Status is
                        "running" or
                        "paused")
                    {
                        await Task.Delay(
                            25,
                            cancellationToken);

                        continue;
                    }

                    if (state.Status ==
                        "error")
                        throw new InvalidOperationException(
                            state.Error ??
                            "blocking_flow_failed");

                    break;
                }
            }
        }
        catch (OperationCanceledException)
        {
            foreach (var executionId in
                     executionIds)
                _scripts.Abort(
                    executionId,
                    "Blocking TrainEvent cancelled with Movement.");

            throw;
        }
    }

    void OnTrainEvent(
        TrainEventPayload trainEvent)
    {
        var payload =
            ObjectPayload(
                new
                {
                    eventType =
                        "trainEvent",
                    id =
                        trainEvent.Id,
                    timestamp =
                        trainEvent.Timestamp,
                    source =
                        trainEvent.Source,
                    movementId =
                        trainEvent.MovementId,
                    movementName =
                        trainEvent.MovementName,
                    locoId =
                        trainEvent.LocoId,
                    locoAddress =
                        trainEvent.LocoAddress,
                    locoName =
                        trainEvent.LocoName,
                    trainType =
                        trainEvent.TrainType,
                    direction =
                        trainEvent.Direction,
                    @event =
                        trainEvent.Event,
                    resourceType =
                        trainEvent.ResourceType,
                    resourceKey =
                        trainEvent.ResourceKey,
                    resourceId =
                        trainEvent.ResourceId,
                    resourceName =
                        trainEvent.ResourceName,
                    resourceLabel =
                        trainEvent.ResourceLabel,
                    sensorAddress =
                        trainEvent.SensorAddress,
                    sensors =
                        trainEvent.Sensors
                });

        RunMatchingInputs(
            "trainEventInput",
            node =>
                MatchesTrainEvent(
                    node,
                    trainEvent),
            payload);
    }

    void OnLayoutChanged(
        string type,
        object data)
    {
        if (_exclusiveGate.CalibrationActive)
            return;

        try
        {
            var payload =
                JsonSerializer.SerializeToElement(
                    data);

            switch (type)
            {
                case "sensorChanged":
                    HandleSensorEvent(
                        payload);
                    break;

                case "turnoutChanged":
                    HandleTurnoutEvent(
                        payload);
                    break;

                case "accessoryChanged":
                    HandleAccessoryEvent(
                        payload,
                        false);
                    break;

                case "signalAspectChanged":
                    HandleAccessoryEvent(
                        payload,
                        true);
                    break;

                case "blockStateChanged":
                    HandleBlockSnapshot(
                        payload);
                    break;
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(
                ex,
                "Flow runtime ignored invalid layout event {EventType}",
                type);
        }
    }

    void OnLocoChanged(
        LocoFeedback loco)
    {
        if (_exclusiveGate.CalibrationActive)
            return;

        var signature =
            LocoSignature(
                loco);

        lock (_gate)
        {
            if (!_locoSignatures.TryGetValue(
                    loco.Address,
                    out var previous))
            {
                _locoSignatures[
                    loco.Address] =
                    signature;
                return;
            }

            _locoSignatures[
                loco.Address] =
                signature;

            if (previous ==
                signature)
                return;
        }

        RunMatchingInputs(
            "locoInput",
            node =>
                I(
                    node.Data,
                    "locoAddress") ==
                loco.Address,
            ObjectPayload(
                new
                {
                    eventType =
                        "locoState",
                    locoAddress =
                        loco.Address,
                    speed =
                        loco.Speed,
                    direction =
                        loco.Forward
                            ? "forward"
                            : "reverse",
                    functionsMask =
                        loco.FunctionsMask,
                    loco =
                        new
                        {
                            address =
                                loco.Address,
                            speed =
                                loco.Speed,
                            direction =
                                loco.Forward
                                    ? "forward"
                                    : "reverse",
                            functionsMask =
                                loco.FunctionsMask
                        }
                }));
    }

    void HandleSensorEvent(
        JsonElement data)
    {
        var address =
            I(
                data,
                "address");

        var on =
            B(
                data,
                "on");

        RunMatchingInputs(
            "sensorInput",
            node =>
                I(
                    node.Data,
                    "sensorAddress") ==
                    address &&
                B(
                    node.Data,
                    "sensorState",
                    true) ==
                    on,
            ObjectPayload(
                new
                {
                    eventType =
                        "sensorChanged",
                    address,
                    on,
                    sensorAddress =
                        address,
                    sensorState =
                        on
                }));
    }

    void HandleTurnoutEvent(
        JsonElement data)
    {
        var address =
            I(
                data,
                "address");

        RunMatchingInputs(
            "turnoutInput",
            node =>
            {
                if (I(
                        node.Data,
                        "turnoutAddress") ==
                    address)
                    return true;

                if (!node.Data.TryGetProperty(
                        "turnoutAddresses",
                        out var raw) ||
                    raw.ValueKind !=
                        JsonValueKind.Array)
                    return false;

                return raw
                    .EnumerateArray()
                    .Any(value =>
                        value.TryGetInt32(
                            out var candidate) &&
                        candidate ==
                            address);
            },
            ObjectPayload(
                new
                {
                    eventType =
                        "turnoutChanged",
                    address,
                    closed =
                        B(
                            data,
                            "closed")
                }));
    }

    void HandleAccessoryEvent(
        JsonElement data,
        bool extended)
    {
        var address =
            I(
                data,
                "address");

        var kind =
            extended
                ? "extendedAccessoryInput"
                : "basicAccessoryInput";

        RunMatchingInputs(
            kind,
            node =>
                I(
                    node.Data,
                    "accessoryAddress") ==
                address,
            extended
                ? ObjectPayload(
                    new
                    {
                        eventType =
                            "signalAspectChanged",
                        address,
                        aspect =
                            I(
                                data,
                                "aspect")
                    })
                : ObjectPayload(
                    new
                    {
                        eventType =
                            "accessoryChanged",
                        address,
                        active =
                            B(
                                data,
                                "active")
                    }));
    }

    void HandleBlockSnapshot(
        JsonElement snapshot)
    {
        if (snapshot.ValueKind !=
            JsonValueKind.Object)
            return;

        var changed =
            new List<(
                string BlockId,
                JsonElement State)>();

        lock (_gate)
        {
            foreach (var property in
                     snapshot.EnumerateObject())
            {
                var signature =
                    property.Value
                        .GetRawText();

                if (!_blockSignatures.TryGetValue(
                        property.Name,
                        out var previous))
                {
                    _blockSignatures[
                        property.Name] =
                        signature;
                    continue;
                }

                _blockSignatures[
                    property.Name] =
                    signature;

                if (previous !=
                    signature)
                    changed.Add(
                        (
                            property.Name,
                            property.Value.Clone()
                        ));
            }
        }

        foreach (var item in
                 changed)
        {
            if (!int.TryParse(
                    item.BlockId,
                    out var blockId))
                continue;

            var locoId =
                item.State.ValueKind ==
                    JsonValueKind.Object &&
                item.State.TryGetProperty(
                    "locoId",
                    out var locoIdElement) &&
                locoIdElement.ValueKind ==
                    JsonValueKind.String
                    ? locoIdElement.GetString()
                    : null;

            var locoAddress =
                I(
                    item.State,
                    "locoAddress");

            RunMatchingInputs(
                "blockInput",
                node =>
                    I(
                        node.Data,
                        "blockElementId") ==
                    blockId,
                ObjectPayload(
                    new
                    {
                        eventType =
                            "blockStateChanged",
                        blockId =
                            item.BlockId,
                        blockName =
                            "",
                        locoId,
                        locoAddress,
                        occupied =
                            locoAddress >
                                0 ||
                            !string.IsNullOrEmpty(
                                locoId)
                    }));
        }
    }

    void RunMatchingInputs(
        string kind,
        Func<NodeDef, bool> matches,
        JsonElement payload)
    {
        /*
         * Finishing means existing automation may drain, but no new automatic
         * event-triggered Flow branch is allowed to start.
         */
        if (_scripts.Finishing)
            return;

        DocumentDef document;

        try
        {
            document =
                LoadDocument();
        }
        catch (Exception ex)
        {
            _log.LogWarning(
                ex,
                "Flow runtime could not load saved graph");
            return;
        }

        foreach (var page in
                 document.Pages)
        {
            if (!page.Enabled)
                continue;

            foreach (var input in
                     document.Nodes.Where(node =>
                         node.PageId ==
                             page.Id &&
                         node.Kind ==
                             kind &&
                         matches(
                             node)))
                RunInput(
                    document,
                    page,
                    input,
                    payload,
                    false,
                    "event");
        }
    }

    static string? FirstTarget(
        DocumentDef document,
        string source) =>
        document.Edges
            .FirstOrDefault(edge =>
                edge.Source ==
                source)?
            .Target;

    static NodeDef? FindNode(
        DocumentDef document,
        string id) =>
        document.Nodes
            .FirstOrDefault(node =>
                node.Id ==
                id);

    static string BlockReference(
        JsonElement data)
    {
        var id =
            I(
                data,
                "blockElementId");

        if (id is >= 1 and <= 65535)
            return id.ToString();

        var name =
            S(
                data,
                "blockName")
                .Trim();

        return name.Length > 0
            ? Js(
                name)
            : "";
    }

    static string LocoPayloadGuard(
        string statement) =>
        string.Join(
            "\n",
            "{",
            "  const locoAddress = Number(payload && typeof payload === \"object\" ? payload.locoAddress : NaN);",
            "  if (!Number.isInteger(locoAddress) || locoAddress < 1 || locoAddress > 10239) {",
            "    throw new Error(\"This node requires payload.locoAddress (1..10239).\");",
            "  }",
            "  " +
                statement,
            "}");

    static string Statement(
        NodeDef node)
    {
        var data =
            node.Data;

        switch (node.Kind)
        {
            // These nodes intentionally require SmartDispatcher context and
            // remain skipped in a normal Flow branch, exactly like the current
            // WebUI generator.
            case "setSpeed":
            case "waitForBlock":
            case "horn":
                return "";

            case "waitForSensor":
                return
                    "await dcc.waitForSensor(" +
                    Math.Max(
                        0,
                        I(
                            data,
                            "sensorAddress")) +
                    ", " +
                    (
                        B(
                            data,
                            "sensorState",
                            true)
                            ? "true"
                            : "false"
                    ) +
                    ");";

            case "setSensor":
                return
                    "dcc.setSensor(" +
                    Math.Clamp(
                        I(
                            data,
                            "sensorAddress",
                            1),
                        1,
                        65535) +
                    ", " +
                    (
                        B(
                            data,
                            "sensorState",
                            true)
                            ? "true"
                            : "false"
                    ) +
                    ");";

            case "setTurnout":
                {
                    if (data.TryGetProperty(
                            "turnoutCommands",
                            out var commands) &&
                        commands.ValueKind ==
                            JsonValueKind.Array)
                    {
                        var lines =
                            commands
                                .EnumerateArray()
                                .Where(command =>
                                    I(
                                        command,
                                        "address") is >=
                                        1 and <= 32767)
                                .Select(command =>
                                    "await dcc.setTurnout(" +
                                    I(
                                        command,
                                        "address") +
                                    ", " +
                                    (
                                        B(
                                            command,
                                            "closed",
                                            true)
                                            ? "true"
                                            : "false"
                                    ) +
                                    ");")
                                .ToArray();

                        if (lines.Length >
                            0)
                            return string.Join(
                                "\n",
                                lines);
                    }

                    var address =
                        I(
                            data,
                            "turnoutAddress");

                    return address is >= 1 and <= 2048
                        ? "await dcc.setTurnout(" +
                          address +
                          ", " +
                          (
                              B(
                                  data,
                                  "turnoutClosed",
                                  true)
                                  ? "true"
                                  : "false"
                          ) +
                          ");"
                        : "throw new Error(\"Set Turnout node has no configured turnout.\");";
                }

            case "setAccessory":
                return
                    "await dcc.setAccessory(" +
                    Math.Clamp(
                        I(
                            data,
                            "accessoryAddress",
                            1),
                        1,
                        2048) +
                    ", " +
                    (
                        B(
                            data,
                            "accessoryActive",
                            true)
                            ? "true"
                            : "false"
                    ) +
                    ");";

            case "setExtendedAccessory":
                return
                    "await dcc.setSignalAspect(" +
                    Math.Clamp(
                        I(
                            data,
                            "accessoryAddress",
                            1),
                        1,
                        2048) +
                    ", " +
                    Math.Clamp(
                        I(
                            data,
                            "accessoryAspect"),
                        0,
                        255) +
                    ");";

            case "setLoco":
                {
                    var speed =
                        Math.Clamp(
                            I(
                                data,
                                "speed",
                                20),
                            0,
                            126);

                    var direction =
                        S(
                            data,
                            "locoDirection") ==
                        "reverse"
                            ? "reverse"
                            : "forward";

                    var address =
                        I(
                            data,
                            "locoAddress");

                    if (address is >= 1 and <= 10239)
                        return
                            "await dcc.setLoco(" +
                            address +
                            ", " +
                            speed +
                            ", " +
                            Js(
                                direction) +
                            ");";

                    return LocoPayloadGuard(
                        "await dcc.setLoco(locoAddress, " +
                        speed +
                        ", " +
                        Js(
                            direction) +
                        ");");
                }

            case "getBlock":
                {
                    var block =
                        BlockReference(
                            data);

                    return block.Length >
                        0
                        ? "if (!payload || typeof payload !== \"object\" || Array.isArray(payload)) { payload = {}; }\n" +
                          "payload.locoAddress = dcc.getBlock(" +
                          block +
                          ");"
                        : "throw new Error(\"Get Block node has no configured block.\");";
                }

            case "setBlock":
                {
                    var block =
                        BlockReference(
                            data);

                    if (block.Length ==
                        0)
                        return "throw new Error(\"Set Block node has no configured block.\");";

                    var address =
                        I(
                            data,
                            "locoAddress");

                    return address is >= 1 and <= 10239
                        ? "dcc.setBlock(" +
                          block +
                          ", " +
                          address +
                          ");"
                        : LocoPayloadGuard(
                            "dcc.setBlock(" +
                            block +
                            ", locoAddress);");
                }

            case "clearBlock":
                {
                    var block =
                        BlockReference(
                            data);

                    return block.Length >
                        0
                        ? "dcc.clearBlock(" +
                          block +
                          ");"
                        : "throw new Error(\"Clear Block node has no configured block.\");";
                }

            case "getBlockTargetLoco":
                {
                    var block =
                        BlockReference(
                            data);

                    return block.Length >
                        0
                        ? "if (!payload || typeof payload !== \"object\" || Array.isArray(payload)) { payload = {}; }\n" +
                          "payload.locoAddress = dcc.getBlockTargetLoco(" +
                          block +
                          ");"
                        : "throw new Error(\"Get Target node has no configured block.\");";
                }

            case "setBlockTargetLoco":
                {
                    var block =
                        BlockReference(
                            data);

                    return block.Length >
                        0
                        ? LocoPayloadGuard(
                            "dcc.setBlockTargetLoco(" +
                            block +
                            ", locoAddress);")
                        : "throw new Error(\"Set Target node has no configured block.\");";
                }

            case "clearBlockTargetLoco":
                {
                    var block =
                        BlockReference(
                            data);

                    return block.Length >
                        0
                        ? "dcc.clearBlockTargetLoco(" +
                          block +
                          ");"
                        : "throw new Error(\"Clear Target node has no configured block.\");";
                }

            case "locoFunction":
                {
                    var fn =
                        Math.Clamp(
                            I(
                                data,
                                "functionNumber",
                                2),
                            0,
                            68);

                    var bindingId =
                        I(
                            data,
                            "functionBindingId");

                    var pulse =
                        Math.Clamp(
                            I(
                                data,
                                "pulseMs",
                                700),
                            1,
                            600000);

                    var on =
                        bindingId > 0
                            ? "await dcc.setLocoFunctionBinding(locoAddress, " +
                              bindingId +
                              ", true);"
                            : "await dcc.setLocoFunction(locoAddress, " +
                              fn +
                              ", true);";

                    var off =
                        bindingId > 0
                            ? "await dcc.setLocoFunctionBinding(locoAddress, " +
                              bindingId +
                              ", false);"
                            : "await dcc.setLocoFunction(locoAddress, " +
                              fn +
                              ", false);";

                    return string.Join(
                        "\n",
                        "{",
                        "  const locoAddress = Number(payload && typeof payload === \"object\" ? payload.locoAddress : NaN);",
                        "  if (!Number.isInteger(locoAddress) || locoAddress < 1 || locoAddress > 10239) {",
                        "    throw new Error(\"Loco Function requires payload.locoAddress (1..10239).\");",
                        "  }",
                        "  " +
                            on,
                        "  await delay(" +
                            pulse +
                            ");",
                        "  " +
                            off,
                        "}");
                }

            case "movementHold":
                return
                    "if (!payload || typeof payload !== \"object\" || !payload.movementId) { throw new Error(\"Movement Hold requires payload.movementId.\"); }\n" +
                    "movement.hold(String(payload.movementId));";

            case "movementRelease":
                return
                    "if (!payload || typeof payload !== \"object\" || !payload.movementId) { throw new Error(\"Movement Release requires payload.movementId.\"); }\n" +
                    "movement.release(String(payload.movementId));";

            case "delay":
                return
                    "await delay(" +
                    Math.Clamp(
                        I(
                            data,
                            "delayMs",
                            500),
                        0,
                        600000) +
                    ");";

            case "playAudio":
                {
                    var name =
                        S(
                            data,
                            "audioName")
                            .Trim();

                    if (name.Length ==
                        0)
                        return "throw new Error(\"Play Audio requires an audio name.\");";

                    return B(
                            data,
                            "audioWaitForEnd")
                        ? "await playAudio(" +
                          Js(
                              name) +
                          ");"
                        : "playAudio(" +
                          Js(
                              name) +
                          ");";
                }

            case "log":
                return
                    "log(" +
                    Js(
                        S(
                            data,
                            "message")) +
                    ", \"payload:\", JSON.stringify(payload, null, 2));";

            default:
                return "";
        }
    }

    string? BuildBranchSource(
        DocumentDef document,
        PageDef page,
        NodeDef input,
        JsonElement? payload)
    {
        var nextId =
            FirstTarget(
                document,
                input.Id);

        if (nextId is null)
            return null;

        var statements =
            new List<string>();

        var visited =
            new HashSet<string>(
                StringComparer.Ordinal);

        var current =
            FindNode(
                document,
                nextId);

        while (current is not null)
        {
            if (!visited.Add(
                    current.Id))
                break;

            if (!InputKind(
                    current.Kind))
            {
                var statement =
                    Statement(
                        current);

                if (!string.IsNullOrWhiteSpace(
                        statement))
                    statements.Add(
                        statement);
            }

            var next =
                FirstTarget(
                    document,
                    current.Id);

            current =
                next is null
                    ? null
                    : FindNode(
                        document,
                        next);
        }

        if (statements.Count ==
            0)
            return null;

        var payloadJson =
            payload.HasValue
                ? payload.Value.GetRawText()
                : DefaultPayload(
                    input);

        return
            "let payload = " +
            payloadJson +
            ";\n\n" +
            string.Join(
                "\n\n",
                statements);
    }

    static string DefaultPayload(
        NodeDef input)
    {
        if (input.Kind ==
            "trainEventInput")
            return Json(
                new
                {
                    eventType =
                        "trainEvent",
                    movementId =
                        "manual-test",
                    movementName =
                        "Manual test",
                    locoId =
                        (string?)null,
                    locoAddress =
                        1,
                    locoName =
                        (string?)null,
                    trainType =
                        (string?)null,
                    direction =
                        "forward",
                    @event =
                        StringArray(
                            input.Data,
                            "trainEventTypes")
                            .FirstOrDefault() ??
                        "arrived",
                    resourceType =
                        StringArray(
                            input.Data,
                            "trainResourceTypes")
                            .FirstOrDefault() ??
                        "block",
                    resourceKey =
                        "manual-test",
                    resourceId =
                        1,
                    resourceName =
                        "Manual test",
                    resourceLabel =
                        "Manual test",
                    sensorAddress =
                        (int?)null,
                    sensors =
                        Array.Empty<int>()
                });

        if (input.Kind ==
            "sensorInput")
            return Json(
                new
                {
                    sensorAddress =
                        Math.Clamp(
                            I(
                                input.Data,
                                "sensorAddress",
                                1),
                            1,
                            65535),
                    sensorState =
                        B(
                            input.Data,
                            "sensorState",
                            true)
                });

        if (input.Kind ==
            "locoInput")
            return Json(
                new
                {
                    locoAddress =
                        Math.Clamp(
                            I(
                                input.Data,
                                "locoAddress",
                                1),
                            1,
                            10239)
                });

        if (input.Kind ==
            "blockInput")
            return Json(
                new
                {
                    blockId =
                        I(
                            input.Data,
                            "blockElementId")
                            .ToString(),
                    blockName =
                        S(
                            input.Data,
                            "blockName"),
                    locoAddress =
                        0,
                    occupied =
                        false
                });

        if (input.Kind ==
            "trigger")
        {
            var type =
                S(
                    input.Data,
                    "triggerPayloadType",
                    "json");

            var raw =
                S(
                    input.Data,
                    "triggerPayloadValue",
                    "{}");

            if (type ==
                "null")
                return "null";

            if (type ==
                "timestamp")
                return NowMs()
                    .ToString();

            if (type ==
                "string")
                return Js(
                    raw);

            if (type ==
                "number" &&
                double.TryParse(
                    raw,
                    System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var number))
                return number.ToString(
                    System.Globalization.CultureInfo.InvariantCulture);

            if (type ==
                "boolean")
                return string.Equals(
                        raw.Trim(),
                        "false",
                        StringComparison.OrdinalIgnoreCase)
                    ? "false"
                    : "true";

            try
            {
                using var doc =
                    JsonDocument.Parse(
                        raw);

                return doc.RootElement
                    .GetRawText();
            }
            catch
            {
                return "null";
            }
        }

        return "null";
    }

    (bool Started, string? Error, string? ExecutionId) RunInput(
        DocumentDef document,
        PageDef page,
        NodeDef input,
        JsonElement? payload,
        bool manual,
        string reason,
        string? executionIdOverride = null)
    {
        if (!page.Enabled &&
            !manual)
            return (
                false,
                "flow_page_disabled",
                null);

        var source =
            BuildBranchSource(
                document,
                page,
                input,
                payload);

        WriteLog(
            page.Id,
            "info",
            "EVENT " +
            S(
                input.Data,
                "label",
                input.Kind),
            payload.HasValue
                ? payload.Value
                : null);

        if (string.IsNullOrWhiteSpace(
                source))
        {
            WriteLog(
                page.Id,
                "error",
                "SKIP " +
                S(
                    input.Data,
                    "label",
                    input.Kind),
                "The input has no runnable connected branch.");

            return (
                false,
                "flow_branch_empty",
                null);
        }

        var executionId =
            !string.IsNullOrWhiteSpace(
                executionIdOverride)
                ? executionIdOverride!
                : manual
                    ? "visual-flow-" +
                      reason +
                      ":" +
                      page.Id +
                      ":" +
                      Interlocked.Increment(
                          ref _manualSequence)
                    : "visual-flow-runtime:" +
                      page.Id +
                      ":" +
                      input.Id;

        /*
         * Register ownership before ScriptRuntime.StartSource(). StartSource
         * publishes RUNNING synchronously and a very short script can also
         * finish on its background task immediately. Pre-registration makes
         * both state transitions observable by FlowRuntime.
         */
        _executionPages[
            executionId] =
            page.Id;

        _executionInputs[
            executionId] =
            input.Id;

        var result =
            _scripts.StartSource(
                executionId,
                "Flow input: " +
                page.Name +
                " / " +
                S(
                    input.Data,
                    "label",
                    input.Kind),
                "visual-flow",
                source);

        if (!result.Ok)
        {
            if (result.Error ==
                "script_already_running")
            {
                Publish();

                return (
                    false,
                    result.Error,
                    executionId);
            }

            _executionPages.TryRemove(
                executionId,
                out _);

            _executionInputs.TryRemove(
                executionId,
                out _);

            WriteLog(
                page.Id,
                "error",
                "ERROR " +
                S(
                    input.Data,
                    "label",
                    input.Kind),
                result.Error ??
                "flow_start_failed");

            Publish();

            return (
                false,
                result.Error ??
                "flow_start_failed",
                executionId);
        }

        Publish();

        return (
            true,
            null,
            executionId);
    }

    void OnScriptStateChanged(
        ScriptRuntimeState state)
    {
        if (!_executionPages.TryGetValue(
                state.ExecutionId,
                out var pageId))
            return;

        if (state.Status is
            "running" or
            "paused")
        {
            Publish();
            return;
        }

        _executionPages.TryRemove(
            state.ExecutionId,
            out _);

        _executionInputs.TryRemove(
            state.ExecutionId,
            out _);

        if (state.Status ==
                "error")
            WriteLog(
                pageId,
                "error",
                "ERROR",
                state.Error ??
                "Flow execution failed.");

        Publish();
    }

    void OnScriptLog(
        ScriptRuntimeLog entry)
    {
        if (!_executionPages.TryGetValue(
                entry.ExecutionId,
                out var pageId))
            return;

        LogChanged?.Invoke(
            new FlowRuntimeLog(
                pageId,
                entry.Timestamp,
                "log",
                [
                    entry.Message
                ]));
    }

    public (bool Ok, string? Error) RunPage(
        string pageId,
        string? inputNodeId,
        JsonElement? payload,
        string reason = "run")
    {
        if (_exclusiveGate.CalibrationActive)
            return (
                false,
                "calibration_active");

        DocumentDef document;

        try
        {
            document =
                LoadDocument();
        }
        catch (Exception ex)
        {
            return (
                false,
                ex.Message);
        }

        var page =
            document.Pages
                .FirstOrDefault(candidate =>
                    candidate.Id ==
                    pageId);

        if (page is null)
            return (
                false,
                "flow_page_not_found");

        var inputs =
            document.Nodes
                .Where(node =>
                    node.PageId ==
                        page.Id &&
                    InputKind(
                        node.Kind))
                .ToArray();

        var input =
            !string.IsNullOrWhiteSpace(
                inputNodeId)
                ? inputs.FirstOrDefault(node =>
                    node.Id ==
                    inputNodeId)
                : inputs.FirstOrDefault();

        if (input is null)
            return (
                false,
                "flow_input_not_found");

        var run =
            RunInput(
                document,
                page,
                input,
                payload,
                true,
                reason);

        return (
            run.Started,
            run.Error);
    }

    public int AbortPage(
        string pageId,
        string reason =
            "Visual flow page stopped.")
    {
        var ids =
            _executionPages
                .Where(pair =>
                    pair.Value ==
                    pageId)
                .Select(pair =>
                    pair.Key)
                .ToArray();

        var count =
            0;

        foreach (var id in ids)
            if (_scripts.Abort(
                    id,
                    reason))
                count++;

        return count;
    }

    public int AbortAll(
        string reason =
            "Visual flows aborted.")
    {
        var ids =
            _executionPages.Keys
                .ToArray();

        var count =
            0;

        foreach (var id in ids)
            if (_scripts.Abort(
                    id,
                    reason))
                count++;

        return count;
    }

    protected override async Task ExecuteAsync(
        CancellationToken stoppingToken)
    {
        using var timer =
            new PeriodicTimer(
                TimeSpan.FromMilliseconds(
                    250));

        while (await timer.WaitForNextTickAsync(
                   stoppingToken))
        {
            try
            {
                TickIntervals();
            }
            catch (Exception ex)
            {
                _log.LogWarning(
                    ex,
                    "Flow interval tick failed");
            }
        }
    }

    void TickIntervals()
    {
        if (_exclusiveGate.CalibrationActive)
            return;

        var document =
            LoadDocument();

        var now =
            Environment.TickCount64;

        var liveKeys =
            new HashSet<string>(
                StringComparer.Ordinal);

        foreach (var page in
                 document.Pages)
        {
            if (!page.Enabled)
                continue;

            foreach (var input in
                     document.Nodes.Where(node =>
                         node.PageId ==
                             page.Id &&
                         node.Kind ==
                             "trigger" &&
                         S(
                             node.Data,
                             "triggerMode") ==
                             "interval"))
            {
                var key =
                    page.Id +
                    ":" +
                    input.Id;

                liveKeys.Add(
                    key);

                var intervalMs =
                    Math.Clamp(
                        I(
                            input.Data,
                            "intervalMs",
                            60000),
                        1000,
                        86_400_000);

                long due;

                lock (_gate)
                {
                    if (!_nextIntervals.TryGetValue(
                            key,
                            out due))
                    {
                        due =
                            now;

                        _nextIntervals[
                            key] =
                            due;
                    }
                }

                if (now <
                    due)
                    continue;

                /*
                 * Advance the cadence even while Finishing is active. This
                 * prevents a backlog/burst from firing immediately when
                 * Finishing is later cleared.
                 */
                lock (_gate)
                    _nextIntervals[
                        key] =
                        now +
                        intervalMs;

                if (_scripts.Finishing)
                    continue;

                RunInput(
                    document,
                    page,
                    input,
                    null,
                    false,
                    "interval");
            }
        }

        lock (_gate)
        {
            foreach (var key in
                     _nextIntervals.Keys
                         .Where(key =>
                             !liveKeys.Contains(
                                 key))
                         .ToArray())
                _nextIntervals.Remove(
                    key);
        }
    }
}
