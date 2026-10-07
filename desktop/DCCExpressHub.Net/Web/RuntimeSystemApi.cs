using DCCExpressHub.Net.CommandCenter;
using Microsoft.Extensions.Configuration;

namespace DCCExpressHub.Net.Web;

public sealed class RuntimeSystemApi
{
    readonly ICommandCenter _commandCenter;
    readonly LayoutRuntime _runtime;
    readonly CommandCenterConfigStore _commandCenterConfig;
    readonly IConfiguration _configuration;
    readonly HubState _hubState;
    readonly WsHub _ws;

    public RuntimeSystemApi(
        ICommandCenter commandCenter,
        LayoutRuntime runtime,
        CommandCenterConfigStore commandCenterConfig,
        IConfiguration configuration,
        HubState hubState,
        WsHub ws)
    {
        _commandCenter =
            commandCenter;
        _runtime =
            runtime;
        _commandCenterConfig =
            commandCenterConfig;
        _configuration =
            configuration;
        _hubState =
            hubState;
        _ws =
            ws;
    }

    public HubApiResponse GetRuntime() =>
        HubApiResponse.Ok(
            new
            {
                ok = true,
                blockState =
                    _runtime.BlockSnapshot(),
                sensorSnapshot =
                    _runtime.SensorSnapshot()
            });

    public HubApiResponse GetStatus()
    {
        var x =
            _commandCenterConfig.Current;

        var urls =
            Environment.GetEnvironmentVariable(
                "DCCEXPRESS_HTTP_URL") ??
            Environment.GetEnvironmentVariable(
                "DCCEXPRESS_DESKTOP_URL") ??
            _configuration["Urls"] ??
            "http://0.0.0.0:5174";

        var httpPort =
            5174;

        var firstUrl =
            urls.Split(
                    ';',
                    StringSplitOptions.RemoveEmptyEntries |
                    StringSplitOptions.TrimEntries)
                .FirstOrDefault();

        if (
            firstUrl is not null &&
            Uri.TryCreate(
                firstUrl,
                UriKind.Absolute,
                out var uri)
        )
        {
            httpPort =
                uri.Port;
        }

        return HubApiResponse.Ok(
            new
            {
                ok = true,
                wifiConnected =
                    false,
                wifiSsid =
                    "",
                deviceIp =
                    "",
                rssi =
                    0,
                csbConnected =
                    _commandCenter.Connected,
                csbTransport =
                    x.Transport,
                csbHost =
                    x.IsSerial
                        ? ""
                        : x.TcpHost,
                csbPort =
                    x.IsSerial
                        ? 0
                        : x.TcpPort,
                csbSerialPort =
                    x.IsSerial
                        ? x.SerialPort
                        : "",
                csbBaudRate =
                    x.IsSerial
                        ? CommandCenterSettings.DccExSerialBaudRate
                        : 0,
                hubHostname =
                    Environment.MachineName,
                hubHttpPort =
                    httpPort,
                hubDhcp =
                    true,
                uptimeMs =
                    Environment.TickCount64,
                freeHeapBytes =
                    GC.GetGCMemoryInfo()
                        .TotalAvailableMemoryBytes,
                accessories =
                    _runtime.AccessoryCount,
                sensors =
                    _runtime.SensorCount
            });
    }

    public async Task<HubApiResponse> EmergencyStopAsync(
        CancellationToken cancellationToken = default)
    {
        var ok =
            await _commandCenter
                .EmergencyStopAsync(
                    cancellationToken);

        if (ok)
        {
            _hubState.EmergencyStop =
                _commandCenter
                    .EmergencyPauseStateKnown
                    ? _commandCenter
                        .EmergencyPaused
                    : !_hubState
                        .EmergencyStop;

            await _ws
                .BroadcastPowerState();
        }

        return ok
            ? HubApiResponse.Ok(
                new
                {
                    ok = true,
                    emergencyStop =
                        _hubState.EmergencyStop,
                    message =
                        (string?)null
                })
            : HubApiResponse.Error(
                503,
                new
                {
                    ok = false,
                    emergencyStop =
                        _hubState.EmergencyStop,
                    message =
                        "Emergency stop command could not be sent"
                });
    }

    public HubApiResponse GetS88Status() =>
        HubApiResponse.Ok(
            new
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
                groups =
                    Array.Empty<object>()
            });
}
