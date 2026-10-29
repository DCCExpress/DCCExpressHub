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
    readonly WsHub _ws;
    readonly object _gate = new();
    int _port = 21105;
    bool _enabled;
    int _clients;
    string _state = "Disabled";
    public Z21HandheldServer(ILogger<Z21HandheldServer> log, WsHub ws) { _log = log; _ws = ws; }

    public object Status()
    {
        lock (_gate) return new { enabled = _enabled, port = _port, clients = _clients, state = _state };
    }

    public void Configure(bool enabled, int port)
    {
        if (port is < 1 or > 65535) throw new ArgumentOutOfRangeException(nameof(port));
        lock (_gate) { _enabled = enabled; _port = port; _state = enabled ? "Starting" : "Disabled"; }
    }

    static bool CheckXor(byte[] frame)
    {
        byte xor = 0;
        for (int i = 4; i < frame.Length - 1; i++) xor ^= frame[i];
        return xor == frame[^1];
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
                    _ws.PublishZ21Packet("RX", packet.RemoteEndPoint.ToString(), data, "Z21 UDP inbound");
                    if (data.Length < 4 || BinaryPrimitives.ReadUInt16LittleEndian(data) != data.Length)
                        continue;
                    clients.Add(packet.RemoteEndPoint);
                    lock (_gate) _clients = clients.Count;
                    var header = BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(2));
                    byte[]? reply = header switch
                    {
                        0x0010 when data.Length == 4 => [8, 0, 0x10, 0, 0x45, 0x58, 0x43, 0x44],
                        0x0040 when data.Length >= 7 && data[4] == 0x21 && data[5] == 0x21
                            => [9, 0, 0x40, 0, 0x63, 0x21, 0x40, 0x12, 0x10],
                        _ => null
                    };
                    if (header == 0x0040 && data.Length >= 7 && CheckXor(data))
                    {
                        if (data[4] == 0xE3 && data.Length == 9 && data[5] == 0xF0)
                        {
                            var address = ((data[6] & 0x3F) << 8) | data[7];
                            if (address > 0) reply = _ws.GetZ21LocoInfo(address);
                        }
                        else if (data[4] == 0x43 && data.Length == 8)
                        {
                            var address = ((data[5] & 0x3F) << 8) | data[6];
                            reply = _ws.GetZ21TurnoutInfo(address + 1);
                        }
                    }
                    if (header == 0x0040 && data.Length >= 7 && CheckXor(data))
                    {
                        var x = data[4];
                        var db = data[5];
                        var handled = false;
                        bool ok = false;
                        if (x == 0xE4 && data.Length == 10)
                        {
                            int address = ((data[6] & 0x3F) << 8) | data[7];
                            if (db == 0xF8)
                            {
                                int fn = data[8] & 0x3F;
                                int mode = data[8] >> 6;
                                if (mode is 0 or 1)
                                {
                                    handled = true;
                                    ok = await _ws.ApplyZ21FunctionAsync(address, fn, mode == 1, stoppingToken);
                                }
                            }
                            else if ((db & 0xF0) == 0x10)
                            {
                                // 128-step DCC: 1 is emergency stop, 2..127 means 1..126 speed.
                                int rawSpeed = data[8] & 0x7F;
                                bool forward = (data[8] & 0x80) != 0;
                                if ((db & 0x0F) == 3 && rawSpeed != 1)
                                {
                                    handled = true;
                                    ok = await _ws.ApplyZ21LocoAsync(address,
                                        rawSpeed == 0 ? 0 : rawSpeed - 1, forward, stoppingToken);
                                }
                            }
                        }
                        else if (x == 0x53 && data.Length == 9)
                        {
                            // Z21 turnout address is zero-based, HUB address is one-based.
                            int address = ((data[5] & 0x3F) << 8) | data[6];
                            bool activate = (data[7] & 0x08) != 0;
                            if (activate && address < ushort.MaxValue)
                            {
                                handled = true;
                                ok = await _ws.ApplyZ21TurnoutAsync((ushort)(address + 1),
                                    (data[7] & 1) == 0, stoppingToken);
                            }
                        }
                        else if (x == 0x21 && data.Length == 7 && db is 0x80 or 0x81)
                        {
                            handled = true;
                            ok = await _ws.ApplyZ21PowerAsync(db == 0x81, stoppingToken);
                        }
                        else if (x == 0x80 && data.Length == 6)
                        {
                            handled = true;
                            ok = await _ws.ApplyZ21StopAsync(stoppingToken);
                        }
                        if (handled)
                        {
                            _ws.PublishZ21Packet("SYS", packet.RemoteEndPoint.ToString(), data,
                                ok ? "Z21 command applied" : "Z21 command rejected");
                        }
                    }
                    if (header == 0x0030) { clients.Remove(packet.RemoteEndPoint); lock (_gate) _clients = clients.Count; }
                    if (reply is not null)
                    {
                        await udp.SendAsync(reply, packet.RemoteEndPoint, stoppingToken);
                        _ws.PublishZ21Packet("TX", packet.RemoteEndPoint.ToString(), reply, "Z21 UDP response");
                    }
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
