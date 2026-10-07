using System.Text.Json;
using WatsonWebserver;
using WatsonWebserver.Core;
using WatsonHttpMethod = WatsonWebserver.Core.HttpMethod;

namespace DCCExpressHub.Net.Web;

public sealed partial class WatsonWebServerService
{
    void RegisterScriptInfoRoutes(
        Webserver server)
    {
        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/script-info",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<ScriptInfoApi>()
                        .Get());
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/api/script-info",
            async ctx =>
            {
                using var input =
                    await ReadBodyStreamAsync(
                        ctx);

                await SendAsync(
                    ctx,
                    await Service<ScriptInfoApi>()
                        .UpdateAsync(
                            input,
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/script-info/events",
            ScriptInfoEventsAsync);
    }

    void RegisterDesktopRoutes(
        Webserver server)
    {
        Add(
            server,
            WatsonHttpMethod.POST,
            DesktopControlApi.PowerOffPath,
            DesktopPowerOffAsync);

        Add(
            server,
            WatsonHttpMethod.POST,
            DesktopControlApi.ShutdownPath,
            DesktopShutdownAsync);
    }

    async Task ScriptInfoEventsAsync(
        HttpContextBase ctx)
    {
        var api =
            Service<ScriptInfoApi>();

        var subscription =
            api.Subscribe();

        ctx.Response.StatusCode =
            200;

        ctx.Response.ContentType =
            "text/event-stream";

        ctx.Response.Headers[
            "Cache-Control"] =
            "no-store";

        ctx.Response.Headers[
            "Connection"] =
            "keep-alive";

        ctx.Response.ServerSentEvents =
            true;

        try
        {
            await foreach (
                var evt in
                    subscription.Reader
                        .ReadAllAsync(
                            ctx.Token)
            )
            {
                var data =
                    evt.Data is null
                        ? "null"
                        : JsonSerializer.Serialize(
                            evt.Data,
                            evt.Data.GetType(),
                            Json);

                await ctx.Response
                    .SendEvent(
                        new ServerSentEvent
                        {
                            Event =
                                evt.EventName,
                            Data =
                                data
                        },
                        false,
                        ctx.Token);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (IOException)
        {
        }
        finally
        {
            api.Unsubscribe(
                subscription.Id);
        }
    }


    async Task DesktopPowerOffAsync(
        HttpContextBase ctx)
    {
        var api =
            Service<DesktopControlApi>();

        if (!Authorized(
                ctx,
                api))
        {
            await HiddenDesktopEndpointAsync(
                ctx);

            return;
        }

        await SendAsync(
            ctx,
            await api.PowerOffAsync(
                ctx.Token));
    }


    async Task DesktopShutdownAsync(
        HttpContextBase ctx)
    {
        var api =
            Service<DesktopControlApi>();

        if (!Authorized(
                ctx,
                api))
        {
            await HiddenDesktopEndpointAsync(
                ctx);

            return;
        }

        await SendAsync(
            ctx,
            api.ShutdownResponse());

        api.RequestShutdown();
    }


    bool Authorized(
        HttpContextBase ctx,
        DesktopControlApi api) =>
        api.IsAuthorized(
            ctx.Request.Source.IpAddress,
            ctx.Request.RetrieveHeaderValue(
                DesktopControlApi.TokenHeader));


    static async Task HiddenDesktopEndpointAsync(
        HttpContextBase ctx)
    {
        ctx.Response.StatusCode =
            404;

        await ctx.Response.Send(
            Array.Empty<byte>(),
            ctx.Token);
    }


}
