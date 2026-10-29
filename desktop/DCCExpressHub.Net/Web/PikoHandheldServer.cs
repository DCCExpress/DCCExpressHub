using System.Net;
using System.Net.Sockets;
using System.Text;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace DCCExpressHub.Net.Web;

/// <summary>Experimental PIKO SmartControl WLAN TCP bridge. Protocol coverage is incomplete.</summary>
public sealed class PikoHandheldServer : BackgroundService
{
    readonly ILogger<PikoHandheldServer> _log;
    readonly WsHub _ws;
    readonly object _gate = new();
    bool _enabled;
    int _port = 55566, _clients;
    string _state = "Disabled";
    CancellationTokenSource? _listenerStop;
    public PikoHandheldServer(ILogger<PikoHandheldServer> log, WsHub ws) { _log = log; _ws = ws; }
    public object Status() { lock (_gate) return new { enabled = _enabled, port = _port, clients = _clients, state = _state }; }
    public void Configure(bool enabled, int port)
    {
        if (port is < 1 or > 65535) throw new ArgumentOutOfRangeException(nameof(port));
        lock (_gate)
        {
            if (_enabled != enabled || _port != port) _listenerStop?.Cancel();
            _enabled = enabled;
            _port = port;
            _state = enabled ? "Starting" : "Disabled";
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            bool enabled;
            int port;
            lock (_gate) { enabled = _enabled; port = _port; }
            if (!enabled) { await Task.Delay(350, stoppingToken); continue; }
            using var stop = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
            lock (_gate) _listenerStop = stop;
            try
            {
                var listener = new TcpListener(IPAddress.Any, port);
                listener.Start();
                try
                {
                    lock (_gate) _state = "Listening";
                    _log.LogInformation("PIKO SmartControl TCP listener on {Port}", port);
                    while (!stop.IsCancellationRequested)
                    {
                        using var client = await listener.AcceptTcpClientAsync(stop.Token);
                        lock (_gate) _clients++;
                        try { await HandleClient(client, stop.Token); }
                        finally { lock (_gate) _clients--; }
                    }
                }
                finally { listener.Stop(); }
            }
            catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested) { }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "PIKO handheld listener error");
                lock (_gate) _state = "Error: " + ex.Message;
                await Task.Delay(1500, stoppingToken);
            }
            finally { lock (_gate) { if (ReferenceEquals(_listenerStop, stop)) _listenerStop = null; } }
        }
    }

    private async Task HandleClient(TcpClient client, CancellationToken ct)
    {
        string remote = client.Client.RemoteEndPoint?.ToString() ?? "unknown";
        var stream = client.GetStream();
        var buffer = new byte[4096];
        var frame = new List<byte>();
        bool inFrame = false;
        while (!ct.IsCancellationRequested)
        {
            int count = await stream.ReadAsync(buffer, ct);
            if (count == 0) return;
            for (int i = 0; i < count; i++)
            {
                var b = buffer[i];
                if (b == 0x02) { frame.Clear(); inFrame = true; continue; }
                if (!inFrame) continue;
                if (b == 0x03)
                {
                    inFrame = false;
                    if (frame.Count == 0 || (frame.Count & 1) != 0) continue;
                    try
                    {
                        byte[] bytes = Convert.FromHexString(Encoding.ASCII.GetString(frame.ToArray()));
                        _ws.PublishPikoPacket("RX", remote, bytes, "PIKO TCP frame");
                        await ProcessFrame(bytes, remote, ct);
                    }
                    catch (FormatException) { _ws.PublishPikoPacket("SYS", remote, frame.ToArray(), "Invalid ASCII HEX"); }
                    continue;
                }
                if (frame.Count < 8192) frame.Add(b);
                else { frame.Clear(); inFrame = false; }
            }
        }
    }

    private async Task ProcessFrame(byte[] data, string remote, CancellationToken ct)
    {
        // Packet signatures were found in firmware, but handshake and checksums remain
        // unconfirmed. Do not operate physical locomotives until frame validation is known.
        if (data.Length >= 6 && data[0] == 0x0B && data[1] == 0x03 && data[2] == 0x03)
        {
            int address = (data[3] << 8) | data[4];
            _ws.PublishPikoPacket("SYS", remote, data,
                $"Unverified drive frame for loco #{address}; blocked until checksum and direction are verified");
        }
    }
}
