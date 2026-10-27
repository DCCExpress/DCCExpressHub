using WatsonWebserver;
using WatsonWebserver.Core;

namespace DCCExpressHub.V2.Runtime;

/// <summary>Cross-platform, embeddable V2 backend.</summary>
public sealed class HubRuntime : IAsyncDisposable
{
    private Webserver? _server;
    private readonly string _webRoot;

    public HubRuntime(string? webRoot = null)
    {
        _webRoot = Path.GetFullPath(webRoot
            ?? Path.Combine(AppContext.BaseDirectory, "wwwroot"));
    }

    public Task StartAsync(string host = "127.0.0.1", int port = 5180)
    {
        if (_server is not null)
            throw new InvalidOperationException("The Hub is already running.");

        var settings = new WebserverSettings(host, port);
        settings.Protocols.EnableHttp1 = true;
        settings.Protocols.EnableHttp2 = false;
        settings.Protocols.EnableHttp3 = false;

        var server = new Webserver(settings, HandleRequestAsync);
        server.Start();
        _server = server;
        return Task.CompletedTask;
    }

    private async Task HandleRequestAsync(HttpContextBase ctx)
    {
        var path = ctx.Request.Url.RawWithoutQuery;
        if (path == "/health")
        {
            ctx.Response.ContentType = "application/json";
            await ctx.Response.Send(
                "{\"status\":\"ok\",\"application\":\"DCCExpressHub V2\"}", ctx.Token);
            return;
        }

        if (ctx.Request.Method != WatsonWebserver.Core.HttpMethod.GET
            || (path != "/" && path != "/index.html"))
        {
            ctx.Response.StatusCode = 404;
            await ctx.Response.Send("Not found", ctx.Token);
            return;
        }

        var file = Path.Combine(_webRoot, "index.html");
        if (!File.Exists(file))
        {
            ctx.Response.StatusCode = 404;
            await ctx.Response.Send("UI not found", ctx.Token);
            return;
        }

        ctx.Response.ContentType = "text/html; charset=utf-8";
        await ctx.Response.Send(await File.ReadAllTextAsync(file), ctx.Token);
    }

    public Task StopAsync()
    {
        var server = Interlocked.Exchange(ref _server, null);
        if (server is null) return Task.CompletedTask;
        try { server.Stop(); }
        finally { server.Dispose(); }
        return Task.CompletedTask;
    }

    public async ValueTask DisposeAsync() => await StopAsync();
}
