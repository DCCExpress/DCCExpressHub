using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed record DispatcherTurnoutRequirement(
    ushort Address,
    bool Closed);

public sealed record DispatcherLegRequest(
    string OwnerId,
    string OwnerName,
    ushort LocoAddress,
    ushort FromBlockId,
    ushort ToBlockId,
    DispatcherTurnoutRequirement[] Turnouts,
    ushort[] SafetySensors,
    int TurnoutLockTimeoutMs = 0);

public sealed record DispatcherLegLeaseInfo(
    string OwnerId,
    string OwnerName,
    ushort LocoAddress,
    ushort FromBlockId,
    ushort ToBlockId,
    ushort[] TurnoutAddresses,
    ushort[] SafetySensors,
    string TargetMarker,
    long AcquiredAtMs);

public sealed record DispatcherAcquireResult(
    bool Ok,
    string? Error,
    DispatcherLegLeaseInfo? Lease,
    ushort? BlockingSensor = null,
    ushort? BlockingBlock = null,
    SwitchManLockInfo[]? TurnoutConflicts = null);

/// <summary>
/// Windows-backend authoritative reservation service for one block-to-block leg.
///
/// Important design rule:
/// a lease protects only the NEXT leg. It never reserves an entire Movement
/// route ahead of the train. This is what allows a train to wait in a station
/// without holding turnouts required by unrelated traffic.
///
/// Acquisition order:
///  1. validate current/source block ownership;
///  2. atomically reserve the destination block in this runtime;
///  3. fail closed on unknown/occupied safety sensors;
///  4. acquire the shared SwitchMan turnout locks;
///  5. re-check block + sensor safety to close the race window;
///  6. set required turnouts while those locks are held;
///  7. publish an owner-specific target-locomotive marker on the destination.
///
/// Any failure rolls back everything already acquired.
/// </summary>
public sealed class DispatcherRuntime
{
    readonly object _gate = new();
    readonly LayoutRuntime _runtime;
    readonly ICommandCenter _commandCenter;
    readonly SwitchManManager _switchMan;
    readonly ILogger<DispatcherRuntime> _log;

    readonly Dictionary<string, DispatcherLegLeaseInfo> _leases =
        new(StringComparer.Ordinal);

    readonly Dictionary<ushort, string> _destinationOwners = new();

    public event Action<DispatcherLegLeaseInfo[]?>? Changed;

    public DispatcherRuntime(
        LayoutRuntime runtime,
        ICommandCenter commandCenter,
        SwitchManManager switchMan,
        ILogger<DispatcherRuntime> log)
    {
        _runtime = runtime;
        _commandCenter = commandCenter;
        _switchMan = switchMan;
        _log = log;

        // A manual/administrative SwitchMan force-release must never leave a
        // Dispatcher lease alive without its physical turnout authority.
        _switchMan.Changed += _ => ReconcileTurnoutAuthority();
    }

    void ReconcileTurnoutAuthority()
    {
        DispatcherLegLeaseInfo[] invalid;

        lock (_gate)
        {
            invalid =
                _leases.Values
                    .Where(lease =>
                        lease.TurnoutAddresses.Any(
                            address =>
                                !_switchMan.IsOwnedBy(
                                    address,
                                    lease.OwnerId)))
                    .ToArray();
        }

        foreach (var lease in invalid)
        {
            _log.LogWarning(
                "Dispatcher lease {OwnerId} lost turnout authority; releasing leg {FromBlock}->{ToBlock}",
                lease.OwnerId,
                lease.FromBlockId,
                lease.ToBlockId);

            ReleaseLeg(
                lease.OwnerId);
        }
    }

    public DispatcherLegLeaseInfo[] Snapshot()
    {
        lock (_gate)
            return _leases.Values
                .OrderBy(x => x.AcquiredAtMs)
                .ToArray();
    }

    static ushort[] NormalizeSensors(IEnumerable<ushort>? sensors) =>
        (sensors ?? Array.Empty<ushort>())
            .Where(x => x > 0)
            .Distinct()
            .OrderBy(x => x)
            .ToArray();

    static DispatcherTurnoutRequirement[] NormalizeTurnouts(
        IEnumerable<DispatcherTurnoutRequirement>? turnouts)
    {
        var result =
            new Dictionary<ushort, bool>();

        foreach (var item in turnouts ?? Array.Empty<DispatcherTurnoutRequirement>())
        {
            if (item.Address is < 1 or > 2048)
                throw new ArgumentException("invalid_turnout_address");

            if (result.TryGetValue(item.Address, out var old) &&
                old != item.Closed)
                throw new ArgumentException("contradictory_turnout_requirement");

            result[item.Address] = item.Closed;
        }

        return result
            .OrderBy(x => x.Key)
            .Select(x => new DispatcherTurnoutRequirement(x.Key, x.Value))
            .ToArray();
    }

    RuntimeBlock? FindBlock(ushort blockId) =>
        _runtime.BlocksForPersistence()
            .FirstOrDefault(x => x.Id == blockId);

    string? ValidateSourceBlock(
        ushort fromBlockId,
        ushort locoAddress)
    {
        var source = FindBlock(fromBlockId);

        if (source is null)
            return "source_block_not_found";

        if (!source.Occupied)
            return "source_block_empty";

        if (source.LocoAddress == 0)
            return "source_loco_unknown";

        if (source.LocoAddress != locoAddress)
            return "source_loco_mismatch";

        return null;
    }

    string? ValidateDestinationBlock(
        ushort toBlockId)
    {
        var destination = FindBlock(toBlockId);

        if (destination is null)
            return "destination_block_not_found";

        if (destination.HasRuntimeState)
            return "destination_block_busy";

        return null;
    }

    (bool Ok, ushort? BlockingSensor) SensorsFree(
        IReadOnlyList<ushort> sensors)
    {
        foreach (var address in sensors)
        {
            // UNKNOWN is deliberately unsafe.
            if (!_runtime.TryGetSensorState(address, out var on) || on)
                return (false, address);
        }

        return (true, null);
    }

    bool TryReserveDestination(
        ushort blockId,
        string ownerId)
    {
        lock (_gate)
        {
            if (_destinationOwners.TryGetValue(blockId, out var existing) &&
                !string.Equals(existing, ownerId, StringComparison.Ordinal))
                return false;

            _destinationOwners[blockId] = ownerId;
            return true;
        }
    }

    void ReleaseDestinationReservation(
        ushort blockId,
        string ownerId)
    {
        lock (_gate)
        {
            if (_destinationOwners.TryGetValue(blockId, out var existing) &&
                string.Equals(existing, ownerId, StringComparison.Ordinal))
                _destinationOwners.Remove(blockId);
        }
    }

    static string CreateTargetMarker(
        ushort locoAddress,
        string ownerId) =>
        RuntimeBlock.TargetLocoPrefix +
        locoAddress +
        ":" +
        Uri.EscapeDataString(ownerId);

    async Task<bool> SetTurnoutAsync(
        DispatcherTurnoutRequirement requirement,
        string ownerId,
        CancellationToken ct)
    {
        var turnout =
            _runtime.FindAccessory(
                RuntimeAccessoryKind.Turnout,
                requirement.Address);

        if (turnout is null)
            return false;

        if (!_switchMan.IsOwnedBy(requirement.Address, ownerId))
            return false;

        if (_runtime.TryGetTurnoutClosed(requirement.Address, out var current) &&
            current == requirement.Closed)
            return true;

        var physicalValue =
            requirement.Closed
                ? turnout.ClosedValue
                : !turnout.ClosedValue;

        bool ok;

        if (turnout.TurnoutExtended)
        {
            var aspect =
                requirement.Closed
                    ? turnout.TurnoutClosedAspect
                    : turnout.TurnoutOpenedAspect;

            ok = await _commandCenter.SetSignalAspectAsync(
                requirement.Address,
                aspect,
                ct);

            if (ok)
                _runtime.SetSignal(
                    requirement.Address,
                    aspect);
        }
        else if (turnout.TurnoutVPin)
        {
            ok = await _commandCenter.SetVPinAsync(
                requirement.Address,
                physicalValue,
                ct);

            if (ok)
                _runtime.SetVPin(
                    requirement.Address,
                    physicalValue);
        }
        else
        {
            ok = await _commandCenter.SetTurnoutAsync(
                requirement.Address,
                physicalValue,
                ct);

            if (ok)
                _runtime.SetTurnout(
                    requirement.Address,
                    physicalValue);
        }

        return ok;
    }

    public async Task<DispatcherAcquireResult> AcquireLegAsync(
        DispatcherLegRequest request,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.OwnerId) ||
            request.OwnerId.Length > 240)
            return new(false, "invalid_owner", null);

        if (request.LocoAddress is < 1 or > 10239)
            return new(false, "invalid_loco_address", null);

        if (request.FromBlockId == 0 ||
            request.ToBlockId == 0 ||
            request.FromBlockId == request.ToBlockId)
            return new(false, "invalid_block_leg", null);

        lock (_gate)
        {
            if (_leases.ContainsKey(request.OwnerId))
                return new(false, "owner_already_has_leg", null);
        }

        DispatcherTurnoutRequirement[] turnouts;

        try
        {
            turnouts =
                NormalizeTurnouts(request.Turnouts);
        }
        catch (ArgumentException ex)
        {
            return new(false, ex.Message, null);
        }

        var sensors =
            NormalizeSensors(request.SafetySensors);

        var sourceError =
            ValidateSourceBlock(
                request.FromBlockId,
                request.LocoAddress);

        if (sourceError is not null)
            return new(false, sourceError, null, BlockingBlock: request.FromBlockId);

        var destinationError =
            ValidateDestinationBlock(
                request.ToBlockId);

        if (destinationError is not null)
            return new(false, destinationError, null, BlockingBlock: request.ToBlockId);

        if (!TryReserveDestination(
                request.ToBlockId,
                request.OwnerId))
            return new(false, "destination_block_reserved", null, BlockingBlock: request.ToBlockId);

        var turnoutAddresses =
            turnouts
                .Select(x => x.Address)
                .ToArray();

        var switchManAcquired = false;
        var markerSet = false;
        var marker =
            CreateTargetMarker(
                request.LocoAddress,
                request.OwnerId);

        try
        {
            var safety =
                SensorsFree(sensors);

            if (!safety.Ok)
                return new(
                    false,
                    "safety_sensor_not_free",
                    null,
                    BlockingSensor: safety.BlockingSensor);

            // Re-check the destination after taking the in-process reservation.
            destinationError =
                ValidateDestinationBlock(
                    request.ToBlockId);

            if (destinationError is not null)
                return new(
                    false,
                    destinationError,
                    null,
                    BlockingBlock: request.ToBlockId);

            if (turnoutAddresses.Length > 0)
            {
                foreach (var address in turnoutAddresses)
                {
                    if (_runtime.FindAccessory(
                            RuntimeAccessoryKind.Turnout,
                            address) is null)
                        return new(false, "turnout_not_found", null);
                }

                SwitchManAcquireResult turnoutLease;

                try
                {
                    turnoutLease =
                        await _switchMan.AcquireAsync(
                            turnoutAddresses,
                            request.OwnerId,
                            string.IsNullOrWhiteSpace(request.OwnerName)
                                ? request.OwnerId
                                : request.OwnerName.Trim(),
                            Math.Clamp(
                                request.TurnoutLockTimeoutMs,
                                0,
                                600000),
                            ct);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }

                if (!turnoutLease.Ok)
                    return new(
                        false,
                        turnoutLease.Error ?? "turnout_lock_failed",
                        null,
                        TurnoutConflicts: turnoutLease.Conflicts);

                switchManAcquired = true;
            }

            // Safety is checked again AFTER turnout locks have been acquired.
            // Nothing is allowed to become "safe by assumption" while waiting.
            sourceError =
                ValidateSourceBlock(
                    request.FromBlockId,
                    request.LocoAddress);

            if (sourceError is not null)
                return new(false, sourceError, null, BlockingBlock: request.FromBlockId);

            destinationError =
                ValidateDestinationBlock(
                    request.ToBlockId);

            if (destinationError is not null)
                return new(false, destinationError, null, BlockingBlock: request.ToBlockId);

            safety =
                SensorsFree(sensors);

            if (!safety.Ok)
                return new(
                    false,
                    "safety_sensor_not_free",
                    null,
                    BlockingSensor: safety.BlockingSensor);

            foreach (var turnout in turnouts)
            {
                ct.ThrowIfCancellationRequested();

                if (!await SetTurnoutAsync(
                        turnout,
                        request.OwnerId,
                        ct))
                    return new(
                        false,
                        "turnout_command_failed",
                        null);
            }

            // Final safety check after physical turnout commands.
            destinationError =
                ValidateDestinationBlock(
                    request.ToBlockId);

            if (destinationError is not null)
                return new(false, destinationError, null, BlockingBlock: request.ToBlockId);

            safety =
                SensorsFree(sensors);

            if (!safety.Ok)
                return new(
                    false,
                    "safety_sensor_not_free",
                    null,
                    BlockingSensor: safety.BlockingSensor);

            if (!_runtime.SetBlock(
                    request.ToBlockId,
                    marker,
                    0))
                return new(
                    false,
                    "target_block_marker_failed",
                    null,
                    BlockingBlock: request.ToBlockId);

            markerSet = true;

            var lease =
                new DispatcherLegLeaseInfo(
                    request.OwnerId,
                    string.IsNullOrWhiteSpace(request.OwnerName)
                        ? request.OwnerId
                        : request.OwnerName.Trim(),
                    request.LocoAddress,
                    request.FromBlockId,
                    request.ToBlockId,
                    turnoutAddresses,
                    sensors,
                    marker,
                    Environment.TickCount64);

            lock (_gate)
                _leases[request.OwnerId] = lease;

            _log.LogInformation(
                "Dispatcher acquired leg {FromBlock}->{ToBlock} for loco #{LocoAddress}, owner {OwnerId}",
                request.FromBlockId,
                request.ToBlockId,
                request.LocoAddress,
                request.OwnerId);

            Changed?.Invoke(Snapshot());

            return new(true, null, lease);
        }
        finally
        {
            bool committed;

            lock (_gate)
                committed = _leases.ContainsKey(request.OwnerId);

            if (!committed)
            {
                if (markerSet)
                    _runtime.RemoveBlock(
                        request.ToBlockId,
                        marker);

                if (switchManAcquired)
                    _switchMan.ReleaseOwned(
                        turnoutAddresses,
                        request.OwnerId);

                ReleaseDestinationReservation(
                    request.ToBlockId,
                    request.OwnerId);
            }
        }
    }

    public bool ReleaseLeg(string ownerId)
    {
        if (string.IsNullOrWhiteSpace(ownerId))
            return false;

        DispatcherLegLeaseInfo? lease;

        lock (_gate)
        {
            if (!_leases.Remove(ownerId, out lease))
                return false;
        }

        // Owner-safe target cleanup: if arrival already replaced the target
        // marker with real block occupancy, RemoveBlock refuses to remove it.
        _runtime.RemoveBlock(
            lease.ToBlockId,
            lease.TargetMarker);

        _switchMan.ReleaseOwned(
            lease.TurnoutAddresses,
            ownerId);

        ReleaseDestinationReservation(
            lease.ToBlockId,
            ownerId);

        _log.LogInformation(
            "Dispatcher released leg {FromBlock}->{ToBlock} for loco #{LocoAddress}, owner {OwnerId}",
            lease.FromBlockId,
            lease.ToBlockId,
            lease.LocoAddress,
            ownerId);

        Changed?.Invoke(Snapshot());

        return true;
    }

    public int ReleaseAll()
    {
        string[] owners;

        lock (_gate)
            owners = _leases.Keys.ToArray();

        var released = 0;

        foreach (var owner in owners)
            if (ReleaseLeg(owner))
                released++;

        return released;
    }
}
