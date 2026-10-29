using DCCExpressHub.Net.CommandCenter;
using DCCExpressHub.Net.Web;
using Microsoft.Extensions.Hosting;

namespace DCCExpressHub.Net;

public sealed class HubRuntime : IAsyncDisposable
{
    private IHost? _host;
    public bool IsRunning => _host is not null;

    public async Task StartAsync(string[]? args = null, CancellationToken ct = default, Action<string>? log = null)
    {
        if (_host is not null) throw new InvalidOperationException("Hub already started");
    
    var builder = Host.CreateApplicationBuilder(args);
    if (log is not null)
        builder.Logging.AddProvider(new RuntimeLogProvider(log));
    
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
    
    var commandCenterProtocol =
        (
            builder.Configuration[
                "CommandCenter:Protocol"] ??
            ""
        )
        .Trim()
        .ToLowerInvariant();
    
    var useLocoNetTcp =
        commandCenterProtocol == "loconet";
    
    var useLocoNetSerial =
        commandCenterProtocol == "loconet-serial";
    
    var useRocoZ21 =
        commandCenterProtocol ==
        "z21";
    
    var useYaMoRcZ21 =
        commandCenterProtocol ==
        "yamorc7010";
    
    builder.Services.AddSingleton<RailComSenseSettings>();
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
    builder.Services.AddSingleton<ExternalDeviceStore>();
    builder.Services.AddSingleton<ExternalDevicesRuntime>();
    builder.Services.AddSingleton<Z21HandheldServer>();
    builder.Services.AddHostedService(sp => sp.GetRequiredService<Z21HandheldServer>());
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
    
    if (useLocoNetSerial || useLocoNetTcp)
    {
        builder.Services.AddSingleton<ILocoNetTransport>(sp =>
            useLocoNetSerial
                ? new LocoNetSerialTransport(builder.Configuration,
                    sp.GetRequiredService<ILogger<LocoNetSerialTransport>>())
                : new LocoNetTcpTransport(builder.Configuration,
                    sp.GetRequiredService<ILogger<LocoNetTcpTransport>>()));
        builder.Services.AddSingleton<LocoNetCommandCenter>();
        builder.Services.AddHostedService(
            sp => sp.GetRequiredService<LocoNetCommandCenter>());
    }
    else if (useYaMoRcZ21)
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
                    (useLocoNetSerial || useLocoNetTcp)
                        ? sp.GetRequiredService<LocoNetCommandCenter>()
                        : useYaMoRcZ21
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
    builder.Services.AddSingleton<SequentialMovementRuntime>();
    builder.Services.AddSingleton<TrainDriverRuntime>();
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
    
    builder.Services.AddSingleton<WsRuntimeCoordinator>();
    builder.Services.AddHostedService(sp => sp.GetRequiredService<WsRuntimeCoordinator>());
    
    // Register the HTTP/WebSocket host last so command-center and automation
    // hosted services start before clients can connect.
    builder.Services.AddHostedService(sp => sp.GetRequiredService<ExternalDevicesRuntime>());
    builder.Services.AddHostedService<WatsonWebServerService>();
    
    var app = builder.Build();
    
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
    
    _ = app.Services.GetRequiredService<PrecisionBrakingRuntime>();
    _host = app;
    await app.StartAsync(ct);
    }

    public Task WaitForShutdownAsync(CancellationToken ct = default)
    {
        var host = _host ?? throw new InvalidOperationException("Hub is not started");
        return host.WaitForShutdownAsync(ct);
    }

    public async Task StopAsync(CancellationToken ct = default)
    {
        var host = _host;
        _host = null;
        if (host is null) return;
        try { await host.StopAsync(ct).ConfigureAwait(false); }
        finally { host.Dispose(); }
    }

    public async ValueTask DisposeAsync() => await StopAsync().ConfigureAwait(false);
}
