using System.IO.Ports;
using System.Net.Sockets;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed record CommandCenterStartupRequest(
    string Vendor, string Transport, string Host, int Port, string SerialPort,
    int RBusOffset, int LocoNetOffset, bool UseLocoNet, int CommandIntervalMs);

/// <summary>
/// Configuration-first startup shared by Desktop WebView2 and Linux/browser.
/// The Hub core is online, but a command center is only started after OK.
/// </summary>
public sealed class CommandCenterStartupApi
{
    readonly CommandCenterConfigStore _store;
    readonly CommandCenterSessionManager _sessions;
    readonly ExternalDeviceStore _externalDevices;
    readonly WsHub _ws;

    public CommandCenterStartupApi(
        CommandCenterConfigStore store, CommandCenterSessionManager sessions,
        ExternalDeviceStore externalDevices, WsHub ws)
    {
        _store = store;
        _sessions = sessions;
        _externalDevices = externalDevices;
        _ws = ws;
    }

    public HubApiResponse Get() => HubApiResponse.Ok(new
    {
        ok = true, started = _sessions.Started,
        config = _store.Current,
        supportedVendors = new[] { "dcc-ex", "roco-z21", "yamorc-yd7010", "loconet" }
    });

    private static string? Validate(CommandCenterStartupRequest p)
    {
        if (p.Vendor is not ("dcc-ex" or "roco-z21" or "yamorc-yd7010" or "loconet"))
            return "Unsupported command-center manufacturer.";
        if (p.Vendor == "dcc-ex" && p.Transport is not ("tcp" or "serial"))
            return "DCC-EX transport must be TCP or USB Serial.";
        if (p.Vendor is "roco-z21" or "yamorc-yd7010" && p.Transport != "z21")
            return "Roco Z21 and YaMoRC YD7010 use Z21 UDP.";
        if (p.Vendor == "loconet" && p.Transport is not ("loconet" or "loconet-serial"))
            return "LocoNet transport must be TCP or Serial.";
        var isSerial = p.Transport is "serial" or "loconet-serial";
        if (isSerial)
        {
            if (!SerialPortName.IsValidForCurrentPlatform(p.SerialPort))
                return "Invalid serial port for this operating system.";
        }
        else
        {
            if (string.IsNullOrWhiteSpace(p.Host) || p.Host.Length > 253 ||
                p.Host.Any(c => c <= 32 || c is '/' or '\\' or ':' or '<' or '>'))
                return "Invalid IP address / hostname.";
            if (p.Port is < 1 or > 65535)
                return "Port must be 1–65535.";
        }
        if (p.RBusOffset is < 0 or > RocoZ21CommandCenter.MaxRBusOffset)
            return "Invalid R-BUS sensor offset.";
        if (p.LocoNetOffset is < 0 or > YaMoRcLocoNetClient.MaxSensorOffset)
            return "Invalid LocoNet sensor offset.";
        if (p.CommandIntervalMs is < 0 or > 1000)
            return "Command interval must be 0–1000 ms.";
        if (p.Vendor == "yamorc-yd7010" && p.UseLocoNet &&
            p.RBusOffset + 1 <= p.LocoNetOffset + 4096 &&
            p.LocoNetOffset + 1 <= p.RBusOffset + 160)
            return "R-BUS and LocoNet sensor address ranges overlap.";
        return null;
    }

    private string? CheckExternalConflicts(CommandCenterStartupRequest p)
    {
        var devices = _externalDevices.List().Where(x => x.Enabled).ToArray();
        if (p.Transport is "serial" or "loconet-serial" &&
            devices.Any(x => string.Equals(x.SerialPort, p.SerialPort, StringComparison.OrdinalIgnoreCase)))
            return "Command-center COM port is reserved by an enabled External Device.";

        var ranges = new List<(int Start, int End, string Name)>();
        if (p.Vendor is "roco-z21" or "yamorc-yd7010")
            ranges.Add((p.RBusOffset + 1, p.RBusOffset + 160, "R-BUS"));
        if (p.Vendor == "yamorc-yd7010" && p.UseLocoNet)
            ranges.Add((p.LocoNetOffset + 1, p.LocoNetOffset + 4096, "LocoNet"));
        foreach (var d in devices)
            foreach (var range in ranges)
                if (d.SensorOffset + 1 <= range.End &&
                    range.Start <= d.SensorOffset + d.SensorCount)
                    return $"External Device '{d.Name}' overlaps {range.Name} sensor addresses.";
        return null;
    }

    private static CommandCenterSettings ToSettings(CommandCenterStartupRequest p) => new()
    {
        Vendor = p.Vendor,
        Transport = p.Transport,
        TcpHost = p.Host.Trim(),
        TcpPort = p.Port,
        SerialPort = p.SerialPort.Trim(),
        RBusOffset = p.RBusOffset,
        LocoNetOffset = p.LocoNetOffset,
        UseLocoNet = p.UseLocoNet,
        CommandIntervalMs = p.CommandIntervalMs,
        PowerIncludesProgramming = p.Vendor == "dcc-ex"
    };

    public async Task<HubApiResponse> StartAsync(CommandCenterStartupRequest profile, CancellationToken ct)
    {
        var error = Validate(profile) ?? CheckExternalConflicts(profile);
        if (error is not null)
            return HubApiResponse.Error(400, new { ok = false, message = error });

        var settings = ToSettings(profile);
        if (!await _store.SaveAsync(settings))
            return HubApiResponse.Error(500, new { ok = false, message = "Failed to save command-center profile." });
        try
        {
            await _sessions.ActivateAsync(_store.Current, ct);
            await _ws.BroadcastStatus();
            await _ws.BroadcastRuntimeSnapshot();
            return HubApiResponse.Ok(new
            {
                ok = true,
                started = true,
                connected = _store.Current.Vendor == "dcc-ex" ? false : false,
                vendor = profile.Vendor
            });
        }
        catch (Exception ex) when (ex is IOException or ArgumentException or InvalidOperationException)
        {
            return HubApiResponse.Error(500, new { ok = false, message = ex.Message });
        }
    }

    public async Task<HubApiResponse> StopAsync(CancellationToken ct)
    {
        await _sessions.DeactivateAsync(ct);
        await _ws.BroadcastStatus();
        await _ws.BroadcastRuntimeSnapshot();
        return HubApiResponse.Ok(new { ok = true, started = false });
    }

    public async Task<HubApiResponse> TestAsync(CommandCenterStartupRequest profile, bool locoNet, CancellationToken ct)
    {
        var error = Validate(profile) ?? CheckExternalConflicts(profile);
        if (error is not null)
            return HubApiResponse.Error(400, new { ok = false, message = error });
        try
        {
            if (locoNet)
            {
                if (profile.Vendor != "yamorc-yd7010")
                    return HubApiResponse.Error(400, new { ok = false, message = "LocoNet LBServer test is available for YaMoRC." });
                using var client = new TcpClient();
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromSeconds(3));
                await client.ConnectAsync(profile.Host, 1234, timeout.Token);
                return HubApiResponse.Ok(new { ok = true, message = "LocoNet LBServer TCP port 1234 reachable (bus feedback not yet verified)." });
            }

            if (profile.Transport is "serial" or "loconet-serial")
            {
                // Only the serial port can be probed generically: don't claim
                // that a matching DCC-EX/LocoNet protocol response was read.
                using var serial = new SerialPort(profile.SerialPort, 115200);
                serial.Open();
                return HubApiResponse.Ok(new { ok = true, message = "Serial port opened; command-center protocol not verified." });
            }

            var result = profile.Transport == "z21"
                ? await CommandCenterProbe.ProbeZ21Async(profile.Host, profile.Port, ct)
                : await CommandCenterProbe.ProbeDccExAsync(profile.Host, profile.Port, ct);
            return result.DccExAlive
                ? HubApiResponse.Ok(new { ok = true, message = result.Reply, elapsedMs = result.ElapsedMs })
                : HubApiResponse.Error(502, new { ok = false, message = "No valid command-center reply.", reply = result.Reply });
        }
        catch (Exception ex) when (ex is IOException or SocketException or UnauthorizedAccessException or OperationCanceledException or InvalidOperationException or ArgumentException)
        {
            return HubApiResponse.Error(502, new { ok = false, message = ex.Message });
        }
    }
}
