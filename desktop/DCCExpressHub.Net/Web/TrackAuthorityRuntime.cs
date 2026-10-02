namespace DCCExpressHub.Net.Web;

public sealed record TrackAuthorityCheck(
    bool Ok,
    ushort? BlockingSensor,
    int? BlockingLocoAddress,
    string? Reason);

/// <summary>
/// Backend-authoritative ownership view used by Movement/Dispatcher safety.
///
/// Physical sensor state still comes from LayoutRuntime. TrainTracking only
/// supplies ownership: which tracked locomotive currently owns an ON sensor
/// or physical SectionPart.
///
/// Safety semantics:
///   OFF                    => free
///   ON + owned only by me  => safe (my own footprint)
///   ON + another loco      => unsafe
///   ON + no tracked owner  => unsafe / unknown
///   sensor state unknown   => unsafe / unknown
/// </summary>
public sealed class TrackAuthorityRuntime
{
    readonly object _gate = new();
    readonly LayoutRuntime _layout;

    Dictionary<ushort, HashSet<int>> _sensorOwners = [];
    Dictionary<string, HashSet<int>> _sectionPartOwners =
        new(StringComparer.Ordinal);

    public TrackAuthorityRuntime(
        LayoutRuntime layout)
    {
        _layout = layout;
    }

    public void Update(
        IEnumerable<TrainTrackingLocoState> locos)
    {
        var sensorOwners =
            new Dictionary<ushort, HashSet<int>>();

        var sectionOwners =
            new Dictionary<string, HashSet<int>>(
                StringComparer.Ordinal);

        foreach (var loco in locos ?? [])
        {
            if (loco.LocoAddress <= 0)
                continue;

            foreach (var rawSensor in
                     loco.CurrentSensors ?? [])
            {
                if (rawSensor is < 1 or > 65535)
                    continue;

                var sensor =
                    (ushort)rawSensor;

                if (!sensorOwners.TryGetValue(
                        sensor,
                        out var owners))
                {
                    owners = [];
                    sensorOwners[
                        sensor] =
                        owners;
                }

                owners.Add(
                    loco.LocoAddress);
            }

            foreach (var rawPart in
                     loco.CurrentSectionParts ?? [])
            {
                var part =
                    (rawPart ?? "")
                        .Trim();

                if (part.Length == 0)
                    continue;

                if (!sectionOwners.TryGetValue(
                        part,
                        out var owners))
                {
                    owners = [];
                    sectionOwners[
                        part] =
                        owners;
                }

                owners.Add(
                    loco.LocoAddress);
            }
        }

        lock (_gate)
        {
            _sensorOwners =
                sensorOwners;
            _sectionPartOwners =
                sectionOwners;
        }
    }

    public TrackAuthorityCheck CheckSensorsForLoco(
        int locoAddress,
        IEnumerable<ushort> sensors)
    {
        foreach (var sensor in
                 (sensors ?? [])
                     .Where(value =>
                         value > 0)
                     .Distinct()
                     .OrderBy(value =>
                         value))
        {
            if (!_layout.TryGetSensorState(
                    sensor,
                    out var on))
                return new(
                    false,
                    sensor,
                    null,
                    "sensor_unknown");

            if (!on)
                continue;

            int[] owners;

            lock (_gate)
                owners =
                    _sensorOwners.TryGetValue(
                        sensor,
                        out var current)
                        ? current
                            .OrderBy(address =>
                                address)
                            .ToArray()
                        : [];

            if (owners.Length == 1 &&
                owners[0] ==
                    locoAddress)
                continue;

            var blockingLoco =
                owners
                    .FirstOrDefault(address =>
                        address !=
                        locoAddress);

            return new(
                false,
                sensor,
                blockingLoco > 0
                    ? blockingLoco
                    : null,
                owners.Length == 0
                    ? "occupied_unknown"
                    : owners.Any(address =>
                        address !=
                        locoAddress)
                        ? "occupied_by_other"
                        : "occupied_ambiguous");
        }

        return new(
            true,
            null,
            null,
            null);
    }

    public int[] SensorOwners(
        ushort sensor)
    {
        lock (_gate)
            return _sensorOwners.TryGetValue(
                    sensor,
                    out var owners)
                ? owners
                    .OrderBy(address =>
                        address)
                    .ToArray()
                : [];
    }

    public int[] SectionPartOwners(
        string partKey)
    {
        var key =
            (partKey ?? "")
                .Trim();

        if (key.Length == 0)
            return [];

        lock (_gate)
            return _sectionPartOwners.TryGetValue(
                    key,
                    out var owners)
                ? owners
                    .OrderBy(address =>
                        address)
                    .ToArray()
                : [];
    }
}
