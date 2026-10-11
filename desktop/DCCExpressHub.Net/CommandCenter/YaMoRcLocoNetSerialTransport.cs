using System.IO.Ports;

namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Experimental raw LocoNet USB serial transport for YD7010.
/// The YD7010 exposes a dedicated LocoNet virtual COM port. This transport
/// deliberately does not assume that a Digitrax PR3/PR4 baud rate applies.
/// It must be explicitly configured and verified against physical hardware
/// before it can replace any command-centre transport.
/// </summary>
public sealed class YaMoRcLocoNetSerialTransport : IAsyncDisposable
{
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly string _portName;
    private readonly int _baudRate;
    private SerialPort? _port;

    public YaMoRcLocoNetSerialTransport(string portName, int baudRate)
    {
        if (string.IsNullOrWhiteSpace(portName))
            throw new ArgumentException("A LocoNet serial port is required.", nameof(portName));
        if (baudRate is < 1200 or > 1000000)
            throw new ArgumentOutOfRangeException(nameof(baudRate));
        _portName = portName.Trim();
        _baudRate = baudRate;
    }

    public string PortName => _portName;
    public int BaudRate => _baudRate;
    public bool IsOpen => _port?.IsOpen == true;

    public void Open()
    {
        if (IsOpen) return;
        var port = new SerialPort(_portName, _baudRate, Parity.None, 8, StopBits.One)
        {
            Handshake = Handshake.None,
            ReadTimeout = 500,
            WriteTimeout = 1000
        };
        port.Open();
        _port = port;
    }

    /// <summary>
    /// Raw read only: packet framing is intentionally left to the protocol
    /// decoder after the actual YD7010 USB framing has been verified.
    /// </summary>
    public async Task<int> ReadAsync(Memory<byte> buffer, CancellationToken ct)
    {
        var port = _port ?? throw new InvalidOperationException("LocoNet serial port is not open.");
        return await port.BaseStream.ReadAsync(buffer, ct);
    }

    public async Task WriteAsync(ReadOnlyMemory<byte> bytes, CancellationToken ct)
    {
        var port = _port ?? throw new InvalidOperationException("LocoNet serial port is not open.");
        await _writeGate.WaitAsync(ct);
        try
        {
            await port.BaseStream.WriteAsync(bytes, ct);
            await port.BaseStream.FlushAsync(ct);
        }
        finally
        {
            _writeGate.Release();
        }
    }

    public ValueTask DisposeAsync()
    {
        _port?.Dispose();
        _port = null;
        _writeGate.Dispose();
        return ValueTask.CompletedTask;
    }
}
