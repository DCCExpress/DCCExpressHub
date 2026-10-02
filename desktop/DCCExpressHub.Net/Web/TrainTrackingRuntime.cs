using System.Text.Json;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed record TrainTrackingLocoState(
    int LocoAddress,
    string? LocoId,
    int? CurrentBlockId,
    string? CurrentBlockName,
    int[] CurrentSensors,
    string[] CurrentSectionParts,
    int? PredictedNextBlockId,
    string? PredictedNextBlockName,
    int? LastSensor,
    int[] RecentSensorPath,
    string Confidence,
    long UpdatedAt);

public sealed record TrainTrackingLogEntry(
    string Id,
    long Timestamp,
    string Level,
    string Message);

public sealed record TrainTrackingSnapshot(
    bool Enabled,
    bool Active,
    bool Ready,
    string[] ReadinessIssues,
    string[] ReadinessWarnings,
    TrainTrackingLocoState[] Locos,
    TrainTrackingLogEntry[] Logs);

/// <summary>
/// Backend-authoritative physical train tracking.
///
/// This is the C# counterpart of the proven trainTrackingRuntime.ts from
/// feature/movement-train-events. It consumes only backend runtime state:
/// DCC-EX Q/q sensors, logical turnout state, block assignments and logical
/// locomotive feedback. Browsers only render snapshots.
/// </summary>
public sealed class TrainTrackingRuntime
{
    sealed class TrackingState
    {
        public int LocoAddress { get; set; }
        public string? LocoId { get; set; }
        public int? CurrentBlockId { get; set; }
        public string? CurrentBlockName { get; set; }
        public List<int> CurrentSensors { get; } = [];
        public List<string> CurrentSectionParts { get; } = [];
        public int? PredictedNextBlockId { get; set; }
        public string? PredictedNextBlockName { get; set; }
        public int? LastSensor { get; set; }
        public List<int> RecentSensorPath { get; } = [];
        public string Confidence { get; set; } = "certain";
        public long UpdatedAt { get; set; }
    }

    sealed record TurnoutRequirement(
        int Address,
        bool Closed);

    sealed class RoutePart
    {
        public string NodeName { get; set; } = "";
        public string PartKey { get; set; } = "";
        public int? PartIndex { get; set; }
        public int? FromSensor { get; set; }
        public int? ToSensor { get; set; }
        public int[] Detectors { get; set; } = [];
    }

    sealed class RouteEntry
    {
        public int FromBlockId { get; set; }
        public string? FromBlockName { get; set; }
        public int ToBlockId { get; set; }
        public string? ToBlockName { get; set; }
        public int[] BlockPath { get; set; } = [];
        public RoutePart[] PartPath { get; set; } = [];
        public TurnoutRequirement[] Turnouts { get; set; } = [];
        public string LocoDirection { get; set; } = "unknown";
    }

    sealed record Candidate(
        TrackingState Tracking,
        RouteEntry Route,
        int[] SensorPath,
        int SensorIndex);

    readonly object _gate = new();
    readonly IWebHostEnvironment _env;
    readonly LayoutRuntime _layout;
    readonly HubState _hubState;
    readonly ICommandCenter _commandCenter;
    readonly MovementRuntime _movement;
    readonly TrackAuthorityRuntime _authority;
    readonly ILogger<TrainTrackingRuntime> _log;

    readonly List<RouteEntry> _routes = [];
    readonly Dictionary<int, int> _blockSensorToId = [];
    readonly Dictionary<int, int> _blockIdToSensor = [];
    readonly Dictionary<int, string> _blockNames = [];
    readonly Dictionary<int, bool> _sensorStates = [];
    readonly Dictionary<int, TrackingState> _tracking = [];
    readonly Dictionary<int, RouteEntry> _committedRoutes = [];
    readonly List<TrainTrackingLogEntry> _logs = [];

    bool _enabled = true;
    bool _ready;
    string[] _readinessIssues = [];
    string[] _readinessWarnings = [];
    DateTime _layoutStampUtc = DateTime.MinValue;

    const int MaxLogs = 300;
    const int MaxRecentSensors = 32;

    public event Action<TrainTrackingSnapshot>? Changed;

    public TrainTrackingRuntime(
        IWebHostEnvironment env,
        LayoutRuntime layout,
        HubState hubState,
        ICommandCenter commandCenter,
        MovementRuntime movement,
        TrackAuthorityRuntime authority,
        ILogger<TrainTrackingRuntime> log)
    {
        _env = env;
        _layout = layout;
        _hubState = hubState;
        _commandCenter = commandCenter;
        _movement = movement;
        _authority = authority;
        _log = log;

        LoadEnabled();
        RefreshTopology();

        SeedSensorsFromRuntime();
        SeedFromBlocks();

        _layout.Changed +=
            OnLayoutChanged;

        _commandCenter.LocoFeedbackChanged +=
            _ => Publish();

        _authority.Update(
            Snapshot().Locos);
    }

    static long NowMs() =>
        DateTimeOffset.UtcNow
            .ToUnixTimeMilliseconds();

    string LayoutPath() =>
        Path.Combine(
            _env.ContentRootPath,
            "data",
            "config",
            "layout.json");

    string StatePath() =>
        Path.Combine(
            _env.ContentRootPath,
            "data",
            "state",
            "train-tracking.json");

    void LoadEnabled()
    {
        var path = StatePath();

        if (!File.Exists(path))
            return;

        try
        {
            using var doc =
                JsonDocument.Parse(
                    File.ReadAllText(path));

            if (doc.RootElement.TryGetProperty(
                    "enabled",
                    out var enabled))
                _enabled =
                    enabled.ValueKind ==
                    JsonValueKind.True;
        }
        catch
        {
            _enabled = true;
        }
    }

    void SaveEnabled()
    {
        try
        {
            var path = StatePath();
            Directory.CreateDirectory(
                Path.GetDirectoryName(path)!);

            File.WriteAllText(
                path,
                JsonSerializer.Serialize(
                    new
                    {
                        enabled =
                            _enabled
                    }));
        }
        catch (Exception ex)
        {
            _log.LogWarning(
                ex,
                "Train Tracking state could not be saved");
        }
    }

    static int? PositiveInt(
        JsonElement element,
        string property)
    {
        if (!element.TryGetProperty(
                property,
                out var value))
            return null;

        if (value.ValueKind ==
                JsonValueKind.Number &&
            value.TryGetInt32(
                out var number) &&
            number > 0)
            return number;

        return null;
    }

    static string StringValue(
        JsonElement element,
        string property,
        string fallback = "")
    {
        return
            element.TryGetProperty(
                property,
                out var value) &&
            value.ValueKind ==
                JsonValueKind.String
                ? value.GetString() ??
                  fallback
                : fallback;
    }

    static int[] IntArray(
        JsonElement element,
        string property)
    {
        if (!element.TryGetProperty(
                property,
                out var raw) ||
            raw.ValueKind !=
                JsonValueKind.Array)
            return [];

        return raw
            .EnumerateArray()
            .Where(item =>
                item.ValueKind ==
                    JsonValueKind.Number &&
                item.TryGetInt32(
                    out var value) &&
                value > 0)
            .Select(item =>
                item.GetInt32())
            .Distinct()
            .ToArray();
    }

    static void AddTurnoutRequirements(
        JsonElement parent,
        Dictionary<int, bool> result)
    {
        if (parent.ValueKind !=
            JsonValueKind.Object)
            return;

        if (parent.TryGetProperty(
                "turnoutStates",
                out var states) &&
            states.ValueKind ==
                JsonValueKind.Array)
        {
            foreach (var state in
                     states.EnumerateArray())
            {
                if (state.ValueKind !=
                    JsonValueKind.Object)
                    continue;

                var address =
                    PositiveInt(
                        state,
                        "address");

                if (!address.HasValue)
                    continue;

                result[address.Value] =
                    state.TryGetProperty(
                        "closed",
                        out var closed) &&
                    closed.ValueKind ==
                        JsonValueKind.True;
            }
        }

        if (parent.TryGetProperty(
                "turnoutPath",
                out var path) &&
            path.ValueKind ==
                JsonValueKind.Array)
        {
            foreach (var passage in
                     path.EnumerateArray())
                AddTurnoutRequirements(
                    passage,
                    result);
        }
    }

    RouteEntry? ParseRoute(
        JsonElement route)
    {
        if (route.ValueKind !=
            JsonValueKind.Object)
            return null;

        var from =
            PositiveInt(
                route,
                "fromBlockId");
        var to =
            PositiveInt(
                route,
                "toBlockId");

        if (!from.HasValue ||
            !to.HasValue)
            return null;

        var blocks =
            new List<int>();

        if (route.TryGetProperty(
                "blockPath",
                out var blockPath) &&
            blockPath.ValueKind ==
                JsonValueKind.Array)
        {
            foreach (var item in
                     blockPath.EnumerateArray())
            {
                var id =
                    item.ValueKind ==
                        JsonValueKind.Object
                        ? PositiveInt(
                            item,
                            "id")
                        : null;

                if (id.HasValue)
                    blocks.Add(
                        id.Value);
            }
        }

        var parts =
            new List<RoutePart>();

        if (route.TryGetProperty(
                "partPath",
                out var partPath) &&
            partPath.ValueKind ==
                JsonValueKind.Array)
        {
            foreach (var item in
                     partPath.EnumerateArray())
            {
                if (item.ValueKind !=
                    JsonValueKind.Object)
                    continue;

                parts.Add(
                    new RoutePart
                    {
                        NodeName =
                            StringValue(
                                item,
                                "nodeName",
                                "?"),
                        PartKey =
                            StringValue(
                                item,
                                "partKey",
                                ""),
                        PartIndex =
                            PositiveInt(
                                item,
                                "partIndex"),
                        FromSensor =
                            PositiveInt(
                                item,
                                "fromSensor"),
                        ToSensor =
                            PositiveInt(
                                item,
                                "toSensor"),
                        Detectors =
                            IntArray(
                                item,
                                "detectors")
                    });
            }
        }

        var turnouts =
            new Dictionary<int, bool>();

        AddTurnoutRequirements(
            route,
            turnouts);

        if (route.TryGetProperty(
                "edgePath",
                out var edgePath) &&
            edgePath.ValueKind ==
                JsonValueKind.Array)
            foreach (var edge in
                     edgePath.EnumerateArray())
                AddTurnoutRequirements(
                    edge,
                    turnouts);

        return new RouteEntry
        {
            FromBlockId =
                from.Value,
            FromBlockName =
                StringValue(
                    route,
                    "fromBlockName",
                    ""),
            ToBlockId =
                to.Value,
            ToBlockName =
                StringValue(
                    route,
                    "toBlockName",
                    ""),
            BlockPath =
                blocks.ToArray(),
            PartPath =
                parts.ToArray(),
            Turnouts =
                turnouts
                    .Select(pair =>
                        new TurnoutRequirement(
                            pair.Key,
                            pair.Value))
                    .ToArray(),
            LocoDirection =
                StringValue(
                    route,
                    "locoDirection",
                    "unknown")
        };
    }

    void BuildBlocks(
        JsonElement root)
    {
        _blockSensorToId.Clear();
        _blockIdToSensor.Clear();
        _blockNames.Clear();

        if (!root.TryGetProperty(
                "layers",
                out var layers) ||
            layers.ValueKind !=
                JsonValueKind.Array)
            return;

        foreach (var layer in
                 layers.EnumerateArray())
        {
            if (layer.ValueKind !=
                    JsonValueKind.Object ||
                !layer.TryGetProperty(
                    "elements",
                    out var elements) ||
                elements.ValueKind !=
                    JsonValueKind.Array)
                continue;

            foreach (var element in
                     elements.EnumerateArray())
            {
                if (element.ValueKind !=
                        JsonValueKind.Object ||
                    !string.Equals(
                        StringValue(
                            element,
                            "type"),
                        "trackblock",
                        StringComparison.Ordinal))
                    continue;

                var blockId =
                    PositiveInt(
                        element,
                        "id");

                if (!blockId.HasValue)
                    continue;

                var sensor =
                    PositiveInt(
                        element,
                        "sensorAddress");

                var name =
                    StringValue(
                        element,
                        "name",
                        "Block " +
                        blockId.Value)
                    .Trim();

                _blockNames[
                    blockId.Value] =
                    name.Length > 0
                        ? name
                        : "Block " +
                          blockId.Value;

                if (sensor.HasValue)
                {
                    _blockSensorToId[
                        sensor.Value] =
                        blockId.Value;

                    _blockIdToSensor[
                        blockId.Value] =
                        sensor.Value;
                }
            }
        }
    }

    void ValidateTopology(
        JsonElement? topology)
    {
        var issues =
            new List<string>();
        var warnings =
            new List<string>();

        foreach (var pair in
                 _blockNames)
            if (!_blockIdToSensor.ContainsKey(
                    pair.Key))
                issues.Add(
                    "Block \"" +
                    pair.Value +
                    "\" has no occupancy sensor.");

        if (_routes.Count == 0)
            issues.Add(
                "Route graph has no routes.");

        if (topology.HasValue &&
            topology.Value.ValueKind ==
                JsonValueKind.Object &&
            topology.Value.TryGetProperty(
                "graph",
                out var graph) &&
            graph.ValueKind ==
                JsonValueKind.Object &&
            graph.TryGetProperty(
                "nodes",
                out var nodes) &&
            nodes.ValueKind ==
                JsonValueKind.Array)
        {
            foreach (var node in
                     nodes.EnumerateArray())
            {
                var nodeName =
                    StringValue(
                        node,
                        "name",
                        "?");

                if (!node.TryGetProperty(
                        "sectionParts",
                        out var parts) ||
                    parts.ValueKind !=
                        JsonValueKind.Array)
                    continue;

                foreach (var part in
                         parts.EnumerateArray())
                {
                    if (IntArray(
                            part,
                            "detectors")
                        .Length >
                        0)
                        continue;

                    var partName =
                        StringValue(
                            part,
                            "key",
                            "");

                    if (partName.Length == 0 &&
                        part.TryGetProperty(
                            "index",
                            out var index))
                        partName =
                            index.ToString();

                    warnings.Add(
                        "SectionPart \"" +
                        nodeName +
                        " / " +
                        (partName.Length > 0
                            ? partName
                            : "?") +
                        "\" has no sensor; tracking will be less precise there.");
                }
            }
        }

        _readinessIssues =
            issues.ToArray();
        _readinessWarnings =
            warnings.ToArray();
        _ready =
            issues.Count == 0;
    }

    public void RefreshTopology()
    {
        lock (_gate)
        {
            _routes.Clear();

            var path =
                LayoutPath();

            if (!File.Exists(path))
            {
                _ready = false;
                _readinessIssues =
                    ["Layout file not found."];
                _readinessWarnings =
                    [];
                return;
            }

            try
            {
                _layoutStampUtc =
                    File.GetLastWriteTimeUtc(
                        path);

                using var doc =
                    JsonDocument.Parse(
                        File.ReadAllText(path));

                var root =
                    doc.RootElement;

                BuildBlocks(
                    root);

                JsonElement? topology =
                    null;

                if (root.TryGetProperty(
                        "routeTopology",
                        out var rawTopology) &&
                    rawTopology.ValueKind ==
                        JsonValueKind.Object)
                {
                    topology =
                        rawTopology.Clone();

                    if (rawTopology.TryGetProperty(
                            "routeTable",
                            out var table) &&
                        table.ValueKind ==
                            JsonValueKind.Array)
                    {
                        foreach (var route in
                                 table.EnumerateArray())
                        {
                            var parsed =
                                ParseRoute(
                                    route);

                            if (parsed is not
                                null)
                                _routes.Add(
                                    parsed);
                        }
                    }
                }

                ValidateTopology(
                    topology);

                WriteLog(
                    _ready
                        ? "info"
                        : "warn",
                    _ready
                        ? "Tracking topology ready: " +
                          _routes.Count +
                          " routes, " +
                          _blockSensorToId.Count +
                          " block sensors."
                        : "Tracking cannot start: " +
                          string.Join(
                              " ",
                              _readinessIssues));
            }
            catch (Exception ex)
            {
                _ready = false;
                _readinessIssues =
                    [ex.Message];
                _readinessWarnings =
                    [];

                WriteLog(
                    "error",
                    "Tracking topology load failed: " +
                    ex.Message);
            }
        }

        SeedFromBlocks();
        Publish();
    }

    void EnsureTopologyCurrent()
    {
        var path =
            LayoutPath();

        if (!File.Exists(path))
            return;

        var stamp =
            File.GetLastWriteTimeUtc(
                path);

        if (stamp !=
            _layoutStampUtc)
            RefreshTopology();
    }

    void SeedSensorsFromRuntime()
    {
        lock (_gate)
        {
            var sensors =
                _blockIdToSensor.Values
                    .Concat(
                        _routes.SelectMany(
                            RouteSensorPath))
                    .Distinct()
                    .ToArray();

            foreach (var sensor in
                     sensors)
                if (sensor is >= 1 and <= 65535 &&
                    _layout.TryGetSensorState(
                        (ushort)sensor,
                        out var on))
                    _sensorStates[
                        sensor] =
                        on;
        }
    }

    Dictionary<int, (string? LocoId, int LocoAddress)>
        ReadBlockAssignments()
    {
        var result =
            new Dictionary<
                int,
                (string? LocoId,
                 int LocoAddress)>();

        var element =
            JsonSerializer.SerializeToElement(
                _layout.BlockSnapshot());

        if (element.ValueKind !=
            JsonValueKind.Object)
            return result;

        foreach (var property in
                 element.EnumerateObject())
        {
            if (!int.TryParse(
                    property.Name,
                    out var blockId) ||
                property.Value.ValueKind !=
                    JsonValueKind.Object)
                continue;

            var state =
                property.Value;

            var address =
                state.TryGetProperty(
                    "locoAddress",
                    out var addressElement) &&
                addressElement.TryGetInt32(
                    out var locoAddress)
                    ? locoAddress
                    : 0;

            var locoId =
                state.TryGetProperty(
                    "locoId",
                    out var idElement) &&
                idElement.ValueKind ==
                    JsonValueKind.String
                    ? idElement.GetString()
                    : null;

            result[blockId] =
                (locoId, address);
        }

        return result;
    }

    void SeedFromBlocks()
    {
        EnsureTopologyCurrent();

        var assignments =
            ReadBlockAssignments();

        lock (_gate)
        {
            var assignedLocos =
                new HashSet<int>();

            foreach (var pair in
                     assignments)
            {
                var blockId =
                    pair.Key;
                var locoAddress =
                    pair.Value.LocoAddress;

                if (locoAddress <= 0)
                    continue;

                assignedLocos.Add(
                    locoAddress);

                var sensor =
                    _blockIdToSensor
                        .GetValueOrDefault(
                            blockId,
                            0);

                _tracking.TryGetValue(
                    locoAddress,
                    out var current);

                var blockChanged =
                    current?.CurrentBlockId !=
                    blockId;

                if (current is not null &&
                    blockChanged &&
                    _movement.IsLocoManaged(
                        locoAddress) &&
                    (sensor <= 0 ||
                     !_sensorStates.TryGetValue(
                         sensor,
                         out var occupied) ||
                     !occupied))
                {
                    WriteLog(
                        "warn",
                        "Tracking ignored premature Movement block assignment for loco #" +
                        locoAddress +
                        ": " +
                        BlockName(
                            blockId) +
                        " / sensor " +
                        (sensor > 0
                            ? "#" +
                              sensor
                            : "NONE") +
                        " is not ON.");

                    continue;
                }

                if (blockChanged)
                    _committedRoutes.Remove(
                        locoAddress);

                var state =
                    current ??
                    new TrackingState
                    {
                        LocoAddress =
                            locoAddress,
                        UpdatedAt =
                            NowMs()
                    };

                state.LocoId =
                    pair.Value.LocoId ??
                    state.LocoId;
                state.CurrentBlockId =
                    blockId;
                state.CurrentBlockName =
                    BlockName(
                        blockId);

                if (sensor > 0 &&
                    (blockChanged ||
                     !state.LastSensor.HasValue))
                {
                    state.LastSensor =
                        sensor;

                    if (!state.CurrentSensors.Contains(
                            sensor))
                        state.CurrentSensors.Add(
                            sensor);

                    AddRecentSensor(
                        state,
                        sensor);

                    state.Confidence =
                        "certain";
                    state.UpdatedAt =
                        NowMs();
                }

                _tracking[
                    locoAddress] =
                    state;
            }

            foreach (var address in
                     _tracking.Keys
                         .Where(address =>
                             !assignedLocos.Contains(
                                 address))
                         .ToArray())
            {
                _tracking.Remove(
                    address);
                _committedRoutes.Remove(
                    address);
            }
        }
    }

    string BlockName(
        int blockId) =>
        _blockNames.TryGetValue(
            blockId,
            out var name)
            ? name
            : "Block " +
              blockId;

    static void AddRecentSensor(
        TrackingState state,
        int sensor)
    {
        if (state.RecentSensorPath
                .LastOrDefault() !=
            sensor)
            state.RecentSensorPath.Add(
                sensor);

        while (state.RecentSensorPath.Count >
               MaxRecentSensors)
            state.RecentSensorPath.RemoveAt(
                0);
    }

    bool RouteMatchesTurnouts(
        RouteEntry route)
    {
        foreach (var turnout in
                 route.Turnouts)
        {
            if (turnout.Address is < 1 or > 65535 ||
                !_layout.TryGetTurnoutClosed(
                    (ushort)turnout.Address,
                    out var closed) ||
                closed !=
                    turnout.Closed)
                return false;
        }

        return true;
    }

    RouteEntry[] DirectRoutesFromBlock(
        int fromBlockId,
        string direction)
    {
        return _routes
            .Where(route =>
                route.FromBlockId ==
                    fromBlockId &&
                string.Equals(
                    route.LocoDirection,
                    direction,
                    StringComparison.OrdinalIgnoreCase) &&
                route.BlockPath.Length ==
                    2 &&
                route.BlockPath[0] ==
                    fromBlockId &&
                route.BlockPath[1] ==
                    route.ToBlockId &&
                RouteMatchesTurnouts(
                    route))
            .ToArray();
    }

    int[] RouteSensorPath(
        RouteEntry route)
    {
        var values =
            new List<int>();

        if (_blockIdToSensor.TryGetValue(
                route.FromBlockId,
                out var fromSensor))
            values.Add(
                fromSensor);

        foreach (var part in
                 route.PartPath)
        {
            if (part.FromSensor.HasValue)
                values.Add(
                    part.FromSensor.Value);

            values.AddRange(
                part.Detectors);

            if (part.ToSensor.HasValue)
                values.Add(
                    part.ToSensor.Value);
        }

        if (_blockIdToSensor.TryGetValue(
                route.ToBlockId,
                out var toSensor))
            values.Add(
                toSensor);

        return values
            .Where(value =>
                value > 0)
            .Distinct()
            .ToArray();
    }

    string[] SectionPartsForSensors(
        RouteEntry route,
        IEnumerable<int> sensors)
    {
        var active =
            sensors.ToHashSet();

        return route.PartPath
            .Where(part =>
                part.FromSensor.HasValue &&
                    active.Contains(
                        part.FromSensor.Value) ||
                part.ToSensor.HasValue &&
                    active.Contains(
                        part.ToSensor.Value) ||
                part.Detectors.Any(
                    active.Contains))
            .Select(part =>
                (part.NodeName.Length > 0
                    ? part.NodeName
                    : "?") +
                " / " +
                (part.PartKey.Length > 0
                    ? part.PartKey
                    : part.PartIndex?.ToString() ??
                      "?"))
            .Distinct(
                StringComparer.Ordinal)
            .ToArray();
    }

    string LocoDirection(
        int locoAddress)
    {
        return _hubState.Locos.TryGetValue(
                locoAddress,
                out var loco) &&
            !loco.Forward
                ? "reverse"
                : "forward";
    }

    bool LocoMoving(
        int locoAddress)
    {
        return _hubState.Locos.TryGetValue(
                   locoAddress,
                   out var loco) &&
               loco.Speed > 0;
    }

    Candidate? CandidateFromRoute(
        TrackingState tracking,
        RouteEntry route,
        int sensor)
    {
        var path =
            RouteSensorPath(
                route);

        var targetIndex =
            Array.IndexOf(
                path,
                sensor);

        if (targetIndex < 0)
            return null;

        int? anchor =
            tracking.LastSensor;

        if (!anchor.HasValue &&
            tracking.CurrentBlockId.HasValue &&
            _blockIdToSensor.TryGetValue(
                tracking.CurrentBlockId.Value,
                out var blockSensor))
            anchor =
                blockSensor;

        var anchorIndex =
            anchor.HasValue
                ? Array.LastIndexOf(
                    path,
                    anchor.Value)
                : -1;

        if (anchorIndex >=
            targetIndex)
            return null;

        return new Candidate(
            tracking,
            route,
            path,
            targetIndex);
    }

    Candidate[] CandidatesForSensor(
        TrackingState tracking,
        int sensor)
    {
        if (!tracking.CurrentBlockId.HasValue ||
            !LocoMoving(
                tracking.LocoAddress))
            return [];

        var direction =
            LocoDirection(
                tracking.LocoAddress);

        if (_committedRoutes.TryGetValue(
                tracking.LocoAddress,
                out var committed) &&
            committed.FromBlockId ==
                tracking.CurrentBlockId &&
            string.Equals(
                committed.LocoDirection,
                direction,
                StringComparison.OrdinalIgnoreCase))
        {
            var candidate =
                CandidateFromRoute(
                    tracking,
                    committed,
                    sensor);

            if (candidate is not null)
                return [candidate];
        }

        return DirectRoutesFromBlock(
                tracking.CurrentBlockId.Value,
                direction)
            .Select(route =>
                CandidateFromRoute(
                    tracking,
                    route,
                    sensor))
            .Where(candidate =>
                candidate is not null)
            .Cast<Candidate>()
            .ToArray();
    }

    void HandleSensorOn(
        int sensor)
    {
        if (!_enabled ||
            !_ready)
            return;

        Candidate[] unique;
        int[] ambiguous;

        lock (_gate)
        {
            var candidates =
                new List<Candidate>();
            var ambiguousLocos =
                new List<int>();

            foreach (var tracking in
                     _tracking.Values)
            {
                var matches =
                    CandidatesForSensor(
                        tracking,
                        sensor);

                if (matches.Length == 1)
                    candidates.Add(
                        matches[0]);
                else if (matches.Length > 1)
                {
                    tracking.Confidence =
                        "ambiguous";
                    tracking.UpdatedAt =
                        NowMs();
                    ambiguousLocos.Add(
                        tracking.LocoAddress);
                }
            }

            unique =
                candidates.ToArray();
            ambiguous =
                ambiguousLocos.ToArray();

            if (ambiguous.Length > 0 ||
                unique.Length > 1)
            {
                foreach (var address in
                         ambiguous
                             .Concat(
                                 unique.Select(
                                     candidate =>
                                         candidate.Tracking
                                             .LocoAddress))
                             .Distinct())
                    if (_tracking.TryGetValue(
                            address,
                            out var trackedState))
                    {
                        trackedState.Confidence =
                            "ambiguous";
                        trackedState.UpdatedAt =
                            NowMs();
                    }

                WriteLog(
                    "warn",
                    "Sensor #" +
                    sensor +
                    " -> ON is ambiguous.");

                return;
            }

            if (unique.Length != 1)
            {
                WriteLog(
                    "warn",
                    "Sensor #" +
                    sensor +
                    " -> ON: no moving tracked locomotive matches graph + direction + turnout state.");

                return;
            }

            var candidate =
                unique[0];
            var state =
                candidate.Tracking;

            _committedRoutes[
                state.LocoAddress] =
                candidate.Route;

            if (!state.CurrentSensors.Contains(
                    sensor))
                state.CurrentSensors.Add(
                    sensor);

            state.CurrentSectionParts.Clear();
            state.CurrentSectionParts.AddRange(
                SectionPartsForSensors(
                    candidate.Route,
                    state.CurrentSensors));

            state.LastSensor =
                sensor;
            AddRecentSensor(
                state,
                sensor);
            state.Confidence =
                "likely";
            state.UpdatedAt =
                NowMs();

            if (_blockSensorToId.TryGetValue(
                    sensor,
                    out var destinationBlockId) &&
                destinationBlockId ==
                    candidate.Route.ToBlockId)
            {
                state.CurrentBlockId =
                    destinationBlockId;
                state.CurrentBlockName =
                    BlockName(
                        destinationBlockId);
                state.Confidence =
                    "certain";
                state.CurrentSectionParts.Clear();
                _committedRoutes.Remove(
                    state.LocoAddress);

                if (!_movement.IsLocoManaged(
                        state.LocoAddress))
                    _layout.SetBlock(
                        (ushort)destinationBlockId,
                        state.LocoId ??
                        "",
                        (ushort)state.LocoAddress);

                WriteLog(
                    "match",
                    "Tracked loco #" +
                    state.LocoAddress +
                    " into " +
                    state.CurrentBlockName +
                    " via sensor #" +
                    sensor +
                    ".");
            }
            else
            {
                WriteLog(
                    "match",
                    "Tracked loco #" +
                    state.LocoAddress +
                    " at sensor #" +
                    sensor +
                    ".");
            }
        }

        Publish();
    }

    void HandleSensorOff(
        int sensor)
    {
        lock (_gate)
        {
            foreach (var state in
                     _tracking.Values)
            {
                if (!state.CurrentSensors.Remove(
                        sensor))
                    continue;

                if (_committedRoutes.TryGetValue(
                        state.LocoAddress,
                        out var route))
                {
                    state.CurrentSectionParts.Clear();
                    state.CurrentSectionParts.AddRange(
                        SectionPartsForSensors(
                            route,
                            state.CurrentSensors));
                }
                else
                {
                    state.CurrentSectionParts.Clear();
                }

                state.UpdatedAt =
                    NowMs();
            }
        }

        Publish();
    }

    void OnLayoutChanged(
        string type,
        object data)
    {
        EnsureTopologyCurrent();

        var element =
            JsonSerializer.SerializeToElement(
                data);

        if (string.Equals(
                type,
                "sensorChanged",
                StringComparison.Ordinal))
        {
            var address =
                PositiveInt(
                    element,
                    "address");

            if (!address.HasValue)
                return;

            var on =
                element.TryGetProperty(
                    "on",
                    out var onElement) &&
                onElement.ValueKind ==
                    JsonValueKind.True;

            bool? previous;

            lock (_gate)
            {
                previous =
                    _sensorStates.TryGetValue(
                        address.Value,
                        out var old)
                        ? old
                        : null;

                _sensorStates[
                    address.Value] =
                    on;
            }

            if (!previous.HasValue ||
                previous.Value ==
                    on)
            {
                Publish();
                return;
            }

            if (on)
                HandleSensorOn(
                    address.Value);
            else
                HandleSensorOff(
                    address.Value);

            return;
        }

        if (string.Equals(
                type,
                "blockStateChanged",
                StringComparison.Ordinal))
        {
            SeedFromBlocks();
            Publish();
            return;
        }

        if (string.Equals(
                type,
                "turnoutChanged",
                StringComparison.Ordinal) ||
            string.Equals(
                type,
                "accessoryChanged",
                StringComparison.Ordinal) ||
            string.Equals(
                type,
                "signalAspectChanged",
                StringComparison.Ordinal) ||
            string.Equals(
                type,
                "vpinChanged",
                StringComparison.Ordinal))
            Publish();
    }

    void SyncPredictions()
    {
        foreach (var state in
                 _tracking.Values)
        {
            state.PredictedNextBlockId =
                null;
            state.PredictedNextBlockName =
                null;

            if (!_enabled ||
                !_ready ||
                !state.CurrentBlockId.HasValue)
                continue;

            var direction =
                LocoDirection(
                    state.LocoAddress);

            RouteEntry? route =
                null;

            if (_committedRoutes.TryGetValue(
                    state.LocoAddress,
                    out var committed) &&
                committed.FromBlockId ==
                    state.CurrentBlockId &&
                string.Equals(
                    committed.LocoDirection,
                    direction,
                    StringComparison.OrdinalIgnoreCase))
                route =
                    committed;
            else
            {
                var routes =
                    DirectRoutesFromBlock(
                        state.CurrentBlockId.Value,
                        direction);

                if (routes.Select(item =>
                        item.ToBlockId)
                        .Distinct()
                        .Count() ==
                    1)
                    route =
                        routes.FirstOrDefault();
            }

            if (route is null)
                continue;

            state.PredictedNextBlockId =
                route.ToBlockId;
            state.PredictedNextBlockName =
                route.ToBlockName?.Length >
                    0
                    ? route.ToBlockName
                    : BlockName(
                        route.ToBlockId);
        }
    }

    TrainTrackingLocoState Copy(
        TrackingState state) =>
        new(
            state.LocoAddress,
            state.LocoId,
            state.CurrentBlockId,
            state.CurrentBlockName,
            state.CurrentSensors.ToArray(),
            state.CurrentSectionParts.ToArray(),
            state.PredictedNextBlockId,
            state.PredictedNextBlockName,
            state.LastSensor,
            state.RecentSensorPath.ToArray(),
            state.Confidence,
            state.UpdatedAt);

    public TrainTrackingSnapshot Snapshot()
    {
        lock (_gate)
        {
            SyncPredictions();

            return new(
                _enabled,
                _enabled &&
                    _ready,
                _ready,
                _readinessIssues
                    .ToArray(),
                _readinessWarnings
                    .ToArray(),
                _tracking.Values
                    .OrderBy(state =>
                        state.LocoAddress)
                    .Select(
                        Copy)
                    .ToArray(),
                _logs
                    .ToArray());
        }
    }

    public void SetEnabled(
        bool enabled)
    {
        lock (_gate)
            _enabled =
                enabled;

        SaveEnabled();

        if (enabled)
        {
            RefreshTopology();
            SeedSensorsFromRuntime();
            SeedFromBlocks();
        }

        Publish();
    }

    public void Reset()
    {
        lock (_gate)
        {
            _tracking.Clear();
            _committedRoutes.Clear();
        }

        SeedFromBlocks();
        Publish();
    }

    public void ClearLogs()
    {
        lock (_gate)
            _logs.Clear();

        Publish();
    }

    void WriteLog(
        string level,
        string message)
    {
        _logs.Add(
            new(
                Guid.NewGuid()
                    .ToString("N"),
                NowMs(),
                level,
                message));

        while (_logs.Count >
               MaxLogs)
            _logs.RemoveAt(
                0);

        _log.LogInformation(
            "TrainTracking [{Level}] {Message}",
            level,
            message);
    }

    void Publish()
    {
        var snapshot =
            Snapshot();

        _authority.Update(
            snapshot.Locos);

        Changed?.Invoke(
            snapshot);
    }
}
