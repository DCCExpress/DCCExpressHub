namespace DCCExpressHub.Net.Web;

// Backend-authoritative dispatcher for turnout sections. An acquisition is
// atomic: either every requested turnout is owned by the caller or none is.
// The WebUI script helper exposes this as switchMan([...], async sw => { ... }).

public sealed record SwitchManLockInfo(
    ushort Address,
    string OwnerId,
    string OwnerName,
    long AcquiredAtMs);

public sealed record SwitchManAcquireResult(
    bool Ok,
    string? Error,
    SwitchManLockInfo[] Locks,
    SwitchManLockInfo[] Conflicts);

public sealed class SwitchManManager
{
    readonly object _gate = new();
    readonly Dictionary<ushort, SwitchManLockInfo> _locks = new();
    readonly HashSet<string> _revokedOwners = new(StringComparer.Ordinal);
    TaskCompletionSource<bool> _changed = NewSignal();

    public event Action<SwitchManLockInfo[]?>? Changed;

    static TaskCompletionSource<bool> NewSignal() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    static ushort[] Normalize(IEnumerable<ushort> addresses) =>
        addresses
            .Where(x => x is >= 1 and <= 2048)
            .Distinct()
            .OrderBy(x => x)
            .ToArray();

    public SwitchManLockInfo[] Snapshot()
    {
        lock (_gate)
            return _locks.Values.OrderBy(x => x.Address).ToArray();
    }

    public bool IsLocked(ushort address, out SwitchManLockInfo? info)
    {
        lock (_gate)
            return _locks.TryGetValue(address, out info);
    }

    public bool IsOwnedBy(ushort address, string ownerId)
    {
        if (string.IsNullOrWhiteSpace(ownerId))
            return false;

        lock (_gate)
            return _locks.TryGetValue(address, out var info) &&
                   string.Equals(info.OwnerId, ownerId, StringComparison.Ordinal);
    }

    public bool CanOperate(ushort address, string? ownerId, out SwitchManLockInfo? blockingLock)
    {
        lock (_gate)
        {
            if (!_locks.TryGetValue(address, out blockingLock))
                return true;

            return !string.IsNullOrWhiteSpace(ownerId) &&
                   string.Equals(blockingLock.OwnerId, ownerId, StringComparison.Ordinal);
        }
    }

    SwitchManAcquireResult TryAcquireLocked(
        ushort[] addresses,
        string ownerId,
        string ownerName)
    {
        if (_revokedOwners.Contains(ownerId))
            return new(false, "switchman_owner_revoked", Array.Empty<SwitchManLockInfo>(), Array.Empty<SwitchManLockInfo>());

        var conflicts = addresses
            .Where(address =>
                _locks.TryGetValue(address, out var existing) &&
                !string.Equals(existing.OwnerId, ownerId, StringComparison.Ordinal))
            .Select(address => _locks[address])
            .ToArray();

        if (conflicts.Length > 0)
            return new(false, "turnout_locked", Array.Empty<SwitchManLockInfo>(), conflicts);

        var now = Environment.TickCount64;
        var acquired = new List<SwitchManLockInfo>();

        foreach (var address in addresses)
        {
            if (_locks.TryGetValue(address, out var existing))
            {
                acquired.Add(existing);
                continue;
            }

            var info = new SwitchManLockInfo(
                address,
                ownerId,
                string.IsNullOrWhiteSpace(ownerName) ? ownerId : ownerName.Trim(),
                now);

            _locks[address] = info;
            acquired.Add(info);
        }

        return new(true, null, acquired.ToArray(), Array.Empty<SwitchManLockInfo>());
    }

    public async Task<SwitchManAcquireResult> AcquireAsync(
        IEnumerable<ushort> requestedAddresses,
        string ownerId,
        string ownerName,
        int timeoutMs,
        CancellationToken cancellationToken)
    {
        var addresses = Normalize(requestedAddresses);

        if (addresses.Length == 0)
            return new(false, "invalid_turnout_addresses", Array.Empty<SwitchManLockInfo>(), Array.Empty<SwitchManLockInfo>());

        if (string.IsNullOrWhiteSpace(ownerId) || ownerId.Length > 240)
            return new(false, "invalid_owner", Array.Empty<SwitchManLockInfo>(), Array.Empty<SwitchManLockInfo>());

        timeoutMs = Math.Clamp(timeoutMs, 0, 10 * 60 * 1000);
        var startedAt = Environment.TickCount64;

        while (true)
        {
            Task changedTask;
            SwitchManAcquireResult attempt;
            SwitchManLockInfo[]? snapshot = null;

            lock (_gate)
            {
                attempt = TryAcquireLocked(addresses, ownerId, ownerName);

                if (attempt.Ok)
                {
                    snapshot = _locks.Values.OrderBy(x => x.Address).ToArray();
                    PulseLocked();
                }

                changedTask = _changed.Task;
            }

            if (attempt.Ok)
            {
                Changed?.Invoke(snapshot);
                return attempt;
            }

            if (timeoutMs == 0)
                return attempt;

            var elapsed = Environment.TickCount64 - startedAt;
            var remaining = timeoutMs - (int)Math.Min(int.MaxValue, Math.Max(0, elapsed));
            if (remaining <= 0)
                return attempt with { Error = "turnout_lock_timeout" };

            try
            {
                var delayTask = Task.Delay(remaining, cancellationToken);
                var completed = await Task.WhenAny(changedTask, delayTask);
                if (completed == delayTask)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    return attempt with { Error = "turnout_lock_timeout" };
                }
            }
            catch (OperationCanceledException)
            {
                throw;
            }
        }
    }

    public int ReleaseOwned(IEnumerable<ushort>? requestedAddresses, string ownerId)
    {
        if (string.IsNullOrWhiteSpace(ownerId))
            return 0;

        var filter = requestedAddresses is null
            ? null
            : Normalize(requestedAddresses).ToHashSet();

        int released = 0;
        SwitchManLockInfo[] snapshot;

        lock (_gate)
        {
            foreach (var pair in _locks.ToArray())
            {
                if (!string.Equals(pair.Value.OwnerId, ownerId, StringComparison.Ordinal))
                    continue;

                if (filter is not null && !filter.Contains(pair.Key))
                    continue;

                if (_locks.Remove(pair.Key))
                    released++;
            }

            if (released > 0)
                PulseLocked();

            snapshot = _locks.Values.OrderBy(x => x.Address).ToArray();
        }

        if (released > 0)
            Changed?.Invoke(snapshot);

        return released;
    }

    public int ForceReleaseAll()
    {
        int released;

        lock (_gate)
        {
            released = _locks.Count;
            _revokedOwners.Clear();

            foreach (var ownerId in _locks.Values.Select(x => x.OwnerId).Distinct(StringComparer.Ordinal))
                _revokedOwners.Add(ownerId);

            _locks.Clear();
            PulseLocked();
        }

        if (released > 0)
            Changed?.Invoke(Array.Empty<SwitchManLockInfo>());

        return released;
    }

    void PulseLocked()
    {
        var old = _changed;
        _changed = NewSignal();
        old.TrySetResult(true);
    }
}
