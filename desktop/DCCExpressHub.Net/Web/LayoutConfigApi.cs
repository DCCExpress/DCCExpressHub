using System.Text;
using System.Text.Json;

namespace DCCExpressHub.Net.Web;

public sealed class LayoutConfigApi
{
    readonly AppPaths _paths;
    readonly LayoutRuntime _runtime;
    readonly SignalAutomationEngine _automation;
    readonly WsHub _ws;

    public LayoutConfigApi(
        AppPaths paths,
        LayoutRuntime runtime,
        SignalAutomationEngine automation,
        WsHub ws)
    {
        _paths = paths;
        _runtime = runtime;
        _automation = automation;
        _ws = ws;
    }

    string ConfigFile(
        string name) =>
        Path.Combine(
            _paths.ConfigRootPath,
            name);

    public async Task<HubApiResponse> GetLayoutAsync(
        CancellationToken cancellationToken = default)
    {
        var path =
            ConfigFile(
                "layout.json");

        return HubApiResponse.Text(
            File.Exists(path)
                ? await File.ReadAllTextAsync(
                    path,
                    cancellationToken)
                : "{}",
            "application/json");
    }

    public async Task<HubApiResponse> SaveLayoutAsync(
        Stream input,
        CancellationToken cancellationToken)
    {
        var finalPath =
            ConfigFile(
                "layout.json");

        var tempPath =
            finalPath +
            ".upload.tmp";

        long bytes = 0;

        try
        {
            await using (
                var output =
                    new FileStream(
                        tempPath,
                        FileMode.Create,
                        FileAccess.Write,
                        FileShare.None)
            )
            {
                await input.CopyToAsync(
                    output,
                    cancellationToken);

                bytes =
                    output.Length;
            }

            try
            {
                using var document =
                    JsonDocument.Parse(
                        await File.ReadAllTextAsync(
                            tempPath,
                            cancellationToken));

                if (
                    document.RootElement.ValueKind !=
                        JsonValueKind.Object
                )
                {
                    File.Delete(
                        tempPath);

                    return InvalidLayout();
                }
            }
            catch
            {
                if (
                    File.Exists(
                        tempPath)
                )
                {
                    File.Delete(
                        tempPath);
                }

                return InvalidLayout();
            }

            File.Move(
                tempPath,
                finalPath,
                true);

            _runtime.Rebuild();

            var signalAutomationReloaded =
                _automation.Reload();

            if (signalAutomationReloaded)
            {
                await _automation
                    .EvaluateAsync();
            }

            await _ws
                .BroadcastRuntimeSnapshot();

            return HubApiResponse.Ok(
                new
                {
                    ok = true,
                    bytes,
                    accessories =
                        _runtime.AccessoryCount,
                    sensors =
                        _runtime.SensorCount,
                    signalAutomationReloaded
                });
        }
        catch (IOException)
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
                507,
                new
                {
                    ok = false,
                    message =
                        "Layout upload failed"
                });
        }
    }

    public async Task<HubApiResponse> GetSignalLogicAsync(
        CancellationToken cancellationToken = default)
    {
        var path =
            ConfigFile(
                "signal-logic.ndjson");

        if (!File.Exists(path))
        {
            return HubApiResponse.Text(
                "Not found",
                "text/plain",
                404);
        }

        return HubApiResponse.Text(
            await File.ReadAllTextAsync(
                path,
                cancellationToken),
            "application/x-ndjson");
    }

    public async Task<HubApiResponse> SaveSignalLogicAsync(
        Stream input,
        CancellationToken cancellationToken)
    {
        var finalPath =
            ConfigFile(
                "signal-logic.ndjson");

        var temp =
            finalPath + ".tmp";

        Directory.CreateDirectory(
            Path.GetDirectoryName(
                finalPath)!);

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

        if (
            !_automation.Validate(
                body)
        )
        {
            return HubApiResponse.Error(
                400,
                new
                {
                    ok = false,
                    message =
                        "Invalid signal automation NDJSON v2"
                });
        }

        try
        {
            await File.WriteAllTextAsync(
                temp,
                body,
                cancellationToken);

            File.Move(
                temp,
                finalPath,
                true);

            if (
                !_automation.Reload()
            )
            {
                return HubApiResponse.Error(
                    500,
                    new
                    {
                        ok = false,
                        message =
                            "Signal automation committed but runtime reload failed"
                    });
            }

            // Saving only persists and reloads the rule definitions.
            // Do not evaluate signals or issue DCC accessory commands here.
            // Subsequent turnout/sensor/accessory events trigger evaluation.


            return HubApiResponse.Ok(
                new
                {
                    ok = true,
                    bytes =
                        Encoding.UTF8
                            .GetByteCount(
                                body)
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
                        "Signal automation atomic rename failed"
                });
        }
    }

    static HubApiResponse InvalidLayout() =>
        HubApiResponse.Error(
            400,
            new
            {
                ok = false,
                message =
                    "Invalid layout JSON"
            });
}
