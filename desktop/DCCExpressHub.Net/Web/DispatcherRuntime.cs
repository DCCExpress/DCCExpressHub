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
    string[] ResourceKeys,
    int TurnoutLockTimeoutMs = 0,
    int TurnoutSetDelayMs = 250);

public sealed record DispatcherLegLeaseInfo(
    string OwnerId,
    string OwnerName,
    ushort LocoAddress,
    ushort FromBlockId,
    ushort ToBlockId,
    ushort[] TurnoutAddresses,
    ushort[] SafetySensors,
    string[] ResourceKeys,
    string TargetMarker,
    long AcquiredAtMs);

public sealed record DispatcherAcquireResult(
    bool Ok,
    string? Error,
    DispatcherLegLeaseInfo? Lease,
    ushort? BlockingSensor = null,
    ushort? BlockingBlock = null,
    SwitchManLockInfo[]? TurnoutConflicts = null);

public sealed record DispatcherRouteBlockRequirement(
    ushort BlockId,
    ushort SensorAddress);

public sealed record DispatcherRouteTargetLease(
    ushort BlockId,
    string Marker);

public sealed record DispatcherRouteRequest(
    string OwnerId,
    string OwnerName,
    ushort LocoAddress,
    ushort SourceBlockId,
    DispatcherRouteBlockRequirement[] DownstreamBlocks,
    DispatcherTurnoutRequirement[] Turnouts,
    string[] ResourceKeys,
    int TurnoutLockTimeoutMs = 0,
    int TurnoutSetDelayMs = 250);

public sealed record DispatcherRouteLeaseInfo(
    string OwnerId,
    string OwnerName,
    ushort LocoAddress,
    ushort SourceBlockId,
    ushort DestinationBlockId,
    ushort[] RouteBlockIds,
    ushort[] TurnoutAddresses,
    string[] ResourceKeys,
    DispatcherRouteTargetLease[] Targets,
    long AcquiredAtMs);

public sealed record DispatcherRouteAcquireResult(
    bool Ok,
    string? Error,
    DispatcherRouteLeaseInfo? Lease,
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

    readonly Dictionary<string, DispatcherRouteLeaseInfo> _routeLeases =
        new(StringComparer.Ordinal);

    readonly Dictionary<ushort, string> _destinationOwners = new();
    readonly Dictionary<string, string> _resourceOwners =
        new(StringComparer.Ordinal);

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
        DispatcherLegLeaseInfo[] invalidLegs;
        DispatcherRouteLeaseInfo[] invalidRoutes;

        lock (_gate)
        {
            invalidLegs =
                _leases.Values
                    .Where(lease =>
                        lease.TurnoutAddresses.Any(
                            address =>
                                !_switchMan.IsOwnedBy(
                                    address,
                                    lease.OwnerId)))
                    .ToArray();

            invalidRoutes =
                _routeLeases.Values
                    .Where(lease =>
                        lease.TurnoutAddresses.Any(
                            address =>
                                !_switchMan.IsOwnedBy(
                                    address,
                                    lease.OwnerId)))
                    .ToArray();
        }

        foreach (var lease in invalidLegs)
        {
            _log.LogWarning(
                "Dispatcher lease {OwnerId} lost turnout authority; releasing leg {FromBlock}->{ToBlock}",
                lease.OwnerId,
                lease.FromBlockId,
                lease.ToBlockId);

            ReleaseLeg(
                lease.OwnerId);
        }

        foreach (var lease in invalidRoutes)
        {
            _log.LogWarning(
                "Dispatcher route lease {OwnerId} lost turnout authority; releasing route {SourceBlock}->{DestinationBlock}",
                lease.OwnerId,
                lease.SourceBlockId,
                lease.DestinationBlockId);

            ReleaseRoute(
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

    public DispatcherRouteLeaseInfo[] RouteSnapshot()
    {
        lock (_gate)
            return _routeLeases.Values
                .OrderBy(x => x.AcquiredAtMs)
                .ToArray();
    }

    static ushort[] NormalizeSensors(IEnumerable<ushort>? sensors) =>
        (sensors ?? Array.Empty<ushort>())
            .Where(x => x > 0)
            .Distinct()
            .OrderBy(x => x)
            .ToArray();

    static string[] NormalizeResources(
        ushort fromBlockId,
        ushort toBlockId,
        IEnumerable<string>? resourceKeys)
    {
        var keys =
            new HashSet<string>(
                StringComparer.Ordinal)
            {
                "block:" +
                    fromBlockId,
                "block:" +
                    toBlockId
            };

        foreach (var raw in resourceKeys ?? Array.Empty<string>())
        {
            var key =
                (raw ?? "")
                    .Trim();

            if (key.Length is > 0 and <= 240)
                keys.Add(key);
        }

        return keys
            .OrderBy(
                key => key,
                StringComparer.Ordinal)
            .ToArray();
    }


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

    bool TryReserveLegResources(
        ushort destinationBlockId,
        string ownerId,
        IReadOnlyList<string> resourceKeys,
        out string? blockingResource)
    {
        lock (_gate)
        {
            blockingResource =
                null;

            if (_destinationOwners.TryGetValue(
                    destinationBlockId,
                    out var destinationOwner) &&
                !string.Equals(
                    destinationOwner,
                    ownerId,
                    StringComparison.Ordinal))
            {
                blockingResource =
                    "block:" +
                    destinationBlockId;

                return false;
            }

            foreach (var key in resourceKeys)
            {
                if (_resourceOwners.TryGetValue(
                        key,
                        out var existingOwner) &&
                    !string.Equals(
                        existingOwner,
                        ownerId,
                        StringComparison.Ordinal))
                {
                    blockingResource =
                        key;

                    return false;
                }
            }

            _destinationOwners[
                destinationBlockId] =
                ownerId;

            foreach (var key in resourceKeys)
                _resourceOwners[key] =
                    ownerId;

            return true;
        }
    }

    void ReleaseLegResources(
        ushort destinationBlockId,
        string ownerId,
        IEnumerable<string> resourceKeys)
    {
        lock (_gate)
        {
            if (_destinationOwners.TryGetValue(
                    destinationBlockId,
                    out var destinationOwner) &&
                string.Equals(
                    destinationOwner,
                    ownerId,
                    StringComparison.Ordinal))
                _destinationOwners.Remove(
                    destinationBlockId);

            foreach (var key in resourceKeys)
            {
                if (_resourceOwners.TryGetValue(
                        key,
                        out var existingOwner) &&
                    string.Equals(
                        existingOwner,
                        ownerId,
                        StringComparison.Ordinal))
                    _resourceOwners.Remove(
                        key);
            }
        }
    }

    bool TryReserveResources(
        string ownerId,
        IReadOnlyList<string> resourceKeys,
        out string? blockingResource)
    {
        lock (_gate)
        {
            blockingResource =
                null;

            foreach (var key in resourceKeys)
            {
                if (_resourceOwners.TryGetValue(
                        key,
                        out var existingOwner) &&
                    !string.Equals(
                        existingOwner,
                        ownerId,
                        StringComparison.Ordinal))
                {
                    blockingResource =
                        key;
                    return false;
                }
            }

            foreach (var key in resourceKeys)
                _resourceOwners[key] =
                    ownerId;

            return true;
        }
    }

    void ReleaseResources(
        string ownerId,
        IEnumerable<string> resourceKeys)
    {
        lock (_gate)
        {
            foreach (var key in resourceKeys)
            {
                if (_resourceOwners.TryGetValue(
                        key,
                        out var existingOwner) &&
                    string.Equals(
                        existingOwner,
                        ownerId,
                        StringComparison.Ordinal))
                    _resourceOwners.Remove(
                        key);
            }
        }
    }

    static string[] NormalizeRouteResources(
        ushort sourceBlockId,
        IEnumerable<DispatcherRouteBlockRequirement> downstreamBlocks,
        IEnumerable<string>? resourceKeys)
    {
        var keys =
            new HashSet<string>(
                StringComparer.Ordinal)
            {
                "block:" +
                    sourceBlockId
            };

        foreach (var block in downstreamBlocks)
            keys.Add(
                "block:" +
                block.BlockId);

        foreach (var raw in resourceKeys ?? Array.Empty<string>())
        {
            var key =
                (raw ?? "")
                    .Trim();

            if (key.Length is > 0 and <= 240)
                keys.Add(key);
        }

        return keys
            .OrderBy(
                key => key,
                StringComparer.Ordinal)
            .ToArray();
    }

    string? ValidateRouteBlocks(
        IReadOnlyList<DispatcherRouteBlockRequirement> blocks,
        out ushort? blockingSensor,
        out ushort? blockingBlock)
    {
        blockingSensor =
            null;
        blockingBlock =
            null;

        foreach (var requirement in blocks)
        {
            var block =
                FindBlock(
                    requirement.BlockId);

            if (block is null)
            {
                blockingBlock =
                    requirement.BlockId;
                return "destination_block_not_found";
            }

            if (block.HasRuntimeState)
            {
                blockingBlock =
                    requirement.BlockId;
                return "destination_block_busy";
            }

            if (requirement.SensorAddress > 0 &&
                (
                    !_runtime.TryGetSensorState(
                        requirement.SensorAddress,
                        out var occupied) ||
                    occupied
                ))
            {
                blockingSensor =
                    requirement.SensorAddress;
                blockingBlock =
                    requirement.BlockId;
                return "safety_sensor_not_free";
            }
        }

        return null;
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

        var resourceKeys =
            NormalizeResources(
                request.FromBlockId,
                request.ToBlockId,
                request.ResourceKeys);

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

        if (!TryReserveLegResources(
                request.ToBlockId,
                request.OwnerId,
                resourceKeys,
                out var blockingResource))
            return new(
                false,
                "dispatcher_resource_locked:" +
                    blockingResource,
                null,
                BlockingBlock:
                    blockingResource ==
                        "block:" +
                        request.ToBlockId
                        ? request.ToBlockId
                        : null);

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

            for (
                var index = 0;
                index < turnouts.Length;
                index++)
            {
                ct.ThrowIfCancellationRequested();

                var turnout =
                    turnouts[index];

                var needsChange =
                    !_runtime.TryGetTurnoutClosed(
                        turnout.Address,
                        out var currentClosed) ||
                    currentClosed !=
                        turnout.Closed;

                if (!await SetTurnoutAsync(
                        turnout,
                        request.OwnerId,
                        ct))
                    return new(
                        false,
                        "turnout_command_failed",
                        null);

                /*
                 * Match the proven browser runtime behavior: after an actual
                 * turnout change leave a short mechanical/command-station
                 * settling interval before issuing the next turnout command.
                 */
                if (needsChange &&
                    index + 1 <
                        turnouts.Length)
                    await Task.Delay(
                        Math.Clamp(
                            request.TurnoutSetDelayMs,
                            0,
                            600000),
                        ct);
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
                    resourceKeys,
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

                ReleaseLegResources(
                    request.ToBlockId,
                    request.OwnerId,
                    resourceKeys);
            }
        }
    }

    public async Task<DispatcherRouteAcquireResult> AcquireRouteAsync(
        DispatcherRouteRequest request,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.OwnerId) ||
            request.OwnerId.Length > 240)
            return new(false, "invalid_owner", null);

        if (request.LocoAddress is < 1 or > 10239 ||
            request.SourceBlockId == 0)
            return new(false, "invalid_dispatcher_route", null);

        var downstream =
            (request.DownstreamBlocks ?? [])
                .Where(block =>
                    block.BlockId > 0 &&
                    block.BlockId !=
                        request.SourceBlockId)
                .GroupBy(block =>
                    block.BlockId)
                .Select(group =>
                    group.First())
                .ToArray();

        if (downstream.Length == 0)
            return new(false, "invalid_dispatcher_route", null);

        lock (_gate)
        {
            if (_routeLeases.ContainsKey(
                    request.OwnerId) ||
                _leases.ContainsKey(
                    request.OwnerId))
                return new(false, "owner_already_has_dispatcher_lease", null);
        }

        DispatcherTurnoutRequirement[] turnouts;

        try
        {
            turnouts =
                NormalizeTurnouts(
                    request.Turnouts);
        }
        catch (ArgumentException ex)
        {
            return new(false, ex.Message, null);
        }

        var sourceError =
            ValidateSourceBlock(
                request.SourceBlockId,
                request.LocoAddress);

        if (sourceError is not null)
            return new(
                false,
                sourceError,
                null,
                BlockingBlock:
                    request.SourceBlockId);

        var blockError =
            ValidateRouteBlocks(
                downstream,
                out var blockingSensor,
                out var blockingBlock);

        if (blockError is not null)
            return new(
                false,
                blockError,
                null,
                BlockingSensor:
                    blockingSensor,
                BlockingBlock:
                    blockingBlock);

        var resourceKeys =
            NormalizeRouteResources(
                request.SourceBlockId,
                downstream,
                request.ResourceKeys);

        if (!TryReserveResources(
                request.OwnerId,
                resourceKeys,
                out var blockingResource))
            return new(
                false,
                "dispatcher_resource_locked:" +
                    blockingResource,
                null);

        var turnoutAddresses =
            turnouts
                .Select(turnout =>
                    turnout.Address)
                .ToArray();

        var switchManAcquired =
            false;

        var targets =
            new List<DispatcherRouteTargetLease>();

        try
        {
            foreach (var address in turnoutAddresses)
            {
                if (_runtime.FindAccessory(
                        RuntimeAccessoryKind.Turnout,
                        address) is null)
                    return new(
                        false,
                        "turnout_not_found",
                        null);
            }

            if (turnoutAddresses.Length > 0)
            {
                var turnoutLease =
                    await _switchMan.AcquireAsync(
                        turnoutAddresses,
                        request.OwnerId,
                        string.IsNullOrWhiteSpace(
                            request.OwnerName)
                            ? request.OwnerId
                            : request.OwnerName.Trim(),
                        Math.Clamp(
                            request.TurnoutLockTimeoutMs,
                            0,
                            600000),
                        ct);

                if (!turnoutLease.Ok)
                    return new(
                        false,
                        turnoutLease.Error ??
                            "turnout_lock_failed",
                        null,
                        TurnoutConflicts:
                            turnoutLease.Conflicts);

                switchManAcquired =
                    true;
            }

            sourceError =
                ValidateSourceBlock(
                    request.SourceBlockId,
                    request.LocoAddress);

            if (sourceError is not null)
                return new(
                    false,
                    sourceError,
                    null,
                    BlockingBlock:
                        request.SourceBlockId);

            blockError =
                ValidateRouteBlocks(
                    downstream,
                    out blockingSensor,
                    out blockingBlock);

            if (blockError is not null)
                return new(
                    false,
                    blockError,
                    null,
                    BlockingSensor:
                        blockingSensor,
                    BlockingBlock:
                        blockingBlock);

            for (
                var index = 0;
                index < turnouts.Length;
                index++)
            {
                ct.ThrowIfCancellationRequested();

                var turnout =
                    turnouts[index];

                var needsChange =
                    !_runtime.TryGetTurnoutClosed(
                        turnout.Address,
                        out var currentClosed) ||
                    currentClosed !=
                        turnout.Closed;

                if (!await SetTurnoutAsync(
                        turnout,
                        request.OwnerId,
                        ct))
                    return new(
                        false,
                        "turnout_command_failed",
                        null);

                if (needsChange &&
                    index + 1 <
                        turnouts.Length)
                    await Task.Delay(
                        Math.Clamp(
                            request.TurnoutSetDelayMs,
                            0,
                            600000),
                        ct);
            }

            sourceError =
                ValidateSourceBlock(
                    request.SourceBlockId,
                    request.LocoAddress);

            if (sourceError is not null)
                return new(
                    false,
                    sourceError,
                    null,
                    BlockingBlock:
                        request.SourceBlockId);

            blockError =
                ValidateRouteBlocks(
                    downstream,
                    out blockingSensor,
                    out blockingBlock);

            if (blockError is not null)
                return new(
                    false,
                    blockError,
                    null,
                    BlockingSensor:
                        blockingSensor,
                    BlockingBlock:
                        blockingBlock);

            foreach (var block in downstream)
            {
                var marker =
                    CreateTargetMarker(
                        request.LocoAddress,
                        request.OwnerId +
                            ":" +
                            block.BlockId);

                if (!_runtime.SetBlock(
                        block.BlockId,
                        marker,
                        0))
                    return new(
                        false,
                        "target_block_marker_failed",
                        null,
                        BlockingBlock:
                            block.BlockId);

                targets.Add(
                    new DispatcherRouteTargetLease(
                        block.BlockId,
                        marker));
            }

            var routeBlockIds =
                new[]
                {
                    request.SourceBlockId
                }
                .Concat(
                    downstream.Select(block =>
                        block.BlockId))
                .ToArray();

            var lease =
                new DispatcherRouteLeaseInfo(
                    request.OwnerId,
                    string.IsNullOrWhiteSpace(
                        request.OwnerName)
                        ? request.OwnerId
                        : request.OwnerName.Trim(),
                    request.LocoAddress,
                    request.SourceBlockId,
                    downstream[^1].BlockId,
                    routeBlockIds,
                    turnoutAddresses,
                    resourceKeys,
                    targets.ToArray(),
                    Environment.TickCount64);

            lock (_gate)
                _routeLeases[
                    request.OwnerId] =
                    lease;

            _log.LogInformation(
                "Dispatcher acquired full route {SourceBlock}->{DestinationBlock} for loco #{LocoAddress}, owner {OwnerId}",
                lease.SourceBlockId,
                lease.DestinationBlockId,
                lease.LocoAddress,
                lease.OwnerId);

            Changed?.Invoke(
                Snapshot());

            return new(
                true,
                null,
                lease);
        }
        finally
        {
            bool committed;

            lock (_gate)
                committed =
                    _routeLeases.ContainsKey(
                        request.OwnerId);

            if (!committed)
            {
                foreach (var target in targets)
                    _runtime.RemoveBlock(
                        target.BlockId,
                        target.Marker);

                if (switchManAcquired)
                    _switchMan.ReleaseOwned(
                        turnoutAddresses,
                        request.OwnerId);

                ReleaseResources(
                    request.OwnerId,
                    resourceKeys);
            }
        }
    }

    public bool CommitRoute(
        string ownerId)
    {
        DispatcherRouteLeaseInfo? lease;

        lock (_gate)
        {
            if (!_routeLeases.TryGetValue(
                    ownerId,
                    out lease))
                return false;
        }

        var sourceError =
            ValidateSourceBlock(
                lease.SourceBlockId,
                lease.LocoAddress);

        if (sourceError is not null)
            return false;

        foreach (var target in lease.Targets)
        {
            var block =
                FindBlock(
                    target.BlockId);

            if (block is null ||
                block.LocoAddress != 0 ||
                !string.Equals(
                    block.LocoId,
                    target.Marker,
                    StringComparison.Ordinal))
                return false;
        }

        /*
         * SetBlock moves the actual locomotive assignment atomically within
         * LayoutRuntime: the old source occurrence is cleared as the
         * destination becomes the real occupied block. Intermediate targets
         * remain owner-marked until ReleaseRoute removes them below.
         */
        if (!_runtime.SetBlock(
                lease.DestinationBlockId,
                "",
                lease.LocoAddress))
            return false;

        return ReleaseRoute(
            ownerId);
    }

    public bool ReleaseRoute(
        string ownerId)
    {
        if (string.IsNullOrWhiteSpace(
                ownerId))
            return false;

        DispatcherRouteLeaseInfo? lease;

        lock (_gate)
        {
            if (!_routeLeases.Remove(
                    ownerId,
                    out lease))
                return false;
        }

        foreach (var target in lease.Targets)
            _runtime.RemoveBlock(
                target.BlockId,
                target.Marker);

        _switchMan.ReleaseOwned(
            lease.TurnoutAddresses,
            ownerId);

        ReleaseResources(
            ownerId,
            lease.ResourceKeys);

        _log.LogInformation(
            "Dispatcher released full route {SourceBlock}->{DestinationBlock} for loco #{LocoAddress}, owner {OwnerId}",
            lease.SourceBlockId,
            lease.DestinationBlockId,
            lease.LocoAddress,
            ownerId);

        Changed?.Invoke(
            Snapshot());

        return true;
    }

    public DispatcherAcquireResult ValidateHeldLeg(
        string ownerId)
    {
        DispatcherLegLeaseInfo? lease;

        lock (_gate)
        {
            if (!_leases.TryGetValue(
                    ownerId,
                    out lease))
                return new(
                    false,
                    "dispatcher_lease_not_found",
                    null);
        }

        var sourceError =
            ValidateSourceBlock(
                lease.FromBlockId,
                lease.LocoAddress);

        if (sourceError is not null)
            return new(
                false,
                sourceError,
                lease,
                BlockingBlock:
                    lease.FromBlockId);

        var destination =
            FindBlock(
                lease.ToBlockId);

        if (destination is null)
            return new(
                false,
                "destination_block_not_found",
                lease,
                BlockingBlock:
                    lease.ToBlockId);

        if (destination.LocoAddress != 0 ||
            !string.Equals(
                destination.LocoId,
                lease.TargetMarker,
                StringComparison.Ordinal))
            return new(
                false,
                "destination_target_lost",
                lease,
                BlockingBlock:
                    lease.ToBlockId);

        lock (_gate)
        {
            foreach (var key in lease.ResourceKeys)
            {
                if (!_resourceOwners.TryGetValue(
                        key,
                        out var resourceOwner) ||
                    !string.Equals(
                        resourceOwner,
                        ownerId,
                        StringComparison.Ordinal))
                    return new(
                        false,
                        "dispatcher_resource_authority_lost:" +
                            key,
                        lease);
            }
        }

        foreach (var address in lease.TurnoutAddresses)
        {
            if (!_switchMan.IsOwnedBy(
                    address,
                    ownerId))
                return new(
                    false,
                    "turnout_authority_lost",
                    lease);
        }

        var safety =
            SensorsFree(
                lease.SafetySensors);

        if (!safety.Ok)
            return new(
                false,
                "safety_sensor_not_free",
                lease,
                BlockingSensor:
                    safety.BlockingSensor);

        return new(
            true,
            null,
            lease);
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

        ReleaseLegResources(
            lease.ToBlockId,
            ownerId,
            lease.ResourceKeys);

        _log.LogInformation(
            "Dispatcher released leg {FromBlock}->{ToBlock} for loco #{LocoAddress}, owner {OwnerId}",
            lease.FromBlockId,
            lease.ToBlockId,
            lease.LocoAddress,
            ownerId);

        Changed?.Invoke(Snapshot());

        return true;
    }

    public int ReleaseScriptLeases()
    {
        string[] legOwners;
        string[] routeOwners;

        lock (_gate)
        {
            legOwners =
                _leases.Keys
                    .Where(owner =>
                        !owner.StartsWith(
                            "movement:",
                            StringComparison.Ordinal))
                    .ToArray();

            // Full-route leases currently belong to script dispatcher().
            routeOwners =
                _routeLeases.Keys
                    .ToArray();
        }

        var released =
            0;

        foreach (var owner in legOwners)
            if (ReleaseLeg(
                    owner))
                released++;

        foreach (var owner in routeOwners)
            if (ReleaseRoute(
                    owner))
                released++;

        return released;
    }

    public int ReleaseAll()
    {
        string[] legOwners;
        string[] routeOwners;

        lock (_gate)
        {
            legOwners =
                _leases.Keys.ToArray();

            routeOwners =
                _routeLeases.Keys.ToArray();
        }

        var released = 0;

        foreach (var owner in legOwners)
            if (ReleaseLeg(owner))
                released++;

        foreach (var owner in routeOwners)
            if (ReleaseRoute(owner))
                released++;

        return released;
    }
}
