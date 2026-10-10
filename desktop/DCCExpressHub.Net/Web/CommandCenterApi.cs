using DCCExpressHub.Net.CommandCenter;
using Microsoft.Extensions.Configuration;

namespace DCCExpressHub.Net.Web;

public sealed record CommandCenterConfigRequest(
    string Host,
    string Port,
    string SerialPort,
    string? PowerIncludesProgramming,
    string? CommandIntervalMs,
    string? RBusOffset);

public sealed record CommandCenterTestRequest(
    string Host,
    string Port);

public sealed record CommandCenterLocoNetTestRequest(
    string Host);

/// <summary>
/// Command-center HTTP/API business logic without web-server request/response
/// types. Watson is only the transport adapter; this service stays independent
/// from the HTTP host.
/// </summary>
public sealed class CommandCenterApi
{
    readonly CommandCenterConfigStore _store;
    readonly ConfiguredCommandCenter _physical;
    readonly ICommandCenter _commandCenter;
    readonly WsHub _ws;
    readonly bool _useZ21RBus;

    public CommandCenterApi(
        CommandCenterConfigStore store,
        ConfiguredCommandCenter physical,
        ICommandCenter commandCenter,
        WsHub ws,
        IConfiguration configuration)
    {
        _store = store;
        _physical = physical;
        _commandCenter = commandCenter;
        _ws = ws;

        var protocol =
            (configuration["CommandCenter:Protocol"] ?? "")
                .Trim();

        _useZ21RBus =
            string.Equals(
                protocol,
                "z21",
                StringComparison.OrdinalIgnoreCase) ||
            string.Equals(
                protocol,
                "yamorc7010",
                StringComparison.OrdinalIgnoreCase);
    }

    public HubApiResponse GetConfig()
    {
        var x = _store.Current;

        return HubApiResponse.Ok(
            new
            {
                ok = true,
                transport = x.Transport,
                host = x.IsSerial ? "" : x.TcpHost,
                port = x.IsSerial ? 0 : x.TcpPort,
                serialPort = x.IsSerial ? x.SerialPort : "",
                baudRate =
                    x.IsSerial
                        ? CommandCenterSettings.DccExSerialBaudRate
                        : 0,
                powerIncludesProgramming =
                    x.PowerIncludesProgramming,
                commandIntervalMs =
                    x.CommandIntervalMs,
                rBusOffset =
                    _useZ21RBus
                        ? x.RBusOffset
                        : 0,
                rBusOffsetConfigurable =
                    _useZ21RBus,
                connected =
                    _commandCenter.Connected
            });
    }

    public async Task<HubApiResponse> SaveConfigAsync(
        CommandCenterConfigRequest request,
        CancellationToken cancellationToken)
    {
        var current =
            _store.Current;

        var powerProg =
            current.PowerIncludesProgramming;

        if (request.PowerIncludesProgramming is not null)
        {
            var value =
                request.PowerIncludesProgramming
                    .Trim()
                    .ToLowerInvariant();

            if (value is "true" or "1" or "yes" or "on")
            {
                powerProg = true;
            }
            else if (value is "false" or "0" or "no" or "off")
            {
                powerProg = false;
            }
            else
            {
                return HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            "Invalid powerIncludesProgramming"
                    });
            }
        }

        var commandIntervalMs =
            current.CommandIntervalMs;

        if (request.CommandIntervalMs is not null)
        {
            if (
                !int.TryParse(
                    request.CommandIntervalMs,
                    out commandIntervalMs) ||
                commandIntervalMs is < 0 or > 1000
            )
            {
                return HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            "Command interval must be between 0 and 1000 ms"
                    });
            }
        }

        var rBusOffset =
            _useZ21RBus
                ? current.RBusOffset
                : 0;

        if (
            _useZ21RBus &&
            request.RBusOffset is not null
        )
        {
            if (
                !int.TryParse(
                    request.RBusOffset,
                    out rBusOffset) ||
                rBusOffset is < 0 or > RocoZ21CommandCenter.MaxRBusOffset
            )
            {
                return HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            $"R-BUS offset must be between 0 and {RocoZ21CommandCenter.MaxRBusOffset}"
                    });
            }
        }

        CommandCenterSettings next;
        string endpoint;
        int endpointValue;

        if (current.IsSerial)
        {
            var serialPort =
                request.SerialPort.Trim();

            // Backward compatibility: older clients sent COMx in host.
            if (serialPort.Length == 0)
                serialPort =
                    request.Host.Trim();

            if (
                !SerialPortName
                    .IsValidForCurrentPlatform(
                        serialPort)
            )
            {
                return HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            OperatingSystem.IsWindows()
                                ? "Invalid serial COM port"
                                : "Invalid serial device path"
                    });
            }

            next =
                new CommandCenterSettings
                {
                    Transport = "serial",
                    TcpHost = current.TcpHost,
                    TcpPort = current.TcpPort,
                    SerialPort = serialPort,
                    PowerIncludesProgramming =
                        powerProg,
                    CommandIntervalMs =
                        commandIntervalMs,
                    RBusOffset =
                        rBusOffset
                };

            endpoint =
                serialPort;

            endpointValue =
                CommandCenterSettings
                    .DccExSerialBaudRate;
        }
        else
        {
            var host =
                request.Host.Trim();

            var portText =
                request.Port.Trim();

            if (!ValidHost(host))
            {
                return HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message = "Invalid host"
                    });
            }

            if (
                !int.TryParse(
                    portText,
                    out var port) ||
                port is < 1 or > 65535
            )
            {
                return HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            "Port must be between 1 and 65535"
                    });
            }

            next =
                new CommandCenterSettings
                {
                    Transport =
                        current.IsZ21
                            ? "z21"
                            : "tcp",
                    TcpHost = host,
                    TcpPort = port,
                    SerialPort =
                        current.SerialPort,
                    PowerIncludesProgramming =
                        current.IsZ21
                            ? false
                            : powerProg,
                    CommandIntervalMs =
                        commandIntervalMs,
                    RBusOffset =
                        rBusOffset
                };

            endpoint =
                host;

            endpointValue =
                port;
        }

        if (
            !await _store.SaveAsync(
                next)
        )
        {
            return HubApiResponse.Error(
                500,
                new
                {
                    ok = false,
                    message =
                        "Command center configuration could not be saved"
                });
        }

        _physical.SetCommandIntervalMs(
            next.CommandIntervalMs);

        if (
            _useZ21RBus &&
            !_physical.SetRBusOffset(
                next.RBusOffset)
        )
        {
            return HubApiResponse.Error(
                500,
                new
                {
                    ok = false,
                    message =
                        "Runtime R-BUS offset change is unavailable"
                });
        }

        if (
            !_physical.SetEndpoint(
                endpoint,
                endpointValue)
        )
        {
            return HubApiResponse.Error(
                500,
                new
                {
                    ok = false,
                    message =
                        "Runtime endpoint change is unavailable"
                });
        }

        await _ws.BroadcastStatus();
        await _ws.BroadcastRuntimeSnapshot();

        var saved =
            _store.Current;

        return HubApiResponse.Ok(
            new
            {
                ok = true,
                transport = saved.Transport,
                host =
                    saved.IsSerial
                        ? ""
                        : saved.TcpHost,
                port =
                    saved.IsSerial
                        ? 0
                        : saved.TcpPort,
                serialPort =
                    saved.IsSerial
                        ? saved.SerialPort
                        : "",
                baudRate =
                    saved.IsSerial
                        ? CommandCenterSettings.DccExSerialBaudRate
                        : 0,
                powerIncludesProgramming =
                    saved.PowerIncludesProgramming,
                commandIntervalMs =
                    saved.CommandIntervalMs,
                rBusOffset =
                    _useZ21RBus
                        ? saved.RBusOffset
                        : 0,
                rBusOffsetConfigurable =
                    _useZ21RBus,
                connected =
                    _physical.Connected
            });
    }

    public async Task<HubApiResponse> TestAsync(
        CommandCenterTestRequest request,
        CancellationToken cancellationToken)
    {
        var host =
            request.Host.Trim();

        if (!ValidHost(host))
        {
            return HubApiResponse.Error(
                400,
                new
                {
                    ok = false,
                    message = "Invalid host"
                });
        }

        if (
            !int.TryParse(
                request.Port,
                out var port) ||
            port is < 1 or > 65535
        )
        {
            return HubApiResponse.Error(
                400,
                new
                {
                    ok = false,
                    message = "Invalid port"
                });
        }

        var probe =
            _store.Current.IsZ21
                ? await CommandCenterProbe
                    .ProbeZ21Async(
                        host,
                        port,
                        cancellationToken)
                : await CommandCenterProbe
                    .ProbeDccExAsync(
                        host,
                        port,
                        cancellationToken);

        if (probe.DccExAlive)
        {
            return HubApiResponse.Ok(
                new
                {
                    ok = true,
                    tcpConnected =
                        probe.TcpConnected,
                    dccExAlive = true,
                    reply = probe.Reply,
                    elapsedMs =
                        probe.ElapsedMs
                });
        }

        return HubApiResponse.Error(
            502,
            new
            {
                ok = false,
                tcpConnected =
                    probe.TcpConnected,
                dccExAlive = false,
                reply = probe.Reply,
                elapsedMs =
                    probe.ElapsedMs,
                message =
                    probe.TcpConnected
                        ? "Command center did not answer"
                        : "Command center connection failed"
            });
    }

    public async Task<HubApiResponse> TestLocoNetAsync(
        CommandCenterLocoNetTestRequest request,
        CancellationToken cancellationToken)
    {
        var host =
            request.Host.Trim();

        if (!ValidHost(host))
        {
            return HubApiResponse.Error(
                400,
                new
                {
                    ok = false,
                    message = "Invalid host"
                });
        }

        var result =
            await _physical.TestLocoNetConnectionAsync(
                host,
                cancellationToken);

        if (result is null)
        {
            return HubApiResponse.Error(
                400,
                new
                {
                    ok = false,
                    message =
                        "LocoNet test is only available for YaMoRC YD7010."
                });
        }

        var payload =
            new
            {
                ok =
                    result.Ok,
                tcpConnected =
                    result.TcpConnected,
                host =
                    result.Host,
                port =
                    result.Port,
                reply =
                    result.Reply,
                elapsedMs =
                    result.ElapsedMs,
                backgroundConnected =
                    result.BackgroundConnected,
                lbServerVersion =
                    result.LbServerVersion,
                lbServerLinesObserved =
                    result.LbServerLinesObserved,
                message =
                    result.Message
            };

        return result.Ok
            ? HubApiResponse.Ok(
                payload)
            : HubApiResponse.Error(
                502,
                payload);
    }

    public HubApiResponse GetInfo()
    {
        var x =
            _store.Current;
        var isLocoNet = string.Equals(
            _commandCenter.Type, "loconet", StringComparison.OrdinalIgnoreCase);

        return HubApiResponse.Ok(
            new
            {
                ok = true,
                type =
                    _commandCenter.Type,
                name =
                    _commandCenter.Name,
                transport =
                    x.Transport,
                defaultPort =
                    x.IsZ21
                        ? RocoZ21CommandCenter.DefaultPort
                        : isLocoNet ? 1234 : 2560,
                defaultBaudRate =
                    CommandCenterSettings.DccExSerialBaudRate,
                connected =
                    _commandCenter.Connected,
                host =
                    x.IsSerial
                        ? ""
                        : x.TcpHost,
                port =
                    x.IsSerial
                        ? 0
                        : x.TcpPort,
                serialPort =
                    x.IsSerial
                        ? x.SerialPort
                        : "",
                baudRate =
                    x.IsSerial
                        ? CommandCenterSettings.DccExSerialBaudRate
                        : 0,
                capabilities =
                    new
                    {
                        trackPower = true,
                        programmingTrackPower =
                            !x.IsZ21 && !isLocoNet,
                        serviceModeProgramming = true,
                        pomProgramming = true,
                        pomRead =
                            x.IsZ21 || isLocoNet,
                        accessoryPomProgramming =
                            x.IsZ21 || isLocoNet,
                        accessoryPomRead =
                            x.IsZ21,
                        rawCommand =
                            !x.IsZ21 && !isLocoNet,
                        vPin =
                            !x.IsZ21 && !isLocoNet,
                        extendedAccessory = true,
                        currentTelemetry = !isLocoNet,
                        trackConfiguration = !isLocoNet,
                        locomotiveControl = true,
                        locomotiveFunctions = true,
                        turnoutControl = true,
                        basicAccessory = true,
                        signalAspect = true,
                        locoNet =
                            _physical.GetLocoNetDiagnostics() is not null
                    }
            });
    }

    public HubApiResponse GetCapabilities() =>
        HubApiResponse.Ok(
            new
            {
                ok = true,
                javascriptAutomation = false,
                fileManager = true,
                deviceConfiguration = true,
                gamepad = true,
                s88 = false,
                programmingTrack = true
            });

    static bool ValidHost(
        string value)
    {
        if (
            value.Length is 0 or > 253
        )
        {
            return false;
        }

        foreach (var c in value)
        {
            if (
                c <= 32 ||
                c is '/' or '\\' or ':' or '<' or '>'
            )
            {
                return false;
            }
        }

        return true;
    }
}
