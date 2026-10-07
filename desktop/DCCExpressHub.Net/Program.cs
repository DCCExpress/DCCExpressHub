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


app.MapGet("/api/calibration", (CalibrationRuntime calibration) =>
    Results.Json(calibration.Snapshot()));

app.MapPost("/api/calibration/start", async (HttpRequest req, CalibrationRuntime calibration) =>
{
    CalibrationStartRequest? request;

    try
    {
        request =
            await JsonSerializer.DeserializeAsync<CalibrationStartRequest>(
                req.Body,
                new JsonSerializerOptions(JsonSerializerDefaults.Web),
                req.HttpContext.RequestAborted);
    }
    catch
    {
        return Results.Json(
            new { ok = false, message = "invalid_calibration_request" },
            statusCode: 400);
    }

    if (request is null)
        return Results.Json(
            new { ok = false, message = "invalid_calibration_request" },
            statusCode: 400);

    var result =
        calibration.Start(
            request);

    return result.Ok
        ? Results.Json(
            new
            {
                ok = true,
                state = calibration.Snapshot()
            })
        : Results.Json(
            new
            {
                ok = false,
                message = result.Error,
                state = calibration.Snapshot()
            },
            statusCode: 409);
});

app.MapPost("/api/calibration/stop", (CalibrationRuntime calibration) =>
    Results.Json(
        new
        {
            ok = calibration.Stop(),
            state = calibration.Snapshot()
        }));

app.MapPost("/api/calibration/abort", (CalibrationRuntime calibration) =>
    Results.Json(
        new
        {
            ok = calibration.Abort(false),
            state = calibration.Snapshot()
        }));

app.MapPost("/api/calibration/estop", (CalibrationRuntime calibration) =>
    Results.Json(
        new
        {
            ok = calibration.Abort(true),
            state = calibration.Snapshot()
        }));

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

app.MapGet("/api/runtime", (LayoutRuntime runtime) => Results.Json(new
{
    ok = true,
    blockState = runtime.BlockSnapshot(),
    sensorSnapshot = runtime.SensorSnapshot()
}));

app.MapGet("/api/status", (ICommandCenter cc, LayoutRuntime runtime, CommandCenterConfigStore ccStore, IConfiguration cfg) =>
{
    var x = ccStore.Current;
    var urls = cfg["Urls"] ?? "http://0.0.0.0:5174";
    int httpPort = 5174;
    var lastColon = urls.LastIndexOf(':');
    if (lastColon >= 0) int.TryParse(urls[(lastColon + 1)..].TrimEnd('/'), out httpPort);
    return Results.Json(new
    {
        ok = true,
        // ESP-only network telemetry has neutral native values, while the JSON contract remains identical.
        wifiConnected = false,
        wifiSsid = "",
        deviceIp = "",
        rssi = 0,
        csbConnected = cc.Connected,
        csbTransport = x.Transport,
        csbHost = x.IsSerial ? "" : x.TcpHost,
        csbPort = x.IsSerial ? 0 : x.TcpPort,
        csbSerialPort = x.IsSerial ? x.SerialPort : "",
        csbBaudRate = x.IsSerial ? CommandCenterSettings.DccExSerialBaudRate : 0,
        hubHostname = Environment.MachineName,
        hubHttpPort = httpPort,
        hubDhcp = true,
        uptimeMs = Environment.TickCount64,
        freeHeapBytes = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes,
        accessories = runtime.AccessoryCount,
        sensors = runtime.SensorCount
    });
});

app.MapPost("/api/emergency-stop", async (ICommandCenter cc, HubState state, WsHub ws) =>
{
    var ok = await cc.EmergencyStopAsync();
    if (ok)
    {
        state.EmergencyStop = cc.EmergencyPauseStateKnown ? cc.EmergencyPaused : !state.EmergencyStop;
        await ws.BroadcastPowerState();
    }
    return Results.Json(new
    {
        ok,
        emergencyStop = state.EmergencyStop,
        message = ok ? null : "Emergency stop command could not be sent"
    }, statusCode: ok ? 200 : 503);
});

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
app.MapGet("/api/s88-status", () => Results.Json(new
{
    enabled = false,
    online = false,
    snapshotKnown = false,
    dataFresh = false,
    ready = false,
    adapterInfoKnown = false,
    protocolVersion = 0,
    firmwareVersion = "",
    firmwareMajor = 0,
    firmwareMinor = 0,
    firmwarePatch = 0,
    maxByteCount = 0,
    capabilities = 0,
    address = 0,
    addressHex = "0x00",
    baseAddress = 0,
    groupCount = 0,
    byteCount = 0,
    sensorCount = 0,
    groups = Array.Empty<object>()
}));

// File-manager flash statistics. On native, report the data volume.
app.MapGet("/fsinfo", (HubFileStorage files) =>
{
    var root = new DriveInfo(Path.GetPathRoot(files.Root)!);
    long used = root.TotalSize - root.AvailableFreeSpace;
    return Results.Json(new { total = root.TotalSize, used, free = root.AvailableFreeSpace });
});

// Stream a virtual storage file with its real MIME type (audio manager uses this).
app.MapGet("/api/storage/file", (string? path, HubFileStorage files) =>
{
    var full = files.Resolve(path);
    if (full is null) return Results.Json(new { ok = false, message = "Invalid path" }, statusCode: 400);
    if (!File.Exists(full)) return Results.Json(new { ok = false, message = "File not found" }, statusCode: 404);
    return Results.File(full, files.ContentType(full), enableRangeProcessing: true);
});

// LittleFS compatibility: /list
app.MapGet("/list", (string? path, HubFileStorage files) =>
{
    try { return Results.Json(files.List(path)); }
    catch (DirectoryNotFoundException) { return Results.Json(new { ok = false, message = "Directory not found" }, statusCode: 404); }
});

// LittleFS compatibility: read text files
app.MapGet("/api/files/text", async (string? path, HubFileStorage files) =>
{
    var full = files.Resolve(path);
    if (full is null) return Results.Json(new { ok = false, message = "Invalid path" }, statusCode: 400);
    if (!File.Exists(full)) return Results.Json(new { ok = false, message = "File not found" }, statusCode: 404);
    return Results.Text(await File.ReadAllTextAsync(full), "text/plain; charset=utf-8");
});

// LittleFS compatibility: multipart upload into a virtual directory.
app.MapPost("/upload", async (HttpRequest req, string? path, HubFileStorage files) =>
{
    if (!req.HasFormContentType)
        return Results.Json(new { ok = false, message = "multipart/form-data required" }, statusCode: 400);

    var directory = files.Resolve(path, allowRoot: false);
    if (directory is null)
        return Results.Json(new { ok = false, message = "Invalid upload path" }, statusCode: 400);

    Directory.CreateDirectory(directory);
    var form = await req.ReadFormAsync();
    var upload = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
    if (upload is null)
        return Results.Json(new { ok = false, message = "No uploaded file received" }, statusCode: 400);

    var safeName = Path.GetFileName(upload.FileName);
    if (string.IsNullOrWhiteSpace(safeName) || safeName.Contains(".."))
        return Results.Json(new { ok = false, message = "Invalid upload filename" }, statusCode: 400);

    var target = Path.GetFullPath(Path.Combine(directory, safeName));
    if (!target.StartsWith(files.Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        return Results.Json(new { ok = false, message = "Invalid upload target" }, statusCode: 400);
    if (files.IsProtected(target) || files.IsManagedConfig(target))
        return Results.Json(new { ok = false, message = "Upload destination is protected or managed" }, statusCode: 403);

    await using (var output = File.Create(target))
        await upload.CopyToAsync(output);

    return Results.Json(new { ok = true, message = $"File uploaded: {path}/{safeName}" });
});

// Firmware supports GET and DELETE for backwards compatibility.
async Task<IResult> DeletePath(string? path, HubFileStorage files)
{
    var full = files.Resolve(path, allowRoot: false);
    if (full is null) return Results.Json(new { ok = false, message = "Invalid path" }, statusCode: 400);
    if (files.IsProtected(full)) return Results.Json(new { ok = false, message = "Path is protected" }, statusCode: 403);

    if (File.Exists(full))
    {
        File.Delete(full);
        return Results.Json(new { ok = true, message = "Deleted" });
    }
    if (Directory.Exists(full))
    {
        if (Directory.EnumerateFileSystemEntries(full).Any())
            return Results.Json(new { ok = false, message = "Directory is not empty" }, statusCode: 409);
        Directory.Delete(full);
        return Results.Json(new { ok = true, message = "Deleted" });
    }
    return Results.Json(new { ok = false, message = "Path not found" }, statusCode: 404);
}
app.MapDelete("/delete", DeletePath);

app.MapGet("/delete", DeletePath);

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
app.MapGet("/api/script-info", (ScriptInfoStore store) =>
    Results.Json(new { items = store.Snapshot() }));

app.MapPost("/api/script-info", async (HttpRequest req, ScriptInfoStore store) =>
{
    JsonDocument doc;
    try { doc = await JsonDocument.ParseAsync(req.Body); }
    catch { return Results.Json(new { ok = false, message = "JSON object expected" }, statusCode: 400); }
    using (doc)
    {
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
            return Results.Json(new { ok = false, message = "JSON object expected" }, statusCode: 400);

        var root = doc.RootElement;
        string executionId = root.TryGetProperty("executionId", out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() ?? "" : "";
        string ownerId = root.TryGetProperty("ownerId", out var o) && o.ValueKind == JsonValueKind.String ? o.GetString() ?? "" : "";
        string message = root.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() ?? "" : "";
        bool force = root.TryGetProperty("force", out var f) && f.ValueKind == JsonValueKind.True;

        var r = store.Update(executionId, ownerId, message, force);
        if (!r.ok) return Results.Json(new { ok = false, message = r.error }, statusCode: r.status);
        return message.Length == 0
            ? Results.Json(new { ok = true, cleared = r.cleared })
            : Results.Json(new { ok = true });
    }
});

app.MapGet("/api/script-info/events", async (HttpContext ctx, ScriptInfoStore store) =>
{
    ctx.Response.StatusCode = 200;
    ctx.Response.ContentType = "text/event-stream";
    ctx.Response.Headers.CacheControl = "no-store";
    ctx.Response.Headers.Connection = "keep-alive";
    var sub = store.Subscribe();
    try
    {
        await foreach (var evt in sub.Reader.ReadAllAsync(ctx.RequestAborted))
        {
            var json = JsonSerializer.Serialize(evt.Data);
            await ctx.Response.WriteAsync($"event: {evt.EventName}\n", ctx.RequestAborted);
            await ctx.Response.WriteAsync($"data: {json}\n\n", ctx.RequestAborted);
            await ctx.Response.Body.FlushAsync(ctx.RequestAborted);
        }
    }
    catch (OperationCanceledException) { }
    finally { store.Unsubscribe(sub.Id); }
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
