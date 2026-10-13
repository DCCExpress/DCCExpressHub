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

// Apply a validated pending workspace restore before any runtime can read state.
if (WorkspaceBackupService.ApplyPendingOnStartup(Path.GetFullPath(contentRoot)))
    Console.WriteLine("Workspace backup restored; previous workspace retained in .dcc-backup-previous.");

builder.Services.AddSingleton(
    new AppPaths(
        contentRoot,
        webRoot));

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
builder.Services.AddSingleton<CommandCenterStartupApi>();
builder.Services.AddSingleton<ExternalDeviceStore>();
builder.Services.AddSingleton<ExternalDevicesRuntime>();
builder.Services.AddSingleton<LocomotiveConfigApi>();
builder.Services.AddSingleton<LayoutConfigApi>();
builder.Services.AddSingleton<AutomationConfigApi>();
builder.Services.AddSingleton<DeviceConfigApi>();
builder.Services.AddSingleton<CalibrationApi>();
builder.Services.AddSingleton<RuntimeSystemApi>();
builder.Services.AddSingleton<FileManagerApi>();
builder.Services.AddSingleton<ScriptInfoApi>();
builder.Services.AddSingleton<DesktopControlApi>();

// The startup browser must be usable without a physical command station.
// A dormant DCC-EX driver is only a safe ICommandCenter placeholder;
// CommandCenterSessionManager creates/starts the selected physical driver on OK.
builder.Services.AddSingleton<ConfiguredCommandCenter>(sp =>
    new ConfiguredCommandCenter(
        new DccExCommandCenter(new TcpDccExTransport("127.0.0.1", 2560),
            sp.GetRequiredService<ILogger<DccExCommandCenter>>()),
        sp.GetRequiredService<AppPaths>(),
        sp.GetRequiredService<ILogger<ConfiguredCommandCenter>>()));
builder.Services.AddSingleton<ICommandCenter>(sp =>
    sp.GetRequiredService<ConfiguredCommandCenter>());
builder.Services.AddSingleton<CommandCenterSessionManager>();

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
builder.Services.AddSingleton<PrecisionBrakingRuntime>();
builder.Services.AddSingleton<WsHub>();

// Manager has a no-op host StartAsync and is not allowed to activate hardware
// automatically; hosted lifetime ensures the driver is stopped on shutdown.
builder.Services.AddHostedService(sp => sp.GetRequiredService<CommandCenterSessionManager>());
builder.Services.AddHostedService<WsRuntimeCoordinator>();
// Subscribe to external sensor feedback before starting serial readers.
builder.Services.AddHostedService(sp => sp.GetRequiredService<ExternalDevicesRuntime>());

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

// Reading the persisted profile does not connect to hardware.
_ = ccConfigStore.Current;

var configuredCommandCenter =
    app.Services
        .GetRequiredService<
            ConfiguredCommandCenter>();

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

_ = app.Services.GetRequiredService<PrecisionBrakingRuntime>();
await app.RunAsync();
