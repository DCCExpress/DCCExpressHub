using System.Text.Json;
using DCCExpressHub.Net.CommandCenter;
using DCCExpressHub.Net.Web;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
var desktopUrl = Environment.GetEnvironmentVariable("DCCEXPRESS_DESKTOP_URL");
if (!string.IsNullOrWhiteSpace(desktopUrl))
    builder.WebHost.UseUrls(desktopUrl);


builder.Services.AddSingleton<HubState>();
builder.Services.AddSingleton<LayoutRuntime>();
builder.Services.AddSingleton<SignalAutomationEngine>();
builder.Services.AddSingleton<ScriptInfoStore>();
builder.Services.AddSingleton<RuntimeStateStore>();
builder.Services.AddSingleton<HubFileStorage>();
builder.Services.AddSingleton<CommandCenterConfigStore>();
builder.Services.AddSingleton<IDccExTransport>(sp =>
    string.Equals(builder.Configuration["DccEx:Transport"], "Serial", StringComparison.OrdinalIgnoreCase)
        ? new SerialDccExTransport(builder.Configuration)
        : new TcpDccExTransport(builder.Configuration));
builder.Services.AddSingleton<DccExCommandCenter>();
builder.Services.AddSingleton<ConfiguredCommandCenter>();
builder.Services.AddSingleton<ICommandCenter>(sp => sp.GetRequiredService<ConfiguredCommandCenter>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<DccExCommandCenter>());
builder.Services.AddSingleton<WsHub>();
builder.Services.AddHostedService<WsRuntimeCoordinator>();

var app = builder.Build();
var ccConfigStore=app.Services.GetRequiredService<CommandCenterConfigStore>();
var persistedCc=ccConfigStore.Current;
app.Services.GetRequiredService<DccExCommandCenter>().SetEndpoint(persistedCc.Host,persistedCc.Port);
var configuredCommandCenter = app.Services.GetRequiredService<ConfiguredCommandCenter>();
configuredCommandCenter.ReloadLocomotiveConfiguration();
var runtimeStateStore = app.Services.GetRequiredService<RuntimeStateStore>();

// Firmware startup order: restore LayoutRuntime state BEFORE SignalAutomation subscribes/evaluates.
// App.cpp does: _runtime.begin -> _stateStore.load -> _signalAutomation.begin.
await runtimeStateStore.LoadAsync();

// Only now subscribe/evaluate signal automation against the restored runtime state.
_ = app.Services.GetRequiredService<SignalAutomationEngine>();


var dataRoot = Path.Combine(app.Environment.ContentRootPath, "data");
Directory.CreateDirectory(Path.Combine(dataRoot, "config"));
Directory.CreateDirectory(Path.Combine(dataRoot, "images"));
Directory.CreateDirectory(Path.Combine(dataRoot, "state"));

app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });

app.Map("/ws", async ctx =>
{
    if (!ctx.WebSockets.IsWebSocketRequest) { ctx.Response.StatusCode = 400; return; }
    await ctx.RequestServices.GetRequiredService<WsHub>().Accept(ctx);
});


app.MapGet("/api/command-center-config", (CommandCenterConfigStore store,ICommandCenter cc) =>
{
    var x=store.Current;
    return Results.Json(new { ok=true,host=x.Host,port=x.Port,powerIncludesProgramming=x.PowerIncludesProgramming,connected=cc.Connected });
});

app.MapPost("/api/command-center-config", async (HttpRequest req,CommandCenterConfigStore store,DccExCommandCenter physical,WsHub ws,CancellationToken ct) =>
{
    if(!req.HasFormContentType)return Results.Json(new{ok=false,message="Missing host or port"},statusCode:400);
    var form=await req.ReadFormAsync(ct);
    var host=form["host"].ToString().Trim();var portText=form["port"].ToString().Trim();
    static bool ValidHost(string h)=>h.Length is >0 and <=253 && !h.Any(c=>c<=32||c is '/' or '\\' or ':' or '<' or '>');
    if(!ValidHost(host))return Results.Json(new{ok=false,message="Invalid host"},statusCode:400);
    if(!int.TryParse(portText,out var port)||port is <1 or >65535)return Results.Json(new{ok=false,message="Port must be between 1 and 65535"},statusCode:400);
    bool powerProg=store.Current.PowerIncludesProgramming;
    if(form.TryGetValue("powerIncludesProgramming",out var pv))
    {
        var v=pv.ToString().Trim().ToLowerInvariant();
        if(v is "true" or "1" or "yes" or "on")powerProg=true;
        else if(v is "false" or "0" or "no" or "off")powerProg=false;
        else return Results.Json(new{ok=false,message="Invalid powerIncludesProgramming"},statusCode:400);
    }
    var next=new CommandCenterSettings(host,port,powerProg);
    if(!await store.SaveAsync(next))return Results.Json(new{ok=false,message="Command center configuration could not be saved"},statusCode:500);
    if(!physical.SetEndpoint(host,port))return Results.Json(new{ok=false,message="Runtime endpoint change is unavailable"},statusCode:500);
    await ws.BroadcastStatus();
    await ws.BroadcastRuntimeSnapshot();
    return Results.Json(new{ok=true,host,port,powerIncludesProgramming=powerProg,connected=physical.Connected});
});

app.MapPost("/api/command-center-test", async (HttpRequest req, CancellationToken ct) =>
{
    if(!req.HasFormContentType)
        return Results.Json(new { ok=false, message="Invalid host" }, statusCode:400);

    var form=await req.ReadFormAsync(ct);
    var host=(form["host"].ToString() ?? "").Trim();
    var portText=form["port"].ToString();

    static bool ValidHost(string value)
    {
        if(value.Length is 0 or >253)return false;
        foreach(var c in value)
            if(c<=32 || c is '/' or '\\' or ':' or '<' or '>')return false;
        return true;
    }

    if(!ValidHost(host))
        return Results.Json(new { ok=false, message="Invalid host" }, statusCode:400);
    if(!int.TryParse(portText,out var port) || port is <1 or >65535)
        return Results.Json(new { ok=false, message="Invalid port" }, statusCode:400);

    var probe=await CommandCenterProbe.ProbeDccExAsync(host,port,ct);
    if(probe.DccExAlive)
        return Results.Json(new { ok=true, tcpConnected=probe.TcpConnected, dccExAlive=true, reply=probe.Reply, elapsedMs=probe.ElapsedMs });

    return Results.Json(new {
        ok=false, tcpConnected=probe.TcpConnected, dccExAlive=false,
        reply=probe.Reply, elapsedMs=probe.ElapsedMs,
        message=probe.TcpConnected ? "Command center did not answer" : "Command center connection failed"
    }, statusCode:502);
});

app.MapGet("/api/command-center-info", (ICommandCenter cc,CommandCenterConfigStore store) =>
{
    var x=store.Current;
    return Results.Json(new
    {
        ok=true,type=cc.Type,name=cc.Name,defaultPort=2560,connected=cc.Connected,
        host=x.Host,port=x.Port,
        capabilities=new
        {
            trackPower=true,programmingTrackPower=true,rawCommand=true,vPin=true,
            extendedAccessory=true,currentTelemetry=true,trackConfiguration=true,
            locomotiveControl=true,locomotiveFunctions=true,turnoutControl=true,
            basicAccessory=true,signalAspect=true
        }
    });
});

app.MapGet("/api/capabilities", () => Results.Json(new
{
    ok = true, javascriptAutomation = false, fileManager = true, deviceConfiguration = true,
    gamepad = true, s88 = false, programmingTrack = true
}));

static string DataFile(IWebHostEnvironment env, string name)
    => Path.Combine(env.ContentRootPath, "data", "config", name);

app.MapGet("/api/locos", async (IWebHostEnvironment env) =>
{
    var p = DataFile(env, "locos.json");
    return Results.Text(File.Exists(p) ? await File.ReadAllTextAsync(p) : "[]", "application/json");
});
app.MapPost("/api/locos", async (HttpRequest req, IWebHostEnvironment env, ConfiguredCommandCenter configuredCc) =>
{
    using var sr = new StreamReader(req.Body);
    var body=await sr.ReadToEndAsync();
    try
    {
        using var doc=JsonDocument.Parse(body);
        if(doc.RootElement.ValueKind!=JsonValueKind.Array)
            return Results.Json(new { ok=false, message="Expected locomotive JSON array" },statusCode:400);
    }
    catch
    {
        return Results.Json(new { ok=false, message="Expected locomotive JSON array" },statusCode:400);
    }

    var path=DataFile(env,"locos.json");
    var temp=path+".tmp";
    await File.WriteAllTextAsync(temp,body);
    File.Move(temp,path,true);

    if(!configuredCc.ReloadLocomotiveConfiguration())
        return Results.Json(new { ok=false, message="Locomotive configuration committed but runtime reload failed" },statusCode:500);

    return Results.Json(new { ok=true, bytes=System.Text.Encoding.UTF8.GetByteCount(body) });
});
app.MapGet("/api/layout", async (IWebHostEnvironment env) =>
{
    var p = DataFile(env, "layout.json");
    return Results.Text(File.Exists(p) ? await File.ReadAllTextAsync(p) : "{}", "application/json");
});
app.MapPost("/api/layout", async (HttpRequest req, IWebHostEnvironment env, LayoutRuntime runtime, SignalAutomationEngine automation, WsHub ws) =>
{
    var finalPath=DataFile(env,"layout.json");
    var tempPath=finalPath+".upload.tmp";
    long bytes=0;
    try
    {
        await using(var output=new FileStream(tempPath,FileMode.Create,FileAccess.Write,FileShare.None))
        {
            await req.Body.CopyToAsync(output,req.HttpContext.RequestAborted);
            bytes=output.Length;
        }

        // Validate the temporary file before replacing the authoritative layout.
        try
        {
            using var doc=JsonDocument.Parse(await File.ReadAllTextAsync(tempPath,req.HttpContext.RequestAborted));
            if(doc.RootElement.ValueKind!=JsonValueKind.Object)
            {
                File.Delete(tempPath);
                return Results.Json(new{ok=false,message="Invalid layout JSON"},statusCode:400);
            }
        }
        catch
        {
            if(File.Exists(tempPath))File.Delete(tempPath);
            return Results.Json(new{ok=false,message="Invalid layout JSON"},statusCode:400);
        }

        File.Move(tempPath,finalPath,true);
        runtime.Rebuild();

        // Firmware parity: IDs used by signal rules are resolved against the newly
        // rebuilt runtime, therefore reload + evaluate after every committed layout.
        var signalAutomationReloaded=automation.Reload();
        if(signalAutomationReloaded)await automation.EvaluateAsync();

        await ws.BroadcastRuntimeSnapshot();
        return Results.Json(new {
            ok=true,bytes,
            accessories=runtime.AccessoryCount,
            sensors=runtime.SensorCount,
            signalAutomationReloaded
        });
    }
    catch(IOException)
    {
        try{if(File.Exists(tempPath))File.Delete(tempPath);}catch{}
        return Results.Json(new{ok=false,message="Layout upload failed"},statusCode:507);
    }
});

// version.json is generated by the ESP32 web build. The native backend supplies
// a compatible fallback if the copied React dist does not contain one.
app.MapGet("/version.json", (IWebHostEnvironment env) =>
{
    var physical = Path.Combine(env.WebRootPath ?? "wwwroot", "version.json");
    if (File.Exists(physical))
        return Results.File(physical, "application/json");
    return Results.Json(new { version = "net10-development", backend = "dotnet" });
});


// Automation storage contract: exact native equivalent of AutomationsEndpoint.
// ESP32: /config/automations.json in LittleFS
// .NET:  data/config/automations.json
app.MapGet("/api/automations", async (IWebHostEnvironment env) =>
{
    var path = DataFile(env, "automations.json");
    if (!File.Exists(path))
        return Results.Json(new { version = 1, scripts = Array.Empty<object>() });

    return Results.Text(
        await File.ReadAllTextAsync(path),
        "application/json",
        System.Text.Encoding.UTF8);
});

app.MapPost("/api/automations", async (HttpRequest req, IWebHostEnvironment env) =>
{
    const int maxBytes = 512 * 1024;

    if (req.ContentLength is > maxBytes)
        return Results.Json(
            new { ok = false, message = "Automation storage exceeds 512 KB" },
            statusCode: StatusCodes.Status413PayloadTooLarge);

    using var memory = new MemoryStream();
    await req.Body.CopyToAsync(memory);

    if (memory.Length > maxBytes)
        return Results.Json(
            new { ok = false, message = "Automation storage exceeds 512 KB" },
            statusCode: StatusCodes.Status413PayloadTooLarge);

    System.Text.Json.JsonDocument document;
    try
    {
        memory.Position = 0;
        document = await System.Text.Json.JsonDocument.ParseAsync(memory);
    }
    catch (System.Text.Json.JsonException)
    {
        return Results.Json(
            new { ok = false, message = "Invalid automation JSON" },
            statusCode: StatusCodes.Status400BadRequest);
    }

    using (document)
    {
        var root = document.RootElement;

        if (root.ValueKind != System.Text.Json.JsonValueKind.Object)
            return Results.Json(
                new { ok = false, message = "Automation root must be an object" },
                statusCode: StatusCodes.Status400BadRequest);

        if (!root.TryGetProperty("version", out var version) ||
            version.ValueKind != System.Text.Json.JsonValueKind.Number ||
            !version.TryGetInt32(out var versionNumber) ||
            versionNumber != 1)
            return Results.Json(
                new { ok = false, message = "Unsupported automation storage version" },
                statusCode: StatusCodes.Status400BadRequest);

        if (!root.TryGetProperty("scripts", out var scripts) ||
            scripts.ValueKind != System.Text.Json.JsonValueKind.Array)
            return Results.Json(
                new { ok = false, message = "Automation scripts must be an array" },
                statusCode: StatusCodes.Status400BadRequest);

        foreach (var script in scripts.EnumerateArray())
        {
            if (script.ValueKind != System.Text.Json.JsonValueKind.Object)
                return Results.Json(
                    new { ok = false, message = "Automation script entry must be an object" },
                    statusCode: StatusCodes.Status400BadRequest);

            if (!script.TryGetProperty("id", out var id) ||
                id.ValueKind != System.Text.Json.JsonValueKind.String ||
                !script.TryGetProperty("name", out var name) ||
                name.ValueKind != System.Text.Json.JsonValueKind.String ||
                !script.TryGetProperty("script", out var code) ||
                code.ValueKind != System.Text.Json.JsonValueKind.String)
                return Results.Json(
                    new { ok = false, message = "Automation script requires id, name and script strings" },
                    statusCode: StatusCodes.Status400BadRequest);

            var idValue = id.GetString() ?? "";
            var nameValue = name.GetString() ?? "";

            if (idValue.Length == 0 || idValue.Length > 160)
                return Results.Json(
                    new { ok = false, message = "Automation id is invalid" },
                    statusCode: StatusCodes.Status400BadRequest);

            if (nameValue.Length == 0 || nameValue.Length > 160)
                return Results.Json(
                    new { ok = false, message = "Automation name is invalid" },
                    statusCode: StatusCodes.Status400BadRequest);
        }
    }

    var finalPath = DataFile(env, "automations.json");
    var tempPath = finalPath + ".tmp";

    try
    {
        Directory.CreateDirectory(Path.GetDirectoryName(finalPath)!);

        // Write to a temporary file first, then atomically replace/move it,
        // matching the firmware's AtomicFileUpload semantics.
        memory.Position = 0;
        await using (var output = new FileStream(
            tempPath, FileMode.Create, FileAccess.Write, FileShare.None,
            81920, FileOptions.Asynchronous | FileOptions.WriteThrough))
        {
            await memory.CopyToAsync(output);
            await output.FlushAsync();
        }

        File.Move(tempPath, finalPath, true);

        return Results.Json(new
        {
            ok = true,
            bytes = memory.Length
        });
    }
    catch
    {
        try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch { }

        return Results.Json(
            new { ok = false, message = "Automation atomic rename failed" },
            statusCode: StatusCodes.Status500InternalServerError);
    }
});



// Firmware HTTP parity that is platform-neutral.
app.MapGet("/api/signal-logic", async (IWebHostEnvironment env) =>
{
    var path = Path.Combine(env.ContentRootPath, "data", "config", "signal-logic.ndjson");
    if (!File.Exists(path)) return Results.Text("Not found", "text/plain", statusCode:404);
    return Results.Text(await File.ReadAllTextAsync(path), "application/x-ndjson", System.Text.Encoding.UTF8);
});
app.MapPost("/api/signal-logic", async (HttpRequest req, IWebHostEnvironment env, SignalAutomationEngine automation) =>
{
    var final=Path.Combine(env.ContentRootPath,"data","config","signal-logic.ndjson");
    var temp=final+".tmp"; Directory.CreateDirectory(Path.GetDirectoryName(final)!);
    using var sr=new StreamReader(req.Body); var body=await sr.ReadToEndAsync();

    if(!automation.Validate(body))
        return Results.Json(new{ok=false,message="Invalid signal automation NDJSON v2"},statusCode:400);

    try {
        await File.WriteAllTextAsync(temp,body);
        File.Move(temp,final,true);
        if(!automation.Reload())
            return Results.Json(new{ok=false,message="Signal automation committed but runtime reload failed"},statusCode:500);
        await automation.EvaluateAsync();
        return Results.Json(new{ok=true,bytes=System.Text.Encoding.UTF8.GetByteCount(body)});
    }
    catch {
        try{if(File.Exists(temp))File.Delete(temp);}catch{}
        return Results.Json(new{ok=false,message="Signal automation atomic rename failed"},statusCode:500);
    }
});

app.MapGet("/api/runtime", (LayoutRuntime runtime) => Results.Json(new {
    ok=true,
    blockState=runtime.BlockSnapshot(),
    sensorSnapshot=runtime.SensorSnapshot()
}));

app.MapGet("/api/status", (ICommandCenter cc, LayoutRuntime runtime, CommandCenterConfigStore ccStore, IConfiguration cfg) =>
{
    var x=ccStore.Current;
    var urls=cfg["Urls"] ?? "http://0.0.0.0:8080";
    int httpPort=8080;
    var lastColon=urls.LastIndexOf(':');
    if(lastColon>=0)int.TryParse(urls[(lastColon+1)..].TrimEnd('/'),out httpPort);
    return Results.Json(new {
        ok=true,
        // ESP-only network telemetry has neutral native values, while the JSON contract remains identical.
        wifiConnected=false,wifiSsid="",deviceIp="",rssi=0,
        csbConnected=cc.Connected,csbHost=x.Host,csbPort=x.Port,
        hubHostname=Environment.MachineName,hubHttpPort=httpPort,hubDhcp=true,
        uptimeMs=Environment.TickCount64,
        freeHeapBytes=GC.GetGCMemoryInfo().TotalAvailableMemoryBytes,
        accessories=runtime.AccessoryCount,sensors=runtime.SensorCount
    });
});

app.MapPost("/api/emergency-stop", async (ICommandCenter cc, HubState state, WsHub ws) =>
{
    var ok=await cc.EmergencyStopAsync();
    if(ok)
    {
        state.EmergencyStop=cc.EmergencyPauseStateKnown?cc.EmergencyPaused:!state.EmergencyStop;
        await ws.BroadcastPowerState();
    }
    return Results.Json(new {
        ok,
        emergencyStop=state.EmergencyStop,
        message=ok?null:"Emergency stop command could not be sent"
    },statusCode:ok?200:503);
});

// Native parity endpoints used by the current React UI.

app.MapGet("/api/device-config", async (IWebHostEnvironment env) =>
{
    var path = DataFile(env, "device-config.json");
    return Results.Text(
        File.Exists(path) ? await File.ReadAllTextAsync(path) : "{\"version\":1,\"devices\":[]}",
        "application/json", System.Text.Encoding.UTF8);
});

app.MapPost("/api/device-config", async (HttpRequest req, IWebHostEnvironment env) =>
{
    const int maxBytes = 256 * 1024;
    if (req.ContentLength is > maxBytes)
        return Results.Json(new { ok=false, message="Device configuration exceeds 256 KB" }, statusCode:413);

    using var ms = new MemoryStream();
    await req.Body.CopyToAsync(ms);
    if (ms.Length > maxBytes)
        return Results.Json(new { ok=false, message="Device configuration exceeds 256 KB" }, statusCode:413);

    System.Text.Json.JsonDocument doc;
    try { ms.Position=0; doc=await System.Text.Json.JsonDocument.ParseAsync(ms); }
    catch { return Results.Json(new { ok=false, message="Invalid device configuration JSON" }, statusCode:400); }

    using (doc)
    {
        var root=doc.RootElement;
        if (root.ValueKind != System.Text.Json.JsonValueKind.Object)
            return Results.Json(new { ok=false, message="Invalid device configuration JSON" }, statusCode:400);
        if (!root.TryGetProperty("version", out var v) || !v.TryGetInt32(out var vn) || vn != 1)
            return Results.Json(new { ok=false, message="Unsupported device configuration version" }, statusCode:400);
        if (!root.TryGetProperty("devices", out var devices) || devices.ValueKind != System.Text.Json.JsonValueKind.Array)
            return Results.Json(new { ok=false, message="Device configuration requires a devices array" }, statusCode:400);

        var ids=new HashSet<string>(StringComparer.Ordinal);
        var addresses=new HashSet<int>();
        var ranges=new List<(int First,int Last)>();
        int s88Count=0;

        foreach(var d in devices.EnumerateArray())
        {
            if (d.ValueKind != System.Text.Json.JsonValueKind.Object ||
                !d.TryGetProperty("id",out var idEl) || idEl.ValueKind!=System.Text.Json.JsonValueKind.String ||
                !d.TryGetProperty("name",out var nameEl) || nameEl.ValueKind!=System.Text.Json.JsonValueKind.String ||
                !d.TryGetProperty("type",out var typeEl) || typeEl.ValueKind!=System.Text.Json.JsonValueKind.String)
                return Results.Json(new { ok=false, message="Every device requires id, name and type" }, statusCode:400);

            var id=idEl.GetString() ?? ""; var name=nameEl.GetString() ?? ""; var type=typeEl.GetString() ?? "";
            if (id.Length==0 || name.Length==0 || type.Length==0)
                return Results.Json(new { ok=false, message="Every device requires id, name and type" }, statusCode:400);
            if (!ids.Add(id))
                return Results.Json(new { ok=false, message="Device IDs must be unique" }, statusCode:400);
            if (!d.TryGetProperty("enabled",out var en) || (en.ValueKind!=System.Text.Json.JsonValueKind.True && en.ValueKind!=System.Text.Json.JsonValueKind.False) ||
                !d.TryGetProperty("address",out var addrEl) || !addrEl.TryGetInt32(out var address))
                return Results.Json(new { ok=false, message="Device configuration contains invalid required fields" }, statusCode:400);

            bool enabled=en.GetBoolean();
            bool s88=type=="s88adapter";
            bool pca=type=="pca9685";
            bool legacy=pca || type=="mcp23017" || type=="pcf8574" || type=="pcf8575";
            if (!s88 && !legacy)
                return Results.Json(new { ok=false, message=$"Unsupported device type: {type}" }, statusCode:400);
            if (address < 0x08 || address > 0x77)
                return Results.Json(new { ok=false, message="I2C address must be between 0x08 and 0x77" }, statusCode:400);
            if (enabled && !addresses.Add(address))
                return Results.Json(new { ok=false, message="Enabled devices cannot share the same I2C address" }, statusCode:400);

            if (s88) { if (++s88Count>1) return Results.Json(new {ok=false,message="Only one S88 adapter is currently supported"},statusCode:400); }
            else
            {
                if (!d.TryGetProperty("firstVpin",out var fv) || !fv.TryGetInt32(out var first) ||
                    !d.TryGetProperty("pinCount",out var pc) || !pc.TryGetInt32(out var count))
                    return Results.Json(new {ok=false,message="HAL device requires firstVpin and pinCount"},statusCode:400);
                int expected=type=="pcf8574" ? 8 : 16;
                if(first<40 || first>32767 || count!=expected || first+count-1>32767)
                    return Results.Json(new {ok=false,message="HAL device VPIN range or pin count is invalid"},statusCode:400);
                if(pca && (address<0x40 || address>0x7d))
                    return Results.Json(new {ok=false,message="PCA9685 I2C address must be between 0x40 and 0x7D"},statusCode:400);
                if(!pca && (address<0x20 || address>0x27))
                    return Results.Json(new {ok=false,message="Configured digital I2C expander address must be between 0x20 and 0x27"},statusCode:400);
                var last=first+count-1;
                if(enabled && ranges.Any(r=>first<=r.Last && last>=r.First))
                    return Results.Json(new {ok=false,message="Enabled HAL device VPIN ranges cannot overlap"},statusCode:400);
                if(enabled) ranges.Add((first,last));
            }
        }
    }

    var final=DataFile(env,"device-config.json"); var temp=final+".tmp";
    try {
        ms.Position=0; await using(var f=File.Create(temp)){await ms.CopyToAsync(f);await f.FlushAsync();}
        File.Move(temp,final,true);
        return Results.Json(new {ok=true,bytes=ms.Length,s88Applied=false,s88Online=false,
            message="Device configuration saved; native backend does not expose an S88 I2C bus"});
    } catch {
        try{if(File.Exists(temp))File.Delete(temp);}catch{}
        return Results.Json(new {ok=false,message="Device configuration atomic rename failed"},statusCode:500);
    }
});

// Native backend currently has no physical S88 I2C master.
app.MapGet("/api/s88-status", () => Results.Json(new {
    enabled=false, online=false, snapshotKnown=false, dataFresh=false, ready=false,
    adapterInfoKnown=false, protocolVersion=0, firmwareVersion="", firmwareMajor=0,
    firmwareMinor=0, firmwarePatch=0, maxByteCount=0, capabilities=0, address=0,
    addressHex="0x00", baseAddress=0, groupCount=0, byteCount=0, sensorCount=0,
    groups=Array.Empty<object>()
}));

// File-manager flash statistics. On native, report the data volume.
app.MapGet("/fsinfo", (HubFileStorage files) =>
{
    var root=new DriveInfo(Path.GetPathRoot(files.Root)!);
    long used=root.TotalSize-root.AvailableFreeSpace;
    return Results.Json(new { total=root.TotalSize, used, free=root.AvailableFreeSpace });
});

// Stream a virtual storage file with its real MIME type (audio manager uses this).
app.MapGet("/api/storage/file", (string? path, HubFileStorage files) =>
{
    var full=files.Resolve(path);
    if(full is null) return Results.Json(new {ok=false,message="Invalid path"},statusCode:400);
    if(!File.Exists(full)) return Results.Json(new {ok=false,message="File not found"},statusCode:404);
    return Results.File(full, files.ContentType(full), enableRangeProcessing:true);
});

// LittleFS compatibility: /list
app.MapGet("/list", (string? path, HubFileStorage files) =>
{
    try { return Results.Json(files.List(path)); }
    catch (DirectoryNotFoundException) { return Results.Json(new { ok=false, message="Directory not found" }, statusCode:404); }
});

// LittleFS compatibility: read text files
app.MapGet("/api/files/text", async (string? path, HubFileStorage files) =>
{
    var full = files.Resolve(path);
    if (full is null) return Results.Json(new { ok=false, message="Invalid path" }, statusCode:400);
    if (!File.Exists(full)) return Results.Json(new { ok=false, message="File not found" }, statusCode:404);
    return Results.Text(await File.ReadAllTextAsync(full), "text/plain; charset=utf-8");
});

// LittleFS compatibility: multipart upload into a virtual directory.
app.MapPost("/upload", async (HttpRequest req, string? path, HubFileStorage files) =>
{
    if (!req.HasFormContentType)
        return Results.Json(new { ok=false, message="multipart/form-data required" }, statusCode:400);

    var directory = files.Resolve(path, allowRoot:false);
    if (directory is null)
        return Results.Json(new { ok=false, message="Invalid upload path" }, statusCode:400);

    Directory.CreateDirectory(directory);
    var form = await req.ReadFormAsync();
    var upload = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
    if (upload is null)
        return Results.Json(new { ok=false, message="No uploaded file received" }, statusCode:400);

    var safeName = Path.GetFileName(upload.FileName);
    if (string.IsNullOrWhiteSpace(safeName) || safeName.Contains(".."))
        return Results.Json(new { ok=false, message="Invalid upload filename" }, statusCode:400);

    var target = Path.GetFullPath(Path.Combine(directory, safeName));
    if (!target.StartsWith(files.Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        return Results.Json(new { ok=false, message="Invalid upload target" }, statusCode:400);
    if (files.IsProtected(target) || files.IsManagedConfig(target))
        return Results.Json(new { ok=false, message="Upload destination is protected or managed" }, statusCode:403);

    await using (var output = File.Create(target))
        await upload.CopyToAsync(output);

    return Results.Json(new { ok=true, message=$"File uploaded: {path}/{safeName}" });
});

// Firmware supports GET and DELETE for backwards compatibility.
async Task<IResult> DeletePath(string? path, HubFileStorage files)
{
    var full = files.Resolve(path, allowRoot:false);
    if (full is null) return Results.Json(new { ok=false, message="Invalid path" }, statusCode:400);
    if (files.IsProtected(full)) return Results.Json(new { ok=false, message="Path is protected" }, statusCode:403);

    if (File.Exists(full))
    {
        File.Delete(full);
        return Results.Json(new { ok=true, message="Deleted" });
    }
    if (Directory.Exists(full))
    {
        if (Directory.EnumerateFileSystemEntries(full).Any())
            return Results.Json(new { ok=false, message="Directory is not empty" }, statusCode:409);
        Directory.Delete(full);
        return Results.Json(new { ok=true, message="Deleted" });
    }
    return Results.Json(new { ok=false, message="Path not found" }, statusCode:404);
}
app.MapDelete("/delete", DeletePath);
app.MapGet("/delete", DeletePath);

// Expose the native equivalent of LittleFS. Old Hub URLs such as /images/x.jpg
// continue to work, and the current file manager's /flash/* prefix works too.
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(dataRoot),
    RequestPath = "/flash",
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
    catch { return Results.Json(new { ok=false, message="JSON object expected" }, statusCode:400); }
    using(doc)
    {
        if(doc.RootElement.ValueKind != JsonValueKind.Object)
            return Results.Json(new { ok=false, message="JSON object expected" }, statusCode:400);

        var root=doc.RootElement;
        string executionId=root.TryGetProperty("executionId",out var e)&&e.ValueKind==JsonValueKind.String?e.GetString()??"":"";
        string ownerId=root.TryGetProperty("ownerId",out var o)&&o.ValueKind==JsonValueKind.String?o.GetString()??"":"";
        string message=root.TryGetProperty("message",out var m)&&m.ValueKind==JsonValueKind.String?m.GetString()??"":"";
        bool force=root.TryGetProperty("force",out var f)&&f.ValueKind==JsonValueKind.True;

        var r=store.Update(executionId,ownerId,message,force);
        if(!r.ok) return Results.Json(new { ok=false, message=r.error }, statusCode:r.status);
        return message.Length==0
            ? Results.Json(new { ok=true, cleared=r.cleared })
            : Results.Json(new { ok=true });
    }
});

app.MapGet("/api/script-info/events", async (HttpContext ctx, ScriptInfoStore store) =>
{
    ctx.Response.StatusCode=200;
    ctx.Response.ContentType="text/event-stream";
    ctx.Response.Headers.CacheControl="no-store";
    ctx.Response.Headers.Connection="keep-alive";
    var sub=store.Subscribe();
    try
    {
        await foreach(var evt in sub.Reader.ReadAllAsync(ctx.RequestAborted))
        {
            var json=JsonSerializer.Serialize(evt.Data);
            await ctx.Response.WriteAsync($"event: {evt.EventName}\n",ctx.RequestAborted);
            await ctx.Response.WriteAsync($"data: {json}\n\n",ctx.RequestAborted);
            await ctx.Response.Body.FlushAsync(ctx.RequestAborted);
        }
    }
    catch(OperationCanceledException) { }
    finally { store.Unsubscribe(sub.Id); }
});

app.MapFallback(async ctx =>
{
    var index = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "index.html");
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
