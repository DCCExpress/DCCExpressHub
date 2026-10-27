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
                "{\\\"status\\\":\\\"ok\\\",\\\"application\\\":\\\"DCCExpressHub V2\\\"}", ctx.Token);
            return;
        }

        if (ctx.Request.Method != WatsonWebserver.Core.HttpMethod.GET)
        {
            ctx.Response.StatusCode = 405;
            await ctx.Response.Send("Method not allowed", ctx.Token);
            return;
        }

        var relative = (path == "/" ? "index.html" : path.TrimStart('/'))
            .Replace('/', Path.DirectorySeparatorChar);
        var root = Path.GetFullPath(_webRoot) + Path.DirectorySeparatorChar;
        var file = Path.GetFullPath(Path.Combine(_webRoot, relative));
        if (!file.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        {
            ctx.Response.StatusCode = 403;
            await ctx.Response.Send("Forbidden", ctx.Token);
            return;
        }

        if (!File.Exists(file))
        {
            ctx.Response.StatusCode = 404;
            await ctx.Response.Send("Not found", ctx.Token);
            return;
        }

        ctx.Response.ContentType = Path.GetExtension(file).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".js" => "text/javascript; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".json" => "application/json",
            ".svg" => "image/svg+xml",
            ".png" => "image/png",
            ".ico" => "image/x-icon",
            ".woff2" => "font/woff2",
            _ => "application/octet-stream"
        };
        await ctx.Response.Send(await File.ReadAllBytesAsync(file), ctx.Token);
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
