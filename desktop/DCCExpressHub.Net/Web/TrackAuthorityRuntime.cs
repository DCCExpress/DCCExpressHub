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

    /*
     * Expected ownership bridges the few milliseconds between:
     *   protected-zone authority granted -> sensor becomes ON -> Tracking
     *   confirms the physical locomotive.
     *
     * Only Movement's CURRENT NEXT protected zone is armed, and only while
     * its sensors were observed FREE. It is not equivalent to reserving an
     * entire leg.
     */
    readonly Dictionary<string, (int LocoAddress, HashSet<ushort> Sensors)>
        _expected = new(StringComparer.Ordinal);

    /*
     * Once an expected FREE->ON transition is observed, keep that sensor
     * provisionally owned until either Tracking confirms an owner or the
     * sensor turns OFF. This prevents a second Movement from treating the
     * same physical occupancy as unknown during Tracking handover.
     */
    readonly Dictionary<ushort, int> _provisionalSensorOwners = [];

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

            foreach (var sensor in
                     sensorOwners.Keys)
                _provisionalSensorOwners.Remove(
                    sensor);
        }
    }

    public void ArmExpectedSensors(
        string ownerKey,
        int locoAddress,
        IEnumerable<ushort> sensors)
    {
        if (string.IsNullOrWhiteSpace(
                ownerKey) ||
            locoAddress <= 0)
            return;

        var armed =
            (sensors ?? [])
                .Where(sensor =>
                    sensor > 0 &&
                    _layout.TryGetSensorState(
                        sensor,
                        out var on) &&
                    !on)
                .Distinct()
                .ToHashSet();

        lock (_gate)
        {
            if (armed.Count == 0)
                _expected.Remove(
                    ownerKey);
            else
                _expected[
                    ownerKey] =
                    (
                        locoAddress,
                        armed
                    );
        }
    }

    public void ClearExpectedSensors(
        string ownerKey)
    {
        if (string.IsNullOrWhiteSpace(
                ownerKey))
            return;

        lock (_gate)
            _expected.Remove(
                ownerKey);
    }

    public void ObserveSensorState(
        int sensor,
        bool on)
    {
        if (sensor is < 1 or > 65535 ||
            on)
            return;

        lock (_gate)
            _provisionalSensorOwners.Remove(
                (ushort)sensor);
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
            int? provisionalOwner;
            int[] expectedOwners;

            lock (_gate)
            {
                owners =
                    _sensorOwners.TryGetValue(
                        sensor,
                        out var current)
                        ? current
                            .OrderBy(address =>
                                address)
                            .ToArray()
                        : [];

                provisionalOwner =
                    _provisionalSensorOwners.TryGetValue(
                        sensor,
                        out var provisional)
                        ? provisional
                        : null;

                expectedOwners =
                    _expected.Values
                        .Where(expected =>
                            expected.Sensors.Contains(
                                sensor))
                        .Select(expected =>
                            expected.LocoAddress)
                        .Distinct()
                        .OrderBy(address =>
                            address)
                        .ToArray();
            }

            /*
             * Tracking is authoritative whenever it knows an owner.
             * An expected/provisional claim can never hide another tracked
             * locomotive.
             */
            if (owners.Length > 0)
            {
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
                    owners.Any(address =>
                        address !=
                        locoAddress)
                        ? "occupied_by_other"
                        : "occupied_ambiguous");
            }

            if (provisionalOwner.HasValue)
            {
                if (provisionalOwner.Value ==
                    locoAddress)
                    continue;

                return new(
                    false,
                    sensor,
                    provisionalOwner.Value,
                    "occupied_by_other_provisional");
            }

            /*
             * The sensor was FREE when exactly one Movement armed it as its
             * current next protected zone. Its later ON edge is therefore the
             * expected entry of that loco unless Tracking says otherwise.
             */
            if (expectedOwners.Length == 1 &&
                expectedOwners[0] ==
                    locoAddress)
            {
                lock (_gate)
                    _provisionalSensorOwners[
                        sensor] =
                        locoAddress;

                continue;
            }

            return new(
                false,
                sensor,
                expectedOwners
                    .FirstOrDefault(address =>
                        address !=
                        locoAddress) is var blocking &&
                    blocking > 0
                        ? blocking
                        : null,
                expectedOwners.Length > 1
                    ? "occupied_expected_ambiguous"
                    : "occupied_unknown");
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
