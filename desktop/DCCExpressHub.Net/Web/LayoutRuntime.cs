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
    public int TurnoutClosedAspect { get; set; } = 0;
    public int TurnoutOpenedAspect { get; set; } = 1;

    // Signal binding metadata.
    public bool SignalExtended { get; set; } = true;
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
    public string LocoId { get; set; } = "";
    public ushort LocoAddress { get; set; }

    public bool TargetOnly =>
        LocoAddress == 0 &&
        LocoId.StartsWith(TargetLocoPrefix, StringComparison.Ordinal);

    public bool Occupied =>
        LocoAddress > 0 ||
        (LocoId.Length > 0 && !TargetOnly);

    public bool HasRuntimeState => Occupied || TargetOnly;
}

public sealed record RuntimeSnapshotItem(string Type, object Data);

public sealed class LayoutRuntime
{
    readonly object _gate = new();
    readonly IWebHostEnvironment _env;

    // Semantic/layout bindings. These never own authoritative physical state.
    List<RuntimeAccessory> _accessories = [];
    List<RuntimeSensor> _sensors = [];
    List<RuntimeBlock> _blocks = [];

    // Authoritative physical runtime state.
    // Sensors are NOT reconciled to the layout. They come from <Q> / Q/q.
    readonly Dictionary<ushort, bool> _sensorStates = new();

    // Basic/extended endpoints ARE reconciled to the current layout topology.
    Dictionary<ushort, bool> _basicAccessoryStates = new();
    Dictionary<ushort, byte> _extendedAccessoryStates = new();

    // Kept for existing VPIN turnout/output support. VPIN is HAL state rather
    // than DCC accessory state, so it is intentionally outside Basic/Extended.
    Dictionary<ushort, bool> _vpinStates = new();

    public event Action<string, object>? Changed;

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

    public LayoutRuntime(IWebHostEnvironment env)
    {
        _env = env;
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
            "tracksignal3" or
            "tracksignal4" or
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

            lock (_gate)
            {
                oldBindings = _accessories;
                oldBlocks = _blocks;
                oldBasic = new(_basicAccessoryStates);
                oldExtended = new(_extendedAccessoryStates);
                oldVpins = new(_vpinStates);
            }

            var bindings = new List<RuntimeAccessory>();
            var sensors = new List<RuntimeSensor>();
            var blocks = new List<RuntimeBlock>();
            var basicTopology = new HashSet<ushort>();
            var extendedTopology = new HashSet<ushort>();
            var vpinTopology = new HashSet<ushort>();

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
                                    vpinTopology);
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
        HashSet<ushort> vpinTopology)
    {
        var type = S(e, "type");
        int elementAddress = I(e, "address");
        bool addressIsSensor = false;

        if (type is "trackstraight" or "trackdirection" or "trackend" or
            "trackcorner" or "trackcurve" or "trackcrossing" or
            "tracklevelcrossing" or "tracksensor")
        {
            addressIsSensor = true;
        }
        else if (TurnoutType(type))
        {
            bool dual = type is "trackturnoutdouble" or "trackturnouttreeway";
            addressIsSensor = dual
                ? I(e, "turnout1Address") > 0 || I(e, "turnout2Address") > 0
                : I(e, "turnoutAddress") > 0;
        }
        else if (SignalType(type))
        {
            addressIsSensor = false;
        }

        if (addressIsSensor && elementAddress is > 0 and <= 65535)
            sensors.Add(new RuntimeSensor { Id = id, Address = (ushort)elementAddress });

        if (type == "trackblock")
        {
            blocks.Add(new RuntimeBlock { Id = id });
            return;
        }

        if (TurnoutType(type))
        {
            string mode = S(e, "outputMode", "accessory");
            bool extended = mode == "extended";
            bool vpin = mode == "vpin";
            bool dual = type is "trackturnoutdouble" or "trackturnouttreeway";

            void AddTurnout(
                int address,
                byte channel,
                bool closedValue,
                int closedAspect,
                int openedAspect)
            {
                if (address is <= 0 or > 65535)
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
                    TurnoutClosedAspect = Math.Clamp(closedAspect, 0, 255),
                    TurnoutOpenedAspect = Math.Clamp(openedAspect, 0, 255)
                });

                if (extended)
                    extendedTopology.Add(a);
                else if (vpin)
                    vpinTopology.Add(a);
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

            bindings.Add(new RuntimeAccessory
            {
                Id = id,
                Kind = RuntimeAccessoryKind.Signal,
                Address = (ushort)address,
                SignalExtended = extended,
                SignalOutputCount = (byte)Math.Clamp(outputCount, 1, 16)
            });

            if (extended)
                extendedTopology.Add((ushort)address);
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
                x.Kind == RuntimeAccessoryKind.Turnout &&
                x.Address == address);

            if (turnout is null)
            {
                closed = false;
                return false;
            }

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
            if (turnout.TurnoutVPin)
            {
                if (!_vpinStates.TryGetValue(address, out physical))
                {
                    closed = false;
                    return false;
                }
            }
            else
            {
                if (!_basicAccessoryStates.TryGetValue(address, out physical))
                {
                    closed = false;
                    return false;
                }
            }

            closed = physical == turnout.ClosedValue;
            return true;
        }
    }

    public bool TryGetSignalValue(ushort address, out int value)
    {
        lock (_gate)
        {
            var signal = _accessories.FirstOrDefault(x =>
                x.Kind == RuntimeAccessoryKind.Signal &&
                x.Address == address);

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

                if (!_basicAccessoryStates.TryGetValue(outputAddress, out var active))
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
            bool logicalKnown = TryGetTurnoutClosed(address, out var logicalClosed);
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

        return SetAccessory(address, physicalValue);
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

    public bool SetSensor(ushort address, bool on)
    {
        bool changed;

        lock (_gate)
        {
            changed = !_sensorStates.TryGetValue(address, out var old) || old != on;
            _sensorStates[address] = on;
        }

        if (changed)
            Changed?.Invoke("sensorChanged", new { address, on });

        return true;
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

    public bool RemoveBlock(ushort id, string locoId = "")
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
            return _blocks.ToDictionary(
                x => x.Id.ToString(),
                x => (object)new
                {
                    locoId = x.LocoId,
                    locoAddress = x.LocoAddress
                });
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

            // Physical state first: Debug and client runtime consume exactly
            // the same authoritative maps.
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
                bool logicalKnown = TryGetTurnoutClosed(turnout.Address, out var logicalClosed);
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
                            : "accessory",
                    aspect,
                    closedAspect = turnout.TurnoutClosedAspect,
                    openedAspect = turnout.TurnoutOpenedAspect
                }));
            }

            items.Add(new("sensorSnapshot", SensorSnapshot()));
            items.Add(new("blockStateChanged", BlockSnapshot()));

            return items;
        }
    }
}
