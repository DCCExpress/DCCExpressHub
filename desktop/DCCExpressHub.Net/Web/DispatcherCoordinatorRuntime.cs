using System.Text.Json;

namespace DCCExpressHub.Net.Web;

public sealed record DispatcherTaskState(
    string MovementId,
    string MovementName,
    int LocoAddress,
    int[] RequestedBlocks,
    int? CurrentBlockId,
    int? NextBlockId,
    string Status,
    string? Info,
    string? Error,
    long? StartedAt);

public sealed record DispatcherRuntimeLogEntry(
    string Id,
    long Timestamp,
    string Level,
    string Message);

public sealed record DispatcherCoordinatorSnapshot(
    bool Enabled,
    DispatcherTaskState[] Tasks,
    DispatcherRuntimeLogEntry[] Logs);

/// <summary>
/// High-level Dispatcher facade from feature/movement-train-events.
///
/// Saved Movement pages are intents. TrainTracking locates exactly one
/// locomotive on the requested checkpoint route. If the train is already at
/// an intermediate checkpoint, execution is trimmed and resumed from there.
/// Physical authority remains in MovementRuntime + DispatcherRuntime.
/// </summary>
public sealed class DispatcherCoordinatorRuntime
{
    sealed record ActiveTask(
        MovementPageModel OriginalPage,
        int LocoAddress,
        int[] RequestedBlocks);

    readonly object _gate = new();
    readonly IWebHostEnvironment _env;
    readonly TrainTrackingRuntime _tracking;
    readonly MovementRuntime _movement;
    readonly ILogger<DispatcherCoordinatorRuntime> _log;
    readonly JsonSerializerOptions _json =
        new(JsonSerializerDefaults.Web);

    readonly Dictionary<string, ActiveTask> _tasks =
        new(StringComparer.Ordinal);
    readonly Dictionary<int, string> _locoOwners = [];
    readonly List<DispatcherRuntimeLogEntry> _logs = [];

    bool _enabled = true;
    const int MaxLogs = 300;

    public event Action<DispatcherCoordinatorSnapshot>? Changed;

    public DispatcherCoordinatorRuntime(
        IWebHostEnvironment env,
        TrainTrackingRuntime tracking,
        MovementRuntime movement,
        ILogger<DispatcherCoordinatorRuntime> log)
    {
        _env = env;
        _tracking = tracking;
        _movement = movement;
        _log = log;

        LoadEnabled();

        _tracking.Changed +=
            _ => Publish();

        _movement.Changed +=
            OnMovementChanged;
    }

    static long NowMs() =>
        DateTimeOffset.UtcNow
            .ToUnixTimeMilliseconds();

    string StatePath() =>
        Path.Combine(
            _env.ContentRootPath,
            "data",
            "state",
            "dispatcher.json");

    string AutomationsPath() =>
        Path.Combine(
            _env.ContentRootPath,
            "data",
            "config",
            "automations.json");

    void LoadEnabled()
    {
        var path = StatePath();

        if (!File.Exists(path))
            return;

        try
        {
            using var doc =
                JsonDocument.Parse(
                    File.ReadAllText(path));

            if (doc.RootElement.TryGetProperty(
                    "enabled",
                    out var enabled))
                _enabled =
                    enabled.ValueKind ==
                    JsonValueKind.True;
        }
        catch
        {
            _enabled = true;
        }
    }

    void SaveEnabled()
    {
        try
        {
            var path = StatePath();

            Directory.CreateDirectory(
                Path.GetDirectoryName(path)!);

            File.WriteAllText(
                path,
                JsonSerializer.Serialize(
                    new
                    {
                        enabled =
                            _enabled
                    }));
        }
        catch (Exception ex)
        {
            _log.LogWarning(
                ex,
                "Dispatcher state could not be saved");
        }
    }

    MovementPageModel? LoadPage(
        string pageId)
    {
        var path =
            AutomationsPath();

        if (!File.Exists(path))
            return null;

        try
        {
            using var doc =
                JsonDocument.Parse(
                    File.ReadAllText(path));

            if (!doc.RootElement.TryGetProperty(
                    "movement",
                    out var movement) ||
                movement.ValueKind !=
                    JsonValueKind.Object ||
                !movement.TryGetProperty(
                    "pages",
                    out var pages) ||
                pages.ValueKind !=
                    JsonValueKind.Array)
                return null;

            foreach (var item in
                     pages.EnumerateArray())
            {
                if (item.ValueKind !=
                    JsonValueKind.Object)
                    continue;

                var id =
                    item.TryGetProperty(
                        "id",
                        out var idElement) &&
                    idElement.ValueKind ==
                        JsonValueKind.String
                        ? idElement.GetString() ??
                          ""
                        : "";

                if (!string.Equals(
                        id,
                        pageId,
                        StringComparison.Ordinal))
                    continue;

                return JsonSerializer
                    .Deserialize<MovementPageModel>(
                        item.GetRawText(),
                        _json);
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(
                ex,
                "Dispatcher movement definition could not be loaded: {PageId}",
                pageId);
        }

        return null;
    }

    static int[] RouteBlocks(
        MovementPageModel page)
    {
        var result =
            new List<int>();

        if (page.FromBlockId.HasValue)
            result.Add(
                page.FromBlockId.Value);

        result.AddRange(
            page.ViaBlockIds ??
            []);

        if (page.ToBlockId.HasValue)
            result.Add(
                page.ToBlockId.Value);

        return result
            .Where(id =>
                id > 0)
            .ToArray();
    }

    MovementPageModel? RemainingPage(
        MovementPageModel page,
        int currentBlockId)
    {
        var requested =
            RouteBlocks(
                page);

        var currentIndex =
            Array.IndexOf(
                requested,
                currentBlockId);

        if (currentIndex < 0 ||
            requested.Length < 2 ||
            currentIndex ==
                requested.Length - 1)
            return null;

        var remaining =
            requested[
                currentIndex..];

        var clone =
            JsonSerializer.Deserialize<MovementPageModel>(
                JsonSerializer.Serialize(
                    page,
                    _json),
                _json);

        if (clone is null)
            return null;

        clone.RouteKey = "";
        clone.FromBlockId =
            remaining[0];
        clone.ViaBlockIds =
            remaining.Length > 2
                ? remaining[
                    1..^1]
                : [];
        clone.ToBlockId =
            remaining[^1];

        return clone;
    }

    static int? NextBlock(
        int[] requested,
        int? currentBlockId)
    {
        if (requested.Length == 0)
            return null;

        if (!currentBlockId.HasValue)
            return requested[0];

        var index =
            Array.IndexOf(
                requested,
                currentBlockId.Value);

        return index >= 0 &&
               index + 1 <
                   requested.Length
            ? requested[
                index + 1]
            : null;
    }

    public (bool Ok, string? Error) Start(
        string pageId)
    {
        var page =
            LoadPage(
                pageId);

        if (page is null)
            return (
                false,
                "dispatcher_movement_not_found");

        return Start(
            page);
    }

    public (bool Ok, string? Error) Start(
        MovementPageModel page)
    {
        lock (_gate)
            if (!_enabled)
                return (
                    false,
                    "dispatcher_disabled");

        if (!page.FromBlockId.HasValue ||
            !page.ToBlockId.HasValue)
            return (
                false,
                "dispatcher_route_incomplete");

        var tracking =
            _tracking.Snapshot();

        if (!tracking.Active)
            return (
                false,
                "train_tracking_not_active");

        var requested =
            RouteBlocks(
                page);

        var routeLocos =
            tracking.Locos
                .Where(loco =>
                    loco.CurrentBlockId.HasValue &&
                    requested.Contains(
                        loco.CurrentBlockId.Value))
                .ToArray();

        if (routeLocos.Length == 0)
        {
            WriteLog(
                "warn",
                page.Name +
                ": no tracked locomotive is currently on the requested route.");

            return (
                false,
                "dispatcher_no_tracked_loco");
        }

        if (routeLocos.Length > 1)
        {
            WriteLog(
                "warn",
                page.Name +
                ": more than one tracked locomotive is currently on the requested route.");

            return (
                false,
                "dispatcher_multiple_tracked_locos");
        }

        var loco =
            routeLocos[0];

        if (!loco.CurrentBlockId.HasValue)
            return (
                false,
                "dispatcher_loco_block_unknown");

        var currentBlockId =
            loco.CurrentBlockId.Value;

        lock (_gate)
        {
            if (_locoOwners.TryGetValue(
                    loco.LocoAddress,
                    out var existingOwner) &&
                !string.Equals(
                    existingOwner,
                    page.Id,
                    StringComparison.Ordinal))
                return (
                    false,
                    "dispatcher_loco_already_owned");
        }

        var destination =
            requested.LastOrDefault();

        lock (_gate)
            _tasks[
                page.Id] =
                new(
                    page,
                    loco.LocoAddress,
                    requested);

        if (currentBlockId ==
            destination)
        {
            WriteLog(
                "match",
                "\"" +
                page.Name +
                "\" already completed for loco #" +
                loco.LocoAddress +
                ": locomotive is already in destination block #" +
                destination +
                ".");

            Publish();

            return (
                true,
                null);
        }

        var executionPage =
            RemainingPage(
                page,
                currentBlockId);

        if (executionPage is null)
            return (
                false,
                "dispatcher_cannot_resume");

        lock (_gate)
            _locoOwners[
                loco.LocoAddress] =
                page.Id;

        var remaining =
            RouteBlocks(
                executionPage);

        WriteLog(
            "info",
            currentBlockId ==
                requested[0]
                ? "Starting \"" +
                  page.Name +
                  "\" for loco #" +
                  loco.LocoAddress +
                  ": " +
                  string.Join(
                      " -> ",
                      requested) +
                  "."
                : "Resuming \"" +
                  page.Name +
                  "\" for loco #" +
                  loco.LocoAddress +
                  " from block #" +
                  currentBlockId +
                  ": " +
                  string.Join(
                      " -> ",
                      remaining) +
                  ".");

        var result =
            _movement.StartDefinition(
                executionPage,
                loco.LocoAddress);

        if (!result.Ok)
        {
            lock (_gate)
                if (_locoOwners.TryGetValue(
                        loco.LocoAddress,
                        out var owner) &&
                    owner ==
                        page.Id)
                    _locoOwners.Remove(
                        loco.LocoAddress);

            WriteLog(
                "error",
                "\"" +
                page.Name +
                "\" failed to start: " +
                result.Error);

            Publish();

            return result;
        }

        Publish();

        return (
            true,
            null);
    }

    void OnMovementChanged(
        MovementRuntimeState state)
    {
        lock (_gate)
        {
            if (!_tasks.TryGetValue(
                    state.PageId,
                    out var task))
                return;

            if (state.Status is
                "idle" or
                "error")
            {
                if (_locoOwners.TryGetValue(
                        task.LocoAddress,
                        out var owner) &&
                    owner ==
                        state.PageId)
                    _locoOwners.Remove(
                        task.LocoAddress);
            }
        }

        Publish();
    }

    public bool Stop(
        string pageId) =>
        _movement.Stop(
            pageId);

    public bool Abort(
        string pageId,
        bool emergencyStop) =>
        _movement.Abort(
            pageId,
            emergencyStop);

    public bool Hold(
        string pageId,
        string ownerId) =>
        _movement.Hold(
            pageId,
            ownerId);

    public bool Release(
        string pageId,
        string ownerId) =>
        _movement.Release(
            pageId,
            ownerId);

    public int StopAll(
        bool emergencyStop)
    {
        string[] ids;

        lock (_gate)
            ids =
                _tasks.Keys
                    .ToArray();

        return ids.Count(
            id =>
                emergencyStop
                    ? _movement.Abort(
                        id,
                        true)
                    : _movement.Stop(
                        id));
    }

    public void SetEnabled(
        bool enabled)
    {
        lock (_gate)
            _enabled =
                enabled;

        SaveEnabled();
        Publish();
    }

    public void ClearLogs()
    {
        lock (_gate)
            _logs.Clear();

        Publish();
    }

    DispatcherTaskState TaskSnapshot(
        ActiveTask task)
    {
        var movement =
            _movement.GetState(
                task.OriginalPage.Id);

        var tracking =
            _tracking.Snapshot()
                .Locos
                .FirstOrDefault(
                    loco =>
                        loco.LocoAddress ==
                        task.LocoAddress);

        var current =
            tracking?.CurrentBlockId;

        return new(
            task.OriginalPage.Id,
            task.OriginalPage.Name,
            task.LocoAddress,
            task.RequestedBlocks,
            current,
            NextBlock(
                task.RequestedBlocks,
                current),
            movement.Status,
            movement.Info,
            movement.Error,
            movement.StartedAt);
    }

    public DispatcherCoordinatorSnapshot Snapshot()
    {
        lock (_gate)
            return new(
                _enabled,
                _tasks.Values
                    .Select(
                        TaskSnapshot)
                    .OrderByDescending(
                        task =>
                            task.StartedAt ??
                            0)
                    .ToArray(),
                _logs.ToArray());
    }

    void WriteLog(
        string level,
        string message)
    {
        lock (_gate)
        {
            _logs.Add(
                new(
                    Guid.NewGuid()
                        .ToString("N"),
                    NowMs(),
                    level,
                    message));

            while (_logs.Count >
                   MaxLogs)
                _logs.RemoveAt(
                    0);
        }

        _log.LogInformation(
            "Dispatcher [{Level}] {Message}",
            level,
            message);
    }

    void Publish()
    {
        Changed?.Invoke(
            Snapshot());
    }
}
