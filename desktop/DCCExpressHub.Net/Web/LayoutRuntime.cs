using System.Text.Json;

namespace DCCExpressHub.Net.Web;

public enum RuntimeAccessoryKind { Turnout, Signal, Accessory, VPin }

// IMPORTANT: RuntimeAccessory is topology/binding metadata only.
// Authoritative physical state lives in address-keyed maps in LayoutRuntime.
public sealed class RuntimeAccessory
{
    public ushort Id { get; set; }
    public RuntimeAccessoryKind Kind { get; set; }
    public ushort Address { get; set; }
    public byte Channel { get; set; }

    // Turnout binding metadata.
    public bool ClosedValue { get; set; }
    public bool TurnoutExtended { get; set; }
    public bool TurnoutVPin { get; set; }
    public bool TurnoutDccExId { get; set; }
    public int TurnoutClosedAspect { get; set; } = 0;
    public int TurnoutOpenedAspect { get; set; } = 1;

    // Signal binding metadata.
    public bool SignalExtended { get; set; } = true;
    public bool SignalVPin { get; set; }
    public byte SignalOutputCount { get; set; } = 1;
}

// Layout reference only. Sensor state is authoritative in _sensorStates and
// is learned from DCC-EX Q/q feedback, independently from layout membership.
public sealed class RuntimeSensor
{
    public ushort Id { get; set; }
    public ushort Address { get; set; }
}

public sealed class RuntimeBlock
{
    public const string TargetLocoPrefix = "__dcc_target_loco__:";

    public ushort Id { get; set; }
    public string Name { get; set; } = "";
    public ushort SensorAddress { get; set; }
    // RailCom uses SensorAddress; no separate address or runtime occupancy authority.
    public bool RailCom { get; set; }
    public string LocoId { get; set; } = "";
    public ushort LocoAddress { get; set; }

    public bool TargetOnly =>
        LocoAddress == 0 &&
        LocoId.StartsWith(TargetLocoPrefix, StringComparison.Ordinal);

    public ushort TargetLocoAddress
    {
        get
        {
            if (!TargetOnly)
                return 0;

            var raw =
                LocoId.AsSpan(
                    TargetLocoPrefix.Length);

            var separator =
                raw.IndexOf(':');

            if (separator >= 0)
                raw =
                    raw[..separator];

            return ushort.TryParse(
                    raw,
                    out var address) &&
                address is >= 1 and <= 10239
                    ? address
                    : (ushort)0;
        }
    }

    public bool Occupied =>
        LocoAddress > 0 ||
        (LocoId.Length > 0 && !TargetOnly);

    public bool HasRuntimeState => Occupied || TargetOnly;
}

public sealed record RuntimeSnapshotItem(string Type, object Data);

public sealed class LayoutRuntime
{
    readonly object _gate = new();
    readonly AppPaths _env;

    // Semantic/layout bindings. These never own authoritative physical state.
    List<RuntimeAccessory> _accessories = [];
    List<RuntimeSensor> _sensors = [];
    List<RuntimeBlock> _blocks = [];

    // Authoritative physical runtime state.
    // Sensors are NOT reconciled to the layout. They come from <Q> / Q/q.
    readonly Dictionary<ushort, bool> _sensorStates = new();
    // OFF must remain stable for 250 ms; ON is processed immediately.
    int _sensorOffDelayMs = 250;
    int _turnoutCommandIntervalMs = 150;
    int _turnoutSettlingTimeMs = 100;
    readonly string _sensorSettingsPath;
    public int SensorOffDelayMs { get { lock (_gate) return _sensorOffDelayMs; } }
    public int TurnoutCommandIntervalMs { get { lock (_gate) return _turnoutCommandIntervalMs; } }
    public int TurnoutSettlingTimeMs { get { lock (_gate) return _turnoutSettlingTimeMs; } }

    public bool SaveTimingSettings(int sensorOffMs, int turnoutIntervalMs, int turnoutSettlingMs)
    {
        if (sensorOffMs is < 100 or > 1000 ||
            turnoutIntervalMs is < 0 or > 5000 ||
            turnoutSettlingMs is < 0 or > 30000)
            return false;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_sensorSettingsPath)!);
            var json = JsonSerializer.Serialize(new {
                sensorOffDelayMs = sensorOffMs,
                turnoutCommandIntervalMs = turnoutIntervalMs,
                turnoutSettlingTimeMs = turnoutSettlingMs
            });
            var tmp = _sensorSettingsPath + ".tmp";
            File.WriteAllText(tmp, json);
            File.Move(tmp, _sensorSettingsPath, true);
            lock (_gate)
            {
                _sensorOffDelayMs = sensorOffMs;
                _turnoutCommandIntervalMs = turnoutIntervalMs;
                _turnoutSettlingTimeMs = turnoutSettlingMs;
            }
            return true;
        }
        catch { return false; }
    }

    public bool SaveSensorOffDelayMs(int milliseconds) =>
        SaveTimingSettings(milliseconds, TurnoutCommandIntervalMs, TurnoutSettlingTimeMs);
    readonly Dictionary<ushort, CancellationTokenSource> _pendingSensorOff = new();

    // Basic/extended endpoints ARE reconciled to the current layout topology.
    Dictionary<ushort, bool> _basicAccessoryStates = new();
    Dictionary<ushort, byte> _extendedAccessoryStates = new();

    // Kept for existing VPIN turnout/output support. VPIN is HAL state rather
    // than DCC accessory state, so it is intentionally outside Basic/Extended.
    Dictionary<ushort, bool> _vpinStates = new();

    // DCC-EX native <T id> is a separate namespace from DCC accessories.
    // Only received <H id state> / <jT id C|T> or successful local commands
    // populate this cache. Unknown state is represented by a missing key.
    Dictionary<ushort, bool> _dccExTurnoutStates = new();

    // Startup-only canvas hints from the previous session. These are NEVER
    // returned by TryGetTurnoutClosed or the authoritative physical snapshot.
    readonly Dictionary<(ushort Address, string Mode), bool>
        _restoredTurnoutDisplayStates = new();

    public event Action<string, object>? Changed;
    // Safety runs after normal consumers, including TrainTracking, process the sensor change.
    public event Action? SensorTransitionProcessed;

    public int AccessoryCount
    {
        get
        {
            lock (_gate)
                return _basicAccessoryStates.Count + _extendedAccessoryStates.Count;
        }
    }

    public int SensorCount
    {
        get
        {
            lock (_gate)
                return _sensorStates.Count;
        }
    }

    public int BlockCount
    {
        get
        {
            lock (_gate)
                return _blocks.Count;
        }
    }

    public LayoutRuntime(AppPaths env)
    {
        _env = env;
        _sensorSettingsPath = Path.Combine(env.ContentRootPath, "data", "state", "sensor-settings.json");
        try
        {
            if (File.Exists(_sensorSettingsPath))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(_sensorSettingsPath));
                if (doc.RootElement.TryGetProperty("sensorOffDelayMs", out var delay) &&
                    delay.TryGetInt32(out var ms) && ms is >= 100 and <= 1000)
                    _sensorOffDelayMs = ms;
                if (doc.RootElement.TryGetProperty("turnoutCommandIntervalMs", out var interval) &&
                    interval.TryGetInt32(out var intervalMs) && intervalMs is >= 0 and <= 5000)
                    _turnoutCommandIntervalMs = intervalMs;
                if (doc.RootElement.TryGetProperty("turnoutSettlingTimeMs", out var settling) &&
                    settling.TryGetInt32(out var settlingMs) && settlingMs is >= 0 and <= 30000)
                    _turnoutSettlingTimeMs = settlingMs;
            }
        }
        catch { /* Invalid settings must not prevent startup. */ }
        Rebuild();
    }

    static bool TurnoutType(string t) =>
        t is "trackturnout" or
            "trackturnoutleft" or
            "trackturnoutright" or
            "trackturnoutdouble" or
            "trackturnouttwoway" or
            "trackturnouttreeway";

    static bool SignalType(string t) =>
        t is "tracksignal" or
            "tracksignal2" or
            "tracklevelcrossing";

    static int I(JsonElement e, string n, int d = 0) =>
        e.TryGetProperty(n, out var x) && x.TryGetInt32(out var v) ? v : d;

    static bool B(JsonElement e, string n, bool d = false) =>
        e.TryGetProperty(n, out var x)
            ? x.ValueKind == JsonValueKind.True
                ? true
                : x.ValueKind == JsonValueKind.False
                    ? false
                    : d
            : d;

    static string S(JsonElement e, string n, string d = "") =>
        e.TryGetProperty(n, out var x) && x.ValueKind == JsonValueKind.String
            ? x.GetString() ?? d
            : d;

    static Dictionary<(int layer, int element), ushort> MigrateIds(JsonElement root, out int migrated)
    {
        migrated = 0;
        var reserved = new HashSet<ushort>();
        var seen = new HashSet<ushort>();
        var map = new Dictionary<(int, int), ushort>();

        if (!root.TryGetProperty("layers", out var layers) || layers.ValueKind != JsonValueKind.Array)
            return map;

        foreach (var layer in layers.EnumerateArray())
        {
            if (!layer.TryGetProperty("elements", out var es) || es.ValueKind != JsonValueKind.Array)
                continue;

            foreach (var e in es.EnumerateArray())
                if (ReadPersistedNumericId(e, out var id))
                    reserved.Add(id);
        }

        var used = new HashSet<ushort>(reserved);
        ushort next = 1;
        int li = 0;

        foreach (var layer in layers.EnumerateArray())
        {
            int ei = 0;

            if (layer.TryGetProperty("elements", out var es) && es.ValueKind == JsonValueKind.Array)
            {
                foreach (var e in es.EnumerateArray())
                {
                    bool numeric = ReadPersistedNumericId(e, out var persisted);
                    ushort runtime;

                    if (numeric && seen.Add(persisted))
                    {
                        runtime = persisted;
                    }
                    else
                    {
                        runtime = NextFree(used, next);
                        if (runtime == 0)
                        {
                            ei++;
                            continue;
                        }

                        used.Add(runtime);
                        next = runtime == ushort.MaxValue ? (ushort)1 : (ushort)(runtime + 1);
                        migrated++;
                    }

                    map[(li, ei)] = runtime;
                    ei++;
                }
            }

            li++;
        }

        return map;
    }

    static bool ReadPersistedNumericId(JsonElement e, out ushort id)
    {
        id = 0;

        if (!e.TryGetProperty("id", out var x) ||
            x.ValueKind != JsonValueKind.Number ||
            !x.TryGetInt32(out var v) ||
            v <= 0 ||
            v > 65535)
            return false;

        id = (ushort)v;
        return true;
    }

    static ushort NextFree(HashSet<ushort> used, ushort start)
    {
        uint c = start > 0 ? (uint)start : 1u;

        for (uint a = 0; a < 65535; a++)
        {
            if (c > 65535)
                c = 1;

            var id = (ushort)c;
            if (!used.Contains(id))
                return id;

            c++;
        }

        return 0;
    }

    static void AddRange(HashSet<ushort> target, int start, int length)
    {
        if (start <= 0 || start > 65535)
            return;

        int safeLength = Math.Clamp(length, 1, 16);

        for (int i = 0; i < safeLength; i++)
        {
            int address = start + i;
            if (address > 65535)
                break;

            target.Add((ushort)address);
        }
    }

    static Dictionary<ushort, T> Reconcile<T>(
        Dictionary<ushort, T> previous,
        IEnumerable<ushort> topology,
        T defaultValue)
    {
        var next = new Dictionary<ushort, T>();

        foreach (var address in topology.OrderBy(x => x))
        {
            next[address] = previous.TryGetValue(address, out var old)
                ? old
                : defaultValue;
        }

        return next;
    }

    public bool Rebuild()
    {
        var path = Path.Combine(_env.ContentRootPath, "data", "config", "layout.json");

        if (!File.Exists(path))
        {
            lock (_gate)
            {
                _accessories = [];
                _sensors = [];
                _blocks = [];
                _basicAccessoryStates.Clear();
                _extendedAccessoryStates.Clear();
                _vpinStates.Clear();
                _dccExTurnoutStates.Clear();
            }

            Console.WriteLine($"LayoutRuntime: no layout at {path}");
            return true;
        }

        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            var ids = MigrateIds(root, out var migrated);

            List<RuntimeAccessory> oldBindings;
            List<RuntimeBlock> oldBlocks;
            Dictionary<ushort, bool> oldBasic;
            Dictionary<ushort, byte> oldExtended;
            Dictionary<ushort, bool> oldVpins;
            Dictionary<ushort, bool> oldDccExTurnouts;

            lock (_gate)
            {
                oldBindings = _accessories;
                oldBlocks = _blocks;
                oldBasic = new(_basicAccessoryStates);
                oldExtended = new(_extendedAccessoryStates);
                oldVpins = new(_vpinStates);
                oldDccExTurnouts = new(_dccExTurnoutStates);
            }

            var bindings = new List<RuntimeAccessory>();
            var sensors = new List<RuntimeSensor>();
            var blocks = new List<RuntimeBlock>();
            var basicTopology = new HashSet<ushort>();
            var extendedTopology = new HashSet<ushort>();
            var vpinTopology = new HashSet<ushort>();
            var dccExTurnoutTopology = new HashSet<ushort>();

            if (root.TryGetProperty("layers", out var layers) && layers.ValueKind == JsonValueKind.Array)
            {
                int li = 0;

                foreach (var layer in layers.EnumerateArray())
                {
                    int ei = 0;

                    if (layer.TryGetProperty("elements", out var es) && es.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var e in es.EnumerateArray())
                        {
                            if (ids.TryGetValue((li, ei), out var id))
                            {
                                AddElement(
                                    e,
                                    id,
                                    bindings,
                                    sensors,
                                    blocks,
                                    basicTopology,
                                    extendedTopology,
                                    vpinTopology,
                                    dccExTurnoutTopology);
                            }

                            ei++;
                        }
                    }

                    li++;
                }
            }

            // Blocks are semantic runtime and keep state by stable layout ID.
            foreach (var block in blocks)
            {
                var old = oldBlocks.FirstOrDefault(x => x.Id == block.Id);
                if (old is null)
                    continue;

                block.LocoId = old.LocoId;
                block.LocoAddress = old.LocoAddress;
            }

            lock (_gate)
            {
                _accessories = bindings;
                _sensors = sensors;
                _blocks = blocks;

                // This is the key rule: layout topology owns DCC output existence.
                // Removed endpoints disappear. Protocol changes do not carry state
                // across Basic <-> Extended because they live in different maps.
                _basicAccessoryStates = Reconcile(oldBasic, basicTopology, false);
                _extendedAccessoryStates = Reconcile(oldExtended, extendedTopology, (byte)0);
                _vpinStates = Reconcile(oldVpins, vpinTopology, false);
                // Preserve only known native turnout states across a layout edit,
                // never synthesize an OFF state for a newly configured turnout.
                _dccExTurnoutStates = oldDccExTurnouts
                    .Where(pair => dccExTurnoutTopology.Contains(pair.Key))
                    .ToDictionary(pair => pair.Key, pair => pair.Value);
                _restoredTurnoutDisplayStates.Clear();
            }

            if (migrated > 0)
                Console.WriteLine($"LayoutRuntime: migrated {migrated} legacy/duplicate element ID(s) in RAM");

            Console.WriteLine(
                $"LayoutRuntime rebuilt: " +
                $"{_basicAccessoryStates.Count} basic, " +
                $"{_extendedAccessoryStates.Count} extended, " +
                $"{_sensorStates.Count} sensor state(s), " +
                $"{bindings.Count} binding(s), " +
                $"{blocks.Count} block(s)");

            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine("LayoutRuntime parse failed: " + ex.Message);
            return false;
        }
    }

    static void AddElement(
        JsonElement e,
        ushort id,
        List<RuntimeAccessory> bindings,
        List<RuntimeSensor> sensors,
        List<RuntimeBlock> blocks,
        HashSet<ushort> basicTopology,
        HashSet<ushort> extendedTopology,
        HashSet<ushort> vpinTopology,
        HashSet<ushort> dccExTurnoutTopology)
    {
        var type = S(e, "type");
        int elementAddress = I(e, "address");
        bool addressIsSensor = false;

        if (type is "trackstraight" or "trackbridge" or "trackdirection" or "trackend" or
            "trackcorner" or "trackcurve" or "trackcrossing" or
            "tracklevelcrossing" or "tracksensor" || TurnoutType(type))
        {
            // Occupancy address is independent of turnout motor addresses.
            // Bridge tracks and unpowered/manual turnouts can have detectors too.
            addressIsSensor = true;
        }
        else if (SignalType(type))
        {
            addressIsSensor = false;
        }

        if (addressIsSensor && elementAddress is > 0 and <= 65535)
            sensors.Add(new RuntimeSensor { Id = id, Address = (ushort)elementAddress });

        if (type == "trackblock")
        {
            var sensorAddress =
                I(
                    e,
                    "sensorAddress");

            blocks.Add(
                new RuntimeBlock
                {
                    Id = id,
                    Name =
                        S(
                            e,
                            "text",
                            "Block #" + id),
                    SensorAddress =
                        sensorAddress is >= 1 and <= 65535
                            ? (ushort)sensorAddress
                            : (ushort)0,
                    RailCom = B(e, "railCom")
                });

            return;
        }

        if (TurnoutType(type))
        {
            string mode = S(e, "outputMode", "accessory");
            bool extended = mode == "extended";
            bool vpin = mode == "vpin";
            bool dccexId = mode == "dccex-turnout";
            bool dual = type is "trackturnoutdouble" or "trackturnouttreeway";

            void AddTurnout(
                int address,
                byte channel,
                bool closedValue,
                int closedAspect,
                int openedAspect)
            {
                if (address is <= 0 or > 65535 ||
                    (dccexId && address > 32767))
                    return;

                var a = (ushort)address;

                bindings.Add(new RuntimeAccessory
                {
                    Id = id,
                    Kind = RuntimeAccessoryKind.Turnout,
                    Address = a,
                    Channel = channel,
                    ClosedValue = closedValue,
                    TurnoutExtended = extended,
                    TurnoutVPin = vpin,
                    TurnoutDccExId = dccexId,
                    TurnoutClosedAspect = Math.Clamp(closedAspect, 0, 255),
                    TurnoutOpenedAspect = Math.Clamp(openedAspect, 0, 255)
                });

                if (extended)
                    extendedTopology.Add(a);
                else if (vpin)
                    vpinTopology.Add(a);
                else if (dccexId)
                    dccExTurnoutTopology.Add(a);
                else
                    basicTopology.Add(a);
            }

            if (dual)
            {
                AddTurnout(
                    I(e, "turnout1Address"),
                    0,
                    B(e, "turnout1ClosedValue"),
                    I(e, "turnout1ClosedAspect", 0),
                    I(e, "turnout1OpenedAspect", 1));

                AddTurnout(
                    I(e, "turnout2Address"),
                    1,
                    B(e, "turnout2ClosedValue"),
                    I(e, "turnout2ClosedAspect", 0),
                    I(e, "turnout2OpenedAspect", 1));
            }
            else
            {
                int address = I(e, "turnoutAddress");
                if (address == 0)
                    address = I(e, "address");

                AddTurnout(
                    address,
                    0,
                    B(e, "turnoutClosedValue"),
                    I(e, "turnoutClosedAspect", 0),
                    I(e, "turnoutOpenedAspect", 1));
            }

            return;
        }

        if (SignalType(type))
        {
            JsonElement so = default;
            bool has = e.TryGetProperty("signalOutput", out so) && so.ValueKind == JsonValueKind.Object;
            bool crossing = type == "tracklevelcrossing";

            int address = has ? I(so, "address") : 0;
            if (address == 0 && crossing)
                address = I(e, "basicAccessoryAddress");
            if (address == 0 && !crossing)
                address = I(e, "address");
            if (address is <= 0 or > 65535)
                return;

            string protocol = has
                ? S(so, "protocol", crossing ? "dcc" : "dccext")
                : crossing ? "dcc" : "dccext";

            int outputCount = has
                ? I(so, "outputCount", 1)
                : Math.Clamp(I(e, "addressLength", 1), 1, 16);

            bool extended = protocol == "dccext";
            bool signalVPin = protocol == "vpin";

            bindings.Add(new RuntimeAccessory
            {
                Id = id,
                Kind = RuntimeAccessoryKind.Signal,
                Address = (ushort)address,
                SignalExtended = extended,
                SignalVPin = signalVPin,
                SignalOutputCount = (byte)Math.Clamp(outputCount, 1, 16)
            });

            if (extended)
                extendedTopology.Add((ushort)address);
            else if (signalVPin)
                AddRange(vpinTopology, address, outputCount);
            else
                AddRange(basicTopology, address, outputCount);

            return;
        }

        if (type == "button")
        {
            int address = I(e, "address");
            if (address is <= 0 or > 65535)
                return;

            string mode = S(e, "outputMode", "accessory");

            if (mode == "extended")
            {
                extendedTopology.Add((ushort)address);
                bindings.Add(new RuntimeAccessory
                {
                    Id = id,
                    Kind = RuntimeAccessoryKind.Signal,
                    Address = (ushort)address,
                    SignalExtended = true,
                    SignalOutputCount = 1
                });
            }
            else
            {
                basicTopology.Add((ushort)address);
                bindings.Add(new RuntimeAccessory
                {
                    Id = id,
                    Kind = RuntimeAccessoryKind.Accessory,
                    Address = (ushort)address
                });
            }
        }
    }

    public RuntimeAccessory? FindAccessoryById(RuntimeAccessoryKind kind, ushort id, byte channel = 0)
    {
        lock (_gate)
            return _accessories.FirstOrDefault(x => x.Kind == kind && x.Id == id && x.Channel == channel);
    }

    public RuntimeAccessory? FindAccessory(RuntimeAccessoryKind kind, ushort address)
    {
        lock (_gate)
            return _accessories.FirstOrDefault(x => x.Kind == kind && x.Address == address);
    }

    public RuntimeSensor? FindSensorById(ushort id)
    {
        lock (_gate)
            return _sensors.FirstOrDefault(x => x.Id == id);
    }

    public RuntimeSensor? FindSensor(ushort address)
    {
        lock (_gate)
            return _sensors.FirstOrDefault(x => x.Address == address);
    }

    public bool TryGetSensorState(ushort address, out bool on)
    {
        lock (_gate)
            return _sensorStates.TryGetValue(address, out on);
    }

    public bool TryGetBasicAccessoryState(ushort address, out bool active)
    {
        lock (_gate)
            return _basicAccessoryStates.TryGetValue(address, out active);
    }

    public bool TryGetExtendedAccessoryState(ushort address, out byte aspect)
    {
        lock (_gate)
            return _extendedAccessoryStates.TryGetValue(address, out aspect);
    }

    public bool TryGetVPinState(ushort address, out bool active)
    {
        lock (_gate)
            return _vpinStates.TryGetValue(address, out active);
    }

    public bool TryGetTurnoutClosed(ushort address, out bool closed)
    {
        lock (_gate)
        {
            var turnout = _accessories.FirstOrDefault(x =>
                x.Kind == RuntimeAccessoryKind.Turnout && x.Address == address);
            if (turnout is null)
            {
                closed = false;
                return false;
            }
            return TryGetTurnoutClosedForBinding(turnout, out closed);
        }
    }

    // Each protocol has its own state namespace. UI events must resolve the
    // requested binding (not the first same-numbered accessory on the layout).
    bool TryGetTurnoutClosedForBinding(RuntimeAccessory turnout, out bool closed)
    {
        lock (_gate)
        {
            var address = turnout.Address;
            if (turnout.TurnoutExtended)
            {
                if (!_extendedAccessoryStates.TryGetValue(address, out var aspect))
                {
                    closed = false;
                    return false;
                }
                if (aspect == turnout.TurnoutClosedAspect)
                {
                    closed = true;
                    return true;
                }
                if (aspect == turnout.TurnoutOpenedAspect)
                {
                    closed = false;
                    return true;
                }
                closed = false;
                return false;
            }

            bool physical;
            bool known = turnout.TurnoutDccExId
                ? _dccExTurnoutStates.TryGetValue(address, out physical)
                : turnout.TurnoutVPin
                    ? _vpinStates.TryGetValue(address, out physical)
                    : _basicAccessoryStates.TryGetValue(address, out physical);
            if (!known)
            {
                closed = false;
                return false;
            }

            closed = physical == turnout.ClosedValue;
            return true;
        }
    }

    public bool TryGetSignalValue(ushort address, out int value, ushort signalId = 0)
    {
        lock (_gate)
        {
            var signal = _accessories.FirstOrDefault(x =>
                x.Kind == RuntimeAccessoryKind.Signal &&
                x.Address == address &&
                (signalId == 0 || x.Id == signalId));

            if (signal is null)
            {
                value = 0;
                return false;
            }

            if (signal.SignalExtended)
            {
                if (_extendedAccessoryStates.TryGetValue(address, out var aspect))
                {
                    value = aspect;
                    return true;
                }

                value = 0;
                return false;
            }

            int bits = 0;

            for (int i = 0; i < signal.SignalOutputCount; i++)
            {
                var outputAddress = (ushort)(signal.Address + i);

                var states = signal.SignalVPin ? _vpinStates : _basicAccessoryStates;
                if (!states.TryGetValue(outputAddress, out var active))
                {
                    value = 0;
                    return false;
                }

                if (active)
                    bits |= 1 << i;
            }

            value = bits;
            return true;
        }
    }

    // Display hints only. Save all accessory outputs, but restore a visual
    // position exclusively for bindings that are CURRENTLY turnouts.
    // No command station output and no physical runtime state is altered.
    public void RestoreTurnoutDisplayStates(
        IReadOnlyDictionary<ushort, bool> savedBasic,
        IReadOnlyDictionary<ushort, byte> savedExtended)
    {
        lock (_gate)
        {
            _restoredTurnoutDisplayStates.Clear();

            foreach (var turnout in _accessories.Where(
                item => item.Kind == RuntimeAccessoryKind.Turnout))
            {
                if (turnout.TurnoutVPin || turnout.TurnoutDccExId)
                    continue; // Neither HAL VPIN nor native <T> is a DCC accessory.

                if (turnout.TurnoutExtended)
                {
                    if (!savedExtended.TryGetValue(turnout.Address, out var aspect))
                        continue;

                    bool logicalClosed;
                    if (aspect == turnout.TurnoutClosedAspect)
                        logicalClosed = true;
                    else if (aspect == turnout.TurnoutOpenedAspect)
                        logicalClosed = false;
                    else
                        continue;

                    var physicalValue = logicalClosed
                        ? turnout.ClosedValue : !turnout.ClosedValue;
                    _restoredTurnoutDisplayStates[(turnout.Address, "extended")] =
                        physicalValue;
                }
                else if (savedBasic.TryGetValue(turnout.Address, out var physical))
                {
                    _restoredTurnoutDisplayStates[(turnout.Address, "accessory")] =
                        physical;
                }
            }
        }
    }

    // RuntimeStateStore must preserve saved turnout drawings even if the
    // operator restarts the backend without issuing any new turnout commands.
    // Snapshot these persisted hints ONLY for disk storage: the authoritative
    // basic/extended maps and physical queries remain unchanged.
    public (IReadOnlyDictionary<ushort, bool> Basic,
        IReadOnlyDictionary<ushort, byte> Extended) AccessorySaveSnapshot()
    {
        lock (_gate)
        {
            var basic = new Dictionary<ushort, bool>(_basicAccessoryStates);
            var extended = new Dictionary<ushort, byte>(_extendedAccessoryStates);

            foreach (var saved in _restoredTurnoutDisplayStates)
            {
                var (address, mode) = saved.Key;
                if (mode == "accessory")
                {
                    basic[address] = saved.Value;
                    continue;
                }

                if (mode != "extended")
                    continue;

                var turnout = _accessories.FirstOrDefault(item =>
                    item.Kind == RuntimeAccessoryKind.Turnout &&
                    item.TurnoutExtended && item.Address == address);
                if (turnout is null)
                    continue;

                bool logicalClosed = saved.Value == turnout.ClosedValue;
                var aspect = logicalClosed
                    ? turnout.TurnoutClosedAspect
                    : turnout.TurnoutOpenedAspect;
                extended[address] = (byte)aspect;
            }

            return (basic, extended);
        }
    }

    public IReadOnlyDictionary<ushort, bool> BasicAccessoryStatesForPersistence()
    {
        lock (_gate)
            return new Dictionary<ushort, bool>(_basicAccessoryStates);
    }

    public IReadOnlyDictionary<ushort, byte> ExtendedAccessoryStatesForPersistence()
    {
        lock (_gate)
            return new Dictionary<ushort, byte>(_extendedAccessoryStates);
    }

    public IReadOnlyDictionary<ushort, bool> VPinStatesForPersistence()
    {
        lock (_gate)
            return new Dictionary<ushort, bool>(_vpinStates);
    }

    public RuntimeBlock[] BlocksForPersistence()
    {
        lock (_gate)
            return _blocks.Select(x => new RuntimeBlock
            {
                Id = x.Id,
                Name = x.Name,
                SensorAddress = x.SensorAddress,
                RailCom = x.RailCom,
                LocoId = x.LocoId,
                LocoAddress = x.LocoAddress
            }).ToArray();
    }

    void EmitTurnoutDerivedEventsForAddress(ushort address)
    {
        RuntimeAccessory[] turnouts;

        lock (_gate)
        {
            turnouts = _accessories
                .Where(x => x.Kind == RuntimeAccessoryKind.Turnout && x.Address == address)
                .ToArray();
        }

        foreach (var turnout in turnouts)
        {
            bool logicalKnown = TryGetTurnoutClosedForBinding(turnout, out var logicalClosed);
            bool physicalValue = logicalKnown
                ? logicalClosed ? turnout.ClosedValue : !turnout.ClosedValue
                : false;

            byte? aspect = null;
            if (turnout.TurnoutExtended && TryGetExtendedAccessoryState(address, out var ext))
                aspect = ext;

            Changed?.Invoke("turnoutChanged", new
            {
                address,
                closed = physicalValue,
                logicalClosed = logicalKnown ? logicalClosed : (bool?)null,
                outputMode = turnout.TurnoutExtended
                    ? "extended"
                    : turnout.TurnoutVPin
                        ? "vpin"
                        : turnout.TurnoutDccExId
                            ? "dccex-turnout"
                            : "accessory",
                aspect,
                closedAspect = turnout.TurnoutClosedAspect,
                openedAspect = turnout.TurnoutOpenedAspect
            });
        }
    }

    public bool SetTurnout(ushort address, bool physicalValue)
    {
        RuntimeAccessory? turnout;

        lock (_gate)
        {
            turnout = _accessories.FirstOrDefault(x =>
                x.Kind == RuntimeAccessoryKind.Turnout &&
                x.Address == address);
        }

        if (turnout is null)
        {
            Console.WriteLine($"LayoutRuntime: turnout address {address} not found");
            return false;
        }

        if (turnout.TurnoutExtended)
        {
            // Extended turnout physical state is represented by its aspect, not
            // a second bool state. The caller should use SetSignal/SetExtended.
            EmitTurnoutDerivedEventsForAddress(address);
            return true;
        }

        if (turnout.TurnoutVPin)
            return SetVPin(address, physicalValue);
        if (turnout.TurnoutDccExId)
            return SetDccExTurnoutState(address, physicalValue);

        return SetAccessory(address, physicalValue);
    }

    // A native <T> confirmation or <jT>/<H> feedback must never touch the
    // legacy DCC accessory map, even when both use the same numeric address.
    public bool SetDccExTurnoutState(ushort id, bool thrown)
    {
        bool changed;
        lock (_gate)
        {
            if (!_accessories.Any(x => x.Kind == RuntimeAccessoryKind.Turnout &&
                x.TurnoutDccExId && x.Address == id))
                return false;
            changed = !_dccExTurnoutStates.TryGetValue(id, out var previous) || previous != thrown;
            _dccExTurnoutStates[id] = thrown;
        }
        if (changed)
            EmitTurnoutDerivedEventsForAddress(id);
        return true;
    }

    public ushort[] DccExTurnoutIds()
    {
        lock (_gate)
            return _accessories
                .Where(x => x.Kind == RuntimeAccessoryKind.Turnout && x.TurnoutDccExId)
                .Select(x => x.Address).Distinct().OrderBy(x => x).ToArray();
    }

    public void InvalidateDccExTurnoutStates()
    {
        ushort[] ids;
        lock (_gate)
        {
            ids = _dccExTurnoutStates.Keys.ToArray();
            _dccExTurnoutStates.Clear();
        }
        foreach (var id in ids)
            EmitTurnoutDerivedEventsForAddress(id);
    }

    public bool SetSignal(ushort address, int aspect)
    {
        if (aspect is < 0 or > 255)
            return false;

        bool changed;

        lock (_gate)
        {
            if (!_extendedAccessoryStates.ContainsKey(address))
                return false;

            changed = _extendedAccessoryStates[address] != (byte)aspect;
            _extendedAccessoryStates[address] = (byte)aspect;
            _restoredTurnoutDisplayStates.Remove((address, "extended"));
        }

        if (changed)
            Changed?.Invoke("signalAspectChanged", new { address, aspect });

        EmitTurnoutDerivedEventsForAddress(address);
        return true;
    }

    public bool SetAccessory(ushort address, bool active)
    {
        bool changed;

        lock (_gate)
        {
            if (!_basicAccessoryStates.ContainsKey(address))
                return false;

            changed = _basicAccessoryStates[address] != active;
            _basicAccessoryStates[address] = active;
            _restoredTurnoutDisplayStates.Remove((address, "accessory"));
        }

        if (changed)
            Changed?.Invoke("accessoryChanged", new { address, active });

        EmitTurnoutDerivedEventsForAddress(address);
        return true;
    }

    public bool SetVPin(ushort address, bool active)
    {
        bool changed;

        lock (_gate)
        {
            if (!_vpinStates.ContainsKey(address))
                return false;

            changed = _vpinStates[address] != active;
            _vpinStates[address] = active;
        }

        if (changed)
            Changed?.Invoke("vpinChanged", new { vpin = address, active });

        EmitTurnoutDerivedEventsForAddress(address);
        return true;
    }

    // A reconnect does not prove that a previously ON input is still ON,
    // nor that it is now OFF. Drop its *known* status until new hardware
    // feedback arrives. Dispatcher must continue to treat unknown as unsafe.
    public void InvalidateSensorStates()
    {
        bool hadKnown;
        lock (_gate)
        {
            foreach (var pending in _pendingSensorOff.Values)
                pending.Cancel();
            _pendingSensorOff.Clear();
            hadKnown = _sensorStates.Count > 0;
            _sensorStates.Clear();
        }

        if (hadKnown)
        {
            Changed?.Invoke("sensorSnapshot", SensorSnapshot());
            SensorTransitionProcessed?.Invoke();
        }
    }

    // Invalidate only sensors owned by one external device. Never emit OFF
    // transitions for a lost connection: the dispatcher must see UNKNOWN.
    public void InvalidateSensorRange(int firstAddress, int count)
    {
        bool changed = false;
        lock (_gate)
        {
            for (int address = firstAddress; address < firstAddress + count; address++)
            {
                if (address is < 1 or > 65535)
                    continue;
                var key = (ushort)address;
                if (_pendingSensorOff.Remove(key, out var pending))
                    pending.Cancel();
                changed |= _sensorStates.Remove(key);
            }
        }
        if (changed)
        {
            Changed?.Invoke("sensorSnapshot", SensorSnapshot());
            SensorTransitionProcessed?.Invoke();
        }
    }

    public bool SetSensor(ushort address, bool on)
    {
        bool changed = false;
        CancellationTokenSource? pendingOff = null;

        lock (_gate)
        {
            // Repeated OFF reports (including R-BUS snapshots) must not restart
            // the delay indefinitely. Only ON cancels a pending OFF.
            if (!on && _pendingSensorOff.ContainsKey(address))
                return true;

            if (_pendingSensorOff.Remove(address, out var previous))
                previous.Cancel();

            if (!on && _sensorStates.TryGetValue(address, out var wasOn) && wasOn)
            {
                // A brief loss of current must not release a block or fire LEAVE.
                pendingOff = new CancellationTokenSource();
                _pendingSensorOff[address] = pendingOff;
            }
            else
            {
                // The first known OFF sample remains OFF; do not manufacture
                // an occupied state for sensors which have never reported ON.
                changed = !_sensorStates.TryGetValue(address, out var old) || old != on;
                _sensorStates[address] = on;
            }
        }

        if (pendingOff is not null)
            _ = ConfirmSensorOffAsync(address, pendingOff);

        if (changed)
        {
            Changed?.Invoke("sensorChanged", new { address, on });
            SensorTransitionProcessed?.Invoke();
        }

        return true;
    }

    async Task ConfirmSensorOffAsync(ushort address, CancellationTokenSource pending)
    {
        try
        {
            await Task.Delay(SensorOffDelayMs, pending.Token);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        bool changed = false;
        lock (_gate)
        {
            if (_pendingSensorOff.TryGetValue(address, out var current) &&
                ReferenceEquals(current, pending) &&
                !pending.IsCancellationRequested)
            {
                _pendingSensorOff.Remove(address);
                changed = _sensorStates.TryGetValue(address, out var previous) && previous;
                _sensorStates[address] = false;
            }
        }

        if (changed)
        {
            Changed?.Invoke("sensorChanged", new { address, on = false });
            SensorTransitionProcessed?.Invoke();
        }
    }

    public bool SetBlock(ushort id, string locoId, ushort locoAddress)
    {
        bool changed = false;

        lock (_gate)
        {
            var target = _blocks.FirstOrDefault(x => x.Id == id);
            if (target is null)
                return false;

            bool clearing = string.IsNullOrEmpty(locoId) && locoAddress == 0;

            if (!clearing)
            {
                foreach (var block in _blocks)
                {
                    if (block.Id == id || !block.Occupied)
                        continue;

                    bool sameAddress = locoAddress > 0 && block.LocoAddress == locoAddress;
                    bool sameId = !string.IsNullOrEmpty(locoId) && block.LocoId == locoId;

                    if (!sameAddress && !sameId)
                        continue;

                    block.LocoId = "";
                    block.LocoAddress = 0;
                    changed = true;
                }
            }

            if (clearing)
            {
                if (target.HasRuntimeState)
                {
                    target.LocoId = "";
                    target.LocoAddress = 0;
                    changed = true;
                }
            }
            else if (target.LocoId != locoId || target.LocoAddress != locoAddress)
            {
                target.LocoId = locoId;
                target.LocoAddress = locoAddress;
                changed = true;
            }
        }

        if (changed)
            Changed?.Invoke("blockStateChanged", BlockSnapshot());

        return true;
    }

    // Acquire the target marker atomically with the block-state check.
    // A different movement may have occupied or reserved the block since
    // Dispatcher initially validated it.
    public bool TryReserveTargetBlock(ushort id, string marker)
    {
        if (string.IsNullOrWhiteSpace(marker) ||
            !marker.StartsWith(RuntimeBlock.TargetLocoPrefix, StringComparison.Ordinal))
            return false;

        lock (_gate)
        {
            var block = _blocks.FirstOrDefault(x => x.Id == id);
            if (block is null || block.HasRuntimeState)
                return false;

            block.LocoId = marker;
            block.LocoAddress = 0;
        }

        Changed?.Invoke("blockStateChanged", BlockSnapshot());
        return true;
    }

    public bool RemoveBlock(ushort id, string locoId = "", ushort expectedLocoAddress = 0)
    {
        lock (_gate)
        {
            var block = _blocks.FirstOrDefault(x => x.Id == id);
            if (block is null)
                return false;

            if (!block.HasRuntimeState)
                return true;

            if (locoId.Length > 0 && block.LocoId != locoId)
                return false;

            // Never remove a newly acquired target marker or another locomotive
            // when the previous train's delayed LEAVE finally completes.
            if (expectedLocoAddress > 0 && block.LocoAddress != expectedLocoAddress)
                return false;

            block.LocoId = "";
            block.LocoAddress = 0;
        }

        Changed?.Invoke("blockStateChanged", BlockSnapshot());
        return true;
    }

    public bool ClearBlocks()
    {
        bool changed = false;

        lock (_gate)
        {
            foreach (var block in _blocks)
            {
                if (!block.HasRuntimeState)
                    continue;

                block.LocoId = "";
                block.LocoAddress = 0;
                changed = true;
            }
        }

        if (changed)
            Changed?.Invoke("blockStateChanged", BlockSnapshot());

        return true;
    }

    public object BlockSnapshot()
    {
        lock (_gate)
        {
            var snapshot =
                new Dictionary<string, object>();

            foreach (var block in _blocks)
            {
                var state =
                    new Dictionary<string, object?>
                    {
                        ["blockId"] =
                            block.Id.ToString(),

                        ["locoId"] =
                            string.IsNullOrEmpty(
                                block.LocoId)
                                ? null
                                : block.LocoId
                    };

                if (block.LocoAddress > 0)
                {
                    state["locoAddress"] =
                        block.LocoAddress;
                }

                snapshot[
                    block.Id.ToString()] =
                    state;
            }

            return snapshot;
        }
    }

    public object SensorSnapshot()
    {
        lock (_gate)
        {
            var groups = _sensorStates
                .GroupBy(x => (x.Key / 16) * 16)
                .OrderBy(g => g.Key)
                .Select(g =>
                {
                    int active = 0;
                    int known = 0;

                    foreach (var state in g)
                    {
                        int bit = state.Key - g.Key;
                        if (bit is < 0 or >= 16)
                            continue;

                        known |= 1 << bit;
                        if (state.Value)
                            active |= 1 << bit;
                    }

                    return new[] { g.Key, active, known };
                })
                .ToArray();

            return new { groups };
        }
    }

    public IReadOnlyList<RuntimeSnapshotItem> RuntimeSnapshot()
    {
        lock (_gate)
        {
            var items = new List<RuntimeSnapshotItem>();

            items.Add(new(
                "runtimePhysicalSnapshot",
                new
                {
                    basicAccessories = _basicAccessoryStates
                        .OrderBy(x => x.Key)
                        .Select(x => new
                        {
                            address = x.Key,
                            active = x.Value
                        })
                        .ToArray(),

                    extendedAccessories = _extendedAccessoryStates
                        .OrderBy(x => x.Key)
                        .Select(x => new
                        {
                            address = x.Key,
                            aspect = x.Value
                        })
                        .ToArray()
                }));

            // Physical incremental state follows the authoritative replacement
            // snapshot for backward-compatible live consumers.
            foreach (var state in _basicAccessoryStates.OrderBy(x => x.Key))
                items.Add(new("accessoryChanged", new { address = state.Key, active = state.Value }));

            foreach (var state in _extendedAccessoryStates.OrderBy(x => x.Key))
                items.Add(new("signalAspectChanged", new { address = state.Key, aspect = state.Value }));

            foreach (var state in _vpinStates.OrderBy(x => x.Key))
                items.Add(new("vpinChanged", new { vpin = state.Key, active = state.Value }));

            foreach (var state in _sensorStates.OrderBy(x => x.Key))
                items.Add(new("sensorChanged", new { address = state.Key, on = state.Value }));

            // Semantic turnout rows are derived from topology + physical state.
            foreach (var turnout in _accessories.Where(x => x.Kind == RuntimeAccessoryKind.Turnout))
            {
                bool logicalKnown = TryGetTurnoutClosedForBinding(turnout, out var logicalClosed);
                bool physicalValue = logicalKnown
                    ? logicalClosed ? turnout.ClosedValue : !turnout.ClosedValue
                    : false;

                byte? aspect = null;
                if (turnout.TurnoutExtended && _extendedAccessoryStates.TryGetValue(turnout.Address, out var ext))
                    aspect = ext;

                items.Add(new("turnoutChanged", new
                {
                    address = turnout.Address,
                    closed = physicalValue,
                    logicalClosed = logicalKnown ? logicalClosed : (bool?)null,
                    outputMode = turnout.TurnoutExtended
                        ? "extended"
                        : turnout.TurnoutVPin
                            ? "vpin"
                            : turnout.TurnoutDccExId
                                ? "dccex-turnout"
                                : "accessory",
                    aspect,
                    closedAspect = turnout.TurnoutClosedAspect,
                    openedAspect = turnout.TurnoutOpenedAspect
                }));
            }

            // Sent after physical state rows so the canvas shows the previous
            // turnout drawing until fresh state or a live command supersedes it.
            // This distinct event is NOT physical turnout feedback.
            foreach (var saved in _restoredTurnoutDisplayStates.OrderBy(
                state => state.Key.Address))
                items.Add(new("turnoutDisplayRestored", new
                {
                    address = saved.Key.Address,
                    closed = saved.Value,
                    outputMode = saved.Key.Mode
                }));

            items.Add(new("sensorSnapshot", SensorSnapshot()));
            items.Add(new("blockStateChanged", BlockSnapshot()));

            return items;
        }
    }
}
