using System.IO.Ports;

namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Binary USB/COM framing. Does not interpret any LocoNet command opcodes.
/// </summary>
public sealed class LocoNetSerialTransport : ILocoNetTransport
{
    private readonly ILogger<LocoNetSerialTransport> _log;
    private readonly SemaphoreSlim _txGate = new(1, 1);
    private readonly object _gate = new();
    private SerialPort? _serialPort;
    private volatile bool _connected;
    private long _connectedTick = -1;

    public LocoNetSerialTransport(IConfiguration config, ILogger<LocoNetSerialTransport> log)
    {
        _log = log;
        Endpoint = (config["LocoNet:SerialPort"] ?? "COM16").Trim();
        BaudRate = config.GetValue("LocoNet:SerialBaudRate", 115200);
    }

    public string Kind => "serial";
    public string Endpoint { get; }
    public int BaudRate { get; }
    public bool Connected => _connected;
    public long LinkUptimeMs => _connected
        ? Math.Max(0, Environment.TickCount64 - Interlocked.Read(ref _connectedTick))
        : -1;

    public event Action<bool>? ConnectionChanged;
    public event Action<string>? Information;

    public async Task RunSessionAsync(Action<byte[]> received, CancellationToken ct)
    {
        SerialPort? port = null;
        try
        {
            Information?.Invoke($"LocoNet Serial opening {Endpoint} @ {BaudRate}");
            port = new SerialPort(Endpoint, BaudRate, Parity.None, 8, StopBits.One)
            {
                Handshake = Handshake.None,
                ReadTimeout = 500,
                WriteTimeout = 1000
            };
            port.Open();
            lock (_gate) _serialPort = port;
            Interlocked.Exchange(ref _connectedTick, Environment.TickCount64);
            _connected = true;
            ConnectionChanged?.Invoke(true);
            Information?.Invoke($"LocoNet Serial connected: {Endpoint} @ {BaudRate}");

            var bytes = new byte[512];
            var frame = new byte[128];
            int count = 0, expected = 0;
            while (!ct.IsCancellationRequested)
            {
                var size = await port.BaseStream.ReadAsync(bytes, ct);
                if (size <= 0) return;
                for (var i = 0; i < size; i++)
                {
                    var b = bytes[i];
                    if ((b & 0x80) != 0)
                    {
                        frame[0] = b;
                        count = 1;
                        expected = (b & 0x60) == 0x60
                            ? 0 : ((b & 0x60) >> 4) + 2;
                    }
                    else if (count != 0 && count < frame.Length)
                        frame[count++] = b;
                    else
                    {
                        count = expected = 0;
                        continue;
                    }
                    if (count == 2 && expected == 0)
                        expected = frame[1];
                    if (expected < 2 && count >= 2 || expected > frame.Length)
                    {
                        count = expected = 0;
                        continue;
                    }
                    if (expected > 0 && count == expected)
                    {
                        received(frame.AsSpan(0, count).ToArray());
                        count = expected = 0;
                    }
                }
            }
        }
        finally
        {
            _connected = false;
            Interlocked.Exchange(ref _connectedTick, -1);
            lock (_gate) _serialPort = null;
            port?.Dispose();
            ConnectionChanged?.Invoke(false);
        }
    }

    public async Task<bool> SendFrameAsync(ReadOnlyMemory<byte> frame, CancellationToken ct)
    {
        if (!_connected) return false;
        await _txGate.WaitAsync(ct);
        try
        {
            SerialPort? port;
            lock (_gate) port = _serialPort;
            if (port?.IsOpen != true) return false;
            await port.BaseStream.WriteAsync(frame, ct);
            await port.BaseStream.FlushAsync(ct);
            return true;
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or InvalidOperationException or TimeoutException)
        {
            _log.LogWarning(ex, "LocoNet Serial TX failed on {Port}", Endpoint);
            return false;
        }
        finally { _txGate.Release(); }
    }
}
