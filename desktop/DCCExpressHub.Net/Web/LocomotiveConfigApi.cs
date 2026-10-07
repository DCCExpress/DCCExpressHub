using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed class LocomotiveConfigApi
{
    readonly AppPaths _paths;
    readonly LocoCounterRuntime _counters;
    readonly ConfiguredCommandCenter _configuredCommandCenter;
    readonly LocoStorageCoordinator _locoStorage;

    public LocomotiveConfigApi(
        AppPaths paths,
        LocoCounterRuntime counters,
        ConfiguredCommandCenter configuredCommandCenter,
        LocoStorageCoordinator locoStorage)
    {
        _paths = paths;
        _counters = counters;
        _configuredCommandCenter =
            configuredCommandCenter;
        _locoStorage = locoStorage;
    }

    string ConfigFile(
        string name) =>
        Path.Combine(
            _paths.ConfigRootPath,
            name);

    public async Task<HubApiResponse> GetCountersAsync(
        CancellationToken cancellationToken = default)
    {
        var path =
            Path.Combine(
                _paths.StateRootPath,
                "loco-counters.json");

        return HubApiResponse.Text(
            File.Exists(path)
                ? await File.ReadAllTextAsync(
                    path,
                    cancellationToken)
                : "{\"version\":1,\"items\":[]}",
            "application/json");
    }

    public async Task<HubApiResponse> SaveCountersAsync(
        Stream input,
        CancellationToken cancellationToken)
    {
        JsonObject document;

        try
        {
            document =
                await JsonNode.ParseAsync(
                    input,
                    cancellationToken:
                        cancellationToken) as
                JsonObject ??
                throw new JsonException();
        }
        catch
        {
            return HubApiResponse.Error(
                400,
                new
                {
                    ok = false,
                    message =
                        "Invalid locomotive counter state"
                });
        }

        if (
            document["items"] is not
                JsonArray
        )
        {
            return HubApiResponse.Error(
                400,
                new
                {
                    ok = false,
                    message =
                        "Invalid locomotive counter state"
                });
        }

        Directory.CreateDirectory(
            _paths.StateRootPath);

        var path =
            Path.Combine(
                _paths.StateRootPath,
                "loco-counters.json");

        var temp =
            path + ".tmp";

        await File.WriteAllTextAsync(
            temp,
            document.ToJsonString(
                new JsonSerializerOptions
                {
                    WriteIndented = true
                }),
            cancellationToken);

        File.Move(
            temp,
            path,
            true);

        if (
            !_counters.ReloadConfiguration(
                false)
        )
        {
            return HubApiResponse.Error(
                500,
                new
                {
                    ok = false,
                    message =
                        "Counter state committed but runtime reload failed"
                });
        }

        return HubApiResponse.Ok(
            new
            {
                ok = true
            });
    }

    public async Task<HubApiResponse> GetLocosAsync(
        CancellationToken cancellationToken = default)
    {
        var path =
            ConfigFile(
                "locos.json");

        return HubApiResponse.Text(
            File.Exists(path)
                ? await File.ReadAllTextAsync(
                    path,
                    cancellationToken)
                : "[]",
            "application/json");
    }

    public async Task<HubApiResponse> SaveLocosAsync(
        Stream input,
        CancellationToken cancellationToken)
    {
        JsonArray incoming;

        try
        {
            incoming =
                await JsonNode.ParseAsync(
                    input,
                    cancellationToken:
                        cancellationToken) as
                JsonArray ??
                throw new JsonException();
        }
        catch
        {
            return HubApiResponse.Error(
                400,
                new
                {
                    ok = false,
                    message =
                        "Expected locomotive JSON array"
                });
        }

        var normalizedBody =
            await _locoStorage.ExecuteAsync(
                async () =>
                {
                    var path =
                        ConfigFile(
                            "locos.json");

                    if (File.Exists(path))
                    {
                        try
                        {
                            var existing =
                                JsonNode.Parse(
                                    await File.ReadAllTextAsync(
                                        path,
                                        cancellationToken)) as
                                    JsonArray;

                            if (existing is not null)
                            {
                                var calibrationById =
                                    new Dictionary<
                                        string,
                                        JsonNode?>(
                                        StringComparer.Ordinal);

                                foreach (var node in existing)
                                {
                                    if (
                                        node is not
                                            JsonObject loco
                                    )
                                    {
                                        continue;
                                    }

                                    var id =
                                        loco["id"]?
                                            .GetValue<string>();

                                    if (
                                        string.IsNullOrWhiteSpace(
                                            id) ||
                                        loco["calibration"] is null
                                    )
                                    {
                                        continue;
                                    }

                                    calibrationById[id] =
                                        loco["calibration"]!
                                            .DeepClone();
                                }

                                foreach (var node in incoming)
                                {
                                    if (
                                        node is not
                                            JsonObject loco
                                    )
                                    {
                                        continue;
                                    }

                                    var id =
                                        loco["id"]?
                                            .GetValue<string>();

                                    if (
                                        string.IsNullOrWhiteSpace(
                                            id) ||
                                        !calibrationById
                                            .TryGetValue(
                                                id,
                                                out var calibration) ||
                                        calibration is null
                                    )
                                    {
                                        continue;
                                    }

                                    loco["calibration"] =
                                        calibration.DeepClone();
                                }
                            }
                        }
                        catch
                        {
                            // Keep normal locomotive editing usable if an old
                            // file cannot be merged. The incoming document is
                            // already validated.
                        }
                    }

                    var body =
                        incoming.ToJsonString(
                            new JsonSerializerOptions
                            {
                                WriteIndented =
                                    false
                            });

                    var temp =
                        path + ".tmp";

                    await File.WriteAllTextAsync(
                        temp,
                        body,
                        cancellationToken);

                    File.Move(
                        temp,
                        path,
                        true);

                    return body;
                },
                cancellationToken);

        if (
            !_configuredCommandCenter
                .ReloadLocomotiveConfiguration()
        )
        {
            return HubApiResponse.Error(
                500,
                new
                {
                    ok = false,
                    message =
                        "Locomotive configuration committed but runtime reload failed"
                });
        }

        _counters.ReloadConfiguration(
            true);

        return HubApiResponse.Ok(
            new
            {
                ok = true,
                bytes =
                    Encoding.UTF8.GetByteCount(
                        normalizedBody)
            });
    }

    public async Task<HubApiResponse> GetFunctionBindingsAsync(
        CancellationToken cancellationToken = default)
    {
        var path =
            ConfigFile(
                "function-bindings.json");

        return HubApiResponse.Text(
            File.Exists(path)
                ? await File.ReadAllTextAsync(
                    path,
                    cancellationToken)
                : "[]",
            "application/json");
    }

    public async Task<HubApiResponse> SaveFunctionBindingsAsync(
        Stream input,
        CancellationToken cancellationToken)
    {
        string body;

        using (
            var reader =
                new StreamReader(
                    input,
                    Encoding.UTF8,
                    true,
                    leaveOpen:
                        true)
        )
        {
            body =
                await reader.ReadToEndAsync(
                    cancellationToken);
        }

        try
        {
            using var document =
                JsonDocument.Parse(
                    body);

            if (
                document.RootElement.ValueKind !=
                    JsonValueKind.Array
            )
            {
                return InvalidFunctionBindings();
            }

            var usedIds =
                new HashSet<int>();

            foreach (
                var item in
                    document.RootElement
                        .EnumerateArray()
            )
            {
                if (
                    item.ValueKind !=
                        JsonValueKind.Object ||
                    !item.TryGetProperty(
                        "id",
                        out var idElement) ||
                    !idElement.TryGetInt32(
                        out var id) ||
                    id is <= 0 or > 65535 ||
                    !usedIds.Add(
                        id) ||
                    !item.TryGetProperty(
                        "name",
                        out var nameElement) ||
                    nameElement.ValueKind !=
                        JsonValueKind.String ||
                    string.IsNullOrWhiteSpace(
                        nameElement.GetString())
                )
                {
                    return HubApiResponse.Error(
                        400,
                        new
                        {
                            ok = false,
                            message =
                                "Function bindings require unique positive numeric id and non-empty name"
                        });
                }
            }
        }
        catch
        {
            return InvalidFunctionBindings();
        }

        var path =
            ConfigFile(
                "function-bindings.json");

        var temp =
            path + ".tmp";

        await File.WriteAllTextAsync(
            temp,
            body,
            cancellationToken);

        File.Move(
            temp,
            path,
            true);

        return HubApiResponse.Ok(
            new
            {
                ok = true,
                bytes =
                    Encoding.UTF8.GetByteCount(
                        body)
            });
    }

    static HubApiResponse InvalidFunctionBindings() =>
        HubApiResponse.Error(
            400,
            new
            {
                ok = false,
                message =
                    "Expected function binding JSON array"
            });
}
