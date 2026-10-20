using System.Text.Json;
using System.Text.Json.Nodes;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed class LocoCounterRuntime : IDisposable
{
    public sealed record SnapshotItem(
        int Address,
        double TotalKm,
        double DailyKm,
        double TotalHours,
        double DailyHours,
        int Speed,
        bool Moving);

    private sealed class Entry
    {
        public required int Address { get; init; }
        public double TotalKm { get; set; }
        public double TotalHours { get; set; }
        public double DailyKm { get; set; }
        public double DailyHours { get; set; }
        public int MaxSpeedStep { get; set; } = 100;
        public double MaxScaleSpeedKmh { get; set; } = 120;
        public int Speed { get; set; }
        public long LastUpdateTicks { get; set; } = Environment.TickCount64;
    }

    private readonly object _gate = new();
    private readonly SemaphoreSlim _saveGate = new(1, 1);
    private readonly string _locosPath;
    private readonly string _statePath;
    private readonly Dictionary<int, Entry> _entries = new();
    private readonly Timer _timer;
    private bool _trackPowerOn;

    public event Action? Changed;

    public LocoCounterRuntime(AppPaths env)
    {
        _locosPath = Path.Combine(
            env.ContentRootPath,
            "data",
            "config",
            "locos.json");

        _statePath = Path.Combine(
            env.ContentRootPath,
            "data",
            "state",
            "loco-counters.json");

        _timer = new Timer(
            _ => Tick(),
            null,
            TimeSpan.FromMilliseconds(500),
            TimeSpan.FromMilliseconds(500));
    }

    private static double NonNegative(JsonNode? node, double fallback = 0)
    {
        if (node is null) return fallback;

        try
        {
            var value = node.GetValue<double>();
            return double.IsFinite(value) && value >= 0 ? value : fallback;
        }
        catch
        {
            return fallback;
        }
    }

    private void Integrate(Entry entry, long nowTicks)
    {
        var elapsedMs = Math.Max(0, nowTicks - entry.LastUpdateTicks);
        entry.LastUpdateTicks = nowTicks;

        if (!_trackPowerOn || entry.Speed <= 0 || elapsedMs <= 0)
            return;

        var elapsedHours = elapsedMs / 3_600_000.0;
        var speedRatio = Math.Clamp(
            entry.Speed / (double)Math.Max(1, entry.MaxSpeedStep),
            0,
            1);

        var distanceKm =
            entry.MaxScaleSpeedKmh *
            speedRatio *
            elapsedHours;

        entry.TotalHours += elapsedHours;
        entry.DailyHours += elapsedHours;
        entry.TotalKm += distanceKm;
        entry.DailyKm += distanceKm;
    }

    private void IntegrateAll(long nowTicks)
    {
        foreach (var entry in _entries.Values)
            Integrate(entry, nowTicks);
    }

    private void Tick()
    {
        bool changed;

        lock (_gate)
        {
            var now = Environment.TickCount64;
            changed =
                _trackPowerOn &&
                _entries.Values.Any(x => x.Speed > 0);

            if (changed)
                IntegrateAll(now);
            else
                foreach (var entry in _entries.Values)
                    entry.LastUpdateTicks = now;
        }

        if (changed)
            Changed?.Invoke();
    }

    public bool ReloadConfiguration(bool preserveRuntimeTotals = true)
    {
        if (!File.Exists(_locosPath))
            return false;

        JsonArray? locos;

        try
        {
            locos = JsonNode.Parse(
                File.ReadAllText(_locosPath)) as JsonArray;
        }
        catch
        {
            return false;
        }

        if (locos is null)
            return false;

        var persistedTotals =
            new Dictionary<int, (double Km, double Hours)>();

        if (File.Exists(_statePath))
        {
            try
            {
                var state =
                    JsonNode.Parse(
                        File.ReadAllText(_statePath)) as JsonObject;

                if (state?["items"] is JsonArray items)
                {
                    foreach (var node in items)
                    {
                        if (node is not JsonObject item)
                            continue;

                        var address =
                            item["address"]?.GetValue<int>() ?? 0;

                        if (address <= 0)
                            continue;

                        persistedTotals[address] =
                            (
                                NonNegative(item["totalKm"]),
                                NonNegative(item["totalHours"])
                            );
                    }
                }
            }
            catch
            {
                // Keep legacy locos.json totals as the fallback seed if the
                // dedicated counter state is missing or corrupt.
            }
        }

        lock (_gate)
        {
            var now = Environment.TickCount64;
            var activeAddresses = new HashSet<int>();

            foreach (var node in locos)
            {
                if (node is not JsonObject loco)
                    continue;

                var address =
                    loco["address"]?.GetValue<int>() ?? 0;

                if (address <= 0)
                    continue;

                activeAddresses.Add(address);

                if (!_entries.TryGetValue(address, out var entry))
                {
                    var legacyKm =
                        NonNegative(loco["odometerKm"]);

                    var legacyHours =
                        NonNegative(loco["operatingHours"]);

                    var persisted =
                        persistedTotals.TryGetValue(
                            address,
                            out var stored)
                                ? stored
                                : (legacyKm, legacyHours);

                    entry = new Entry
                    {
                        Address = address,
                        TotalKm = persisted.Item1,
                        TotalHours = persisted.Item2,
                        LastUpdateTicks = now
                    };

                    _entries[address] = entry;
                }
                else if (!preserveRuntimeTotals)
                {
                    var legacyKm =
                        NonNegative(loco["odometerKm"]);

                    var legacyHours =
                        NonNegative(loco["operatingHours"]);

                    var persisted =
                        persistedTotals.TryGetValue(
                            address,
                            out var stored)
                                ? stored
                                : (legacyKm, legacyHours);

                    entry.TotalKm = persisted.Item1;
                    entry.TotalHours = persisted.Item2;
                    entry.DailyKm = 0;
                    entry.DailyHours = 0;
                }

                entry.MaxSpeedStep = Math.Clamp(
                    loco["maxSpeed"]?.GetValue<int>() ?? 100,
                    1,
                    1000);

                var counterSettings =
                    loco["counterSettings"] as JsonObject;

                entry.MaxScaleSpeedKmh = Math.Clamp(
                    NonNegative(
                        counterSettings?["maxScaleSpeedKmh"],
                        120),
                    1,
                    400);

                entry.LastUpdateTicks = now;
            }

            foreach (var address in _entries.Keys.ToArray())
            {
                if (!activeAddresses.Contains(address) &&
                    _entries[address].Speed <= 0)
                    _entries.Remove(address);
            }
        }

        Changed?.Invoke();
        return true;
    }

    public void SetTrackPower(bool on)
    {
        bool changed;

        lock (_gate)
        {
            var now = Environment.TickCount64;
            IntegrateAll(now);

            changed = _trackPowerOn != on;
            _trackPowerOn = on;

            foreach (var entry in _entries.Values)
                entry.LastUpdateTicks = now;
        }

        if (changed)
            Changed?.Invoke();
    }

    public void UpdateLoco(LocoFeedback feedback)
    {
        bool changed = false;

        lock (_gate)
        {
            if (!_entries.TryGetValue(feedback.Address, out var entry))
                return;

            var now = Environment.TickCount64;
            Integrate(entry, now);

            if (entry.Speed != feedback.Speed)
            {
                entry.Speed = Math.Max(0, feedback.Speed);
                changed = true;
            }
        }

        if (changed)
            Changed?.Invoke();
    }

    public object Snapshot()
    {
        lock (_gate)
        {
            var items = _entries.Values
                .OrderBy(x => x.Address)
                .Select(x => new SnapshotItem(
                    x.Address,
                    x.TotalKm,
                    x.DailyKm,
                    x.TotalHours,
                    x.DailyHours,
                    x.Speed,
                    _trackPowerOn && x.Speed > 0))
                .ToArray();

            return new { items };
        }
    }

    public async Task<bool> SaveAsync()
    {
        await _saveGate.WaitAsync();

        try
        {
            Dictionary<int, (double Km, double Hours)> totals;

            lock (_gate)
            {
                IntegrateAll(Environment.TickCount64);

                totals = _entries.Values.ToDictionary(
                    x => x.Address,
                    x => (x.TotalKm, x.TotalHours));
            }

            var root =
                new JsonObject
                {
                    ["version"] = 1
                };

            var items =
                new JsonArray();

            foreach (var pair in totals.OrderBy(x => x.Key))
            {
                items.Add(
                    new JsonObject
                    {
                        ["address"] = pair.Key,
                        ["totalKm"] = pair.Value.Km,
                        ["totalHours"] = pair.Value.Hours
                    });
            }

            root["items"] = items;

            var directory =
                Path.GetDirectoryName(_statePath)!;

            Directory.CreateDirectory(directory);

            var tempPath =
                _statePath + ".tmp";

            await File.WriteAllTextAsync(
                tempPath,
                root.ToJsonString(
                    new JsonSerializerOptions
                    {
                        WriteIndented = true
                    }));

            File.Move(
                tempPath,
                _statePath,
                true);

            return true;
        }
        catch
        {
            return false;
        }
        finally
        {
            _saveGate.Release();
        }
    }

    public void Dispose()
    {
        _timer.Dispose();
        _saveGate.Dispose();
    }
}
