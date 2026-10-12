using System.IO.Ports;
using System.Text;
using WatsonWebserver;
using WatsonWebserver.Core;
using WatsonHttpMethod = WatsonWebserver.Core.HttpMethod;

namespace DCCExpressHub.Net.Web;

public sealed partial class WatsonWebServerService
{
    private readonly SemaphoreSlim _s88Gate = new(1, 1);
    private SerialPort? _s88Port;
    private string _s88PortName = "";

    private void RegisterS88AdapterRoutes(Webserver server)
    {
        Add(server, WatsonHttpMethod.GET, "/api/s88-adapter/ports", async ctx =>
        {
            await SendAsync(ctx, HubApiResponse.Ok(new { ok = true, ports = SerialPort.GetPortNames().OrderBy(x => x).ToArray() }));
        });
        Add(server, WatsonHttpMethod.GET, "/api/s88-adapter/connection", async ctx =>
        {
            await _s88Gate.WaitAsync(ctx.Token);
            try { await SendAsync(ctx, HubApiResponse.Ok(new { ok = true, connected = _s88Port?.IsOpen == true, port = _s88PortName })); }
            finally { _s88Gate.Release(); }
        });
        Add(server, WatsonHttpMethod.POST, "/api/s88-adapter/connect", S88AdapterConnectAsync);
        Add(server, WatsonHttpMethod.POST, "/api/s88-adapter/disconnect", S88AdapterDisconnectAsync);
        Add(server, WatsonHttpMethod.POST, "/api/s88-adapter/command", S88AdapterCommandAsync);
    }

    private async Task S88AdapterConnectAsync(HttpContextBase ctx)
    {
        if (!IsUrlEncodedForm(ctx))
        {
            await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Form data required." }));
            return;
        }
        var form = await ReadUrlEncodedFormAsync(ctx);
        var portName = Get(form, "port").Trim();
        if (!SerialPort.GetPortNames().Contains(portName, StringComparer.OrdinalIgnoreCase))
        {
            await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Select an available serial port." }));
            return;
        }
        await _s88Gate.WaitAsync(ctx.Token);
        try
        {
            if (_s88Port?.IsOpen == true && string.Equals(_s88PortName, portName, StringComparison.OrdinalIgnoreCase))
            {
                await SendAsync(ctx, HubApiResponse.Ok(new { ok = true, connected = true, port = _s88PortName }));
                return;
            }
            _s88Port?.Dispose();
            _s88Port = null;
            _s88PortName = "";
            var serial = new SerialPort(portName, 115200, Parity.None, 8, StopBits.One)
            {
                ReadTimeout = 100, WriteTimeout = 1000, NewLine = "\n"
            };
            try { serial.Open(); }
            catch { serial.Dispose(); throw; }
            _s88Port = serial;
            _s88PortName = portName;
            // Opening an Uno's serial port may reset its processor.
            await Task.Delay(2200, ctx.Token);
            await SendAsync(ctx, HubApiResponse.Ok(new { ok = true, connected = true, port = portName }));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException or TimeoutException)
        {
            _s88Port?.Dispose(); _s88Port = null; _s88PortName = "";
            await SendAsync(ctx, HubApiResponse.Error(503, new { ok = false, connected = false, message = ex.Message }));
        }
        finally { _s88Gate.Release(); }
    }

    private async Task S88AdapterDisconnectAsync(HttpContextBase ctx)
    {
        await _s88Gate.WaitAsync(ctx.Token);
        try
        {
            _s88Port?.Dispose();
            _s88Port = null;
            _s88PortName = "";
            await SendAsync(ctx, HubApiResponse.Ok(new { ok = true, connected = false }));
        }
        finally { _s88Gate.Release(); }
    }

    private async Task S88AdapterCommandAsync(HttpContextBase ctx)
    {
        if (!IsUrlEncodedForm(ctx))
        {
            await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Form data required." }));
            return;
        }
        var form = await ReadUrlEncodedFormAsync(ctx);
        var portName = Get(form, "port").Trim();
        var command = Get(form, "command").Trim().ToUpperInvariant();
        if (portName.Length == 0 || !SerialPort.GetPortNames().Contains(portName, StringComparer.OrdinalIgnoreCase))
        {
            await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Select an available serial port." }));
            return;
        }
        var simple = new[] { "STATUS", "INFO", "READ", "SAVE", "DEFAULTS", "LOG ON", "LOG OFF", "REBOOT", "HELP" };
        var valid = simple.Contains(command);
        if (command.StartsWith("SET BYTES ", StringComparison.Ordinal) &&
            int.TryParse(command["SET BYTES ".Length..], out var bytes) && bytes is >= 1 and <= 32)
            valid = true;
        if (command.StartsWith("SET ADDRESS ", StringComparison.Ordinal))
        {
            var text = command["SET ADDRESS ".Length..];
            var parsed = text.StartsWith("0X", StringComparison.Ordinal)
                ? int.TryParse(text[2..], System.Globalization.NumberStyles.HexNumber, null, out var hex) ? hex : -1
                : int.TryParse(text, out var dec) ? dec : -1;
            if (parsed is >= 8 and <= 119) valid = true;
        }
        if (!valid)
        {
            await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Unsupported adapter command." }));
            return;
        }
        await _s88Gate.WaitAsync(ctx.Token);
        try
        {
            if (_s88Port?.IsOpen != true || !string.Equals(_s88PortName, portName, StringComparison.OrdinalIgnoreCase))
            {
                await SendAsync(ctx, HubApiResponse.Error(409, new { ok = false, message = "Connect to this S88Adapter serial port first." }));
                return;
            }
            // Drain periodic S88 logging so it cannot be mistaken for a command reply.
            _s88Port.DiscardInBuffer();
            _s88Port.Write(command + "\n");
            var output = new StringBuilder();
            var deadline = DateTime.UtcNow.AddMilliseconds(command == "REBOOT" ? 700 : 1100);
            var lastData = DateTime.UtcNow;
            while (DateTime.UtcNow < deadline && output.Length < 12000)
            {
                var available = _s88Port.BytesToRead;
                if (available > 0)
                {
                    var chars = new char[Math.Min(available, 2048)];
                    var count = _s88Port.Read(chars, 0, chars.Length);
                    output.Append(chars, 0, count);
                    lastData = DateTime.UtcNow;
                }
                else if (output.Length > 0 && (DateTime.UtcNow - lastData).TotalMilliseconds > 180)
                    break;
                await Task.Delay(35, ctx.Token);
            }
            var raw = output.ToString();
            var error = raw.Contains("ERR:", StringComparison.OrdinalIgnoreCase) ||
                (string.IsNullOrWhiteSpace(raw) && command != "REBOOT") ||
                (command == "READ" && !raw.Contains("S88:", StringComparison.Ordinal));
            if (command == "REBOOT") { _s88Port.Dispose(); _s88Port = null; _s88PortName = ""; }
            await SendAsync(ctx, error
                ? HubApiResponse.Error(502, new { ok = false, port = portName, command, raw, message = "No valid adapter reply, or adapter rejected command." })
                : HubApiResponse.Ok(new { ok = true, port = portName, command, raw, message = "Command completed." }));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException or TimeoutException)
        {
            _s88Port?.Dispose(); _s88Port = null; _s88PortName = "";
            await SendAsync(ctx, HubApiResponse.Error(503, new { ok = false, message = ex.Message }));
        }
        finally { _s88Gate.Release(); }
    }
}
