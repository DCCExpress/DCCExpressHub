using System.IO.Ports;
using System.Net.Sockets;
using System.Text;

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

public sealed class TcpDccExTransport(IConfiguration cfg) : IDccExTransport
{
    private TcpClient? _client; private NetworkStream? _stream;
    private string _host=cfg["DccEx:Host"] ?? "127.0.0.1";
    private int _port=cfg.GetValue("DccEx:Port",2560);
    public bool IsConnected => _client?.Connected==true && _stream!=null;
    public string Endpoint=>$"{_host}:{_port}";
    public void SetEndpoint(string host,int port){_host=host;_port=port;_ = DisconnectAsync();}
    public async Task ConnectAsync(CancellationToken ct)
    {
        await DisconnectAsync(); _client=new TcpClient{NoDelay=true};
        await _client.ConnectAsync(_host,_port,ct); _stream=_client.GetStream();
    }
    public Task<int> ReadAsync(Memory<byte> b,CancellationToken ct)=>_stream!.ReadAsync(b,ct).AsTask();
    public Task WriteAsync(ReadOnlyMemory<byte> b,CancellationToken ct)=>_stream!.WriteAsync(b,ct).AsTask();
    public Task DisconnectAsync(){try{_stream?.Dispose();_client?.Dispose();}catch{} _stream=null;_client=null;return Task.CompletedTask;}
    public async ValueTask DisposeAsync()=>await DisconnectAsync();
}

public sealed class SerialDccExTransport(IConfiguration cfg) : IDccExTransport
{
    private SerialPort? _port;
    private readonly string _name=cfg["DccEx:SerialPort"] ?? "COM3";
    private readonly int _baud=cfg.GetValue("DccEx:BaudRate",115200);
    public bool IsConnected=>_port?.IsOpen==true;
    public string Endpoint=>$"{_name}@{_baud}";
    public Task ConnectAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested(); _port?.Dispose();
        _port=new SerialPort(_name,_baud,Parity.None,8,StopBits.One){Handshake=Handshake.None,ReadTimeout=-1,WriteTimeout=2000};
        _port.Open(); return Task.CompletedTask;
    }
    public async Task<int> ReadAsync(Memory<byte>b,CancellationToken ct)=>await _port!.BaseStream.ReadAsync(b,ct);
    public async Task WriteAsync(ReadOnlyMemory<byte>b,CancellationToken ct)=>await _port!.BaseStream.WriteAsync(b,ct);
    public Task DisconnectAsync(){try{_port?.Close();_port?.Dispose();}catch{} _port=null;return Task.CompletedTask;}
    public async ValueTask DisposeAsync()=>await DisconnectAsync();
}
