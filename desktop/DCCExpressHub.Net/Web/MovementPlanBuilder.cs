using System.Text.Json;
using System.Text.Encodings.Web;

namespace DCCExpressHub.Net.Web;

/// <summary>
/// Builds the exact physical Movement plan from the authoritative persisted
/// layout route topology. Runtime execution never trusts a client-supplied
/// route plan.
/// </summary>
public sealed class MovementPlanBuilder
{
    readonly IWebHostEnvironment _env;
    readonly ILogger<MovementPlanBuilder> _log;
    readonly object _diagnosticGate = new();
    readonly HashSet<string> _reportedTopologyDiagnostics =
        new(StringComparer.Ordinal);

    public MovementPlanBuilder(
        IWebHostEnvironment env,
        ILogger<MovementPlanBuilder> log)
    {
        _env = env;
        _log = log;
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

    static void CollectUnknownProperties(
        JsonElement element,
        string path,
        IReadOnlySet<string> known,
        ISet<string> ignored)
    {
        if (element.ValueKind != JsonValueKind.Object)
            return;

        foreach (var property in element.EnumerateObject())
            if (!known.Contains(property.Name))
                ignored.Add(
                    string.IsNullOrEmpty(path)
                        ? property.Name
                        : path + "." + property.Name);
    }

    void ReportTopologyDiagnostics(
        JsonElement topology,
        JsonElement graph,
        JsonElement route)
    {
        var ignored =
            new SortedSet<string>(
                StringComparer.Ordinal);

        CollectUnknownProperties(
            topology,
            "routeTopology",
            new HashSet<string>(
                new[]
                {
                    "version",
                    "graph",
                    "routeTable"
                },
                StringComparer.Ordinal),
            ignored);

        CollectUnknownProperties(
            graph,
            "routeTopology.graph",
            new HashSet<string>(
                new[]
                {
                    "ready",
                    "nodes"
                },
                StringComparer.Ordinal),
            ignored);

        if (graph.TryGetProperty(
                "nodes",
                out var graphNodes) &&
            graphNodes.ValueKind == JsonValueKind.Array)
        {
            foreach (var node in graphNodes.EnumerateArray())
                CollectUnknownProperties(
                    node,
                    "routeTopology.graph.nodes[]",
                    new HashSet<string>(
                        new[]
                        {
                            "name",
                            "trackName",
                            "detectors",
                            "elementIds"
                        },
                        StringComparer.Ordinal),
                    ignored);
        }

        CollectUnknownProperties(
            route,
            "routeTopology.routeTable[]",
            new HashSet<string>(
                new[]
                {
                    "fromBlockId",
                    "toBlockId",
                    "blockPath",
                    "nodes",
                    "partPath",
                    "edgePath",
                    "turnoutStates",
                    "locoDirection"
                },
                StringComparer.Ordinal),
            ignored);

        if (route.TryGetProperty(
                "blockPath",
                out var blockPath) &&
            blockPath.ValueKind == JsonValueKind.Array)
        {
            foreach (var block in blockPath.EnumerateArray())
                CollectUnknownProperties(
                    block,
                    "routeTopology.routeTable[].blockPath[]",
                    new HashSet<string>(
                        new[]
                        {
                            "id",
                            "name",
                            "nodeIndex"
                        },
                        StringComparer.Ordinal),
                    ignored);
        }

        if (route.TryGetProperty(
                "edgePath",
                out var edgePath) &&
            edgePath.ValueKind == JsonValueKind.Array)
        {
            foreach (var edge in edgePath.EnumerateArray())
            {
                CollectUnknownProperties(
                    edge,
                    "routeTopology.routeTable[].edgePath[]",
                    new HashSet<string>(
                        new[]
                        {
                            "from",
                            "to",
                            "turnoutStates",
                            "turnoutPath",
                            "locoDirection"
                        },
                        StringComparer.Ordinal),
                    ignored);

                if (edge.TryGetProperty(
                        "turnoutPath",
                        out var turnoutPath) &&
                    turnoutPath.ValueKind == JsonValueKind.Array)
                    foreach (var passage in
                             turnoutPath.EnumerateArray())
                        CollectUnknownProperties(
                            passage,
                            "routeTopology.routeTable[].edgePath[].turnoutPath[]",
                            new HashSet<string>(
                                new[]
                                {
                                    "elementId",
                                    "turnoutStates"
                                },
                                StringComparer.Ordinal),
                            ignored);
            }
        }

        var version =
            Int(
                topology,
                "version",
                -1);

        var ignoredText =
            ignored.Count == 0
                ? "(none)"
                : string.Join(
                    ", ",
                    ignored);

        var signature =
            version.ToString(
                System.Globalization.CultureInfo.InvariantCulture) +
            "|" +
            ignoredText;

        lock (_diagnosticGate)
        {
            if (!_reportedTopologyDiagnostics.Add(
                    signature))
                return;
        }

        _log.LogInformation(
            "Movement route topology parsed by capabilities. Version={Version}. Ignored fields: {IgnoredFields}",
            version,
            ignoredText);
    }

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

    static string[] ReadIdentityStates(
        JsonElement parent,
        string propertyName)
    {
        if (!parent.TryGetProperty(propertyName, out var states) ||
            states.ValueKind != JsonValueKind.Array)
            return [];

        return states
            .EnumerateArray()
            .Select(state =>
            {
                var address =
                    state.TryGetProperty("address", out var addressElement) &&
                    addressElement.TryGetDouble(out var numeric)
                        ? numeric
                        : 0d;

                var closed =
                    state.TryGetProperty("closed", out var rawClosed) &&
                    rawClosed.ValueKind == JsonValueKind.True;

                return new
                {
                    Address =
                        address,
                    Closed =
                        closed
                };
            })
            .Where(state =>
                state.Address > 0 &&
                Math.Abs(
                    state.Address -
                    Math.Round(
                        state.Address)) <
                    double.Epsilon)
            .OrderBy(state =>
                state.Address)
            .Select(state =>
                state.Address.ToString(
                    "0",
                    System.Globalization.CultureInfo.InvariantCulture) +
                ":" +
                (state.Closed
                    ? "1"
                    : "0"))
            .ToArray();
    }

    static string CanonicalRouteKey(
        JsonElement route)
    {
        var blockPath =
            route.TryGetProperty("blockPath", out var rawBlocks) &&
            rawBlocks.ValueKind == JsonValueKind.Array
                ? rawBlocks
                    .EnumerateArray()
                    .Select(block =>
                        $"{Int(block, "id")}@{Int(block, "nodeIndex")}")
                    .ToArray()
                : [];

        var nodes =
            route.TryGetProperty("nodes", out var rawNodes) &&
            rawNodes.ValueKind == JsonValueKind.Array
                ? rawNodes
                    .EnumerateArray()
                    .Select(node =>
                        node.ValueKind == JsonValueKind.String
                            ? node.GetString() ?? ""
                            : "")
                    .ToArray()
                : [];

        object[] edgePath;

        if (route.TryGetProperty("edgePath", out var rawEdges) &&
            rawEdges.ValueKind == JsonValueKind.Array)
        {
            edgePath =
                rawEdges
                    .EnumerateArray()
                    .Select(edge =>
                    {
                        var states =
                            ReadIdentityStates(
                                edge,
                                "turnoutStates");

                        object[] passages =
                            edge.TryGetProperty("turnoutPath", out var rawPassages) &&
                            rawPassages.ValueKind == JsonValueKind.Array
                                ? rawPassages
                                    .EnumerateArray()
                                    .Select(passage =>
                                        (object)new
                                        {
                                            elementId =
                                                Int(
                                                    passage,
                                                    "elementId"),
                                            states =
                                                ReadIdentityStates(
                                                    passage,
                                                    "turnoutStates")
                                        })
                                    .ToArray()
                                : [];

                        return (object)new
                        {
                            from =
                                Str(
                                    edge,
                                    "from"),
                            to =
                                Str(
                                    edge,
                                    "to"),
                            direction =
                                Str(
                                    edge,
                                    "locoDirection",
                                    "unknown"),
                            turnoutStates =
                                states,
                            turnoutPath =
                                passages
                        };
                    })
                    .ToArray();
        }
        else
        {
            edgePath = [];
        }

        return JsonSerializer.Serialize(
            new
            {
                fromBlockId =
                    Int(
                        route,
                        "fromBlockId"),
                toBlockId =
                    Int(
                        route,
                        "toBlockId"),
                blockPath,
                nodes,
                edgePath,
                direction =
                    Str(
                        route,
                        "locoDirection",
                        "unknown")
            },
            new JsonSerializerOptions
            {
                Encoder =
                    JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
                WriteIndented =
                    false
            });
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

    static JsonElement SelectRoute(
        MovementPageModel page,
        JsonElement routeTable)
    {
        if (!string.IsNullOrWhiteSpace(page.RouteKey))
        {
            foreach (var route in routeTable.EnumerateArray())
                if (string.Equals(
                        CanonicalRouteKey(route),
                        page.RouteKey,
                        StringComparison.Ordinal))
                    return route.Clone();

            throw new InvalidOperationException(
                "movement_selected_route_not_found");
        }

        if (!page.FromBlockId.HasValue ||
            !page.ToBlockId.HasValue)
            throw new InvalidOperationException(
                "movement_requires_from_to_blocks");

        var checkpoints =
            new List<int>
            {
                page.FromBlockId.Value
            };

        checkpoints.AddRange(
            page.ViaBlockIds
                .Where(ValidId));

        checkpoints.Add(
            page.ToBlockId.Value);

        var candidates =
            routeTable
                .EnumerateArray()
                .Where(route =>
                    Int(route, "fromBlockId") ==
                        checkpoints[0] &&
                    Int(route, "toBlockId") ==
                        checkpoints[^1] &&
                    ContainsCheckpoints(
                        route,
                        checkpoints))
                .Select(route =>
                    route.Clone())
                .ToArray();

        if (candidates.Length == 0)
            throw new InvalidOperationException(
                "movement_route_not_found");

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
                        "tracksignal2" or
                        "tracksignal3" or
                        "tracksignal4")
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

    static MovementBlockRule? BlockRule(
        MovementPageModel page,
        int blockId) =>
        page.BlockRules
            .FirstOrDefault(x =>
                x.BlockId ==
                blockId);

    static MovementSensorCondition[] CloneConditions(
        IEnumerable<MovementSensorCondition>? source) =>
        (source ?? [])
            .Select(condition =>
                new MovementSensorCondition
                {
                    Id =
                        condition.Id,
                    Sensor =
                        condition.Sensor,
                    State =
                        condition.State
                })
            .ToArray();

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

    static MovementSensorCondition[] ApproachRule(
        MovementPageModel page,
        int blockId,
        JsonElement root,
        string direction)
    {
        var explicitRule =
            BlockRule(
                page,
                blockId);

        if (explicitRule?.ApproachWhen.Length > 0)
            return CloneConditions(
                explicitRule.ApproachWhen);

        return BlockEventConditions(
            root,
            blockId,
            direction,
            "arrival");
    }

    static MovementSensorCondition[] ArrivalRule(
        MovementPageModel page,
        int blockId,
        IReadOnlyDictionary<int, int> blockSensors,
        JsonElement root,
        string direction)
    {
        var explicitRule =
            BlockRule(
                page,
                blockId);

        if (explicitRule?.ArrivedWhen.Length > 0)
            return CloneConditions(
                explicitRule.ArrivedWhen);

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
            MovementPageModel page,
            int blockId,
            JsonElement root,
            string direction)
    {
        var explicitRule =
            BlockRule(
                page,
                blockId);

        if (explicitRule?.LeaveWhen.Length > 0)
            return (
                CloneConditions(
                    explicitRule.LeaveWhen),
                true);

        var configured =
            BlockEventConditions(
                root,
                blockId,
                direction,
                "leave");

        return configured.Length > 0
            ? (
                configured,
                true)
            : (
                [],
                false);
    }

    static MovementSensorCondition[] AfterLeaveRule(
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
            return configured
                .Select(condition =>
                    new MovementSensorCondition
                    {
                        Id =
                            condition.Id.Replace(
                                "-leave-",
                                "-afterLeave-",
                                StringComparison.Ordinal),
                        Sensor =
                            condition.Sensor,
                        State =
                            condition.State
                    })
                .ToArray();

        return blockSensors.TryGetValue(
                blockId,
                out var sensor)
            ? [
                new MovementSensorCondition
                {
                    Id =
                        $"auto-after-leave-{blockId}-off",
                    Sensor =
                        sensor,
                    State =
                        false
                }
              ]
            : [];
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
                RouteKey =
                    CanonicalRouteKey(
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

        var missing =
            new List<string>();

        JsonElement graph =
            default;

        JsonElement graphNodes =
            default;

        JsonElement routeTable =
            default;

        if (!topology.TryGetProperty(
                "graph",
                out graph) ||
            graph.ValueKind != JsonValueKind.Object)
        {
            missing.Add(
                "graph");
        }
        else
        {
            if (!graph.TryGetProperty(
                    "ready",
                    out var ready) ||
                ready.ValueKind != JsonValueKind.True)
                missing.Add(
                    "graph.ready");

            if (!graph.TryGetProperty(
                    "nodes",
                    out graphNodes) ||
                graphNodes.ValueKind != JsonValueKind.Array)
                missing.Add(
                    "graph.nodes");
        }

        if (!topology.TryGetProperty(
                "routeTable",
                out routeTable) ||
            routeTable.ValueKind != JsonValueKind.Array)
            missing.Add(
                "routeTable");

        if (missing.Count > 0)
            throw new InvalidOperationException(
                "movement_route_topology_missing_required: " +
                string.Join(
                    ", ",
                    missing));

        var route =
            SelectRoute(
                page,
                routeTable);

        ReportTopologyDiagnostics(
            topology,
            graph,
            route);

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
            int nodeIndex,
            bool physical = true)
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

            if (physical)
                resources.Add(
                    resource);

            blocks.Add(
                resource);
        }

        JsonElement[] edges =
            route.TryGetProperty(
                "edgePath",
                out var edgePath) &&
            edgePath.ValueKind ==
                JsonValueKind.Array
                ? edgePath
                    .EnumerateArray()
                    .Select(edge =>
                        edge.Clone())
                    .ToArray()
                : [];

        var routeNodeNames =
            routeNodes
                .EnumerateArray()
                .Select(node =>
                    node.ValueKind ==
                        JsonValueKind.String
                        ? node.GetString() ??
                          ""
                        : "")
                .ToArray();

        JsonElement[] partPath =
            route.TryGetProperty(
                "partPath",
                out var rawPartPath) &&
            rawPartPath.ValueKind ==
                JsonValueKind.Array
                ? rawPartPath
                    .EnumerateArray()
                    .Where(part =>
                        part.ValueKind ==
                            JsonValueKind.Object)
                    .Select(part =>
                        part.Clone())
                    .ToArray()
                : [];

        var usesSectionParts =
            partPath.Length >
            0;

        void PushTurnouts(
            JsonElement edge,
            int nodeIndex)
        {
            JsonElement[] passages;

            if (edge.TryGetProperty(
                    "turnoutPath",
                    out var rawTurnoutPath) &&
                rawTurnoutPath.ValueKind ==
                    JsonValueKind.Array &&
                rawTurnoutPath.GetArrayLength() >
                    0)
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
                    ValidId(
                        elementId) &&
                    trackAddresses.TryGetValue(
                        elementId,
                        out var mappedAddress)
                        ? mappedAddress
                        : 0;

                resources.Add(
                    new MovementPlanResourceModel
                    {
                        Key =
                            ValidId(
                                elementId)
                                ? $"turnout:{elementId}"
                                : $"turnout:{Str(edge, "from")}:{Str(edge, "to")}:{passageIndex}",
                        Kind =
                            "turnout",
                        Name =
                            name,
                        Label =
                            name,
                        SensorAddress =
                            detectorAddress >
                                0
                                ? detectorAddress
                                : null,
                        NodeIndex =
                            nodeIndex,
                        Detectors =
                            detectorAddress >
                                0
                                ? [detectorAddress]
                                : [],
                        TurnoutStates =
                            turnoutStates
                    });
            }
        }

        var source =
            blockEntries[0];

        if (usesSectionParts)
        {
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

                foreach (var part in
                         partPath.Where(part =>
                             string.Equals(
                                 Str(
                                     part,
                                     "nodeName"),
                                 nodeName,
                                 StringComparison.Ordinal)))
                {
                    var detectors =
                        new HashSet<int>();

                    if (part.TryGetProperty(
                            "detectors",
                            out var rawDetectors) &&
                        rawDetectors.ValueKind ==
                            JsonValueKind.Array)
                        foreach (var detector in
                                 rawDetectors
                                     .EnumerateArray())
                            if (detector.TryGetInt32(
                                    out var address) &&
                                ValidId(
                                    address))
                                detectors.Add(
                                    address);

                    int? partIndex =
                        part.TryGetProperty(
                            "partIndex",
                            out var rawPartIndex) &&
                        rawPartIndex.TryGetInt32(
                            out var parsedPartIndex)
                            ? parsedPartIndex
                            : null;

                    var partKey =
                        Str(
                            part,
                            "partKey",
                            partIndex.HasValue
                                ? "part-" +
                                  partIndex.Value
                                : "part");

                    resources.Add(
                        new MovementPlanResourceModel
                        {
                            Key =
                                $"part:{nodeName}:{partKey}",
                            Kind =
                                "segment",
                            Name =
                                partKey,
                            Label =
                                nodeName +
                                " · " +
                                partKey,
                            NodeIndex =
                                nodeIndex,
                            Detectors =
                                detectors
                                    .OrderBy(value =>
                                        value)
                                    .ToArray(),
                            PartIndex =
                                partIndex
                        });
                }

                if (nodeIndex <
                    edges.Length)
                    PushTurnouts(
                        edges[
                            nodeIndex],
                        nodeIndex);
            }

            for (
                var routeOrder = 0;
                routeOrder <
                    resources.Count;
                routeOrder++)
                resources[
                    routeOrder]
                    .RouteOrder =
                    routeOrder;

            foreach (var block in
                     blockEntries)
            {
                if (!blockSensors.TryGetValue(
                        block.Id,
                        out var sensor))
                    throw new InvalidOperationException(
                        $"movement_block_sensor_missing:{block.Name}");

                var matchingSegments =
                    resources
                        .Where(resource =>
                            string.Equals(
                                resource.Kind,
                                "segment",
                                StringComparison.Ordinal) &&
                            resource.Detectors.Contains(
                                sensor))
                        .ToArray();

                if (matchingSegments.Length !=
                    1)
                    throw new InvalidOperationException(
                        matchingSegments.Length ==
                            0
                            ? $"movement_block_sensor_not_on_route:{block.Name}:#{sensor}"
                            : $"movement_block_sensor_ambiguous:{block.Name}:#{sensor}");

                var segment =
                    matchingSegments[
                        0];

                var blockResource =
                    new MovementPlanResourceModel
                    {
                        Key =
                            $"block:{block.Id}",
                        Kind =
                            "block",
                        Name =
                            block.Name,
                        Label =
                            block.Name,
                        BlockId =
                            block.Id,
                        SensorAddress =
                            sensor,
                        NodeIndex =
                            segment.NodeIndex,
                        RouteOrder =
                            segment.RouteOrder,
                        PartIndex =
                            segment.PartIndex,
                        PhysicalSegmentNames =
                            [segment.Name]
                    };

                blocks.Add(
                    blockResource);
            }
        }
        else
        {
            PushBlock(
                source.Id,
                source.Name,
                source.NodeIndex);

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
                    if (node.TryGetProperty(
                            "detectors",
                            out var rawDetectors) &&
                        rawDetectors.ValueKind ==
                            JsonValueKind.Array)
                    {
                        foreach (var detector in
                                 rawDetectors
                                     .EnumerateArray())
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

                    if (node.TryGetProperty(
                            "elementIds",
                            out var rawElementIds) &&
                        rawElementIds.ValueKind ==
                            JsonValueKind.Array)
                    {
                        foreach (var elementId in
                                 rawElementIds
                                     .EnumerateArray())
                        {
                            if (!elementId.TryGetInt32(
                                    out var id))
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
                                .OrderBy(value =>
                                    value)
                                .ToArray()
                    });

                foreach (var block in
                         blockEntries)
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

                if (nodeIndex <
                    edges.Length)
                    PushTurnouts(
                        edges[
                            nodeIndex],
                        nodeIndex);
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

            for (
                var routeOrder = 0;
                routeOrder <
                    resources.Count;
                routeOrder++)
                resources[
                    routeOrder]
                    .RouteOrder =
                    routeOrder;
        }

        for (
            var index = 1;
            index <
                blocks.Count;
            index++)
            if (blocks[
                    index -
                    1]
                    .RouteOrder >=
                blocks[
                    index]
                    .RouteOrder)
                throw new InvalidOperationException(
                    "movement_block_route_order_invalid:" +
                    blocks[
                        index]
                        .Name);

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
                        if (usesSectionParts)
                            return
                                resource.RouteOrder >
                                    from.RouteOrder &&
                                resource.RouteOrder <=
                                    to.RouteOrder;

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
                    .OrderBy(resource =>
                        resource.RouteOrder)
                    .ToArray();

            var routeDirection =
                Str(
                    route,
                    "locoDirection",
                    "unknown");

            var leave =
                LeaveRule(
                    page,
                    from.BlockId.Value,
                    root,
                    routeDirection);

            var fromRule =
                BlockRule(
                    page,
                    from.BlockId.Value);

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
                    DepartWhen =
                        CloneConditions(
                            fromRule?.DepartWhen),
                    LeaveWhen =
                        leave.Conditions,
                    LeaveWhenExplicit =
                        leave.Explicit,
                    AfterLeaveWhen =
                        AfterLeaveRule(
                            from.BlockId.Value,
                            blockSensors,
                            root,
                            routeDirection),
                    ArrivedWhen =
                        ArrivalRule(
                            page,
                            to.BlockId.Value,
                            blockSensors,
                            root,
                            routeDirection)
                });
        }

        return new MovementPlanModel
        {
            Direction =
                Str(
                    route,
                    "locoDirection",
                    "unknown"),
            Resources =
                resources.ToArray(),
            Blocks =
                blocks.ToArray(),
            Legs =
                legs.ToArray()
        };
    }
}
