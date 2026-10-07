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


}
