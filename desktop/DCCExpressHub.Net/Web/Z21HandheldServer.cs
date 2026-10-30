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
    // A WLANMAUS receives unsolicited loco updates for addresses it has requested.
    readonly System.Collections.Concurrent.ConcurrentDictionary<int, byte> _pendingLocoUpdates = new();
    readonly System.Collections.Concurrent.ConcurrentDictionary<int, byte> _pendingTurnoutUpdates = new();
    int _pendingPowerUpdate;
    sealed class ListenerState
    {
        public required int Port { get; init; }
        public string State { get; set; } = "Starting";
        public int Clients { get; set; }
        public CancellationTokenSource? Cancellation { get; set; }
        public Task? Task { get; set; }
    }
    readonly Dictionary<int, ListenerState> _listeners = new();

    public Z21HandheldServer(ILogger<Z21HandheldServer> log, WsHub ws)
    {
        _log = log;
        _ws = ws;
        _ws.Z21LocoStateChanged += address => _pendingLocoUpdates[address] = 0;
        _ws.Z21TurnoutStateChanged += address => _pendingTurnoutUpdates[address] = 0;
        _ws.Z21PowerStateChanged += () => Interlocked.Exchange(ref _pendingPowerUpdate, 1);
    }

    public object Status()
    {
        lock (_gate) return new
        {
            enabled = _listeners.Count > 0,
            port = _listeners.Keys.FirstOrDefault(),
            clients = _listeners.Values.Sum(x => x.Clients),
            state = _listeners.Count == 0 ? "Disabled" : string.Join(", ", _listeners.Values.Select(x => x.State)),
            listeners = _listeners.Values.Select(x => new
            {
                port = x.Port, enabled = true, clients = x.Clients, state = x.State
            }).ToArray()
        };
    }

    public void Configure(bool enabled, int port)
    {
        if (port is < 1 or > 65535) throw new ArgumentOutOfRangeException(nameof(port));
        lock (_gate)
        {
            if (enabled)
            {
                if (!_listeners.ContainsKey(port))
                    _listeners[port] = new ListenerState { Port = port };
            }
            else if (_listeners.Remove(port, out var listener))
                listener.Cancellation?.Cancel();
        }
    }

    static bool CheckXor(byte[] frame)
    {
        byte xor = 0;
        for (int i = 4; i < frame.Length - 1; i++) xor ^= frame[i];
        return xor == frame[^1];
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                lock (_gate)
                {
                    foreach (var listener in _listeners.Values)
                    {
                        if (listener.Task is not null) continue;
                        listener.Cancellation = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                        listener.Task = ListenAsync(listener, listener.Cancellation.Token);
                    }
                }
                await Task.Delay(500, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally
        {
            Task[] running;
            lock (_gate)
            {
                foreach (var item in _listeners.Values) item.Cancellation?.Cancel();
                running = _listeners.Values.Select(x => x.Task).OfType<Task>().ToArray();
            }
            try { await Task.WhenAll(running); }
            catch (OperationCanceledException) { }
        }
    }

    private async Task ListenAsync(ListenerState listener, CancellationToken stoppingToken)
    {
        int port = listener.Port;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var udp = new UdpClient(new IPEndPoint(IPAddress.Any, port));
                lock (_gate) listener.State = "Listening";
                _log.LogInformation("Z21 handheld UDP listener active on {Port}", port);
                var clients = new HashSet<IPEndPoint>();
                var subscribedLocos = new Dictionary<IPEndPoint, HashSet<int>>();
                while (!stoppingToken.IsCancellationRequested)
                {

                    using var shortWait = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                    shortWait.CancelAfter(500);
                    UdpReceiveResult packet;
                    try { packet = await udp.ReceiveAsync(shortWait.Token); }
                    catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
                    {
                        foreach (var address in _pendingLocoUpdates.Keys)
                        {
                            if (!_pendingLocoUpdates.TryRemove(address, out _)) continue;
                            var frame = _ws.GetZ21LocoInfo(address);
                            foreach (var (endpoint, addresses) in subscribedLocos)
                            {
                                if (!addresses.Contains(address)) continue;
                                await udp.SendAsync(frame, endpoint, stoppingToken);
                                _ws.PublishZ21Packet("TX", endpoint.ToString(), frame, $"Z21 loco sync #{address}");
                            }
                        }
                        foreach (var address in _pendingTurnoutUpdates.Keys)
                        {
                            if (!_pendingTurnoutUpdates.TryRemove(address, out _)) continue;
                            var frame = _ws.GetZ21TurnoutInfo(address);
                            if (frame is null) continue;
                            foreach (var endpoint in clients)
                            {
                                await udp.SendAsync(frame, endpoint, stoppingToken);
                                _ws.PublishZ21Packet("TX", endpoint.ToString(), frame, $"Z21 turnout sync #{address}");
                            }
                        }
                        if (Interlocked.Exchange(ref _pendingPowerUpdate, 0) == 1)
                        {
                            var state = _ws.GetZ21PowerState();
                            byte[] frame = state.EmergencyStop
                                ? [7, 0, 0x40, 0, 0x81, 0, 0x81]
                                : state.PowerOn
                                    ? [7, 0, 0x40, 0, 0x61, 1, 0x60]
                                    : [7, 0, 0x40, 0, 0x61, 0, 0x61];
                            foreach (var endpoint in clients)
                            {
                                await udp.SendAsync(frame, endpoint, stoppingToken);
                                _ws.PublishZ21Packet("TX", endpoint.ToString(), frame, "Z21 power / emergency sync");
                            }
                        }
                        continue;
                    }
                    var data = packet.Buffer;
                    _ws.PublishZ21Packet("RX", packet.RemoteEndPoint.ToString(), data, "Z21 UDP inbound");
                    if (data.Length < 4 || BinaryPrimitives.ReadUInt16LittleEndian(data) != data.Length)
                    {
                        _ws.PublishZ21Packet("SYS", packet.RemoteEndPoint.ToString(), data, "[UNHANDLED] Invalid Z21 packet length");
                        continue;
                    }
                    clients.Add(packet.RemoteEndPoint);
                    lock (_gate) listener.Clients = clients.Count;
                    var header = BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(2));
                    bool handledPacket = false;
                    byte[]? reply = header switch
                    {
                        0x0010 when data.Length == 4 => [8, 0, 0x10, 0, 0x45, 0x58, 0x43, 0x44],
                        0x0040 when data.Length >= 7 && data[4] == 0x21 && data[5] == 0x21
                            => [9, 0, 0x40, 0, 0x63, 0x21, 0x40, 0x12, 0x10],
                        _ => null
                    };
                    if (reply is not null) handledPacket = true;
                    if (header == 0x0040 && data.Length >= 6 && CheckXor(data))
                    {
                        if (data[4] == 0xE3 && data.Length == 9 && data[5] == 0xF0)
                        {
                            var address = ((data[6] & 0x3F) << 8) | data[7];
                            if (address > 0)
                            {
                                reply = _ws.GetZ21LocoInfo(address);
                                if (!subscribedLocos.TryGetValue(packet.RemoteEndPoint, out var addresses))
                                    subscribedLocos[packet.RemoteEndPoint] = addresses = new HashSet<int>();
                                addresses.Add(address);
                            }
                        }
                        else if (data[4] == 0x43 && data.Length == 8)
                        {
                            var address = ((data[5] & 0x3F) << 8) | data[6];
                            reply = _ws.GetZ21TurnoutInfo(address + 1);
                        }
                    }
                    if (reply is not null) handledPacket = true;
                    if (header == 0x0040 && data.Length >= 6 && CheckXor(data))
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
                                if (mode is 0 or 1 or 2)
                                {
                                    handled = true;
                                    bool active = mode == 1 ||
                                        (mode == 2 && !_ws.GetZ21FunctionState(address, fn));
                                    ok = await _ws.ApplyZ21FunctionAsync(address, fn, active, stoppingToken);
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
                            handledPacket = true;
                            _ws.PublishZ21Packet("SYS", packet.RemoteEndPoint.ToString(), data,
                                ok ? "Z21 command applied" : "Z21 command rejected");
                        }
                    }
                    if (header == 0x0030)
                    {
                        handledPacket = true;
                        clients.Remove(packet.RemoteEndPoint);
                        subscribedLocos.Remove(packet.RemoteEndPoint);
                        lock (_gate) listener.Clients = clients.Count;
                    }
                    if (!handledPacket)
                        _ws.PublishZ21Packet("SYS", packet.RemoteEndPoint.ToString(), data,
                            $"[UNHANDLED] Z21 header=0x{header:X4}" +
                            (data.Length >= 6 ? $" X=0x{data[4]:X2} DB=0x{data[5]:X2}" : ""));
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
                lock (_gate) listener.State = "Error: " + ex.Message;
                await Task.Delay(2000, stoppingToken);
            }
            finally { lock (_gate) listener.Clients = 0; }
        }
    }
}
