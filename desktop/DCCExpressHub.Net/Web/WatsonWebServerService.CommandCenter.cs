using WatsonWebserver;
using WatsonWebserver.Core;
using WatsonHttpMethod = WatsonWebserver.Core.HttpMethod;

namespace DCCExpressHub.Net.Web;

public sealed partial class WatsonWebServerService
{
    void RegisterCommandCenterRoutes(
        Webserver server)
    {
        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/command-center-config",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<CommandCenterApi>()
                        .GetConfig());
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/command-center-config",
            SaveCommandCenterConfigAsync);

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/command-center-test",
            TestCommandCenterAsync);

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/command-center-loconet-test",
            TestCommandCenterLocoNetAsync);

        Add(server, WatsonHttpMethod.GET, "/api/loconet-serial-config",
            async ctx => await SendAsync(ctx,
                Service<CommandCenterApi>().GetLocoNetSerialSettings()));
        Add(server, WatsonHttpMethod.POST, "/api/loconet-serial-config",
            SaveLocoNetSerialSettingsAsync);
        Add(server, WatsonHttpMethod.POST, "/api/loconet-serial-test",
            TestLocoNetSerialSettingsAsync);

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/command-center-info",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<CommandCenterApi>()
                        .GetInfo());
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/capabilities",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<CommandCenterApi>()
                        .GetCapabilities());
            });
    }

    async Task SaveLocoNetSerialSettingsAsync(HttpContextBase ctx)
    {
        if (!IsUrlEncodedForm(ctx))
        {
            await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Missing form data" }));
            return;
        }
        var form = await ReadUrlEncodedFormAsync(ctx);
        if (!int.TryParse(Get(form, "baudRate"), out var baudRate))
        {
            await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Invalid baud rate" }));
            return;
        }
        await SendAsync(ctx, Service<CommandCenterApi>().SaveLocoNetSerialSettings(
            Get(form, "enabled") == "true", Get(form, "port"), baudRate));
    }

    async Task TestLocoNetSerialSettingsAsync(HttpContextBase ctx)
    {
        if (!IsUrlEncodedForm(ctx))
        {
            await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Missing form data" }));
            return;
        }
        var form = await ReadUrlEncodedFormAsync(ctx);
        if (!int.TryParse(Get(form, "baudRate"), out var baudRate))
        {
            await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Invalid baud rate" }));
            return;
        }
        await SendAsync(ctx, await Service<CommandCenterApi>()
            .TestLocoNetSerialSettingsAsync(Get(form, "port"), baudRate));
    }

    async Task SaveCommandCenterConfigAsync(
        HttpContextBase ctx)
    {
        if (!IsUrlEncodedForm(ctx))
        {
            await SendAsync(
                ctx,
                HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            "Missing command-center settings"
                    }));

            return;
        }

        var form =
            await ReadUrlEncodedFormAsync(
                ctx);

        var response =
            await Service<CommandCenterApi>()
                .SaveConfigAsync(
                    new CommandCenterConfigRequest(
                        Host:
                            Get(
                                form,
                                "host"),
                        Port:
                            Get(
                                form,
                                "port"),
                        SerialPort:
                            Get(
                                form,
                                "serialPort"),
                        PowerIncludesProgramming:
                            Optional(
                                form,
                                "powerIncludesProgramming"),
                        CommandIntervalMs:
                            Optional(
                                form,
                                "commandIntervalMs"),
                        RBusOffset:
                            Optional(
                                form,
                                "rBusOffset")),
                    ctx.Token);

        await SendAsync(
            ctx,
            response);
    }


    async Task TestCommandCenterAsync(
        HttpContextBase ctx)
    {
        if (!IsUrlEncodedForm(ctx))
        {
            await SendAsync(
                ctx,
                HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            "Invalid host"
                    }));

            return;
        }

        var form =
            await ReadUrlEncodedFormAsync(
                ctx);

        await SendAsync(
            ctx,
            await Service<CommandCenterApi>()
                .TestAsync(
                    new CommandCenterTestRequest(
                        Host:
                            Get(
                                form,
                                "host"),
                        Port:
                            Get(
                                form,
                                "port")),
                    ctx.Token));
    }

    async Task TestCommandCenterLocoNetAsync(
        HttpContextBase ctx)
    {
        if (!IsUrlEncodedForm(ctx))
        {
            await SendAsync(
                ctx,
                HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            "Invalid host"
                    }));

            return;
        }

        var form =
            await ReadUrlEncodedFormAsync(
                ctx);

        await SendAsync(
            ctx,
            await Service<CommandCenterApi>()
                .TestLocoNetAsync(
                    new CommandCenterLocoNetTestRequest(
                        Host:
                            Get(
                                form,
                                "host")),
                    ctx.Token));
    }



}
