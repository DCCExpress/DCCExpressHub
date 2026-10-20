using System.Text.Json;

namespace DCCExpressHub.Net.Web;

public sealed class DeviceConfigApi
{
    const int MaxBytes =
        256 * 1024;

    readonly AppPaths _paths;

    public DeviceConfigApi(
        AppPaths paths)
    {
        _paths = paths;
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
                "device-config.json");

        return HubApiResponse.Text(
            File.Exists(path)
                ? await File.ReadAllTextAsync(
                    path,
                    cancellationToken)
                : "{\"version\":1,\"devices\":[]}",
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
        catch
        {
            return Invalid(
                "Invalid device configuration JSON");
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
                    "Invalid device configuration JSON");
            }

            if (
                !root.TryGetProperty(
                    "version",
                    out var version) ||
                !version.TryGetInt32(
                    out var versionNumber) ||
                versionNumber != 1
            )
            {
                return Invalid(
                    "Unsupported device configuration version");
            }

            if (
                !root.TryGetProperty(
                    "devices",
                    out var devices) ||
                devices.ValueKind !=
                    JsonValueKind.Array
            )
            {
                return Invalid(
                    "Device configuration requires a devices array");
            }

            var ids =
                new HashSet<string>(
                    StringComparer.Ordinal);

            var addresses =
                new HashSet<int>();

            var ranges =
                new List<(
                    int First,
                    int Last)>();

            var s88Count =
                0;

            foreach (
                var device in
                    devices.EnumerateArray()
            )
            {
                if (
                    device.ValueKind !=
                        JsonValueKind.Object ||
                    !device.TryGetProperty(
                        "id",
                        out var idElement) ||
                    idElement.ValueKind !=
                        JsonValueKind.String ||
                    !device.TryGetProperty(
                        "name",
                        out var nameElement) ||
                    nameElement.ValueKind !=
                        JsonValueKind.String ||
                    !device.TryGetProperty(
                        "type",
                        out var typeElement) ||
                    typeElement.ValueKind !=
                        JsonValueKind.String
                )
                {
                    return Invalid(
                        "Every device requires id, name and type");
                }

                var id =
                    idElement.GetString() ?? "";

                var name =
                    nameElement.GetString() ?? "";

                var type =
                    typeElement.GetString() ?? "";

                if (
                    id.Length == 0 ||
                    name.Length == 0 ||
                    type.Length == 0
                )
                {
                    return Invalid(
                        "Every device requires id, name and type");
                }

                if (!ids.Add(id))
                {
                    return Invalid(
                        "Device IDs must be unique");
                }

                if (
                    !device.TryGetProperty(
                        "enabled",
                        out var enabledElement) ||
                    (
                        enabledElement.ValueKind !=
                            JsonValueKind.True &&
                        enabledElement.ValueKind !=
                            JsonValueKind.False
                    ) ||
                    !device.TryGetProperty(
                        "address",
                        out var addressElement) ||
                    !addressElement.TryGetInt32(
                        out var address)
                )
                {
                    return Invalid(
                        "Device configuration contains invalid required fields");
                }

                var enabled =
                    enabledElement.GetBoolean();

                var s88 =
                    type == "s88adapter";

                var pca =
                    type == "pca9685";

                var legacy =
                    pca ||
                    type == "mcp23017" ||
                    type == "pcf8574" ||
                    type == "pcf8575";

                if (
                    !s88 &&
                    !legacy
                )
                {
                    return Invalid(
                        $"Unsupported device type: {type}");
                }

                if (
                    address < 0x08 ||
                    address > 0x77
                )
                {
                    return Invalid(
                        "I2C address must be between 0x08 and 0x77");
                }

                if (
                    enabled &&
                    !addresses.Add(
                        address)
                )
                {
                    return Invalid(
                        "Enabled devices cannot share the same I2C address");
                }

                if (s88)
                {
                    if (
                        ++s88Count > 1
                    )
                    {
                        return Invalid(
                            "Only one S88 adapter is currently supported");
                    }

                    continue;
                }

                if (
                    !device.TryGetProperty(
                        "firstVpin",
                        out var firstVpinElement) ||
                    !firstVpinElement.TryGetInt32(
                        out var first) ||
                    !device.TryGetProperty(
                        "pinCount",
                        out var pinCountElement) ||
                    !pinCountElement.TryGetInt32(
                        out var count)
                )
                {
                    return Invalid(
                        "HAL device requires firstVpin and pinCount");
                }

                var expected =
                    type == "pcf8574"
                        ? 8
                        : 16;

                if (
                    first < 40 ||
                    first > 32767 ||
                    count != expected ||
                    first + count - 1 >
                        32767
                )
                {
                    return Invalid(
                        "HAL device VPIN range or pin count is invalid");
                }

                if (
                    pca &&
                    (
                        address < 0x40 ||
                        address > 0x7d
                    )
                )
                {
                    return Invalid(
                        "PCA9685 I2C address must be between 0x40 and 0x7D");
                }

                if (
                    !pca &&
                    (
                        address < 0x20 ||
                        address > 0x27
                    )
                )
                {
                    return Invalid(
                        "Configured digital I2C expander address must be between 0x20 and 0x27");
                }

                var last =
                    first +
                    count -
                    1;

                if (
                    enabled &&
                    ranges.Any(
                        range =>
                            first <=
                                range.Last &&
                            last >=
                                range.First)
                )
                {
                    return Invalid(
                        "Enabled HAL device VPIN ranges cannot overlap");
                }

                if (enabled)
                {
                    ranges.Add(
                        (
                            first,
                            last
                        ));
                }
            }
        }

        var finalPath =
            ConfigFile(
                "device-config.json");

        var temp =
            finalPath + ".tmp";

        try
        {
            memory.Position = 0;

            await using (
                var output =
                    File.Create(
                        temp)
            )
            {
                await memory.CopyToAsync(
                    output,
                    cancellationToken);

                await output.FlushAsync(
                    cancellationToken);
            }

            File.Move(
                temp,
                finalPath,
                true);

            return HubApiResponse.Ok(
                new
                {
                    ok = true,
                    bytes =
                        memory.Length,
                    s88Applied =
                        false,
                    s88Online =
                        false,
                    message =
                        "Device configuration saved; native backend does not expose an S88 I2C bus"
                });
        }
        catch
        {
            try
            {
                if (File.Exists(temp))
                    File.Delete(temp);
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
                        "Device configuration atomic rename failed"
                });
        }
    }

    static HubApiResponse TooLarge() =>
        HubApiResponse.Error(
            413,
            new
            {
                ok = false,
                message =
                    "Device configuration exceeds 256 KB"
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
