using WatsonWebserver;
using WatsonWebserver.Core;
using WatsonHttpMethod = WatsonWebserver.Core.HttpMethod;

namespace DCCExpressHub.Net.Web;

public sealed partial class WatsonWebServerService
{
    private void RegisterCommandCenterStartupRoutes(Webserver server)
    {
        Add(server, WatsonHttpMethod.GET, "/api/command-center/startup",
            async ctx => await SendAsync(ctx, Service<CommandCenterStartupApi>().Get()));

        Add(server, WatsonHttpMethod.POST, "/api/command-center/startup/start",
            async ctx =>
            {
                if (!IsUrlEncodedForm(ctx))
                {
                    await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Form data required." }));
                    return;
                }
                var form = await ReadUrlEncodedFormAsync(ctx);
                await SendAsync(ctx, await Service<CommandCenterStartupApi>()
                    .StartAsync(ReadStartupProfile(form), ctx.Token));
            });

        Add(server, WatsonHttpMethod.POST, "/api/command-center/startup/stop",
            async ctx => await SendAsync(ctx, await Service<CommandCenterStartupApi>().StopAsync(ctx.Token)));

        Add(server, WatsonHttpMethod.POST, "/api/command-center/startup/test",
            async ctx =>
            {
                if (!IsUrlEncodedForm(ctx))
                {
                    await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Form data required." }));
                    return;
                }
                var form = await ReadUrlEncodedFormAsync(ctx);
                await SendAsync(ctx, await Service<CommandCenterStartupApi>()
                    .TestAsync(ReadStartupProfile(form),
                        string.Equals(Get(form, "kind"), "loconet", StringComparison.OrdinalIgnoreCase),
                        ctx.Token));
            });
    }

    private static CommandCenterStartupRequest ReadStartupProfile(
        Dictionary<string, string> form)
    {
        static int Parse(string text) => int.TryParse(text, out var value) ? value : -1;

        return new CommandCenterStartupRequest(
            Vendor: Get(form, "vendor"),
            Transport: Get(form, "transport"),
            Host: Get(form, "host"),
            Port: Parse(Get(form, "port")),
            SerialPort: Get(form, "serialPort"),
            RBusOffset: Parse(Get(form, "rBusOffset")),
            LocoNetOffset: Parse(Get(form, "locoNetOffset")),
            UseLocoNet: string.Equals(Get(form, "useLocoNet"), "true", StringComparison.OrdinalIgnoreCase),
            CommandIntervalMs: Parse(Get(form, "commandIntervalMs")));
    }
}
