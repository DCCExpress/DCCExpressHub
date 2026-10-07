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
public sealed class WatsonWebServerService :
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
        // Preserve the old Kestrel behavior for a plain HTTP request to the
        // WebSocket path. Actual upgrade requests are handled by the Watson
        // WebSocket route registered in StartAsync.
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

        Add(
            server,
            WatsonHttpMethod.GET,
            "/fsinfo",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<FileManagerApi>()
                        .GetFsInfo());
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/storage/file",
            StorageFileAsync);

        Add(
            server,
            WatsonHttpMethod.GET,
            "/list",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<FileManagerApi>()
                        .List(
                            Query(
                                ctx,
                                "path")));
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/files/text",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    await Service<FileManagerApi>()
                        .ReadTextAsync(
                            Query(
                                ctx,
                                "path"),
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/upload",
            UploadAsync);

        Add(
            server,
            WatsonHttpMethod.DELETE,
            "/delete",
            DeleteAsync);

        Add(
            server,
            WatsonHttpMethod.GET,
            "/delete",
            DeleteAsync);

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

    async Task StorageFileAsync(
        HttpContextBase ctx)
    {
        var result =
            Service<FileManagerApi>()
                .GetFile(
                    Query(
                        ctx,
                        "path"));

        if (result.Error is not null)
        {
            await SendAsync(
                ctx,
                result.Error);

            return;
        }

        var file =
            result.File!;

        await SendPhysicalFileAsync(
            ctx,
            file.FilePath,
            file.ContentType,
            file.EnableRangeProcessing);
    }

    async Task UploadAsync(
        HttpContextBase ctx)
    {
        if (
            string.IsNullOrWhiteSpace(
                ctx.Request.ContentType) ||
            !ctx.Request.ContentType.StartsWith(
                "multipart/form-data",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            await SendAsync(
                ctx,
                HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            "multipart/form-data required"
                    }));

            return;
        }

        var body =
            await ctx.Request
                .ReadBodyAsync(
                    ctx.Token) ??
            Array.Empty<byte>();

        var part =
            MultipartFormData
                .TryReadFirstFile(
                    ctx.Request.ContentType,
                    body);

        if (part is null)
        {
            await SendAsync(
                ctx,
                HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            "No uploaded file received"
                    }));

            return;
        }

        using var input =
            part.OpenReadStream();

        await SendAsync(
            ctx,
            await Service<FileManagerApi>()
                .UploadAsync(
                    Query(
                        ctx,
                        "path"),
                    part.FileName,
                    input,
                    ctx.Token));
    }

    async Task DeleteAsync(
        HttpContextBase ctx)
    {
        await SendAsync(
            ctx,
            Service<FileManagerApi>()
                .Delete(
                    Query(
                        ctx,
                        "path")));
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
                    JsonSerializer.Serialize(
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

    async Task DefaultRouteAsync(
        HttpContextBase ctx)
    {
        var requestPath =
            NormalizeRequestPath(
                ctx.Request.Url
                    .RawWithoutQuery);

        if (
            requestPath.StartsWith(
                "/api/",
                StringComparison.OrdinalIgnoreCase) ||
            requestPath.Equals(
                "/api",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            await SendAsync(
                ctx,
                HubApiResponse.Error(
                    404,
                    new
                    {
                        ok = false,
                        error =
                            "api_endpoint_not_found",
                        path =
                            requestPath
                    }));

            return;
        }

        if (
            ctx.Request.Method is not
                WatsonHttpMethod.GET and not
                WatsonHttpMethod.HEAD
        )
        {
            ctx.Response.StatusCode =
                404;

            await ctx.Response.Send(
                "Not found",
                ctx.Token);

            return;
        }

        var publicFile =
            ResolvePublicFile(
                requestPath);

        if (
            publicFile is not null &&
            File.Exists(
                publicFile)
        )
        {
            await SendPhysicalFileAsync(
                ctx,
                publicFile,
                Service<HubFileStorage>()
                    .ContentType(
                        publicFile),
                true);

            return;
        }

        var index =
            Path.Combine(
                _paths.WebRootPath,
                "index.html");

        if (File.Exists(index))
        {
            await SendPhysicalFileAsync(
                ctx,
                index,
                "text/html; charset=utf-8",
                false);

            return;
        }

        ctx.Response.StatusCode =
            200;

        ctx.Response.ContentType =
            "text/plain; charset=utf-8";

        await ctx.Response.Send(
            "DCCExpressHub .NET is running. Copy the built React UI into wwwroot/.",
            ctx.Token);
    }

    async Task SendPhysicalFileAsync(
        HttpContextBase ctx,
        string physicalPath,
        string contentType,
        bool enableRanges)
    {
        var file =
            new FileInfo(
                physicalPath);

        if (!file.Exists)
        {
            ctx.Response.StatusCode =
                404;

            await ctx.Response.Send(
                "Not found",
                ctx.Token);

            return;
        }

        ctx.Response.ContentType =
            contentType;

        if (enableRanges)
        {
            ctx.Response.Headers[
                "Accept-Ranges"] =
                "bytes";
        }

        var rangeHeader =
            enableRanges
                ? ctx.Request
                    .RetrieveHeaderValue(
                        "Range")
                : null;

        if (
            enableRanges &&
            !string.IsNullOrWhiteSpace(
                rangeHeader)
        )
        {
            if (
                !TryParseSingleRange(
                    rangeHeader,
                    file.Length,
                    out var start,
                    out var end)
            )
            {
                ctx.Response.StatusCode =
                    416;

                ctx.Response.Headers[
                    "Content-Range"] =
                    $"bytes */{file.Length}";

                await ctx.Response.Send(
                    Array.Empty<byte>(),
                    ctx.Token);

                return;
            }

            var count =
                end -
                start +
                1;

            ctx.Response.StatusCode =
                206;

            ctx.Response.Headers[
                "Content-Range"] =
                $"bytes {start}-{end}/{file.Length}";

            await using var stream =
                new FileStream(
                    physicalPath,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.Read,
                    64 * 1024,
                    FileOptions.Asynchronous |
                    FileOptions.SequentialScan);

            stream.Seek(
                start,
                SeekOrigin.Begin);

            await ctx.Response.Send(
                count,
                stream,
                ctx.Token);

            return;
        }

        ctx.Response.StatusCode =
            200;

        if (
            ctx.Request.Method ==
            WatsonHttpMethod.HEAD
        )
        {
            ctx.Response.Headers[
                "Content-Length"] =
                file.Length.ToString();

            await ctx.Response.Send(
                Array.Empty<byte>(),
                ctx.Token);

            return;
        }

        await using var fullStream =
            new FileStream(
                physicalPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                64 * 1024,
                FileOptions.Asynchronous |
                FileOptions.SequentialScan);

        await ctx.Response.Send(
            file.Length,
            fullStream,
            ctx.Token);
    }

    async Task SendAsync(
        HttpContextBase ctx,
        HubApiResponse response)
    {
        ctx.Response.StatusCode =
            response.StatusCode;

        ctx.Response.ContentType =
            response.ContentType;

        if (
            response.BodyKind ==
            HubApiBodyKind.Text
        )
        {
            await ctx.Response.Send(
                response.Body as string ??
                "",
                ctx.Token);

            return;
        }

        ctx.Response.ContentType =
            "application/json";

        var body =
            response.Body is null
                ? Encoding.UTF8.GetBytes(
                    "null")
                : JsonSerializer
                    .SerializeToUtf8Bytes(
                        response.Body,
                        response.Body.GetType(),
                        Json);

        await ctx.Response.Send(
            body,
            ctx.Token);
    }

    static async Task<MemoryStream> ReadBodyStreamAsync(
        HttpContextBase ctx)
    {
        var body =
            await ctx.Request
                .ReadBodyAsync(
                    ctx.Token) ??
            Array.Empty<byte>();

        return new MemoryStream(
            body,
            writable:
                false);
    }

    static bool IsUrlEncodedForm(
        HttpContextBase ctx) =>
        !string.IsNullOrWhiteSpace(
            ctx.Request.ContentType) &&
        ctx.Request.ContentType.StartsWith(
            "application/x-www-form-urlencoded",
            StringComparison.OrdinalIgnoreCase);

    static async Task<Dictionary<string, string>>
        ReadUrlEncodedFormAsync(
            HttpContextBase ctx)
    {
        var body =
            await ctx.Request
                .ReadBodyAsync(
                    ctx.Token) ??
            Array.Empty<byte>();

        var text =
            Encoding.UTF8.GetString(
                body);

        var result =
            new Dictionary<string, string>(
                StringComparer.OrdinalIgnoreCase);

        foreach (
            var pair in
                text.Split(
                    '&',
                    StringSplitOptions
                        .RemoveEmptyEntries)
        )
        {
            var equals =
                pair.IndexOf(
                    '=');

            var rawKey =
                equals >= 0
                    ? pair[..equals]
                    : pair;

            var rawValue =
                equals >= 0
                    ? pair[
                        (equals + 1)..]
                    : "";

            var key =
                DecodeFormValue(
                    rawKey);

            if (key.Length == 0)
                continue;

            result[key] =
                DecodeFormValue(
                    rawValue);
        }

        return result;
    }

    static string DecodeFormValue(
        string value) =>
        Uri.UnescapeDataString(
            value.Replace(
                '+',
                ' '));

    static string Get(
        IReadOnlyDictionary<string, string> values,
        string key) =>
        values.TryGetValue(
            key,
            out var value)
                ? value
                : "";

    static string? Optional(
        IReadOnlyDictionary<string, string> values,
        string key) =>
        values.TryGetValue(
            key,
            out var value)
                ? value
                : null;

    static long? DeclaredLength(
        HttpContextBase ctx) =>
        ctx.Request.ContentLength > 0
            ? ctx.Request.ContentLength
            : null;

    static string? Query(
        HttpContextBase ctx,
        string key)
    {
        try
        {
            return
                ctx.Request
                    .RetrieveQueryValue(
                        key);
        }
        catch
        {
            return null;
        }
    }

    string? ResolvePublicFile(
        string requestPath)
    {
        if (
            requestPath.Equals(
                "/",
                StringComparison.Ordinal)
        )
        {
            return Path.Combine(
                _paths.WebRootPath,
                "index.html");
        }

        if (
            requestPath.Equals(
                "/flash",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return null;
        }

        if (
            requestPath.StartsWith(
                "/flash/",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return ResolveUnderRoot(
                _paths.DataRootPath,
                requestPath[
                    "/flash/".Length..]);
        }

        if (
            requestPath.Equals(
                "/sd",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return null;
        }

        if (
            requestPath.StartsWith(
                "/sd/",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return ResolveUnderRoot(
                _paths.SdRootPath,
                requestPath[
                    "/sd/".Length..]);
        }

        if (
            requestPath.Equals(
                "/images",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return null;
        }

        if (
            requestPath.StartsWith(
                "/images/",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return ResolveUnderRoot(
                Path.Combine(
                    _paths.DataRootPath,
                    "images"),
                requestPath[
                    "/images/".Length..]);
        }

        return ResolveUnderRoot(
            _paths.WebRootPath,
            requestPath
                .TrimStart('/'));
    }

    static string? ResolveUnderRoot(
        string root,
        string relative)
    {
        try
        {
            relative =
                Uri.UnescapeDataString(
                    relative)
                    .Replace(
                        '/',
                        Path.DirectorySeparatorChar)
                    .TrimStart(
                        Path.DirectorySeparatorChar,
                        Path.AltDirectorySeparatorChar);

            if (
                relative.Contains(
                    "..",
                    StringComparison.Ordinal)
            )
            {
                return null;
            }

            var fullRoot =
                Path.GetFullPath(
                    root)
                    .TrimEnd(
                        Path.DirectorySeparatorChar,
                        Path.AltDirectorySeparatorChar);

            var full =
                Path.GetFullPath(
                    Path.Combine(
                        fullRoot,
                        relative));

            if (
                string.Equals(
                    full,
                    fullRoot,
                    StringComparison.OrdinalIgnoreCase)
            )
            {
                return full;
            }

            return
                full.StartsWith(
                    fullRoot +
                    Path.DirectorySeparatorChar,
                    StringComparison.OrdinalIgnoreCase)
                    ? full
                    : null;
        }
        catch
        {
            return null;
        }
    }

    static string NormalizeRequestPath(
        string? path)
    {
        if (
            string.IsNullOrWhiteSpace(
                path)
        )
        {
            return "/";
        }

        var result =
            path.Replace(
                '\\',
                '/');

        if (!result.StartsWith('/'))
            result =
                "/" + result;

        return result;
    }

    static bool TryParseSingleRange(
        string value,
        long length,
        out long start,
        out long end)
    {
        start = 0;
        end = 0;

        if (
            length <= 0 ||
            string.IsNullOrWhiteSpace(
                value) ||
            !value.StartsWith(
                "bytes=",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return false;
        }

        var raw =
            value[
                "bytes=".Length..]
                .Trim();

        if (
            raw.Contains(
                ',')
        )
        {
            return false;
        }

        var dash =
            raw.IndexOf(
                '-');

        if (dash < 0)
            return false;

        var startText =
            raw[..dash]
                .Trim();

        var endText =
            raw[
                (dash + 1)..]
                .Trim();

        if (startText.Length == 0)
        {
            if (
                !long.TryParse(
                    endText,
                    out var suffixLength) ||
                suffixLength <= 0
            )
            {
                return false;
            }

            suffixLength =
                Math.Min(
                    suffixLength,
                    length);

            start =
                length -
                suffixLength;

            end =
                length -
                1;

            return true;
        }

        if (
            !long.TryParse(
                startText,
                out start) ||
            start < 0 ||
            start >= length
        )
        {
            return false;
        }

        if (endText.Length == 0)
        {
            end =
                length -
                1;

            return true;
        }

        if (
            !long.TryParse(
                endText,
                out end) ||
            end < start
        )
        {
            return false;
        }

        end =
            Math.Min(
                end,
                length -
                1);

        return true;
    }

    (string Host, int Port) ResolveEndpoint()
    {
        var raw =
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
