using System.Text.Json;

namespace DCCExpressHub.Net.Web;

public sealed class RuntimeStateStore
{
    readonly LayoutRuntime _runtime;
    readonly string _path;
    readonly ILogger<RuntimeStateStore> _log;
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public RuntimeStateStore(LayoutRuntime runtime, IWebHostEnvironment env, ILogger<RuntimeStateStore> log)
    {
        _runtime = runtime;
        _log = log;
        _path = Path.Combine(env.ContentRootPath, "data", "state", "runtime-state.json");
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
    }

    public async Task<bool> LoadAsync()
    {
        if (!File.Exists(_path))
        {
            _log.LogInformation("No saved runtime state; defaults remain active");
            return true;
        }

        try
        {
            using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(_path));
            var root = doc.RootElement;

            // v3 physical runtime format.
            if (root.TryGetProperty("basicAccessories", out var basic) && basic.ValueKind == JsonValueKind.Object)
            {
                foreach (var pair in basic.EnumerateObject())
                {
                    if (!ushort.TryParse(pair.Name, out var address))
                        continue;

                    bool active = pair.Value.ValueKind == JsonValueKind.True ||
                                  (pair.Value.ValueKind == JsonValueKind.Number && pair.Value.TryGetInt32(out var n) && n != 0);

                    _runtime.SetAccessory(address, active);
                }
            }

            if (root.TryGetProperty("extendedAccessories", out var extended) && extended.ValueKind == JsonValueKind.Object)
            {
                foreach (var pair in extended.EnumerateObject())
                {
                    if (!ushort.TryParse(pair.Name, out var address))
                        continue;

                    if (!pair.Value.TryGetInt32(out var aspect) || aspect is < 0 or > 255)
                        continue;

                    _runtime.SetSignal(address, aspect);
                }
            }

            if (root.TryGetProperty("vpins", out var vpins) && vpins.ValueKind == JsonValueKind.Object)
            {
                foreach (var pair in vpins.EnumerateObject())
                {
                    if (!ushort.TryParse(pair.Name, out var address))
                        continue;

                    bool active = pair.Value.ValueKind == JsonValueKind.True ||
                                  (pair.Value.ValueKind == JsonValueKind.Number && pair.Value.TryGetInt32(out var n) && n != 0);

                    _runtime.SetVPin(address, active);
                }
            }

            // Read-only migration support for the old semantic v2 format.
            // Only values that map cleanly to current physical topology survive.
            if (root.TryGetProperty("accessories", out var legacyAccessories) && legacyAccessories.ValueKind == JsonValueKind.Object)
            {
                foreach (var pair in legacyAccessories.EnumerateObject())
                {
                    var key = pair.Name;
                    var value = pair.Value;

                    if (key.StartsWith("accessory:", StringComparison.Ordinal) &&
                        ushort.TryParse(key[10..], out var basicAddress))
                    {
                        _runtime.SetAccessory(
                            basicAddress,
                            value.TryGetProperty("active", out var active) && active.ValueKind == JsonValueKind.True);
                    }
                    else if (key.StartsWith("signal:", StringComparison.Ordinal) &&
                             ushort.TryParse(key[7..], out var extendedAddress) &&
                             value.TryGetProperty("aspect", out var a) &&
                             a.ValueKind == JsonValueKind.Number &&
                             a.TryGetInt32(out var aspect) &&
                             aspect is >= 0 and <= 255)
                    {
                        // This succeeds only if the CURRENT layout says the address
                        // is Extended. A former basic signal cannot leak into it.
                        _runtime.SetSignal(extendedAddress, aspect);
                    }
                    else if (key.StartsWith("vpin:", StringComparison.Ordinal) &&
                             ushort.TryParse(key[5..], out var vp))
                    {
                        _runtime.SetVPin(
                            vp,
                            value.TryGetProperty("active", out var active) && active.ValueKind == JsonValueKind.True);
                    }
                    else if (key.StartsWith("turnout:", StringComparison.Ordinal) &&
                             ushort.TryParse(key[8..], out var turnoutAddress) &&
                             value.TryGetProperty("closed", out var c) &&
                             c.ValueKind is JsonValueKind.True or JsonValueKind.False)
                    {
                        var turnout = _runtime.FindAccessory(RuntimeAccessoryKind.Turnout, turnoutAddress);
                        if (turnout is null || turnout.TurnoutExtended)
                            continue;

                        bool logicalClosed = c.GetBoolean();
                        bool physical = logicalClosed ? turnout.ClosedValue : !turnout.ClosedValue;
                        _runtime.SetTurnout(turnoutAddress, physical);
                    }
                }
            }

            // Sensor state is intentionally NOT restored. DCC-EX <Q> is the
            // authoritative source and startup/reconnect requests it.

            if (root.TryGetProperty("blocks", out var blocks) && blocks.ValueKind == JsonValueKind.Object)
            {
                foreach (var pair in blocks.EnumerateObject())
                {
                    if (!ushort.TryParse(pair.Name, out var blockId) || blockId == 0)
                        continue;

                    var value = pair.Value;
                    string locoId = value.TryGetProperty("locoId", out var li) && li.ValueKind == JsonValueKind.String
                        ? li.GetString() ?? ""
                        : "";

                    ushort locoAddress = 0;
                    if (value.TryGetProperty("locoAddress", out var la) &&
                        la.TryGetInt32(out var n) &&
                        n is > 0 and <= 10239)
                    {
                        locoAddress = (ushort)n;
                    }

                    _runtime.SetBlock(blockId, locoId, locoAddress);
                }
            }

            _log.LogInformation("Physical runtime state restored");
            return true;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Runtime state parse failed");
            return false;
        }
    }

    public async Task<bool> SaveAsync()
    {
        try
        {
            var basic = _runtime.BasicAccessoryStatesForPersistence()
                .ToDictionary(x => x.Key.ToString(), x => x.Value);

            var extended = _runtime.ExtendedAccessoryStatesForPersistence()
                .ToDictionary(x => x.Key.ToString(), x => x.Value);

            var vpins = _runtime.VPinStatesForPersistence()
                .ToDictionary(x => x.Key.ToString(), x => x.Value);

            var blocks = new Dictionary<string, object>();
            foreach (var block in _runtime.BlocksForPersistence())
            {
                if (string.IsNullOrEmpty(block.LocoId) && block.LocoAddress == 0)
                    continue;

                blocks[block.Id.ToString()] = new
                {
                    locoId = string.IsNullOrEmpty(block.LocoId) ? null : block.LocoId,
                    locoAddress = block.LocoAddress > 0 ? (ushort?)block.LocoAddress : null
                };
            }

            var body = JsonSerializer.Serialize(new
            {
                version = 3,
                savedAtMs = Environment.TickCount64,
                basicAccessories = basic,
                extendedAccessories = extended,
                vpins,
                blocks
            }, Json);

            var tmp = _path + ".tmp";
            await File.WriteAllTextAsync(tmp, body);
            File.Move(tmp, _path, true);

            _log.LogInformation("Physical runtime state saved on POWER OFF");
            return true;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Runtime state atomic save failed");
            return false;
        }
    }
}
