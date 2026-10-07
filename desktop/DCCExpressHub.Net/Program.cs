using DCCExpressHub.Net.CommandCenter;
using DCCExpressHub.Net.Web;

var builder =
    Host.CreateApplicationBuilder(
        args);

var contentRoot =
    Environment.GetEnvironmentVariable(
        "DCCEXPRESS_CONTENT_ROOT") ??
    Environment.GetEnvironmentVariable(
        "ASPNETCORE_CONTENTROOT");

if (
    string.IsNullOrWhiteSpace(
        contentRoot)
)
{
    contentRoot =
        builder.Environment
            .ContentRootPath;
}

var webRoot =
    Environment.GetEnvironmentVariable(
        "DCCEXPRESS_WEB_ROOT") ??
    Environment.GetEnvironmentVariable(
        "ASPNETCORE_WEBROOT");

if (
    string.IsNullOrWhiteSpace(
        webRoot)
)
{
    webRoot =
        Path.Combine(
            contentRoot,
            "wwwroot");
}

builder.Services.AddSingleton(
    new AppPaths(
        contentRoot,
        webRoot));

var commandCenterProtocol =
    (
        builder.Configuration[
            "CommandCenter:Protocol"] ??
        ""
    )
    .Trim()
    .ToLowerInvariant();

var useRocoZ21 =
    commandCenterProtocol ==
    "z21";

var useYaMoRcZ21 =
    commandCenterProtocol ==
    "yamorc7010";

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
builder.Services.AddSingleton<DesktopControlApi>();

if (useYaMoRcZ21)
{
    builder.Services
        .AddSingleton<YaMoRcZ21CommandCenter>();

    builder.Services
        .AddHostedService(
            sp =>
                sp.GetRequiredService<
                    YaMoRcZ21CommandCenter>());
}
else if (useRocoZ21)
{
    builder.Services
        .AddSingleton<RocoZ21CommandCenter>();

    builder.Services
        .AddHostedService(
            sp =>
                sp.GetRequiredService<
                    RocoZ21CommandCenter>());
}
else
{
    builder.Services
        .AddSingleton<IDccExTransport>(
            sp =>
                string.Equals(
                    builder.Configuration[
                        "DccEx:Transport"],
                    "Serial",
                    StringComparison
                        .OrdinalIgnoreCase)
                    ? new SerialDccExTransport(
                        builder.Configuration)
                    : new TcpDccExTransport(
                        builder.Configuration));

    builder.Services
        .AddSingleton<DccExCommandCenter>();

    builder.Services
        .AddHostedService(
            sp =>
                sp.GetRequiredService<
                    DccExCommandCenter>());
}

builder.Services
    .AddSingleton<ConfiguredCommandCenter>(
        sp =>
        {
            ICommandCenter inner =
                useYaMoRcZ21
                    ? sp.GetRequiredService<
                        YaMoRcZ21CommandCenter>()
                    : useRocoZ21
                        ? sp.GetRequiredService<
                            RocoZ21CommandCenter>()
                        : sp.GetRequiredService<
                            DccExCommandCenter>();

            return
                new ConfiguredCommandCenter(
                    inner,
                    sp.GetRequiredService<
                        AppPaths>(),
                    sp.GetRequiredService<
                        ILogger<
                            ConfiguredCommandCenter>>());
        });

builder.Services
    .AddSingleton<ICommandCenter>(
        sp =>
            sp.GetRequiredService<
                ConfiguredCommandCenter>());

builder.Services.AddSingleton<FastClockRuntime>();
builder.Services.AddSingleton<SwitchManManager>();
builder.Services.AddSingleton<DispatcherRuntime>();
builder.Services.AddSingleton<MovementPlanBuilder>();
builder.Services.AddSingleton<TrainEventRuntime>();
builder.Services.AddSingleton<MovementRuntime>();
builder.Services.AddSingleton<TrainTrackingRuntime>();
builder.Services.AddSingleton<ScriptRuntime>();
builder.Services.AddSingleton<FlowRuntime>();

builder.Services.AddHostedService(
    sp =>
        sp.GetRequiredService<
            FlowRuntime>());

builder.Services.AddSingleton<TimetableRuntime>();

builder.Services.AddHostedService(
    sp =>
        sp.GetRequiredService<
            TimetableRuntime>());

builder.Services.AddSingleton<CalibrationRuntime>();
builder.Services.AddSingleton<WsHub>();
builder.Services.AddHostedService<WsRuntimeCoordinator>();

// Register the HTTP/WebSocket host last so command-center and automation
// hosted services start before clients can connect.
builder.Services.AddHostedService<WatsonWebServerService>();

using var app =
    builder.Build();

var appPaths =
    app.Services
        .GetRequiredService<
            AppPaths>();

Console.WriteLine(
    $"Web UI root: {appPaths.WebRootPath}");

var ccConfigStore =
    app.Services
        .GetRequiredService<
            CommandCenterConfigStore>();

var persistedCc =
    ccConfigStore.Current;

var configuredCommandCenter =
    app.Services
        .GetRequiredService<
            ConfiguredCommandCenter>();

configuredCommandCenter
    .SetCommandIntervalMs(
        persistedCc.CommandIntervalMs);

if (useRocoZ21 || useYaMoRcZ21)
{
    configuredCommandCenter
        .SetRBusOffset(
            persistedCc.RBusOffset);
}

configuredCommandCenter
    .SetEndpoint(
        persistedCc.IsSerial
            ? persistedCc.SerialPort
            : persistedCc.TcpHost,
        persistedCc.IsSerial
            ? CommandCenterSettings
                .DccExSerialBaudRate
            : persistedCc.TcpPort);

configuredCommandCenter
    .ReloadLocomotiveConfiguration();

var runtimeStateStore =
    app.Services
        .GetRequiredService<
            RuntimeStateStore>();

// Firmware startup order: restore LayoutRuntime state BEFORE
// SignalAutomation subscribes/evaluates.
await runtimeStateStore
    .LoadAsync();

// Only now subscribe/evaluate signal automation against restored state.
_ = app.Services
    .GetRequiredService<
        SignalAutomationEngine>();

Directory.CreateDirectory(
    appPaths.ConfigRootPath);

Directory.CreateDirectory(
    Path.Combine(
        appPaths.DataRootPath,
        "images"));

Directory.CreateDirectory(
    appPaths.StateRootPath);

Directory.CreateDirectory(
    Path.Combine(
        appPaths.SdRootPath,
        "audio"));

var locoCounterRuntime =
    app.Services
        .GetRequiredService<
            LocoCounterRuntime>();

if (
    !locoCounterRuntime
        .ReloadConfiguration(
            false)
)
{
    Console.WriteLine(
        "Locomotive counter configuration could not be loaded.");
}

// WsHub owns command-center event fan-out and backend locomotive counters.
// Resolve it even when no browser is connected.
_ = app.Services
    .GetRequiredService<
        WsHub>();

await app.RunAsync();
