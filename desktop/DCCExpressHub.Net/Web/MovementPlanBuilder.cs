using System.Text.Json;

namespace DCCExpressHub.Net.Web;

/// <summary>
/// Builds the exact physical Movement plan from the authoritative persisted
/// layout route topology. Runtime execution never trusts a client-supplied
/// route plan.
/// </summary>
public sealed class MovementPlanBuilder
{
    readonly IWebHostEnvironment _env;

    public MovementPlanBuilder(
        IWebHostEnvironment env)
    {
        _env = env;
    }

    static int Int(
        JsonElement element,
        string name,
        int fallback = 0) =>
        element.TryGetProperty(name, out var value) &&
        value.TryGetInt32(out var result)
            ? result
            : fallback;

    static string Str(
        JsonElement element,
        string name,
        string fallback = "") =>
        element.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? fallback
            : fallback;

    static bool ValidId(int value) =>
        value is >= 1 and <= 65535;

    static DispatcherTurnoutRequirement[] UniqueTurnoutStates(
        IEnumerable<DispatcherTurnoutRequirement> source)
    {
        var result =
            new Dictionary<ushort, bool>();

        foreach (var state in source)
        {
            if (state.Address == 0)
                continue;

            if (result.TryGetValue(state.Address, out var old) &&
                old != state.Closed)
                throw new InvalidOperationException(
                    "movement_route_conflicting_turnout_state");

            result[state.Address] =
                state.Closed;
        }

        return result
            .OrderBy(x => x.Key)
            .Select(x =>
                new DispatcherTurnoutRequirement(
                    x.Key,
                    x.Value))
            .ToArray();
    }

    static DispatcherTurnoutRequirement[] ReadTurnoutStates(
        JsonElement parent,
        string propertyName)
    {
        if (!parent.TryGetProperty(propertyName, out var states) ||
            states.ValueKind != JsonValueKind.Array)
            return [];

        var result =
            new List<DispatcherTurnoutRequirement>();

        foreach (var state in states.EnumerateArray())
        {
            var address =
                Int(state, "address");

            if (address is < 1 or > 2048)
                continue;

            var closed =
                state.TryGetProperty("closed", out var rawClosed) &&
                rawClosed.ValueKind == JsonValueKind.True;

            result.Add(
                new DispatcherTurnoutRequirement(
                    (ushort)address,
                    closed));
        }

        return UniqueTurnoutStates(result);
    }

    static bool ContainsCheckpoints(
        JsonElement route,
        IReadOnlyList<int> checkpoints)
    {
        if (!route.TryGetProperty("blockPath", out var blocks) ||
            blocks.ValueKind != JsonValueKind.Array)
            return false;

        var checkpointIndex = 0;

        foreach (var block in blocks.EnumerateArray())
        {
            if (checkpointIndex >= checkpoints.Count)
                return true;

            if (Int(block, "id") ==
                checkpoints[checkpointIndex])
                checkpointIndex++;
        }

        return checkpointIndex ==
               checkpoints.Count;
    }

    static MovementRouteRefModel RouteRefFromRoute(
        JsonElement route)
    {
        var blockIds =
            route.TryGetProperty("blockPath", out var blocks) &&
            blocks.ValueKind == JsonValueKind.Array
                ? blocks
                    .EnumerateArray()
                    .Select(block =>
                        Int(block, "id"))
                    .Where(ValidId)
                    .ToArray()
                : [];

        if (blockIds.Length < 2)
            throw new InvalidOperationException(
                "movement_route_incomplete");

        var direction =
            Str(
                route,
                "locoDirection",
                "unknown");

        if (direction is not ("forward" or "reverse"))
            throw new InvalidOperationException(
                "movement_direction_unknown");

        return new MovementRouteRefModel
        {
            FromBlockId =
                blockIds[0],
            ToBlockId =
                blockIds[^1],
            Direction =
                direction,
            ViaBlockIds =
                blockIds.Length > 2
                    ? blockIds[1..^1]
                    : []
        };
    }

    static JsonElement SelectRoute(
        MovementPageModel page,
        JsonElement routeTable)
    {
        var routeRef =
            page.RouteRef ??
            throw new InvalidOperationException(
                "movement_requires_route_ref");

        if (!ValidId(routeRef.FromBlockId) ||
            !ValidId(routeRef.ToBlockId) ||
            routeRef.FromBlockId == routeRef.ToBlockId ||
            routeRef.Direction is not ("forward" or "reverse"))
            throw new InvalidOperationException(
                "movement_route_ref_invalid");

        var checkpoints =
            new List<int>
            {
                routeRef.FromBlockId
            };

        checkpoints.AddRange(
            (routeRef.ViaBlockIds ?? [])
                .Where(ValidId));

        checkpoints.Add(
            routeRef.ToBlockId);

        var candidates =
            routeTable
                .EnumerateArray()
                .Where(route =>
                    Int(route, "fromBlockId") ==
                        routeRef.FromBlockId &&
                    Int(route, "toBlockId") ==
                        routeRef.ToBlockId &&
                    string.Equals(
                        Str(
                            route,
                            "locoDirection",
                            "unknown"),
                        routeRef.Direction,
                        StringComparison.Ordinal) &&
                    ContainsCheckpoints(
                        route,
                        checkpoints))
                .Select(route =>
                    route.Clone())
                .ToArray();

        if (candidates.Length == 0)
            throw new InvalidOperationException(
                "movement_selected_route_not_found");

        if (candidates.Length > 1)
            throw new InvalidOperationException(
                "movement_route_ambiguous");

        return candidates[0];
    }

    static Dictionary<int, int> TrackAddressMap(
        JsonElement root)
    {
        var result =
            new Dictionary<int, int>();

        if (!root.TryGetProperty("layers", out var layers) ||
            layers.ValueKind != JsonValueKind.Array)
            return result;

        foreach (var layer in layers.EnumerateArray())
        {
            if (!layer.TryGetProperty("elements", out var elements) ||
                elements.ValueKind != JsonValueKind.Array)
                continue;

            foreach (var element in elements.EnumerateArray())
            {
                var type =
                    Str(element, "type");

                if (!type.StartsWith(
                        "track",
                        StringComparison.Ordinal) ||
                    type is
                        "tracksignal" or
                        "tracksignal2")
                    continue;

                var id =
                    Int(element, "id");
                var address =
                    Int(element, "address");

                if (ValidId(id) &&
                    ValidId(address))
                    result[id] =
                        address;
            }
        }

        return result;
    }

    static Dictionary<int, int> BlockSensorMap(
        JsonElement root)
    {
        var result =
            new Dictionary<int, int>();

        if (!root.TryGetProperty("layers", out var layers) ||
            layers.ValueKind != JsonValueKind.Array)
            return result;

        foreach (var layer in layers.EnumerateArray())
        {
            if (!layer.TryGetProperty("elements", out var elements) ||
                elements.ValueKind != JsonValueKind.Array)
                continue;

            foreach (var element in elements.EnumerateArray())
            {
                if (!string.Equals(
                        Str(element, "type"),
                        "trackblock",
                        StringComparison.Ordinal))
                    continue;

                var id =
                    Int(element, "id");
                var sensor =
                    Int(
                        element,
                        "sensorAddress");

                if (ValidId(id) &&
                    ValidId(sensor))
                    result[id] =
                        sensor;
            }
        }

        return result;
    }

    static MovementSensorCondition[] BlockEventConditions(
        JsonElement root,
        int blockId,
        string direction,
        string eventName)
    {
        if (direction is not ("forward" or "reverse") ||
            !root.TryGetProperty(
                "layers",
                out var layers) ||
            layers.ValueKind != JsonValueKind.Array)
            return [];

        foreach (var layer in layers.EnumerateArray())
        {
            if (!layer.TryGetProperty(
                    "elements",
                    out var elements) ||
                elements.ValueKind != JsonValueKind.Array)
                continue;

            foreach (var element in elements.EnumerateArray())
            {
                if (!string.Equals(
                        Str(
                            element,
                            "type"),
                        "trackblock",
                        StringComparison.Ordinal) ||
                    Int(
                        element,
                        "id") !=
                    blockId ||
                    !element.TryGetProperty(
                        "eventConfig",
                        out var eventConfig) ||
                    eventConfig.ValueKind != JsonValueKind.Object ||
                    !eventConfig.TryGetProperty(
                        direction,
                        out var directionConfig) ||
                    directionConfig.ValueKind != JsonValueKind.Object)
                    continue;

                JsonElement conditions;

                if (!directionConfig.TryGetProperty(
                        eventName,
                        out conditions))
                {
                    var legacyName =
                        eventName switch
                        {
                            "arrival" =>
                                "beforeArrive",
                            "leave" =>
                                directionConfig.TryGetProperty(
                                    "afterLeave",
                                    out _)
                                    ? "afterLeave"
                                    : "beforeLeave",
                            _ =>
                                eventName
                        };

                    if (!directionConfig.TryGetProperty(
                            legacyName,
                            out conditions))
                        return [];
                }

                if (conditions.ValueKind != JsonValueKind.Array)
                    return [];

                var result =
                    new List<MovementSensorCondition>();

                var index =
                    0;

                foreach (var raw in conditions.EnumerateArray())
                {
                    var sensor =
                        Int(
                            raw,
                            "sensor");

                    if (!ValidId(
                            sensor))
                    {
                        index++;
                        continue;
                    }

                    var state =
                        !raw.TryGetProperty(
                            "state",
                            out var stateElement) ||
                        stateElement.ValueKind != JsonValueKind.False;

                    result.Add(
                        new MovementSensorCondition
                        {
                            Id =
                                $"block-event-{blockId}-{direction}-{eventName}-{index}",
                            Sensor =
                                sensor,
                            State =
                                state
                        });

                    index++;
                }

                return result.ToArray();
            }
        }

        return [];
    }

    static int BlockEventDelay(
        JsonElement root,
        int blockId,
        string direction,
        string eventName)
    {
        if (direction is not ("forward" or "reverse") ||
            !root.TryGetProperty(
                "layers",
                out var layers) ||
            layers.ValueKind != JsonValueKind.Array)
            return 0;

        var propertyName =
            eventName switch
            {
                "arrival" =>
                    "arrivalDelayMs",
                "arrived" =>
                    "arrivedDelayMs",
                "leave" =>
                    "leaveDelayMs",
                _ =>
                    ""
            };

        if (propertyName.Length == 0)
            return 0;

        foreach (var layer in layers.EnumerateArray())
        {
            if (!layer.TryGetProperty(
                    "elements",
                    out var elements) ||
                elements.ValueKind != JsonValueKind.Array)
                continue;

            foreach (var element in elements.EnumerateArray())
            {
                if (!string.Equals(
                        Str(
                            element,
                            "type"),
                        "trackblock",
                        StringComparison.Ordinal) ||
                    Int(
                        element,
                        "id") !=
                    blockId ||
                    !element.TryGetProperty(
                        "eventConfig",
                        out var eventConfig) ||
                    eventConfig.ValueKind != JsonValueKind.Object ||
                    !eventConfig.TryGetProperty(
                        direction,
                        out var directionConfig) ||
                    directionConfig.ValueKind != JsonValueKind.Object ||
                    !directionConfig.TryGetProperty(
                        propertyName,
                        out var rawDelay) ||
                    rawDelay.ValueKind != JsonValueKind.Number ||
                    !rawDelay.TryGetInt32(
                        out var delayMs))
                    continue;

                return Math.Clamp(
                    delayMs,
                    0,
                    600000);
            }
        }

        return 0;
    }

    static MovementSensorCondition[] ApproachRule(
        MovementPageModel _page,
        int blockId,
        JsonElement root,
        string direction) =>
        BlockEventConditions(
            root,
            blockId,
            direction,
            "arrival");

    static MovementSensorCondition[] ArrivalRule(
        MovementPageModel _page,
        int blockId,
        IReadOnlyDictionary<int, int> blockSensors,
        JsonElement root,
        string direction)
    {
        var configured =
            BlockEventConditions(
                root,
                blockId,
                direction,
                "arrived");

        if (configured.Length > 0)
            return configured;

        return blockSensors.TryGetValue(
                blockId,
                out var sensor)
            ? [
                new MovementSensorCondition
                {
                    Id =
                        $"auto-arrival-{blockId}-on",
                    Sensor =
                        sensor,
                    State =
                        true
                }
              ]
            : [];
    }

    static (
        MovementSensorCondition[] Conditions,
        bool Explicit)
        LeaveRule(
            MovementPageModel _page,
            int blockId,
            IReadOnlyDictionary<int, int> blockSensors,
            JsonElement root,
            string direction)
    {
        var configured =
            BlockEventConditions(
                root,
                blockId,
                direction,
                "leave");

        if (configured.Length > 0)
            return (
                configured,
                true);

        return blockSensors.TryGetValue(
                blockId,
                out var sensor)
            ? (
                [
                    new MovementSensorCondition
                    {
                        Id =
                            $"auto-leave-{blockId}-off",
                        Sensor =
                            sensor,
                        State =
                            false
                    }
                ],
                false)
            : (
                [],
                false);
    }

    public MovementPlanModel BuildForBlockNames(
        IEnumerable<string> requestedBlockNames)
    {
        var checkpoints =
            (requestedBlockNames ?? [])
                .Select(name =>
                    (name ?? "").Trim())
                .Where(name =>
                    name.Length > 0)
                .ToArray();

        if (checkpoints.Length < 2)
            throw new InvalidOperationException(
                "dispatcher_requires_two_blocks");

        var path =
            Path.Combine(
                _env.ContentRootPath,
                "data",
                "config",
                "layout.json");

        if (!File.Exists(path))
            throw new InvalidOperationException(
                "movement_layout_not_found");

        using var document =
            JsonDocument.Parse(
                File.ReadAllText(path));

        var root =
            document.RootElement;

        if (!root.TryGetProperty(
                "routeTopology",
                out var topology) ||
            topology.ValueKind !=
                JsonValueKind.Object ||
            !topology.TryGetProperty(
                "routeTable",
                out var routeTable) ||
            routeTable.ValueKind !=
                JsonValueKind.Array)
            throw new InvalidOperationException(
                "movement_route_topology_incomplete");

        static bool ContainsNames(
            JsonElement route,
            IReadOnlyList<string> names)
        {
            if (!route.TryGetProperty(
                    "blockPath",
                    out var rawBlocks) ||
                rawBlocks.ValueKind !=
                    JsonValueKind.Array)
                return false;

            var index =
                0;

            foreach (var block in
                     rawBlocks.EnumerateArray())
            {
                if (index >=
                    names.Count)
                    return true;

                var name =
                    Str(
                        block,
                        "name");

                if (string.Equals(
                        name,
                        names[index],
                        StringComparison.OrdinalIgnoreCase))
                    index++;
            }

            return index ==
                   names.Count;
        }

        var candidates =
            routeTable
                .EnumerateArray()
                .Where(route =>
                {
                    if (!route.TryGetProperty(
                            "blockPath",
                            out var rawBlocks) ||
                        rawBlocks.ValueKind !=
                            JsonValueKind.Array)
                        return false;

                    var blocks =
                        rawBlocks
                            .EnumerateArray()
                            .ToArray();

                    if (blocks.Length < 2)
                        return false;

                    return
                        string.Equals(
                            Str(
                                blocks[0],
                                "name"),
                            checkpoints[0],
                            StringComparison.OrdinalIgnoreCase) &&
                        string.Equals(
                            Str(
                                blocks[^1],
                                "name"),
                            checkpoints[^1],
                            StringComparison.OrdinalIgnoreCase) &&
                        ContainsNames(
                            route,
                            checkpoints);
                })
                .Select(route =>
                    route.Clone())
                .ToArray();

        if (candidates.Length == 0)
            throw new InvalidOperationException(
                "dispatcher_route_not_found");

        if (candidates.Length > 1)
            throw new InvalidOperationException(
                "dispatcher_route_ambiguous");

        return Build(
            new MovementPageModel
            {
                Id =
                    "script-route",
                Name =
                    "Script route",
                RouteRef =
                    RouteRefFromRoute(
                        candidates[0])
            });
    }

    public MovementPlanModel Build(
        MovementPageModel page)
    {
        var path =
            Path.Combine(
                _env.ContentRootPath,
                "data",
                "config",
                "layout.json");

        if (!File.Exists(path))
            throw new InvalidOperationException(
                "movement_layout_not_found");

        using var document =
            JsonDocument.Parse(
                File.ReadAllText(path));

        var root =
            document.RootElement;

        if (!root.TryGetProperty("routeTopology", out var topology) ||
            topology.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException(
                "movement_route_topology_missing");

        var version =
            Int(
                topology,
                "version");

        if (version is not (2 or 3))
            throw new InvalidOperationException(
                "movement_route_topology_unsupported");

        if (!topology.TryGetProperty("graph", out var graph) ||
            graph.ValueKind != JsonValueKind.Object ||
            !graph.TryGetProperty("ready", out var ready) ||
            ready.ValueKind != JsonValueKind.True ||
            !graph.TryGetProperty("nodes", out var graphNodes) ||
            graphNodes.ValueKind != JsonValueKind.Array ||
            !topology.TryGetProperty("routeTable", out var routeTable) ||
            routeTable.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException(
                "movement_route_topology_incomplete");

        var route =
            SelectRoute(
                page,
                routeTable);

        var routeDirection =
            page.RouteRef?.Direction ??
            "unknown";

        if (routeDirection is not ("forward" or "reverse"))
            throw new InvalidOperationException(
                "movement_direction_unknown");

        var topologyDirection =
            Str(
                route,
                "locoDirection",
                "unknown");

        if (topologyDirection is "forward" or "reverse" &&
            !string.Equals(
                topologyDirection,
                routeDirection,
                StringComparison.Ordinal))
            throw new InvalidOperationException(
                "movement_route_direction_mismatch");

        var trackAddresses =
            TrackAddressMap(root);

        var blockSensors =
            BlockSensorMap(root);

        var nodesByName =
            graphNodes
                .EnumerateArray()
                .Where(node =>
                    node.ValueKind ==
                        JsonValueKind.Object)
                .GroupBy(node =>
                    Str(
                        node,
                        "name"))
                .Where(group =>
                    !string.IsNullOrWhiteSpace(
                        group.Key))
                .ToDictionary(
                    group =>
                        group.Key,
                    group =>
                        group.First().Clone(),
                    StringComparer.Ordinal);

        if (!route.TryGetProperty("blockPath", out var blockPath) ||
            blockPath.ValueKind != JsonValueKind.Array ||
            !route.TryGetProperty("nodes", out var routeNodes) ||
            routeNodes.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException(
                "movement_route_incomplete");

        var blockEntries =
            blockPath
                .EnumerateArray()
                .Select(block => new
                {
                    Id =
                        Int(block, "id"),
                    Name =
                        Str(block, "name"),
                    NodeIndex =
                        Int(
                            block,
                            "nodeIndex")
                })
                .Where(block =>
                    ValidId(
                        block.Id))
                .ToArray();

        if (blockEntries.Length == 0)
            throw new InvalidOperationException(
                "movement_route_source_missing");

        var resources =
            new List<MovementPlanResourceModel>();

        var blocks =
            new List<MovementPlanResourceModel>();

        void PushBlock(
            int id,
            string name,
            int nodeIndex)
        {
            var resource =
                new MovementPlanResourceModel
                {
                    Key =
                        $"block:{id}",
                    Kind =
                        "block",
                    Name =
                        name,
                    Label =
                        name,
                    BlockId =
                        id,
                    SensorAddress =
                        blockSensors.TryGetValue(
                            id,
                            out var sensor)
                            ? sensor
                            : null,
                    NodeIndex =
                        nodeIndex
                };

            resources.Add(resource);
            blocks.Add(resource);
        }

        var source =
            blockEntries[0];

        PushBlock(
            source.Id,
            source.Name,
            source.NodeIndex);

        JsonElement[] edges =
            route.TryGetProperty("edgePath", out var edgePath) &&
            edgePath.ValueKind == JsonValueKind.Array
                ? edgePath
                    .EnumerateArray()
                    .Select(edge =>
                        edge.Clone())
                    .ToArray()
                : [];

        var edgeDirection =
            "unknown";

        var edgeDirectionConflict =
            false;

        if (routeDirection is not ("forward" or "reverse"))
        {
            foreach (var edge in edges)
            {
                var current =
                    Str(
                        edge,
                        "locoDirection",
                        "unknown");

                if (current is not ("forward" or "reverse"))
                    continue;

                if (edgeDirection == "unknown")
                {
                    edgeDirection =
                        current;
                    continue;
                }

                if (!string.Equals(
                        edgeDirection,
                        current,
                        StringComparison.Ordinal))
                {
                    edgeDirectionConflict =
                        true;
                    break;
                }
            }

            if (!edgeDirectionConflict &&
                edgeDirection is "forward" or "reverse")
                routeDirection =
                    edgeDirection;
        }

        if (routeDirection is not ("forward" or "reverse"))
            throw new InvalidOperationException(
                "movement_direction_unknown" +
                $" routeRefDirection={page.RouteRef?.Direction ?? "missing"}" +
                $" topologyDirection={Str(route, "locoDirection", "unknown")}" +
                $" edgeDirection={edgeDirection}" +
                $" edgeConflict={edgeDirectionConflict}" +
                $" edgeCount={edges.Length}");

        var routeNodeNames =
            routeNodes
                .EnumerateArray()
                .Select(node =>
                    node.ValueKind == JsonValueKind.String
                        ? node.GetString() ?? ""
                        : "")
                .ToArray();

        for (
            var nodeIndex = 0;
            nodeIndex <
                routeNodeNames.Length;
            nodeIndex++)
        {
            var nodeName =
                routeNodeNames[
                    nodeIndex];

            if (string.IsNullOrWhiteSpace(
                    nodeName))
                continue;

            nodesByName.TryGetValue(
                nodeName,
                out var node);

            var detectors =
                new HashSet<int>();

            if (node.ValueKind ==
                    JsonValueKind.Object)
            {
                if (node.TryGetProperty("detectors", out var rawDetectors) &&
                    rawDetectors.ValueKind == JsonValueKind.Array)
                {
                    foreach (var detector in rawDetectors.EnumerateArray())
                    {
                        var address =
                            Int(
                                detector,
                                "address");

                        if (ValidId(
                                address))
                            detectors.Add(
                                address);
                    }
                }

                if (node.TryGetProperty("elementIds", out var rawElementIds) &&
                    rawElementIds.ValueKind == JsonValueKind.Array)
                {
                    foreach (var elementId in rawElementIds.EnumerateArray())
                    {
                        if (!elementId.TryGetInt32(out var id))
                            continue;

                        if (trackAddresses.TryGetValue(
                                id,
                                out var address))
                            detectors.Add(
                                address);
                    }
                }
            }

            var trackName =
                node.ValueKind ==
                    JsonValueKind.Object
                    ? Str(
                        node,
                        "trackName")
                    : "";

            resources.Add(
                new MovementPlanResourceModel
                {
                    Key =
                        "segment:" +
                        nodeName,
                    Kind =
                        "segment",
                    Name =
                        nodeName,
                    Label =
                        string.IsNullOrWhiteSpace(
                            trackName)
                            ? nodeName
                            : nodeName +
                              " · " +
                              trackName.Trim(),
                    NodeIndex =
                        nodeIndex,
                    Detectors =
                        detectors
                            .OrderBy(x => x)
                            .ToArray()
                });

            foreach (var block in blockEntries)
            {
                if (block.NodeIndex !=
                        nodeIndex ||
                    block.Id ==
                        source.Id ||
                    block.Id ==
                        blockEntries[^1].Id ||
                    blocks.Any(existing =>
                        existing.BlockId ==
                        block.Id))
                    continue;

                PushBlock(
                    block.Id,
                    block.Name,
                    block.NodeIndex);
            }

            if (nodeIndex >=
                edges.Length)
                continue;

            var edge =
                edges[nodeIndex];

            JsonElement[] passages;

            if (edge.TryGetProperty("turnoutPath", out var rawTurnoutPath) &&
                rawTurnoutPath.ValueKind == JsonValueKind.Array &&
                rawTurnoutPath.GetArrayLength() > 0)
            {
                passages =
                    rawTurnoutPath
                        .EnumerateArray()
                        .Select(passage =>
                            passage.Clone())
                        .ToArray();
            }
            else
            {
                passages =
                    ReadTurnoutStates(
                        edge,
                        "turnoutStates")
                    .Select(state =>
                    {
                        using var temp =
                            JsonDocument.Parse(
                                JsonSerializer.Serialize(
                                    new
                                    {
                                        elementId =
                                            0,
                                        name =
                                            $"Turnout {state.Address}",
                                        turnoutStates =
                                            new[]
                                            {
                                                new
                                                {
                                                    address =
                                                        state.Address,
                                                    closed =
                                                        state.Closed
                                                }
                                            }
                                    }));

                        return temp.RootElement.Clone();
                    })
                    .ToArray();
            }

            for (
                var passageIndex = 0;
                passageIndex <
                    passages.Length;
                passageIndex++)
            {
                var passage =
                    passages[
                        passageIndex];

                var elementId =
                    Int(
                        passage,
                        "elementId");

                var turnoutStates =
                    ReadTurnoutStates(
                        passage,
                        "turnoutStates");

                var fallbackAddress =
                    turnoutStates
                        .FirstOrDefault()?
                        .Address ??
                    (ushort)(
                        passageIndex +
                        1);

                var name =
                    Str(
                        passage,
                        "name",
                        $"Turnout {fallbackAddress}");

                var detectorAddress =
                    ValidId(elementId) &&
                    trackAddresses.TryGetValue(
                        elementId,
                        out var mappedAddress)
                        ? mappedAddress
                        : 0;

                resources.Add(
                    new MovementPlanResourceModel
                    {
                        Key =
                            ValidId(elementId)
                                ? $"turnout:{elementId}"
                                : $"turnout:{Str(edge, "from")}:{Str(edge, "to")}:{passageIndex}",
                        Kind =
                            "turnout",
                        Name =
                            name,
                        Label =
                            name,
                        SensorAddress =
                            detectorAddress > 0
                                ? detectorAddress
                                : null,
                        NodeIndex =
                            nodeIndex,
                        Detectors =
                            detectorAddress > 0
                                ? [detectorAddress]
                                : [],
                        TurnoutStates =
                            turnoutStates
                    });
            }
        }

        var destination =
            blockEntries[^1];

        if (!blocks.Any(block =>
                block.BlockId ==
                destination.Id))
            PushBlock(
                destination.Id,
                destination.Name,
                destination.NodeIndex);

        var legs =
            new List<MovementPlanLegModel>();

        for (
            var index = 0;
            index <
                blocks.Count - 1;
            index++)
        {
            var from =
                blocks[index];

            var to =
                blocks[index + 1];

            if (!from.NodeIndex.HasValue ||
                !to.NodeIndex.HasValue ||
                !from.BlockId.HasValue ||
                !to.BlockId.HasValue)
                continue;

            var legResources =
                resources
                    .Where(resource =>
                    {
                        if (!resource.NodeIndex.HasValue ||
                            resource.Key ==
                                from.Key ||
                            resource.Key ==
                                to.Key)
                            return false;

                        if (resource.Kind ==
                            "segment")
                            return resource.NodeIndex >
                                       from.NodeIndex &&
                                   resource.NodeIndex <=
                                       to.NodeIndex;

                        if (resource.Kind ==
                            "turnout")
                            return resource.NodeIndex >=
                                       from.NodeIndex &&
                                   resource.NodeIndex <
                                       to.NodeIndex;

                        return false;
                    })
                    .ToArray();

            var leave =
                LeaveRule(
                    page,
                    from.BlockId.Value,
                    blockSensors,
                    root,
                    routeDirection);

            legs.Add(
                new MovementPlanLegModel
                {
                    Index =
                        index,
                    From =
                        from,
                    To =
                        to,
                    Resources =
                        legResources,
                    TurnoutStates =
                        UniqueTurnoutStates(
                            legResources
                                .SelectMany(resource =>
                                    resource.TurnoutStates)),
                    ApproachWhen =
                        ApproachRule(
                            page,
                            to.BlockId.Value,
                            root,
                            routeDirection),
                    ApproachDelayMs =
                        BlockEventDelay(
                            root,
                            to.BlockId.Value,
                            routeDirection,
                            "arrival"),
                    DepartWhen =
                        [],
                    LeaveWhen =
                        leave.Conditions,
                    LeaveWhenExplicit =
                        leave.Explicit,
                    LeaveDelayMs =
                        BlockEventDelay(
                            root,
                            from.BlockId.Value,
                            routeDirection,
                            "leave"),
                    ArrivedWhen =
                        ArrivalRule(
                            page,
                            to.BlockId.Value,
                            blockSensors,
                            root,
                            routeDirection),
                    ArrivedDelayMs =
                        BlockEventDelay(
                            root,
                            to.BlockId.Value,
                            routeDirection,
                            "arrived")
                });
        }

        return new MovementPlanModel
        {
            Direction =
                routeDirection,
            Resources =
                resources.ToArray(),
            Blocks =
                blocks.ToArray(),
            Legs =
                legs.ToArray()
        };
    }
}
