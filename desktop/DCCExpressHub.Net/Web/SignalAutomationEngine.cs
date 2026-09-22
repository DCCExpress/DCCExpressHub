using System.Text.Json;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed class SignalAutomationEngine
{
    enum Source { Turnout, Sensor }

    sealed class Condition
    {
        public Source Source;
        public ushort Address;
        public bool Value;
    }

    sealed class Rule
    {
        public int Value;
        public List<Condition> Conditions = [];
    }

    sealed class SignalRuleSet
    {
        public ushort Id;
        public ushort Address;
        public bool Extended = true;
        public byte Outputs = 1;
        public int DefaultValue;
        public List<Rule> Rules = [];
        public bool HasAppliedValue;
        public int AppliedValue;
    }

    readonly ICommandCenter _cc;
    readonly LayoutRuntime _runtime;
    readonly IWebHostEnvironment _env;
    readonly SemaphoreSlim _evalGate = new(1, 1);

    List<SignalRuleSet> _signals = [];
    volatile bool _enabled;

    string PathName =>
        Path.Combine(
            _env.ContentRootPath,
            "data",
            "config",
            "signal-logic.ndjson");

    public bool Enabled => _enabled;
    public int SignalCount => _signals.Count;

    public SignalAutomationEngine(
        ICommandCenter cc,
        LayoutRuntime runtime,
        IWebHostEnvironment env)
    {
        _cc = cc;
        _runtime = runtime;
        _env = env;

        _runtime.Changed += RuntimeChanged;

        Reload();
        _ = EvaluateAsync();
    }

    void RuntimeChanged(string type, object _)
    {
        if (type is
            "turnoutChanged" or
            "sensorChanged" or
            "accessoryChanged" or
            "signalAspectChanged")
        {
            _ = EvaluateAsync();
        }
    }

    static bool Fits(
        bool extended,
        byte outputs,
        int value)
    {
        if (extended)
            return value is >= 0 and <= 255;

        if (value < 0 || value > 65535)
            return false;

        uint mask =
            outputs >= 16
                ? 0xffffu
                : (1u << outputs) - 1u;

        return (uint)value <= mask;
    }

    public bool Validate(string text) =>
        Parse(text, out _, out _);

    public bool Reload()
    {
        if (!File.Exists(PathName))
        {
            _enabled = false;
            _signals = [];
            return true;
        }

        try
        {
            if (!Parse(
                File.ReadAllText(PathName),
                out var enabled,
                out var signals))
            {
                return false;
            }

            _enabled = enabled;
            _signals = signals;

            Console.WriteLine(
                $"SignalAutomation: loaded {_signals.Count} signal(s), enabled={_enabled}");

            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine(
                $"SignalAutomation reload failed: {ex.Message}");

            return false;
        }
    }

    bool Parse(
        string text,
        out bool enabled,
        out List<SignalRuleSet> signals)
    {
        enabled = false;
        signals = [];

        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();

            if (line.Length == 0)
                continue;

            JsonDocument doc;

            try
            {
                doc = JsonDocument.Parse(line);
            }
            catch
            {
                continue;
            }

            using (doc)
            {
                var o = doc.RootElement;

                if (o.ValueKind != JsonValueKind.Object)
                    continue;

                var kind =
                    o.TryGetProperty("kind", out var k) &&
                    k.ValueKind == JsonValueKind.String
                        ? k.GetString()
                        : "";

                if (kind == "meta")
                {
                    enabled =
                        o.TryGetProperty("enabled", out var e) &&
                        e.ValueKind == JsonValueKind.True;

                    continue;
                }

                if (kind != "signal" ||
                    !ParseSignal(o, out var sig))
                {
                    continue;
                }

                // Current compiled rows have a stable layout ID. Keep different
                // semantic signals separate even if they happen to share a DCC
                // address. Legacy rows without an ID still de-duplicate by address.
                var ix = sig.Id > 0
                    ? signals.FindIndex(x => x.Id == sig.Id)
                    : signals.FindIndex(x => x.Id == 0 && x.Address == sig.Address);

                if (ix >= 0)
                    signals[ix] = sig;
                else
                    signals.Add(sig);
            }
        }

        return true;
    }

    bool ParseSignal(
        JsonElement row,
        out SignalRuleSet signal)
    {
        signal = new();

        int persistedAddress =
            GetInt(row, "address");

        if (persistedAddress is <= 0 or > 65535)
            return false;

        int persistedId =
            GetInt(row, "id");

        RuntimeAccessory? target = null;

        // New format: bind the automation to the exact layout element.
        // This is essential for level crossings because TrackElement.address
        // is the occupancy sensor address while signalOutput.address is the
        // physical signal/accessory output.
        if (persistedId is > 0 and <= 65535)
        {
            target =
                _runtime.FindAccessoryById(
                    RuntimeAccessoryKind.Signal,
                    (ushort)persistedId);
        }

        // Legacy compiled rows did not contain an ID.
        target ??=
            _runtime.FindAccessory(
                RuntimeAccessoryKind.Signal,
                (ushort)persistedAddress);

        if (target is null)
        {
            Console.WriteLine(
                $"SignalAutomation: target not found id={persistedId} address={persistedAddress}");

            return false;
        }

        var mode =
            GetString(row, "mode");

        bool extended =
            mode == "extended";

        if (!extended &&
            mode != "basic")
        {
            return false;
        }

        if (extended != target.SignalExtended)
        {
            Console.WriteLine(
                $"SignalAutomation: target protocol mismatch id={target.Id} address={target.Address} rule={mode}");

            return false;
        }

        byte outputs =
            extended
                ? (byte)1
                : target.SignalOutputCount;

        int configuredOutputs =
            GetInt(
                row,
                "outputs",
                outputs);

        if (!extended &&
            configuredOutputs != outputs)
        {
            return false;
        }

        int def =
            GetInt(row, "default");

        if (!Fits(
            extended,
            outputs,
            def))
        {
            return false;
        }

        if (!row.TryGetProperty("rules", out var rules) ||
            rules.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        signal = new()
        {
            Id = target.Id,
            // Runtime topology is authoritative. Do not use TrackElement.address
            // or a stale persisted alias as the physical output address.
            Address = target.Address,
            Extended = extended,
            Outputs = outputs,
            DefaultValue = def
        };

        foreach (var rr in rules.EnumerateArray())
        {
            if (rr.ValueKind != JsonValueKind.Object)
                continue;

            int value =
                GetInt(rr, "value");

            if (!Fits(
                extended,
                outputs,
                value))
            {
                continue;
            }

            if (!rr.TryGetProperty("conditions", out var cs) ||
                cs.ValueKind != JsonValueKind.Array ||
                cs.GetArrayLength() == 0)
            {
                continue;
            }

            var rule =
                new Rule
                {
                    Value = value
                };

            bool valid = true;

            foreach (var c in cs.EnumerateArray())
            {
                if (c.ValueKind != JsonValueKind.Array)
                {
                    valid = false;
                    break;
                }

                var a =
                    c.EnumerateArray().ToArray();

                string source =
                    a.Length > 0 &&
                    a[0].ValueKind == JsonValueKind.String
                        ? a[0].GetString() ?? ""
                        : "";

                if (a.Length == 3)
                {
                    int addr =
                        AsInt(a[1]);

                    int valueBit =
                        AsInt(a[2]);

                    if (addr <= 0 ||
                        addr > 65535 ||
                        (valueBit != 0 &&
                         valueBit != 1))
                    {
                        valid = false;
                        break;
                    }

                    if (source == "turnout")
                    {
                        if (_runtime.FindAccessory(
                                RuntimeAccessoryKind.Turnout,
                                (ushort)addr) is null)
                        {
                            valid = false;
                            break;
                        }

                        rule.Conditions.Add(
                            new()
                            {
                                Source = Source.Turnout,
                                Address = (ushort)addr,
                                Value = valueBit != 0
                            });
                    }
                    else if (source == "sensor")
                    {
                        // Sensor = physical address + state. The source of that
                        // state is irrelevant to automation.
                        rule.Conditions.Add(
                            new()
                            {
                                Source = Source.Sensor,
                                Address = (ushort)addr,
                                Value = valueBit != 0
                            });
                    }
                    else
                    {
                        valid = false;
                        break;
                    }

                    continue;
                }

                if (a.Length == 4)
                {
                    int legacyId =
                        AsInt(a[1]);

                    int channel =
                        AsInt(a[2]);

                    int valueBit =
                        AsInt(a[3]);

                    if (legacyId <= 0 ||
                        legacyId > 65535 ||
                        channel < 0 ||
                        channel > 1 ||
                        (valueBit != 0 &&
                         valueBit != 1))
                    {
                        valid = false;
                        break;
                    }

                    if (source == "turnout")
                    {
                        var t =
                            _runtime.FindAccessoryById(
                                RuntimeAccessoryKind.Turnout,
                                (ushort)legacyId,
                                (byte)channel);

                        if (t is null)
                        {
                            valid = false;
                            break;
                        }

                        rule.Conditions.Add(
                            new()
                            {
                                Source = Source.Turnout,
                                Address = t.Address,
                                Value = valueBit != 0
                            });
                    }
                    else if (source == "sensor")
                    {
                        var s =
                            _runtime.FindSensorById(
                                (ushort)legacyId);

                        if (s is null)
                        {
                            valid = false;
                            break;
                        }

                        rule.Conditions.Add(
                            new()
                            {
                                Source = Source.Sensor,
                                Address = s.Address,
                                Value = valueBit != 0
                            });
                    }
                    else
                    {
                        valid = false;
                        break;
                    }

                    continue;
                }

                valid = false;
                break;
            }

            if (valid &&
                rule.Conditions.Count ==
                cs.GetArrayLength())
            {
                signal.Rules.Add(rule);
            }
        }

        return signal.Rules.Count > 0;
    }

    bool Matches(
        Condition c)
    {
        if (c.Source == Source.Sensor)
        {
            return
                _runtime.TryGetSensorState(
                    c.Address,
                    out var on) &&
                on == c.Value;
        }

        return
            _runtime.TryGetTurnoutClosed(
                c.Address,
                out var closed) &&
            closed == c.Value;
    }

    int Desired(
        SignalRuleSet s)
    {
        foreach (var r in s.Rules)
        {
            if (r.Conditions.All(Matches))
                return r.Value;
        }

        return s.DefaultValue;
    }

    public async Task EvaluateAsync()
    {
        if (!_enabled)
            return;

        await _evalGate.WaitAsync();

        try
        {
            if (!_enabled)
                return;

            foreach (var s in _signals)
            {
                await ApplyAsync(
                    s,
                    Desired(s));
            }
        }
        finally
        {
            _evalGate.Release();
        }
    }

    async Task ApplyAsync(
        SignalRuleSet s,
        int value)
    {
        RuntimeAccessory? target = null;

        if (s.Id > 0)
        {
            target =
                _runtime.FindAccessoryById(
                    RuntimeAccessoryKind.Signal,
                    s.Id);
        }

        target ??=
            _runtime.FindAccessory(
                RuntimeAccessoryKind.Signal,
                s.Address);

        if (target is null)
        {
            Console.WriteLine(
                $"SignalAutomation: target id={s.Id} address={s.Address} not found");

            return;
        }

        // Follow current topology if the same stable element was edited.
        s.Address = target.Address;

        bool runtimeAlreadyMatches =
            _runtime.TryGetSignalValue(
                s.Address,
                out var runtimeValue) &&
            runtimeValue == value;

        // Do not suppress a command merely because we sent the same value once.
        // A topology rebuild or external/manual command may have changed the
        // authoritative output since then.
        if (s.HasAppliedValue &&
            s.AppliedValue == value &&
            runtimeAlreadyMatches)
        {
            return;
        }

        if (s.Extended)
        {
            if (!await _cc.SetSignalAspectAsync(
                    s.Address,
                    value))
            {
                Console.WriteLine(
                    $"SignalAutomation: FAILED <A {s.Address} {value}>");

                return;
            }

            Console.WriteLine(
                $"SignalAutomation: TX <A {s.Address} {value}>");

            _runtime.SetSignal(
                s.Address,
                value);
        }
        else
        {
            for (byte i = 0;
                 i < s.Outputs;
                 i++)
            {
                bool active =
                    ((value >> i) & 1) != 0;

                var address =
                    (ushort)(s.Address + i);

                if (!await _cc.SetAccessoryAsync(
                        address,
                        active))
                {
                    Console.WriteLine(
                        $"SignalAutomation: FAILED <a {address} {(active ? 1 : 0)}>");

                    return;
                }

                _runtime.SetAccessory(
                    address,
                    active);
            }
        }

        s.AppliedValue = value;
        s.HasAppliedValue = true;
    }

    static int GetInt(
        JsonElement e,
        string n,
        int d = 0) =>
        e.TryGetProperty(n, out var x) &&
        x.TryGetInt32(out var v)
            ? v
            : d;

    static string GetString(
        JsonElement e,
        string n,
        string d = "") =>
        e.TryGetProperty(n, out var x) &&
        x.ValueKind == JsonValueKind.String
            ? x.GetString() ?? d
            : d;

    static int AsInt(
        JsonElement e) =>
        e.TryGetInt32(out var v)
            ? v
            : int.MinValue;
}
