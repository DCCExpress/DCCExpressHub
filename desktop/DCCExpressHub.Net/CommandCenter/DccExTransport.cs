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
    private SerialPort? _port;
    private string _name;
    private int _baud;

    public SerialDccExTransport(IConfiguration cfg)
        : this(
            cfg["DccEx:SerialPort"] ?? "COM3",
            cfg.GetValue("DccEx:BaudRate", 115200))
    {
    }

    public SerialDccExTransport(
        string name,
        int baud)
    {
        _name = name;
        _baud = baud;
    }

    public bool IsConnected =>
        _port?.IsOpen == true;

    public string Endpoint =>
        $"{_name}@{_baud}";

    public bool SetEndpoint(
        string name,
        int baud)
    {
        name = name.Trim();

        if (name.Length == 0 ||
            baud <= 0)
        {
            return false;
        }

        _name = name;
        _baud = baud;
        _ = DisconnectAsync();

        return true;
    }

    public Task ConnectAsync(
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        try
        {
            _port?.Dispose();
        }
        catch
        {
        }

        _port = new SerialPort(
            _name,
            _baud,
            Parity.None,
            8,
            StopBits.One)
        {
            Handshake = Handshake.None,
            ReadTimeout = -1,
            WriteTimeout = 2000
        };

        _port.Open();

        return Task.CompletedTask;
    }

    public async Task<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken ct) =>
        await _port!.BaseStream.ReadAsync(
            buffer,
            ct);

    public async Task WriteAsync(
        ReadOnlyMemory<byte> data,
        CancellationToken ct)
    {
        await _port!.BaseStream.WriteAsync(
            data,
            ct);

        await _port.BaseStream.FlushAsync(ct);
    }

    public Task DisconnectAsync()
    {
        try
        {
            _port?.Close();
            _port?.Dispose();
        }
        catch
        {
        }

        _port = null;

        return Task.CompletedTask;
    }

    public async ValueTask DisposeAsync() =>
        await DisconnectAsync();
}
