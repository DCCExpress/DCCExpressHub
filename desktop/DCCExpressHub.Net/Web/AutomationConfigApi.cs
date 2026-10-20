using System.Text.Json;

namespace DCCExpressHub.Net.Web;

public sealed class AutomationConfigApi
{
    const int MaxBytes =
        512 * 1024;

    readonly AppPaths _paths;
    readonly AutomationStorageCoordinator _storage;

    public AutomationConfigApi(
        AppPaths paths,
        AutomationStorageCoordinator storage)
    {
        _paths = paths;
        _storage = storage;
    }

    string ConfigFile(
        string name) =>
        Path.Combine(
            _paths.ConfigRootPath,
            name);

    public async Task<HubApiResponse> GetAsync(
        CancellationToken cancellationToken = default)
    {
        var path =
            ConfigFile(
                "automations.json");

        if (!File.Exists(path))
        {
            return HubApiResponse.Ok(
                new
                {
                    version = 1,
                    scripts =
                        Array.Empty<object>()
                });
        }

        return HubApiResponse.Text(
            await File.ReadAllTextAsync(
                path,
                cancellationToken),
            "application/json");
    }

    public async Task<HubApiResponse> GetPreviousAsync(
        CancellationToken cancellationToken = default)
    {
        var path =
            ConfigFile(
                "automations.json.previous");

        if (!File.Exists(path))
        {
            return HubApiResponse.Error(
                404,
                new
                {
                    ok = false,
                    message =
                        "No previous automation snapshot"
                });
        }

        return HubApiResponse.Text(
            await File.ReadAllTextAsync(
                path,
                cancellationToken),
            "application/json");
    }

    public async Task<HubApiResponse> SaveAsync(
        Stream input,
        long? declaredLength,
        CancellationToken cancellationToken)
    {
        if (
            declaredLength is > MaxBytes
        )
        {
            return TooLarge();
        }

        using var memory =
            new MemoryStream();

        await input.CopyToAsync(
            memory,
            cancellationToken);

        if (
            memory.Length > MaxBytes
        )
        {
            return TooLarge();
        }

        JsonDocument document;

        try
        {
            memory.Position = 0;

            document =
                await JsonDocument.ParseAsync(
                    memory,
                    cancellationToken:
                        cancellationToken);
        }
        catch (JsonException)
        {
            return HubApiResponse.Error(
                400,
                new
                {
                    ok = false,
                    message =
                        "Invalid automation JSON"
                });
        }

        using (document)
        {
            var root =
                document.RootElement;

            if (
                root.ValueKind !=
                    JsonValueKind.Object
            )
            {
                return Invalid(
                    "Automation root must be an object");
            }

            if (
                !root.TryGetProperty(
                    "version",
                    out var version) ||
                version.ValueKind !=
                    JsonValueKind.Number ||
                !version.TryGetInt32(
                    out var versionNumber) ||
                versionNumber != 1
            )
            {
                return Invalid(
                    "Unsupported automation storage version");
            }

            if (
                !root.TryGetProperty(
                    "scripts",
                    out var scripts) ||
                scripts.ValueKind !=
                    JsonValueKind.Array
            )
            {
                return Invalid(
                    "Automation scripts must be an array");
            }

            foreach (
                var script in
                    scripts.EnumerateArray()
            )
            {
                if (
                    script.ValueKind !=
                        JsonValueKind.Object
                )
                {
                    return Invalid(
                        "Automation script entry must be an object");
                }

                if (
                    !script.TryGetProperty(
                        "id",
                        out var id) ||
                    id.ValueKind !=
                        JsonValueKind.String ||
                    !script.TryGetProperty(
                        "name",
                        out var name) ||
                    name.ValueKind !=
                        JsonValueKind.String ||
                    !script.TryGetProperty(
                        "script",
                        out var code) ||
                    code.ValueKind !=
                        JsonValueKind.String
                )
                {
                    return Invalid(
                        "Automation script requires id, name and script strings");
                }

                var idValue =
                    id.GetString() ?? "";

                var nameValue =
                    name.GetString() ?? "";

                if (
                    idValue.Length == 0 ||
                    idValue.Length > 160
                )
                {
                    return Invalid(
                        "Automation id is invalid");
                }

                if (
                    nameValue.Length == 0 ||
                    nameValue.Length > 160
                )
                {
                    return Invalid(
                        "Automation name is invalid");
                }
            }
        }

        return await _storage
            .ExecuteAsync(
                async () =>
                {
                    var finalPath =
                        ConfigFile(
                            "automations.json");

                    var tempPath =
                        finalPath +
                        ".tmp";

                    try
                    {
                        Directory.CreateDirectory(
                            Path.GetDirectoryName(
                                finalPath)!);

                        memory.Position = 0;

                        await using (
                            var output =
                                new FileStream(
                                    tempPath,
                                    FileMode.Create,
                                    FileAccess.Write,
                                    FileShare.None,
                                    81920,
                                    FileOptions.Asynchronous |
                                    FileOptions.WriteThrough)
                        )
                        {
                            await memory.CopyToAsync(
                                output,
                                cancellationToken);

                            await output.FlushAsync(
                                cancellationToken);
                        }

                        var previousPath =
                            ConfigFile(
                                "automations.json.previous");

                        if (
                            File.Exists(
                                finalPath)
                        )
                        {
                            File.Copy(
                                finalPath,
                                previousPath,
                                true);
                        }

                        File.Move(
                            tempPath,
                            finalPath,
                            true);

                        return HubApiResponse.Ok(
                            new
                            {
                                ok = true,
                                bytes =
                                    memory.Length
                            });
                    }
                    catch
                    {
                        try
                        {
                            if (
                                File.Exists(
                                    tempPath)
                            )
                            {
                                File.Delete(
                                    tempPath);
                            }
                        }
                        catch
                        {
                        }

                        return HubApiResponse.Error(
                            500,
                            new
                            {
                                ok = false,
                                message =
                                    "Automation atomic rename failed"
                            });
                    }
                },
                cancellationToken);
    }

    static HubApiResponse TooLarge() =>
        HubApiResponse.Error(
            413,
            new
            {
                ok = false,
                message =
                    "Automation storage exceeds 512 KB"
            });

    static HubApiResponse Invalid(
        string message) =>
        HubApiResponse.Error(
            400,
            new
            {
                ok = false,
                message
            });
}
