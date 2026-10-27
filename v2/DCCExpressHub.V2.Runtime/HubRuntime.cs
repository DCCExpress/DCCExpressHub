using System.Net;
using System.Text;
using Watson;

namespace DCCExpressHub.V2.Runtime;

public sealed class HubRuntime : IAsyncDisposable
{
    private WatsonServer? _server;
    private readonly string _webRoot;

    public HubRuntime(string? webRoot = null)
    {
        _webRoot = Path.GetFullPath(webRoot ??
            Path.Combine(AppContext.BaseDirectory, "wwwroot"));
    }

    public Task StartAsync(string host = "127.0.0.1", int port = 5180)
    {
        if (_server is not null)
            throw new InvalidOperationException("The Hub is already running.");

        var server = new WatsonServer(host, port);
        server.Routes.PreAuthentication.Static.Add(
            Watson.HttpMethod.GET, "/", async ctx =>
            {
                await ServeFileAsync(ctx, "index.html");
            });
        server.Routes.PreAuthentication.Static.Add(
            Watson.HttpMethod.GET, "/health", async ctx =>
            {
                ctx.Response.ContentType = "application/json";
                await ctx.Response.Send(
                    "{\"status\":\"ok\",\"application\":\"DCCExpressHub V2\"}");
            });
        server.Routes.PreAuthentication.Static.Add(
            Watson.HttpMethod.GET, "/assets/{*path}", async ctx =>
            {
                // Static file requests are handled by the configured content root.
                await ctx.Response.Send(404);
            });
        server.Start();
        _server = server;
        return Task.CompletedTask;
    }

    private async Task ServeFileAsync(HttpContextBase ctx, string name)
    {
        var file = Path.Combine(_webRoot, name);
        if (!File.Exists(file))
        {
            await ctx.Response.Send(404);
            return;
        }
        ctx.Response.ContentType = "text/html; charset=utf-8";
        await ctx.Response.Send(await File.ReadAllTextAsync(file));
    }

    public Task StopAsync()
    {
        var server = _server;
        _server = null;
        server?.Stop();
        server?.Dispose();
        return Task.CompletedTask;
    }

    public async ValueTask DisposeAsync() => await StopAsync();
}
