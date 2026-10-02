using System.Text.Json;

namespace DCCExpressHub.Net.Web;

public sealed record TimetableActiveRunState(
    string Id,
    string TimetableEntryId,
    string TimetableActionId,
    string TargetType,
    string TargetId,
    string TargetName,
    string? ExecutionId,
    string ScheduledTime,
    int ScheduledMinuteOfDay,
    string Status,
    string? Message);

public sealed record TimetableRuntimeState(
    bool Running,
    string? LastTriggeredAt,
    string? LastTriggeredTargetName,
    TimetableActiveRunState[] ActiveRuns);

/// <summary>
/// Backend-authoritative timetable scheduler. FastClock traversal and schedule
/// matching happen here, independently from browser timer throttling/sleep.
///
/// Movement targets are started directly through MovementRuntime. Script targets
/// are delegated to the active WebUI script worker through ScriptRequested,
/// because JavaScript execution is intentionally still a separate subsystem.
/// </summary>
public sealed class TimetableRuntime : BackgroundService
{
    const long MinuteMs = 60_000;
    const int MinutesPerDay = 24 * 60;
    const long DayMs = MinutesPerDay * MinuteMs;
    const long MaxCatchUpMs = 180 * MinuteMs;

    readonly object _gate = new();
    readonly IWebHostEnvironment _env;
    readonly FastClockRuntime _fastClock;
    readonly MovementRuntime _movement;
    readonly ScriptRuntime _scripts;
    readonly ILogger<TimetableRuntime> _log;
    readonly JsonSerializerOptions _json =
        new(JsonSerializerDefaults.Web);

    bool _running;
    bool _finishing;
    long? _previousFastClockTimeMs;
    string? _lastTriggeredAt;
    string? _lastTriggeredTargetName;
    long _nextRunSequence = 1;

    readonly Dictionary<string, TimetableActiveRunState> _activeRuns =
        new(StringComparer.Ordinal);

    public event Action<TimetableRuntimeState>? Changed;

    public TimetableRuntime(
        IWebHostEnvironment env,
        FastClockRuntime fastClock,
        MovementRuntime movement,
        ScriptRuntime scripts,
        ILogger<TimetableRuntime> log)
    {
        _env = env;
        _fastClock = fastClock;
        _movement = movement;
        _scripts = scripts;
        _log = log;

        _movement.Changed +=
            OnMovementChanged;

        _scripts.Changed +=
            OnScriptChanged;
    }

    public TimetableRuntimeState Snapshot()
    {
        lock (_gate)
            return new TimetableRuntimeState(
                _running,
                _lastTriggeredAt,
                _lastTriggeredTargetName,
                _activeRuns.Values
                    .OrderBy(run =>
                        run.ScheduledMinuteOfDay)
                    .ThenBy(run =>
                        run.Id,
                        StringComparer.Ordinal)
                    .ToArray());
    }

    void Publish()
    {
        Changed?.Invoke(
            Snapshot());
    }

    public bool StartScheduler()
    {
        lock (_gate)
        {
            if (_running)
                return false;

            _running = true;
            _previousFastClockTimeMs =
                NormalizeDayTime(
                    _fastClock.GetSnapshot().TimeMs);
        }

        Publish();
        return true;
    }

    public bool StopScheduler()
    {
        lock (_gate)
        {
            if (!_running)
                return false;

            _running = false;
            _previousFastClockTimeMs =
                null;
        }

        Publish();
        return true;
    }

    public void SetFinishing(
        bool finishing)
    {
        lock (_gate)
            _finishing =
                finishing;
    }

    public void Rebase()
    {
        lock (_gate)
            _previousFastClockTimeMs =
                NormalizeDayTime(
                    _fastClock.GetSnapshot().TimeMs);

        Publish();
    }

    static long NormalizeDayTime(
        long value)
    {
        var normalized =
            value %
            DayMs;

        return normalized < 0
            ? normalized +
              DayMs
            : normalized;
    }

    protected override async Task ExecuteAsync(
        CancellationToken stoppingToken)
    {
        using var timer =
            new PeriodicTimer(
                TimeSpan.FromMilliseconds(
                    250));

        while (await timer.WaitForNextTickAsync(
                   stoppingToken))
        {
            try
            {
                Tick();
            }
            catch (Exception ex)
            {
                _log.LogError(
                    ex,
                    "Timetable backend tick failed");
            }
        }
    }

    void Tick()
    {
        long? previous;

        lock (_gate)
        {
            if (!_running)
                return;

            previous =
                _previousFastClockTimeMs;
        }

        var snapshot =
            _fastClock.GetSnapshot();

        var current =
            NormalizeDayTime(
                snapshot.TimeMs);

        if (!snapshot.Running)
        {
            lock (_gate)
                _previousFastClockTimeMs =
                    current;

            return;
        }

        lock (_gate)
            _previousFastClockTimeMs =
                current;

        if (!previous.HasValue)
            return;

        var forwardDelta =
            current >= previous.Value
                ? current -
                  previous.Value
                : DayMs -
                  previous.Value +
                  current;

        if (forwardDelta <= 0 ||
            forwardDelta >
                MaxCatchUpMs)
            return;

        var previousMinute =
            previous.Value /
            MinuteMs;

        var currentAbsoluteMinute =
            current /
            MinuteMs;

        if (current <
            previous.Value)
            currentAbsoluteMinute +=
                MinutesPerDay;

        if (currentAbsoluteMinute <=
            previousMinute)
            return;

        for (
            var absoluteMinute =
                previousMinute +
                1;
            absoluteMinute <=
                currentAbsoluteMinute;
            absoluteMinute++)
        {
            ProcessMinute(
                absoluteMinute);
        }
    }

    sealed record ScriptDefinition(
        string Id,
        string Name,
        string Script);

    sealed record TimetableAction(
        string Id,
        string TargetType,
        string TargetId);

    sealed record TimetableEntry(
        string Id,
        bool Enabled,
        string Cron,
        TimetableAction[] Actions);

    sealed record StorageSnapshot(
        Dictionary<string, ScriptDefinition> Scripts,
        Dictionary<string, MovementPageModel> Movements,
        TimetableEntry[] Entries);

    StorageSnapshot LoadStorage()
    {
        var path =
            Path.Combine(
                _env.ContentRootPath,
                "data",
                "config",
                "automations.json");

        if (!File.Exists(path))
            return new(
                new(
                    StringComparer.Ordinal),
                new(
                    StringComparer.Ordinal),
                []);

        using var doc =
            JsonDocument.Parse(
                File.ReadAllText(
                    path));

        var root =
            doc.RootElement;

        var scripts =
            new Dictionary<string, ScriptDefinition>(
                StringComparer.Ordinal);

        if (root.TryGetProperty("scripts", out var rawScripts) &&
            rawScripts.ValueKind == JsonValueKind.Array)
        {
            foreach (var script in rawScripts.EnumerateArray())
            {
                var id =
                    script.TryGetProperty("id", out var idElement) &&
                    idElement.ValueKind == JsonValueKind.String
                        ? idElement.GetString() ?? ""
                        : "";

                var name =
                    script.TryGetProperty("name", out var nameElement) &&
                    nameElement.ValueKind == JsonValueKind.String
                        ? nameElement.GetString() ?? ""
                        : "";

                var code =
                    script.TryGetProperty("script", out var codeElement) &&
                    codeElement.ValueKind == JsonValueKind.String
                        ? codeElement.GetString() ?? ""
                        : "";

                if (id.Length > 0)
                    scripts[id] =
                        new(
                            id,
                            name,
                            code);
            }
        }

        var movements =
            new Dictionary<string, MovementPageModel>(
                StringComparer.Ordinal);

        if (root.TryGetProperty("movement", out var movementDocument) &&
            movementDocument.ValueKind == JsonValueKind.Object &&
            movementDocument.TryGetProperty("pages", out var pages) &&
            pages.ValueKind == JsonValueKind.Array)
        {
            foreach (var pageJson in pages.EnumerateArray())
            {
                try
                {
                    var page =
                        JsonSerializer.Deserialize<MovementPageModel>(
                            pageJson.GetRawText(),
                            _json);

                    if (page is not null &&
                        !string.IsNullOrWhiteSpace(page.Id))
                        movements[page.Id] =
                            page;
                }
                catch (JsonException ex)
                {
                    _log.LogWarning(
                        ex,
                        "Timetable skipped invalid Movement definition");
                }
            }
        }

        var entries =
            new List<TimetableEntry>();

        if (root.TryGetProperty("timetable", out var rawEntries) &&
            rawEntries.ValueKind == JsonValueKind.Array)
        {
            foreach (var entry in rawEntries.EnumerateArray())
            {
                var id =
                    entry.TryGetProperty("id", out var idElement) &&
                    idElement.ValueKind == JsonValueKind.String
                        ? idElement.GetString() ?? ""
                        : "";

                var enabled =
                    !entry.TryGetProperty("enabled", out var enabledElement) ||
                    enabledElement.ValueKind != JsonValueKind.False;

                var cron =
                    entry.TryGetProperty("cron", out var cronElement) &&
                    cronElement.ValueKind == JsonValueKind.String &&
                    !string.IsNullOrWhiteSpace(
                        cronElement.GetString())
                        ? cronElement.GetString()!.Trim()
                        : "0 *";

                var actions =
                    new List<TimetableAction>();

                if (entry.TryGetProperty("actions", out var rawActions) &&
                    rawActions.ValueKind == JsonValueKind.Array)
                {
                    foreach (var action in rawActions.EnumerateArray())
                    {
                        var actionId =
                            action.TryGetProperty("id", out var actionIdElement) &&
                            actionIdElement.ValueKind == JsonValueKind.String
                                ? actionIdElement.GetString() ?? ""
                                : "";

                        var targetType =
                            action.TryGetProperty("targetType", out var typeElement) &&
                            typeElement.ValueKind == JsonValueKind.String
                                ? typeElement.GetString() ?? "script"
                                : "script";

                        var targetId =
                            action.TryGetProperty("targetId", out var targetElement) &&
                            targetElement.ValueKind == JsonValueKind.String
                                ? targetElement.GetString() ?? ""
                                : "";

                        if (actionId.Length > 0 &&
                            targetId.Length > 0)
                            actions.Add(
                                new(
                                    actionId,
                                    targetType,
                                    targetId));
                    }
                }

                if (actions.Count == 0)
                {
                    var legacyTargetType =
                        entry.TryGetProperty(
                            "targetType",
                            out var legacyTypeElement) &&
                        legacyTypeElement.ValueKind ==
                            JsonValueKind.String &&
                        string.Equals(
                            legacyTypeElement.GetString(),
                            "movement",
                            StringComparison.Ordinal)
                            ? "movement"
                            : "script";

                    var legacyTargetId =
                        entry.TryGetProperty(
                            "targetId",
                            out var legacyTargetElement) &&
                        legacyTargetElement.ValueKind ==
                            JsonValueKind.String
                            ? (
                                legacyTargetElement.GetString() ??
                                ""
                              ).Trim()
                            : "";

                    if (legacyTargetId.Length == 0 &&
                        legacyTargetType == "script" &&
                        entry.TryGetProperty(
                            "scriptId",
                            out var legacyScriptElement) &&
                        legacyScriptElement.ValueKind ==
                            JsonValueKind.String)
                        legacyTargetId =
                            (
                                legacyScriptElement.GetString() ??
                                ""
                            ).Trim();

                    if (legacyTargetId.Length > 0)
                        actions.Add(
                            new(
                                "legacy:" +
                                    id,
                                legacyTargetType,
                                legacyTargetId));
                }

                if (id.Length > 0 &&
                    cron.Length > 0)
                    entries.Add(
                        new(
                            id,
                            enabled,
                            cron,
                            actions.ToArray()));
            }
        }

        return new(
            scripts,
            movements,
            entries.ToArray());
    }

    void ProcessMinute(
        long absoluteMinute)
    {
        lock (_gate)
        {
            if (_finishing)
                return;
        }

        StorageSnapshot storage;

        try
        {
            storage =
                LoadStorage();
        }
        catch (Exception ex)
        {
            _log.LogWarning(
                ex,
                "Timetable could not load automations.json");

            return;
        }

        var minuteOfDay =
            (int)(
                (
                    absoluteMinute %
                        MinutesPerDay +
                    MinutesPerDay
                ) %
                MinutesPerDay);

        var hour =
            minuteOfDay /
            60;

        var minute =
            minuteOfDay %
            60;

        foreach (var entry in storage.Entries)
        {
            if (!entry.Enabled ||
                !CronMatches(
                    entry.Cron,
                    hour,
                    minute))
                continue;

            foreach (var action in entry.Actions)
            {
                if (string.Equals(
                        action.TargetType,
                        "movement",
                        StringComparison.Ordinal))
                {
                    if (storage.Movements.TryGetValue(
                            action.TargetId,
                            out var movement))
                        LaunchMovement(
                            entry,
                            action,
                            movement,
                            hour,
                            minute,
                            minuteOfDay);

                    continue;
                }

                if (storage.Scripts.TryGetValue(
                        action.TargetId,
                        out var script))
                    LaunchScript(
                        entry,
                        action,
                        script,
                        hour,
                        minute,
                        minuteOfDay);
            }
        }
    }

    string NewRunId()
    {
        lock (_gate)
        {
            var value =
                _nextRunSequence++;

            return
                "timetable-run-" +
                value;
        }
    }

    static string FormatTime(
        int hour,
        int minute) =>
        hour.ToString("00") +
        ":" +
        minute.ToString("00");

    void LaunchMovement(
        TimetableEntry entry,
        TimetableAction action,
        MovementPageModel movement,
        int hour,
        int minute,
        int minuteOfDay)
    {
        var state =
            _movement.GetState(
                movement.Id);

        if (state.Status is
            "running" or
            "stopping")
            return;

        if (!movement.Enabled)
            return;

        var runId =
            NewRunId();

        var active =
            new TimetableActiveRunState(
                runId,
                entry.Id,
                action.Id,
                "movement",
                movement.Id,
                movement.Name,
                null,
                FormatTime(
                    hour,
                    minute),
                minuteOfDay,
                "launching",
                null);

        lock (_gate)
        {
            _activeRuns[runId] =
                active;

            _lastTriggeredAt =
                active.ScheduledTime;

            _lastTriggeredTargetName =
                movement.Name;
        }

        Publish();

        var result =
            _movement.Start(
                movement.Id);

        if (!result.Ok)
        {
            lock (_gate)
                _activeRuns.Remove(
                    runId);

            _log.LogWarning(
                "Timetable Movement {Movement} was not started: {Error}",
                movement.Name,
                result.Error);

            Publish();
            return;
        }

        lock (_gate)
            _activeRuns[runId] =
                active with
                {
                    Status =
                        "running",
                    Message =
                        _movement
                            .GetState(
                                movement.Id)
                            .Info
                };

        Publish();
    }

    void LaunchScript(
        TimetableEntry entry,
        TimetableAction action,
        ScriptDefinition script,
        int hour,
        int minute,
        int minuteOfDay)
    {
        if (string.IsNullOrWhiteSpace(
                script.Script))
            return;

        lock (_gate)
        {
            if (_activeRuns.Values.Any(run =>
                    run.TargetType == "script" &&
                    run.TargetId == script.Id))
                return;
        }

        var runId =
            NewRunId();

        var executionId =
            "timetable:" +
            runId +
            ":" +
            script.Id;

        var active =
            new TimetableActiveRunState(
                runId,
                entry.Id,
                action.Id,
                "script",
                script.Id,
                script.Name,
                executionId,
                FormatTime(
                    hour,
                    minute),
                minuteOfDay,
                "launching",
                null);

        lock (_gate)
        {
            _activeRuns[runId] =
                active;

            _lastTriggeredAt =
                active.ScheduledTime;

            _lastTriggeredTargetName =
                script.Name;
        }

        Publish();

        var result =
            _scripts.StartSaved(
                script.Id,
                executionId,
                "timetable");

        if (!result.Ok)
        {
            lock (_gate)
                _activeRuns.Remove(
                    runId);

            _log.LogWarning(
                "Timetable script {Script} was not started: {Error}",
                script.Name,
                result.Error);

            Publish();
            return;
        }

        lock (_gate)
            _activeRuns[runId] =
                active with
                {
                    Status =
                        "running",
                    Message =
                        result.State.Info
                };

        Publish();
    }

    void OnMovementChanged(
        MovementRuntimeState state)
    {
        TimetableActiveRunState? run =
            null;

        lock (_gate)
        {
            var pair =
                _activeRuns
                    .FirstOrDefault(item =>
                        item.Value.TargetType ==
                            "movement" &&
                        item.Value.TargetId ==
                            state.PageId);

            if (pair.Key is null)
                return;

            run =
                pair.Value;

            if (state.Status is
                "running" or
                "stopping")
            {
                _activeRuns[pair.Key] =
                    run with
                    {
                        Status =
                            "running",
                        Message =
                            state.Info
                    };
            }
            else
            {
                _activeRuns.Remove(
                    pair.Key);
            }
        }

        Publish();
    }

    void OnScriptChanged(
        ScriptRuntimeState state)
    {
        bool changed =
            false;

        lock (_gate)
        {
            var pair =
                _activeRuns
                    .FirstOrDefault(item =>
                        item.Value.TargetType ==
                            "script" &&
                        string.Equals(
                            item.Value.ExecutionId,
                            state.ExecutionId,
                            StringComparison.Ordinal));

            if (pair.Key is null)
                return;

            var run =
                pair.Value;

            if (state.Status is
                "running" or
                "paused")
            {
                _activeRuns[pair.Key] =
                    run with
                    {
                        Status =
                            state.Status,
                        Message =
                            state.Info
                    };

                changed =
                    true;
            }
            else
            {
                _activeRuns.Remove(
                    pair.Key);

                changed =
                    true;
            }
        }

        if (changed)
            Publish();
    }

    sealed record ParsedCron(
        HashSet<int> Minutes,
        HashSet<int> Hours);

    static bool CronMatches(
        string cron,
        int hour,
        int minute)
    {
        var parsed =
            ParseCron(cron);

        return parsed is not null &&
               parsed.Hours.Contains(hour) &&
               parsed.Minutes.Contains(minute);
    }

    static ParsedCron? ParseCron(
        string cron)
    {
        var fields =
            cron
                .Trim()
                .Split(
                    (char[]?)null,
                    StringSplitOptions.RemoveEmptyEntries);

        if (fields.Length != 2)
            return null;

        var minutes =
            ExpandField(
                fields[0],
                0,
                59);

        var hours =
            ExpandField(
                fields[1],
                0,
                23);

        return minutes is null ||
               hours is null
            ? null
            : new(
                minutes,
                hours);
    }

    static HashSet<int>? ExpandField(
        string field,
        int min,
        int max)
    {
        var values =
            new HashSet<int>();

        foreach (var part in field.Split(','))
        {
            var expanded =
                ExpandPart(
                    part,
                    min,
                    max);

            if (expanded is null)
                return null;

            foreach (var value in expanded)
                values.Add(value);
        }

        return values.Count > 0
            ? values
            : null;
    }

    static int[]? ExpandPart(
        string rawPart,
        int min,
        int max)
    {
        var part =
            rawPart.Trim();

        if (part.Length == 0)
            return null;

        var slash =
            part.Split('/');

        if (slash.Length > 2)
            return null;

        var basePart =
            slash[0];

        var step = 1;

        if (slash.Length == 2 &&
            (!int.TryParse(
                 slash[1],
                 out step) ||
             step < 1))
            return null;

        int start;
        int end;

        if (basePart == "*")
        {
            start = min;
            end = max;
        }
        else
        {
            var range =
                basePart.Split('-');

            if (range.Length == 1)
            {
                if (!int.TryParse(
                        range[0],
                        out start) ||
                    start < min ||
                    start > max)
                    return null;

                end =
                    slash.Length == 1
                        ? start
                        : max;
            }
            else if (range.Length == 2)
            {
                if (!int.TryParse(
                        range[0],
                        out start) ||
                    !int.TryParse(
                        range[1],
                        out end) ||
                    start < min ||
                    end > max ||
                    start > end)
                    return null;
            }
            else
            {
                return null;
            }
        }

        var result =
            new List<int>();

        for (
            var value = start;
            value <= end;
            value += step)
            result.Add(value);

        return result.ToArray();
    }
}
