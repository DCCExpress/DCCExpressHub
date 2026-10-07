using System.Text.Json.Nodes;
using System.Text.Json;
using DCCExpressHub.Net.CommandCenter;
using DCCExpressHub.Net.Web;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton(
    new AppPaths(
        builder.Environment.ContentRootPath,
        builder.Environment.WebRootPath));

//var webUiDist = Path.GetFullPath(
//    Path.Combine(
//        builder.Environment.ContentRootPath,
//        "..",
//        "..",
//        "web-ui",
//        "dist"));

//builder.Environment.WebRootPath = webUiDist;

Console.WriteLine(
    $"Web UI root: {builder.Environment.WebRootPath}");

var desktopUrl = Environment.GetEnvironmentVariable("DCCEXPRESS_DESKTOP_URL");
if (!string.IsNullOrWhiteSpace(desktopUrl))
    builder.WebHost.UseUrls(desktopUrl);


var commandCenterProtocol =
    (builder.Configuration["CommandCenter:Protocol"] ?? "")
        .Trim()
        .ToLowerInvariant();

var useRocoZ21 =
    commandCenterProtocol == "z21";

var useYaMoRcZ21 =
    commandCenterProtocol == "yamorc7010";

builder.Services.AddSingleton<HubState>();
builder.Services.AddSingleton<LayoutRuntime>();
builder.Services.AddSingleton<SignalAutomationEngine>();
builder.Services.AddSingleton<ScriptInfoStore>();
builder.Services.AddSingleton<RuntimeStateStore>();
builder.Services.AddSingleton<LocoCounterRuntime>();
builder.Services.AddSingleton<HubFileStorage>();
builder.Services.AddSingleton<AutomationStorageCoordinator>();
builder.Services.AddSingleton<LocoStorageCoordinator>();
builder.Services.AddSingleton<AutomationExclusiveGate>();
builder.Services.AddSingleton<CommandCenterConfigStore>();
builder.Services.AddSingleton<CommandCenterApi>();
builder.Services.AddSingleton<LocomotiveConfigApi>();
builder.Services.AddSingleton<LayoutConfigApi>();
builder.Services.AddSingleton<AutomationConfigApi>();
builder.Services.AddSingleton<DeviceConfigApi>();
builder.Services.AddSingleton<CalibrationApi>();
builder.Services.AddSingleton<RuntimeSystemApi>();
builder.Services.AddSingleton<FileManagerApi>();
builder.Services.AddSingleton<ScriptInfoApi>();

if (useYaMoRcZ21)
{
    builder.Services.AddSingleton<YaMoRcZ21CommandCenter>();
    builder.Services.AddHostedService(
        sp => sp.GetRequiredService<YaMoRcZ21CommandCenter>());
}
else if (useRocoZ21)
{
    builder.Services.AddSingleton<RocoZ21CommandCenter>();
    builder.Services.AddHostedService(
        sp => sp.GetRequiredService<RocoZ21CommandCenter>());
}
else
{
    builder.Services.AddSingleton<IDccExTransport>(sp =>
        string.Equals(
            builder.Configuration["DccEx:Transport"],
            "Serial",
            StringComparison.OrdinalIgnoreCase)
                ? new SerialDccExTransport(builder.Configuration)
                : new TcpDccExTransport(builder.Configuration));

    builder.Services.AddSingleton<DccExCommandCenter>();
    builder.Services.AddHostedService(
        sp => sp.GetRequiredService<DccExCommandCenter>());
}

builder.Services.AddSingleton<ConfiguredCommandCenter>(
    sp =>
    {
        ICommandCenter inner =
            useYaMoRcZ21
                ? sp.GetRequiredService<YaMoRcZ21CommandCenter>()
                : useRocoZ21
                    ? sp.GetRequiredService<RocoZ21CommandCenter>()
                    : sp.GetRequiredService<DccExCommandCenter>();

        return new ConfiguredCommandCenter(
            inner,
            sp.GetRequiredService<AppPaths>(),
            sp.GetRequiredService<ILogger<ConfiguredCommandCenter>>());
    });

builder.Services.AddSingleton<ICommandCenter>(
    sp => sp.GetRequiredService<ConfiguredCommandCenter>());
builder.Services.AddSingleton<FastClockRuntime>();
builder.Services.AddSingleton<SwitchManManager>();
builder.Services.AddSingleton<DispatcherRuntime>();
builder.Services.AddSingleton<MovementPlanBuilder>();
builder.Services.AddSingleton<TrainEventRuntime>();
builder.Services.AddSingleton<MovementRuntime>();
builder.Services.AddSingleton<TrainTrackingRuntime>();
builder.Services.AddSingleton<ScriptRuntime>();
builder.Services.AddSingleton<FlowRuntime>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<FlowRuntime>());
builder.Services.AddSingleton<TimetableRuntime>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<TimetableRuntime>());
builder.Services.AddSingleton<CalibrationRuntime>();
builder.Services.AddSingleton<WsHub>();
builder.Services.AddHostedService<WsRuntimeCoordinator>();

var app = builder.Build();

static IResult ToHttpResult(
    HubApiResponse response) =>
    response.BodyKind ==
        HubApiBodyKind.Text
        ? Results.Text(
            response.Body as string ?? "",
            response.ContentType,
            System.Text.Encoding.UTF8,
            statusCode:
                response.StatusCode)
        : Results.Json(
            response.Body,
            statusCode:
                response.StatusCode);

var appPaths =
    app.Services.GetRequiredService<AppPaths>();
var ccConfigStore = app.Services.GetRequiredService<CommandCenterConfigStore>();
var persistedCc = ccConfigStore.Current;
var configuredCommandCenter = app.Services.GetRequiredService<ConfiguredCommandCenter>();

configuredCommandCenter.SetCommandIntervalMs(
    persistedCc.CommandIntervalMs);

if (useRocoZ21)
{
    configuredCommandCenter.SetRBusOffset(
        persistedCc.RBusOffset);
}

configuredCommandCenter.SetEndpoint(
    persistedCc.IsSerial
        ? persistedCc.SerialPort
        : persistedCc.TcpHost,
    persistedCc.IsSerial
        ? CommandCenterSettings.DccExSerialBaudRate
        : persistedCc.TcpPort);

configuredCommandCenter.ReloadLocomotiveConfiguration();
var runtimeStateStore = app.Services.GetRequiredService<RuntimeStateStore>();

// Firmware startup order: restore LayoutRuntime state BEFORE SignalAutomation subscribes/evaluates.
// App.cpp does: _runtime.begin -> _stateStore.load -> _signalAutomation.begin.
await runtimeStateStore.LoadAsync();

// Only now subscribe/evaluate signal automation against the restored runtime state.
_ = app.Services.GetRequiredService<SignalAutomationEngine>();


var dataRoot = Path.Combine(appPaths.ContentRootPath, "data");
var sdRoot = Path.Combine(appPaths.ContentRootPath, "sd");
Directory.CreateDirectory(Path.Combine(dataRoot, "config"));
Directory.CreateDirectory(Path.Combine(dataRoot, "images"));
Directory.CreateDirectory(Path.Combine(dataRoot, "state"));
Directory.CreateDirectory(Path.Combine(sdRoot, "audio"));

var locoCounterRuntime =
    app.Services.GetRequiredService<LocoCounterRuntime>();

if (!locoCounterRuntime.ReloadConfiguration(false))
    Console.WriteLine("Locomotive counter configuration could not be loaded.");

// WsHub owns the command-center event fan-out, including feeding the backend
// locomotive counter runtime. Resolve it at process startup so counters keep
// running even when no browser/WebSocket client is connected.
_ = app.Services.GetRequiredService<WsHub>();

app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });

app.Map("/ws", async ctx =>
{
    if (!ctx.WebSockets.IsWebSocketRequest)
    {
        ctx.Response.StatusCode = 400;
        return;
    }

    var socket =
        await ctx.WebSockets.AcceptWebSocketAsync();

    await ctx.RequestServices
        .GetRequiredService<WsHub>()
        .Accept(
            socket,
            ctx.RequestAborted);
});


app.MapGet(
    "/api/command-center-config",
    (CommandCenterApi api) =>
    {
        var response =
            api.GetConfig();

        return Results.Json(
            response.Body,
            statusCode:
                response.StatusCode);
    });

app.MapPost(
    "/api/command-center-config",
    async (
        HttpRequest req,
        CommandCenterApi api,
        CancellationToken ct) =>
    {
        if (!req.HasFormContentType)
        {
            return Results.Json(
                new
                {
                    ok = false,
                    message =
                        "Missing command-center settings"
                },
                statusCode:
                    400);
        }

        var form =
            await req.ReadFormAsync(
                ct);

        static string? Optional(
            IFormCollection values,
            string name) =>
            values.TryGetValue(
                name,
                out var value)
                ? value.ToString()
                : null;

        var response =
            await api.SaveConfigAsync(
                new CommandCenterConfigRequest(
                    Host:
                        form["host"].ToString(),
                    Port:
                        form["port"].ToString(),
                    SerialPort:
                        form["serialPort"].ToString(),
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
                ct);

        return Results.Json(
            response.Body,
            statusCode:
                response.StatusCode);
    });

app.MapPost(
    "/api/command-center-test",
    async (
        HttpRequest req,
        CommandCenterApi api,
        CancellationToken ct) =>
    {
        if (!req.HasFormContentType)
        {
            return Results.Json(
                new
                {
                    ok = false,
                    message =
                        "Invalid host"
                },
                statusCode:
                    400);
        }

        var form =
            await req.ReadFormAsync(
                ct);

        var response =
            await api.TestAsync(
                new CommandCenterTestRequest(
                    Host:
                        form["host"].ToString(),
                    Port:
                        form["port"].ToString()),
                ct);

        return Results.Json(
            response.Body,
            statusCode:
                response.StatusCode);
    });

app.MapGet(
    "/api/command-center-info",
    (CommandCenterApi api) =>
    {
        var response =
            api.GetInfo();

        return Results.Json(
            response.Body,
            statusCode:
                response.StatusCode);
    });

app.MapGet(
    "/api/capabilities",
    (CommandCenterApi api) =>
    {
        var response =
            api.GetCapabilities();

        return Results.Json(
            response.Body,
            statusCode:
                response.StatusCode);
    });

app.MapGet(
    "/api/loco-counters",
    async (
        LocomotiveConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.GetCountersAsync(
                ct)));

app.MapPost(
    "/api/loco-counters",
    async (
        HttpRequest req,
        LocomotiveConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.SaveCountersAsync(
                req.Body,
                ct)));

app.MapGet(
    "/api/locos",
    async (
        LocomotiveConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.GetLocosAsync(
                ct)));

app.MapPost(
    "/api/locos",
    async (
        HttpRequest req,
        LocomotiveConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.SaveLocosAsync(
                req.Body,
                ct)));


app.MapGet(
    "/api/calibration",
    (CalibrationApi api) =>
        ToHttpResult(
            api.Get()));

app.MapPost(
    "/api/calibration/start",
    async (
        HttpRequest req,
        CalibrationApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.StartAsync(
                req.Body,
                ct)));

app.MapPost(
    "/api/calibration/stop",
    (CalibrationApi api) =>
        ToHttpResult(
            api.Stop()));

app.MapPost(
    "/api/calibration/abort",
    (CalibrationApi api) =>
        ToHttpResult(
            api.Abort()));

app.MapPost(
    "/api/calibration/estop",
    (CalibrationApi api) =>
        ToHttpResult(
            api.EmergencyStop()));

app.MapGet(
    "/api/function-bindings",
    async (
        LocomotiveConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.GetFunctionBindingsAsync(
                ct)));

app.MapPost(
    "/api/function-bindings",
    async (
        HttpRequest req,
        LocomotiveConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.SaveFunctionBindingsAsync(
                req.Body,
                ct)));

app.MapGet(
    "/api/layout",
    async (
        LayoutConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.GetLayoutAsync(
                ct)));

app.MapPost(
    "/api/layout",
    async (
        HttpRequest req,
        LayoutConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.SaveLayoutAsync(
                req.Body,
                ct)));

// version.json is generated by the ESP32 web build. The native backend supplies
// a compatible fallback if the copied React dist does not contain one.
app.MapGet("/version.json", (AppPaths env) =>
{
    var physical = Path.Combine(env.WebRootPath ?? "wwwroot", "version.json");
    if (File.Exists(physical))
        return Results.File(physical, "application/json");
    return Results.Json(new { version = "net10-development", backend = "dotnet" });
});


// Automation storage contract: exact native equivalent of AutomationsEndpoint.
app.MapGet(
    "/api/automations",
    async (
        AutomationConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.GetAsync(
                ct)));

app.MapGet(
    "/api/automations/previous",
    async (
        AutomationConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.GetPreviousAsync(
                ct)));

app.MapPost(
    "/api/automations",
    async (
        HttpRequest req,
        AutomationConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.SaveAsync(
                req.Body,
                req.ContentLength,
                ct)));


// Firmware HTTP parity that is platform-neutral.
app.MapGet(
    "/api/signal-logic",
    async (
        LayoutConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.GetSignalLogicAsync(
                ct)));

app.MapPost(
    "/api/signal-logic",
    async (
        HttpRequest req,
        LayoutConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.SaveSignalLogicAsync(
                req.Body,
                ct)));

app.MapGet(
    "/api/runtime",
    (RuntimeSystemApi api) =>
        ToHttpResult(
            api.GetRuntime()));

app.MapGet(
    "/api/status",
    (RuntimeSystemApi api) =>
        ToHttpResult(
            api.GetStatus()));

app.MapPost(
    "/api/emergency-stop",
    async (
        RuntimeSystemApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.EmergencyStopAsync(
                ct)));

// Native parity endpoints used by the current React UI.
app.MapGet(
    "/api/device-config",
    async (
        DeviceConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.GetAsync(
                ct)));

app.MapPost(
    "/api/device-config",
    async (
        HttpRequest req,
        DeviceConfigApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.SaveAsync(
                req.Body,
                req.ContentLength,
                ct)));

// Native backend currently has no physical S88 I2C master.
app.MapGet(
    "/api/s88-status",
    (RuntimeSystemApi api) =>
        ToHttpResult(
            api.GetS88Status()));

// File-manager flash statistics. On native, report the data volume.
app.MapGet(
    "/fsinfo",
    (FileManagerApi api) =>
        ToHttpResult(
            api.GetFsInfo()));

// Stream a virtual storage file with its real MIME type (audio manager uses this).
app.MapGet(
    "/api/storage/file",
    (
        string? path,
        FileManagerApi api) =>
    {
        var result =
            api.GetFile(
                path);

        if (result.Error is not null)
        {
            return ToHttpResult(
                result.Error);
        }

        var file =
            result.File!;

        return Results.File(
            file.FilePath,
            file.ContentType,
            enableRangeProcessing:
                file.EnableRangeProcessing);
    });

// LittleFS compatibility: /list
app.MapGet(
    "/list",
    (
        string? path,
        FileManagerApi api) =>
        ToHttpResult(
            api.List(
                path)));

// LittleFS compatibility: read text files
app.MapGet(
    "/api/files/text",
    async (
        string? path,
        FileManagerApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.ReadTextAsync(
                path,
                ct)));

// LittleFS compatibility: multipart upload into a virtual directory.
app.MapPost(
    "/upload",
    async (
        HttpRequest req,
        string? path,
        FileManagerApi api,
        CancellationToken ct) =>
    {
        if (!req.HasFormContentType)
        {
            return ToHttpResult(
                HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            "multipart/form-data required"
                    }));
        }

        var form =
            await req.ReadFormAsync(
                ct);

        var upload =
            form.Files.GetFile(
                "file") ??
            form.Files
                .FirstOrDefault();

        if (upload is null)
        {
            return ToHttpResult(
                HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            "No uploaded file received"
                    }));
        }

        await using var input =
            upload.OpenReadStream();

        return ToHttpResult(
            await api.UploadAsync(
                path,
                upload.FileName,
                input,
                ct));
    });

// Firmware supports GET and DELETE for backwards compatibility.
app.MapDelete(
    "/delete",
    (
        string? path,
        FileManagerApi api) =>
        ToHttpResult(
            api.Delete(
                path)));

app.MapGet(
    "/delete",
    (
        string? path,
        FileManagerApi api) =>
        ToHttpResult(
            api.Delete(
                path)));

// Expose the native equivalents of the firmware storage namespaces.
// Keep the same virtual URLs on Windows and ESP32:
//   /flash/* -> <content-root>/data/*
//   /sd/*    -> <content-root>/sd/*
// Old Hub URLs such as /images/x.jpg continue to work as well.
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(dataRoot),
    RequestPath = "/flash",
    ServeUnknownFileTypes = true
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(sdRoot),
    RequestPath = "/sd",
    ServeUnknownFileTypes = true
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(Path.Combine(dataRoot, "images")),
    RequestPath = "/images",
    ServeUnknownFileTypes = true
});

app.UseDefaultFiles();
app.UseStaticFiles();

// Do not return index.html for a missing API endpoint: that was the source of
// "Unexpected token '<' ... is not valid JSON".
app.Map("/api/{**path}", async ctx =>
{
    ctx.Response.StatusCode = StatusCodes.Status404NotFound;
    ctx.Response.ContentType = "application/json";
    await ctx.Response.WriteAsJsonAsync(new
    {
        ok = false,
        error = "api_endpoint_not_found",
        path = ctx.Request.Path.Value
    });
});


// Firmware parity: ScriptInfoEndpoint runtime store + SSE.
app.MapGet(
    "/api/script-info",
    (ScriptInfoApi api) =>
        ToHttpResult(
            api.Get()));

app.MapPost(
    "/api/script-info",
    async (
        HttpRequest req,
        ScriptInfoApi api,
        CancellationToken ct) =>
        ToHttpResult(
            await api.UpdateAsync(
                req.Body,
                ct)));

app.MapGet(
    "/api/script-info/events",
    async (
        HttpContext ctx,
        ScriptInfoApi api) =>
    {
        ctx.Response.StatusCode =
            200;
        ctx.Response.ContentType =
            "text/event-stream";
        ctx.Response.Headers.CacheControl =
            "no-store";
        ctx.Response.Headers.Connection =
            "keep-alive";

        var subscription =
            api.Subscribe();

        try
        {
            await foreach (
                var evt in
                    subscription.Reader
                        .ReadAllAsync(
                            ctx.RequestAborted)
            )
            {
                var json =
                    JsonSerializer.Serialize(
                        evt.Data);

                await ctx.Response.WriteAsync(
                    $"event: {evt.EventName}\n",
                    ctx.RequestAborted);

                await ctx.Response.WriteAsync(
                    $"data: {json}\n\n",
                    ctx.RequestAborted);

                await ctx.Response.Body
                    .FlushAsync(
                        ctx.RequestAborted);
            }
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            api.Unsubscribe(
                subscription.Id);
        }
    });

app.MapFallback(async ctx =>
{
    var index = Path.Combine(appPaths.WebRootPath ?? "wwwroot", "index.html");
    if (File.Exists(index))
    {
        ctx.Response.ContentType = "text/html; charset=utf-8";
        await ctx.Response.SendFileAsync(index);
    }
    else
    {
        ctx.Response.ContentType = "text/plain; charset=utf-8";
        await ctx.Response.WriteAsync("DCCExpressHub .NET is running. Copy the built React UI into wwwroot/.");
    }
});

app.Run();
