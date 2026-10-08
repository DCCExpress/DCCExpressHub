using WatsonWebserver;
using WatsonWebserver.Core;
using WatsonHttpMethod = WatsonWebserver.Core.HttpMethod;

namespace DCCExpressHub.Net.Web;

public sealed partial class WatsonWebServerService
{
    void RegisterConfigurationRoutes(
        Webserver server)
    {
        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/loco-counters",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    await Service<LocomotiveConfigApi>()
                        .GetCountersAsync(
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/loco-counters",
            async ctx =>
            {
                using var input =
                    await ReadBodyStreamAsync(
                        ctx);

                await SendAsync(
                    ctx,
                    await Service<LocomotiveConfigApi>()
                        .SaveCountersAsync(
                            input,
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/decoder-profiles",
            async ctx =>
            {
                await SendAsync(ctx,
                    await Service<LocomotiveConfigApi>()
                        .GetDecoderProfilesAsync(ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/decoder-profiles",
            async ctx =>
            {
                using var input = await ReadBodyStreamAsync(ctx);
                await SendAsync(ctx,
                    await Service<LocomotiveConfigApi>()
                        .SaveDecoderProfileAsync(input, ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/locos",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    await Service<LocomotiveConfigApi>()
                        .GetLocosAsync(
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/locos",
            async ctx =>
            {
                using var input =
                    await ReadBodyStreamAsync(
                        ctx);

                await SendAsync(
                    ctx,
                    await Service<LocomotiveConfigApi>()
                        .SaveLocosAsync(
                            input,
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/calibration",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<CalibrationApi>()
                        .Get());
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/calibration/start",
            async ctx =>
            {
                using var input =
                    await ReadBodyStreamAsync(
                        ctx);

                await SendAsync(
                    ctx,
                    await Service<CalibrationApi>()
                        .StartAsync(
                            input,
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/calibration/stop",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<CalibrationApi>()
                        .Stop());
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/calibration/abort",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<CalibrationApi>()
                        .Abort());
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/calibration/estop",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<CalibrationApi>()
                        .EmergencyStop());
            });

        Add(server, WatsonHttpMethod.GET, "/api/precision-braking",
            async ctx => await SendAsync(ctx,
                HubApiResponse.Ok(Service<PrecisionBrakingRuntime>().Snapshot())));

        Add(server, WatsonHttpMethod.POST, "/api/precision-braking/start",
            async ctx =>
            {
                using var input = await ReadBodyStreamAsync(ctx);
                try
                {
                    var request = await System.Text.Json.JsonSerializer.DeserializeAsync<
                        PrecisionBrakingRuntime.TrialRequest>(input,
                        new System.Text.Json.JsonSerializerOptions(
                            System.Text.Json.JsonSerializerDefaults.Web), ctx.Token);
                    if (request is null) throw new System.Text.Json.JsonException();
                    var result = await Service<PrecisionBrakingRuntime>().StartAsync(request);
                    await SendAsync(ctx, result.Ok
                        ? HubApiResponse.Ok(Service<PrecisionBrakingRuntime>().Snapshot())
                        : HubApiResponse.Error(409, new { ok = false, message = result.Error }));
                }
                catch (System.Text.Json.JsonException)
                {
                    await SendAsync(ctx, HubApiResponse.Error(400,
                        new { ok = false, message = "invalid_braking_request" }));
                }
            });

        Add(server, WatsonHttpMethod.POST, "/api/precision-braking/measure",
            async ctx =>
            {
                using var input = await ReadBodyStreamAsync(ctx);
                try
                {
                    var measurement = await System.Text.Json.JsonSerializer.DeserializeAsync<
                        PrecisionBrakingRuntime.TrialMeasurement>(input,
                        new System.Text.Json.JsonSerializerOptions(
                            System.Text.Json.JsonSerializerDefaults.Web), ctx.Token);
                    if (measurement is null) throw new System.Text.Json.JsonException();
                    var result = await Service<PrecisionBrakingRuntime>().RecordAsync(measurement);
                    await SendAsync(ctx, result.Ok
                        ? HubApiResponse.Ok(Service<PrecisionBrakingRuntime>().Snapshot())
                        : HubApiResponse.Error(409, new { ok = false, message = result.Error }));
                }
                catch (System.Text.Json.JsonException)
                {
                    await SendAsync(ctx, HubApiResponse.Error(400,
                        new { ok = false, message = "invalid_braking_measurement" }));
                }
            });

        Add(server, WatsonHttpMethod.POST, "/api/precision-braking/reset",
            async ctx =>
            {
                using var input = await ReadBodyStreamAsync(ctx);
                try
                {
                    using var document = await System.Text.Json.JsonDocument.ParseAsync(
                        input, cancellationToken: ctx.Token);
                    if (!document.RootElement.TryGetProperty("locoId", out var idElement)
                        || idElement.ValueKind != System.Text.Json.JsonValueKind.String)
                        throw new System.Text.Json.JsonException();
                    var result = await Service<PrecisionBrakingRuntime>()
                        .ResetProfileAsync(idElement.GetString() ?? "");
                    await SendAsync(ctx, result.Ok
                        ? HubApiResponse.Ok(Service<PrecisionBrakingRuntime>().Snapshot())
                        : HubApiResponse.Error(409,
                            new { ok = false, message = result.Error }));
                }
                catch (System.Text.Json.JsonException)
                {
                    await SendAsync(ctx, HubApiResponse.Error(400,
                        new { ok = false, message = "invalid_braking_reset_request" }));
                }
            });

        Add(server, WatsonHttpMethod.POST, "/api/precision-braking/stop",
            async ctx =>
            {
                await Service<PrecisionBrakingRuntime>().StopAsync();
                await SendAsync(ctx, HubApiResponse.Ok(
                    Service<PrecisionBrakingRuntime>().Snapshot()));
            });

        Add(server, WatsonHttpMethod.POST, "/api/precision-braking/estop",
            async ctx =>
            {
                await Service<PrecisionBrakingRuntime>().EmergencyStopAsync();
                await SendAsync(ctx, HubApiResponse.Ok(
                    Service<PrecisionBrakingRuntime>().Snapshot()));
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/function-bindings",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    await Service<LocomotiveConfigApi>()
                        .GetFunctionBindingsAsync(
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/function-bindings",
            async ctx =>
            {
                using var input =
                    await ReadBodyStreamAsync(
                        ctx);

                await SendAsync(
                    ctx,
                    await Service<LocomotiveConfigApi>()
                        .SaveFunctionBindingsAsync(
                            input,
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/layout",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    await Service<LayoutConfigApi>()
                        .GetLayoutAsync(
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/layout",
            async ctx =>
            {
                using var input =
                    await ReadBodyStreamAsync(
                        ctx);

                await SendAsync(
                    ctx,
                    await Service<LayoutConfigApi>()
                        .SaveLayoutAsync(
                            input,
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/version.json",
            VersionAsync);

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/automations",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    await Service<AutomationConfigApi>()
                        .GetAsync(
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/automations/previous",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    await Service<AutomationConfigApi>()
                        .GetPreviousAsync(
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/automations",
            async ctx =>
            {
                using var input =
                    await ReadBodyStreamAsync(
                        ctx);

                await SendAsync(
                    ctx,
                    await Service<AutomationConfigApi>()
                        .SaveAsync(
                            input,
                            DeclaredLength(
                                ctx),
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/signal-logic",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    await Service<LayoutConfigApi>()
                        .GetSignalLogicAsync(
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/signal-logic",
            async ctx =>
            {
                using var input =
                    await ReadBodyStreamAsync(
                        ctx);

                await SendAsync(
                    ctx,
                    await Service<LayoutConfigApi>()
                        .SaveSignalLogicAsync(
                            input,
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/runtime",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<RuntimeSystemApi>()
                        .GetRuntime());
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/status",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<RuntimeSystemApi>()
                        .GetStatus());
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/emergency-stop",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    await Service<RuntimeSystemApi>()
                        .EmergencyStopAsync(
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/device-config",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    await Service<DeviceConfigApi>()
                        .GetAsync(
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/device-config",
            async ctx =>
            {
                using var input =
                    await ReadBodyStreamAsync(
                        ctx);

                await SendAsync(
                    ctx,
                    await Service<DeviceConfigApi>()
                        .SaveAsync(
                            input,
                            DeclaredLength(
                                ctx),
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/s88-status",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<RuntimeSystemApi>()
                        .GetS88Status());
            });
    }

    async Task VersionAsync(
        HttpContextBase ctx)
    {
        var physical =
            Path.Combine(
                _paths.WebRootPath,
                "version.json");

        if (File.Exists(physical))
        {
            await SendPhysicalFileAsync(
                ctx,
                physical,
                "application/json",
                false);

            return;
        }

        await SendAsync(
            ctx,
            HubApiResponse.Ok(
                new
                {
                    version =
                        "net10-development",
                    backend =
                        "dotnet"
                }));
    }


}
