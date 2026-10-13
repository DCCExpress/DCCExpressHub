using DCCExpressHub.Net.CommandCenter;
using Microsoft.Extensions.Configuration;

namespace DCCExpressHub.Net.Web;

/// <summary>
/// Owns the physical command-center session. Hub services keep the stable
/// ConfiguredCommandCenter; no physical connection is made at process startup.
/// A user explicitly activates the saved/edited profile with OK on the
/// Command Center Configuration page.
/// </summary>
public sealed class CommandCenterSessionManager : IHostedService
{
    private readonly ConfiguredCommandCenter _hub;
    private readonly IServiceProvider _services;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CommandCenterSessionManager> _log;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private BackgroundService? _active;
    private bool _started;

    public bool Started => Volatile.Read(ref _started);

    public CommandCenterSessionManager(
        ConfiguredCommandCenter hub, IServiceProvider services,
        IConfiguration configuration, ILogger<CommandCenterSessionManager> log)
    {
        _hub = hub;
        _services = services;
        _configuration = configuration;
        _log = log;
    }

    // Hosted lifetime only manages shutdown. This START NEVER connects:
    // activation always requires an explicit Web UI OK.
    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        try { await DeactivateAsync(); }
        catch (Exception ex)
        {
            _log.LogCritical(ex,
                "Command-center shutdown could not confirm physical stop/power off.");
        }
    }

    private ILogger<T> Log<T>() => _services.GetRequiredService<ILogger<T>>();

    private (BackgroundService Service, ICommandCenter Driver) Create(CommandCenterSettings settings)
    {
        // An isolated settings overlay prevents a previous command center's
        // environment variables from silently overriding the selected profile.
        var overlay = new Dictionary<string, string?>
        {
            ["CommandCenter:Protocol"] = settings.Vendor switch
            {
                "roco-z21" => "z21",
                "yamorc-yd7010" => "yamorc7010",
                "loconet" => settings.Transport,
                _ => settings.Transport
            },
            ["Z21:Host"] = settings.TcpHost,
            ["Z21:Port"] = settings.TcpPort.ToString(),
            ["Z21:RBusOffset"] = settings.RBusOffset.ToString(),
            ["DccEx:Host"] = settings.TcpHost,
            ["DccEx:Port"] = settings.TcpPort.ToString(),
            ["DccEx:SerialPort"] = settings.SerialPort,
            ["DccEx:Transport"] = settings.IsSerial ? "Serial" : "Tcp",
            ["LocoNet:Host"] = settings.TcpHost,
            ["LocoNet:SensorOffset"] = settings.LocoNetOffset.ToString(),
            ["LocoNet:LbServerPort"] = settings.Vendor == "loconet" && !settings.IsSerial
                ? settings.TcpPort.ToString() : "1234",
            ["LocoNet:LbServerFeedback"] = settings.UseLocoNet.ToString(),
            ["LocoNet:FeedbackEnabled"] = settings.UseLocoNet.ToString(),
            ["LocoNet:SerialFeedback"] = "false",
            ["LocoNet:BinaryFeedback"] = "false",
            ["LocoNet:SerialPort"] = settings.SerialPort,
            ["LocoNet:SerialBaudRate"] = CommandCenterSettings.DccExSerialBaudRate.ToString()
        };
        var cfg = new ConfigurationBuilder()
            .AddConfiguration(_configuration)
            .AddInMemoryCollection(overlay)
            .Build();

        BackgroundService driver = settings.Vendor switch
        {
            "roco-z21" => new RocoZ21CommandCenter(cfg, Log<RocoZ21CommandCenter>()),
            "yamorc-yd7010" => new YaMoRcZ21CommandCenter(cfg, Log<YaMoRcZ21CommandCenter>()),
            "loconet" => new LocoNetCommandCenter(
                settings.IsSerial
                    ? new LocoNetSerialTransport(cfg, Log<LocoNetSerialTransport>())
                    : new LocoNetTcpTransport(cfg, Log<LocoNetTcpTransport>()),
                Log<LocoNetCommandCenter>(), cfg),
            _ => new DccExCommandCenter(
                settings.IsSerial
                    ? new SerialDccExTransport(settings.SerialPort)
                    : new TcpDccExTransport(settings.TcpHost, settings.TcpPort),
                Log<DccExCommandCenter>())
        };
        return (driver, (ICommandCenter)driver);
    }

    public async Task ActivateAsync(CommandCenterSettings settings, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            await StopCurrentAsync();
            ct.ThrowIfCancellationRequested();
            var (service, driver) = Create(settings);
            _hub.ReplaceInner(driver);
            _hub.SetCommandIntervalMs(settings.CommandIntervalMs);
            if (settings.Vendor is "roco-z21" or "yamorc-yd7010")
                _hub.SetRBusOffset(settings.RBusOffset);
            try
            {
                await service.StartAsync(ct);
                Volatile.Write(ref _started, true);
                _active = service;
                _log.LogInformation("Command center activated: {Vendor} {Endpoint}",
                    settings.Vendor, driver.Endpoint);
            }
            catch
            {
                service.Dispose();
                throw;
            }
        }
        finally { _gate.Release(); }
    }

    public async Task DeactivateAsync(CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try { await StopCurrentAsync(); }
        finally { _gate.Release(); }
    }

    private async Task StopCurrentAsync()
    {
        var active = _active;
        if (active is null) return;

        // No automation may keep driving after its underlying physical driver
        // changes. Cancel planners before sending physical stop / power off.
        _services.GetRequiredService<TimetableRuntime>().StopScheduler();
        _services.GetRequiredService<FlowRuntime>().AbortAll("Command center configuration reopened.");
        _services.GetRequiredService<ScriptRuntime>().AbortAll("Command center configuration reopened.");
        _services.GetRequiredService<CalibrationRuntime>().Stop();
        try { await _services.GetRequiredService<PrecisionBrakingRuntime>().StopAsync(); }
        catch (Exception ex) { _log.LogWarning(ex, "Precision braking stop during command-center switch failed"); }
        _services.GetRequiredService<MovementRuntime>().StopAll(emergencyStop: false);

        // Do not abandon control of a running train unless at least one safe
        // physical intervention (E-STOP or track power off) was acknowledged.
        if (_hub.Connected)
        {
            // DCC-EX emergency stop is a toggle: never send it if the
            // command station is already emergency-paused (would RESUME!).
            bool stopped = _hub.EmergencyPauseStateKnown && _hub.EmergencyPaused;
            bool poweredOff = false;
            if (!stopped)
            {
                using var stopCts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                try { stopped = await _hub.EmergencyStopAsync(stopCts.Token); }
                catch (Exception ex) { _log.LogWarning(ex, "Emergency stop before command-center switch failed"); }
            }
            using var powerCts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            try { poweredOff = await _hub.SetTrackPowerAsync(false, ct: powerCts.Token); }
            catch (Exception ex) { _log.LogWarning(ex, "Track power off before command-center switch failed"); }
            if (!stopped && !poweredOff)
                throw new InvalidOperationException(
                    "Cannot leave Command Center: neither emergency stop nor track power off was acknowledged.");
        }

        _active = null;
        Volatile.Write(ref _started, false);
        try { await active.StopAsync(CancellationToken.None); }
        finally
        {
            // Event handlers in the stable wrapper reject obsolete drivers;
            // an explicit disconnect invalidates sensor states to UNKNOWN.
            _hub.NotifyDeactivated();
            active.Dispose();
        }
    }
}
