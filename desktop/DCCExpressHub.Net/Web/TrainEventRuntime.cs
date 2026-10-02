using System.Text.Json;

namespace DCCExpressHub.Net.Web;

public sealed record TrainEventPayload(
    string Id,
    long Timestamp,
    string Source,
    string? MovementId,
    string? MovementName,
    string? LocoId,
    int LocoAddress,
    string? LocoName,
    string? TrainType,
    string Direction,
    string Event,
    string ResourceType,
    string ResourceKey,
    object? ResourceId,
    string ResourceName,
    string ResourceLabel,
    int? SensorAddress,
    int[] Sensors);

public sealed class TrainEventRuntime
{
    readonly IWebHostEnvironment _env;
    readonly ILogger<TrainEventRuntime> _log;

    public event Action<TrainEventPayload>? Changed;

    public TrainEventRuntime(
        IWebHostEnvironment env,
        ILogger<TrainEventRuntime> log)
    {
        _env = env;
        _log = log;
    }

    sealed record LocoMeta(
        string? Id,
        string? Name,
        string? TrainType);

    LocoMeta LoadLocoMeta(
        int address)
    {
        var path = Path.Combine(
            _env.ContentRootPath,
            "data",
            "config",
            "locos.json");

        if (!File.Exists(path))
            return new(null, null, null);

        try
        {
            using var doc =
                JsonDocument.Parse(
                    File.ReadAllText(path));

            if (doc.RootElement.ValueKind !=
                JsonValueKind.Array)
                return new(null, null, null);

            foreach (var item in
                     doc.RootElement.EnumerateArray())
            {
                if (!item.TryGetProperty(
                        "address",
                        out var addressElement) ||
                    !addressElement.TryGetInt32(
                        out var currentAddress) ||
                    currentAddress != address)
                    continue;

                string? StringProperty(
                    string name) =>
                    item.TryGetProperty(
                        name,
                        out var value) &&
                    value.ValueKind ==
                        JsonValueKind.String
                        ? value.GetString()
                        : null;

                return new(
                    StringProperty("id"),
                    StringProperty("name"),
                    StringProperty("trainType"));
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(
                ex,
                "TrainEvent locomotive metadata could not be loaded for #{Address}",
                address);
        }

        return new(null, null, null);
    }

    static string NewId() =>
        "train-" +
        Guid.NewGuid()
            .ToString("N");

    public TrainEventPayload PublishMovement(
        MovementRuntimeState state,
        MovementPlanResourceModel resource,
        string eventName)
    {
        var locoAddress =
            state.LocoAddress ?? 0;

        var meta =
            LoadLocoMeta(
                locoAddress);

        var sensors =
            (
                resource.SensorAddress is >= 1 and <= 65535
                    ? new[]
                    {
                        resource.SensorAddress.Value
                    }
                    : Array.Empty<int>()
            )
            .Concat(
                resource.Detectors ??
                [])
            .Where(value =>
                value is >= 1 and <= 65535)
            .Distinct()
            .ToArray();

        object? resourceId =
            resource.BlockId ??
            (object?)resource.Key;

        var payload =
            new TrainEventPayload(
                NewId(),
                DateTimeOffset.UtcNow
                    .ToUnixTimeMilliseconds(),
                "movement",
                state.PageId,
                state.MovementName,
                meta.Id,
                locoAddress,
                meta.Name,
                meta.TrainType,
                state.Direction ??
                    "unknown",
                eventName,
                resource.Kind,
                resource.Key,
                resourceId,
                resource.Name,
                resource.Label,
                resource.SensorAddress,
                sensors);

        Changed?.Invoke(
            payload);

        return payload;
    }
}
