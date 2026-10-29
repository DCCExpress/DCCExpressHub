using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace DCCExpressHub.Net.Web;

/// <summary>Initial Z21 LAN UDP endpoint for WLANMAUS discovery/handshake.
/// No track-changing commands are accepted until command routing is implemented.</summary>
public sealed class Z21HandheldServer : BackgroundService
{
    readonly ILogger<Z21HandheldServer> _log;
    readonly object _gate = new();
    int _port = 21105;
    bool _enabled;
    int _clients;
    string _state = "Disabled";
    public Z21HandheldServer(ILogger<Z21HandheldServer> log) => _log = log;

    public object Status()
    {
        lock (_gate) return new { enabled = _enabled, port = _port, clients = _clients, state = _state };
    }

    public void Configure(bool enabled, int port)
    {
        if (port is < 1 or > 65535) throw new ArgumentOutOfRangeException(nameof(port));
        lock (_gate) { _enabled = enabled; _port = port; _state = enabled ? "Starting" : "Disabled"; }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            bool enabled; int port;
            lock (_gate) { enabled = _enabled; port = _port; }
            if (!enabled) { await Task.Delay(500, stoppingToken); continue; }
            try
            {
                using var udp = new UdpClient(new IPEndPoint(IPAddress.Any, port));
                lock (_gate) _state = "Listening";
                _log.LogInformation("Z21 handheld UDP listener active on {Port}", port);
                var clients = new HashSet<IPEndPoint>();
                while (!stoppingToken.IsCancellationRequested)
                {
                    lock (_gate) { if (!_enabled || _port != port) break; }
                    using var shortWait = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                    shortWait.CancelAfter(500);
                    UdpReceiveResult packet;
                    try { packet = await udp.ReceiveAsync(shortWait.Token); }
                    catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested) { continue; }
                    var data = packet.Buffer;
                    if (data.Length < 4 || BinaryPrimitives.ReadUInt16LittleEndian(data) != data.Length)
                        continue;
                    clients.Add(packet.RemoteEndPoint);
                    lock (_gate) _clients = clients.Count;
                    var header = BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(2));
                    byte[]? reply = header switch
                    {
                        0x0010 when data.Length == 4 => [8, 0, 0x10, 0, 0x45, 0x58, 0x43, 0x44],
                        0x0040 when data.Length >= 7 && data[4] == 0x21 && data[5] == 0x21
                            => [9, 0, 0x40, 0, 0x63, 0x21, 0x40, 0x12, 0x00],
                        _ => null
                    };
                    if (header == 0x0030) { clients.Remove(packet.RemoteEndPoint); lock (_gate) _clients = clients.Count; }
                    if (reply is not null) await udp.SendAsync(reply, packet.RemoteEndPoint, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Z21 handheld listener unavailable");
                lock (_gate) _state = "Error: " + ex.Message;
                await Task.Delay(2000, stoppingToken);
            }
            finally { lock (_gate) _clients = 0; }
        }
    }
}
