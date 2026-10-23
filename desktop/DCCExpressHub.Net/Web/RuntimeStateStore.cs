using System.Text.Json;

namespace DCCExpressHub.Net.Web;

public sealed class RuntimeStateStore
{
    readonly SemaphoreSlim _saveGate = new(1, 1);
    readonly LayoutRuntime _runtime;
    readonly string _path;
    readonly ILogger<RuntimeStateStore> _log;
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public RuntimeStateStore(LayoutRuntime runtime, AppPaths env, ILogger<RuntimeStateStore> log)
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

            // Save accessory outputs for continuity, but NEVER restore them
            // as authoritative physical feedback. Only turnout canvas hints
            // are recovered from the previous session.
            var basic = new Dictionary<ushort, bool>();
            if (root.TryGetProperty("basicAccessories", out var savedBasic) &&
                savedBasic.ValueKind == JsonValueKind.Object)
            {
                foreach (var pair in savedBasic.EnumerateObject())
                {
                    if (!ushort.TryParse(pair.Name, out var address) || address == 0)
                        continue;
                    if (pair.Value.ValueKind is JsonValueKind.True or JsonValueKind.False)
                        basic[address] = pair.Value.ValueKind == JsonValueKind.True;
                }
            }

            var extended = new Dictionary<ushort, byte>();
            if (root.TryGetProperty("extendedAccessories", out var savedExtended) &&
                savedExtended.ValueKind == JsonValueKind.Object)
            {
                foreach (var pair in savedExtended.EnumerateObject())
                {
                    if (!ushort.TryParse(pair.Name, out var address) || address == 0 ||
                        pair.Value.ValueKind != JsonValueKind.Number ||
                        !pair.Value.TryGetInt32(out var aspect) || aspect is < 0 or > 255)
                        continue;
                    extended[address] = (byte)aspect;
                }
            }

            _runtime.RestoreTurnoutDisplayStates(basic, extended);

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

                    if (key.StartsWith("vpin:", StringComparison.Ordinal) &&
                        ushort.TryParse(key[5..], out var vp))
                    {
                        _runtime.SetVPin(
                            vp,
                            value.TryGetProperty("active", out var active) && active.ValueKind == JsonValueKind.True);
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

                    // Target-only markers are temporary script reservations.
                    // Never resurrect one from an older runtime-state.json.
                    if (locoAddress == 0 &&
                        locoId.StartsWith(
                            RuntimeBlock.TargetLocoPrefix,
                            StringComparison.Ordinal))
                    {
                        continue;
                    }

                    _runtime.SetBlock(blockId, locoId, locoAddress);
                }
            }

            _log.LogInformation("Runtime state restored; accessory outputs used for turnout canvas hints only");
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
        await _saveGate.WaitAsync();
        try
        {
            return await SaveCoreAsync();
        }
        finally
        {
            _saveGate.Release();
        }
    }

    async Task<bool> SaveCoreAsync()
    {
        try
        {
            var basicAccessories = _runtime.BasicAccessoryStatesForPersistence()
                .ToDictionary(x => x.Key.ToString(), x => x.Value);
            var extendedAccessories = _runtime.ExtendedAccessoryStatesForPersistence()
                .ToDictionary(x => x.Key.ToString(), x => x.Value);
            var vpins = _runtime.VPinStatesForPersistence()
                .ToDictionary(x => x.Key.ToString(), x => x.Value);

            var blocks = new Dictionary<string, object>();
            foreach (var block in _runtime.BlocksForPersistence())
            {
                // Match ESP32 semantics: only real occupancy is persisted.
                // Target-only automation markers are ephemeral.
                if (!block.Occupied)
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
                basicAccessories,
                extendedAccessories,
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
