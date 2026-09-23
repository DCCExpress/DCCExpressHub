using System.IO.Ports;
using System.Net.Sockets;

namespace DCCExpressHub.Net.CommandCenter;

public interface IDccExTransport : IAsyncDisposable
{
    bool IsConnected { get; }
    string Endpoint { get; }
    Task ConnectAsync(CancellationToken ct);
    Task<int> ReadAsync(Memory<byte> buffer, CancellationToken ct);
    Task WriteAsync(ReadOnlyMemory<byte> data, CancellationToken ct);
    Task DisconnectAsync();
}

public sealed class TcpDccExTransport : IDccExTransport
{
    private TcpClient? _client;
    private NetworkStream? _stream;
    private string _host;
    private int _port;

    public TcpDccExTransport(IConfiguration cfg)
        : this(
            cfg["DccEx:Host"] ?? "127.0.0.1",
            cfg.GetValue("DccEx:Port", 2560))
    {
    }

    public TcpDccExTransport(string host, int port)
    {
        _host = host;
        _port = port;
    }

    public bool IsConnected =>
        _client?.Connected == true &&
        _stream is not null;

    public string Endpoint => $"{_host}:{_port}";

    public bool SetEndpoint(string host, int port)
    {
        host = host.Trim();

        if (host.Length == 0 ||
            port is < 1 or > 65535)
        {
            return false;
        }

        _host = host;
        _port = port;
        _ = DisconnectAsync();

        return true;
    }

    public async Task ConnectAsync(CancellationToken ct)
    {
        await DisconnectAsync();

        _client = new TcpClient
        {
            NoDelay = true
        };

        await _client.ConnectAsync(
            _host,
            _port,
            ct);

        _stream = _client.GetStream();
    }

    public Task<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken ct) =>
        _stream!.ReadAsync(
            buffer,
            ct).AsTask();

    public Task WriteAsync(
        ReadOnlyMemory<byte> data,
        CancellationToken ct) =>
        _stream!.WriteAsync(
            data,
            ct).AsTask();

    public Task DisconnectAsync()
    {
        try
        {
            _stream?.Dispose();
            _client?.Dispose();
        }
        catch
        {
        }

        _stream = null;
        _client = null;

        return Task.CompletedTask;
    }

    public async ValueTask DisposeAsync() =>
        await DisconnectAsync();
}

public sealed class SerialDccExTransport : IDccExTransport
{
    public const int BaudRate = 115200;

    private const int ReadTimeoutMs = 250;
    private const int WriteTimeoutMs = 2000;
    private const int OpenStabilizationMs = 1200;

    private SerialPort? _port;
    private string _name;
    private volatile bool _ready;

    public SerialDccExTransport(IConfiguration cfg)
        : this(
            cfg["DccEx:SerialPort"] ?? "COM3")
    {
    }

    public SerialDccExTransport(
        string name)
    {
        _name = name;
    }

    public bool IsConnected
    {
        get
        {
            try
            {
                return
                    _ready &&
                    _port?.IsOpen == true;
            }
            catch
            {
                return false;
            }
        }
    }

    public string Endpoint =>
        $"{_name}@{BaudRate}";

    public bool SetEndpoint(
        string name,
        int baud)
    {
        name = name.Trim();

        if (name.Length == 0 ||
            baud != BaudRate)
        {
            return false;
        }

        _name = name;
        _ = DisconnectAsync();

        return true;
    }

    public async Task ConnectAsync(
        CancellationToken ct)
    {
        await DisconnectAsync();
        ct.ThrowIfCancellationRequested();

        var port =
            new SerialPort(
                _name,
                BaudRate,
                Parity.None,
                8,
                StopBits.One)
            {
                Handshake = Handshake.None,
                ReadTimeout = ReadTimeoutMs,
                WriteTimeout = WriteTimeoutMs,

                // Do not intentionally assert modem control lines.
                // Many Arduino-class command stations reset when these lines
                // transition while the COM port is opened.
                DtrEnable = false,
                RtsEnable = false
            };

        try
        {
            port.Open();

            if (!port.IsOpen)
            {
                throw new IOException(
                    $"Serial port {_name} did not open.");
            }

            _port = port;

            // Give USB CDC / Arduino-class command stations time to settle after
            // opening the port before DCC-EX traffic starts.
            await Task.Delay(
                OpenStabilizationMs,
                ct);

            ct.ThrowIfCancellationRequested();

            if (!port.IsOpen)
            {
                throw new IOException(
                    $"Serial port {_name} closed during startup.");
            }

            // Drop boot/reset noise before the first DCC-EX request.
            try
            {
                port.DiscardInBuffer();
                port.DiscardOutBuffer();
            }
            catch
            {
                // A driver may not support purging. The parser can still ignore
                // non-DCC-EX text, so this is not fatal.
            }

            _ready = true;
        }
        catch
        {
            _ready = false;

            try
            {
                port.Close();
                port.Dispose();
            }
            catch
            {
            }

            if (ReferenceEquals(
                    _port,
                    port))
            {
                _port = null;
            }

            throw;
        }
    }

    public Task<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken ct)
    {
        if (buffer.Length == 0)
            return Task.FromResult(0);

        /*
         * Use SerialPort.Read instead of BaseStream.ReadAsync.
         *
         * SerialPort has its own receive buffer. Mixing SerialPort state with
         * BaseStream async I/O can produce awkward buffer/cancellation behaviour
         * on Windows USB serial drivers. A short synchronous read timeout gives
         * us one dedicated blocking reader that can still observe cancellation
         * and port closure.
         */
        return Task.Run(
            () =>
            {
                var temp =
                    new byte[
                        buffer.Length];

                while (true)
                {
                    ct.ThrowIfCancellationRequested();

                    var port =
                        _port;

                    if (
                        !_ready ||
                        port is null ||
                        !port.IsOpen)
                    {
                        return 0;
                    }

                    try
                    {
                        var count =
                            port.Read(
                                temp,
                                0,
                                temp.Length);

                        if (count <= 0)
                            continue;

                        temp.AsMemory(
                                0,
                                count)
                            .CopyTo(
                                buffer);

                        return count;
                    }
                    catch (TimeoutException)
                    {
                        // Normal idle serial port. Re-check cancellation and
                        // IsOpen on the next pass.
                    }
                }
            },
            CancellationToken.None);
    }

    public Task WriteAsync(
        ReadOnlyMemory<byte> data,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        var port =
            _port;

        if (
            !_ready ||
            port is null ||
            !port.IsOpen)
        {
            throw new IOException(
                $"Serial port {_name} is not open.");
        }

        var bytes =
            data.ToArray();

        try
        {
            // DCC-EX commands are tiny. SerialPort.Write is deliberate here:
            // no BaseStream and no FlushAsync are needed for a serial device.
            port.Write(
                bytes,
                0,
                bytes.Length);

            return Task.CompletedTask;
        }
        catch (Exception ex)
            when (
                ex is InvalidOperationException or
                IOException or
                UnauthorizedAccessException or
                TimeoutException)
        {
            throw new IOException(
                $"Serial write failed on {_name}.",
                ex);
        }
    }

    public Task DisconnectAsync()
    {
        _ready = false;

        var port =
            _port;

        _port = null;

        try
        {
            port?.Close();
            port?.Dispose();
        }
        catch
        {
        }

        return Task.CompletedTask;
    }

    public async ValueTask DisposeAsync() =>
        await DisconnectAsync();
}
