using System.Net;
using System.Text;
using System.Text.Json;
using WatsonWebserver;
using WatsonWebserver.Core;
using WatsonWebserver.Core.WebSockets;
using WatsonHttpMethod = WatsonWebserver.Core.HttpMethod;

namespace DCCExpressHub.Net.Web;

/// <summary>
/// Watson 7 HTTP/WebSocket host adapter.
///
/// All application behavior lives in transport-neutral API/runtime services.
/// This class only translates Watson requests and responses.
/// </summary>
public sealed partial class WatsonWebServerService :
    IHostedService,
    IDisposable
{
    static readonly JsonSerializerOptions Json =
        new(
            JsonSerializerDefaults.Web);

    readonly IServiceProvider _services;
    readonly AppPaths _paths;
    readonly IConfiguration _configuration;
    readonly ILogger<WatsonWebServerService> _logger;

    Webserver? _server;

    public WatsonWebServerService(
        IServiceProvider services,
        AppPaths paths,
        IConfiguration configuration,
        ILogger<WatsonWebServerService> logger)
    {
        _services =
            services;

        _paths =
            paths;

        _configuration =
            configuration;

        _logger =
            logger;
    }

    public Task StartAsync(
        CancellationToken cancellationToken)
    {
        var endpoint =
            ResolveEndpoint();

        var settings =
            new WebserverSettings(
                endpoint.Host,
                endpoint.Port);

        settings.Protocols.EnableHttp1 =
            true;

        settings.Protocols.EnableHttp2 =
            false;

        settings.Protocols.EnableHttp3 =
            false;

        settings.IO.EnableKeepAlive =
            true;

        // File-manager audio/image uploads can be substantially larger than
        // JSON configuration payloads. Individual API services still enforce
        // their own tighter limits where appropriate.
        settings.IO.MaxRequestBodySize =
            128L * 1024L * 1024L;

        settings.WebSockets.Enable =
            true;

        settings.WebSockets.ReceiveBufferSize =
            64 * 1024;

        _server =
            new Webserver(
                settings,
                DefaultRouteAsync);

        RegisterRoutes(
            _server);

        _server.WebSocket(
            "/ws",
            HandleWebSocketAsync);

        _server.Start();

        _logger.LogInformation(
            "Watson web server listening on http://{Host}:{Port}",
            endpoint.Host,
            endpoint.Port);

        return Task.CompletedTask;
    }

    public Task StopAsync(
        CancellationToken cancellationToken)
    {
        var server =
            Interlocked.Exchange(
                ref _server,
                null);

        if (server is null)
            return Task.CompletedTask;

        try
        {
            server.Stop();
        }
        finally
        {
            server.Dispose();
        }

        return Task.CompletedTask;
    }

    public void Dispose()
    {
        var server =
            Interlocked.Exchange(
                ref _server,
                null);

        server?.Dispose();
    }


    void RegisterRoutes(
        Webserver server)
    {
        RegisterCoreRoutes(
            server);

        RegisterCommandCenterRoutes(
            server);

        RegisterConfigurationRoutes(
            server);

        RegisterFileRoutes(
            server);

        RegisterScriptInfoRoutes(
            server);

        RegisterDesktopRoutes(
            server);
    }

    void RegisterCoreRoutes(
        Webserver server)
    {
        // Preserve the old Kestrel behavior for a plain HTTP request to the
        // WebSocket path. Actual upgrade requests are handled by Watson.
        Add(
            server,
            WatsonHttpMethod.GET,
            "/ws",
            async ctx =>
            {
                ctx.Response.StatusCode =
                    400;

                await ctx.Response.Send(
                    Array.Empty<byte>(),
                    ctx.Token);
            });
    }

    async Task HandleWebSocketAsync(
        HttpContextBase ctx,
        WebSocketSession session)
    {
        await Service<WsHub>()
            .Accept(
                new WatsonWebSocketClient(
                    session),
                ctx.Token);
    }


    (string Host, int Port) ResolveEndpoint()
    {
        var raw =
            Environment.GetEnvironmentVariable(
                "DCCEXPRESS_HTTP_URL") ??
            Environment.GetEnvironmentVariable(
                "DCCEXPRESS_DESKTOP_URL");

        if (
            string.IsNullOrWhiteSpace(
                raw)
        )
        {
            raw =
                _configuration["Urls"];
        }

        if (
            string.IsNullOrWhiteSpace(
                raw)
        )
        {
            raw =
                "http://0.0.0.0:5174";
        }

        raw =
            raw.Split(
                ';',
                StringSplitOptions
                    .RemoveEmptyEntries |
                StringSplitOptions
                    .TrimEntries)
                .FirstOrDefault() ??
            "http://0.0.0.0:5174";

        if (
            !Uri.TryCreate(
                raw,
                UriKind.Absolute,
                out var uri) ||
            !string.Equals(
                uri.Scheme,
                Uri.UriSchemeHttp,
                StringComparison.OrdinalIgnoreCase)
        )
        {
            throw new InvalidOperationException(
                $"Invalid Watson listen URL: {raw}");
        }

        return (
            uri.Host,
            uri.Port
        );
    }


    T Service<T>()
        where T : notnull =>
        _services
            .GetRequiredService<T>();


    static void Add(
        Webserver server,
        WatsonHttpMethod method,
        string path,
        Func<HttpContextBase, Task> handler) =>
        server.Routes
            .PreAuthentication
            .Static
            .Add(
                method,
                path,
                handler);
}
