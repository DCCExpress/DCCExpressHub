using System.Globalization;
using System.Net.Sockets;
using System.Text;

namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// LBServer line framing (SEND / RECEIVE), not LocoNet command logic.
/// </summary>
public sealed class LocoNetTcpTransport : ILocoNetTransport
{
    private readonly ILogger<LocoNetTcpTransport> _log;
    private readonly string _host;
    private readonly int _port;
    private readonly SemaphoreSlim _txGate = new(1, 1);
    private readonly object _gate = new();
    private StreamWriter? _writer;
    private volatile bool _connected;

    public LocoNetTcpTransport(IConfiguration config, ILogger<LocoNetTcpTransport> log)
    {
        _log = log;
        _host = (config["LocoNet:Host"] ?? config["Z21:Host"] ?? "127.0.0.1").Trim();
        _port = config.GetValue("LocoNet:LbServerPort", 1234);
    }

    public string Kind => "tcp";
    public string Endpoint => $"{_host}:{_port}";
    public bool Connected => _connected;

    public event Action<bool>? ConnectionChanged;
    public event Action<string>? Information;

    public async Task RunSessionAsync(Action<byte[]> received, CancellationToken ct)
    {
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync(_host, _port, ct);
            using var stream = client.GetStream();
            using var reader = new StreamReader(stream, Encoding.ASCII, leaveOpen: true);
            using var writer = new StreamWriter(stream, Encoding.ASCII, leaveOpen: true)
            { AutoFlush = true, NewLine = "\n" };
            lock (_gate) _writer = writer;
            _connected = true;
            ConnectionChanged?.Invoke(true);
            Information?.Invoke($"LocoNet TCP connected: {Endpoint}");
            while (!ct.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(ct);
                if (line is null) break;
                if (!line.StartsWith("RECEIVE ", StringComparison.OrdinalIgnoreCase))
                    continue;
                var tokens = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (tokens.Length < 3 || tokens.Length > 129) continue;
                var frame = new byte[tokens.Length - 1];
                bool valid = true;
                for (var i = 1; i < tokens.Length; i++)
                    if (!byte.TryParse(tokens[i], NumberStyles.HexNumber,
                        CultureInfo.InvariantCulture, out frame[i - 1]))
                    {
                        valid = false;
                        break;
                    }
                if (valid) received(frame);
            }
        }
        finally
        {
            _connected = false;
            lock (_gate) _writer = null;
            ConnectionChanged?.Invoke(false);
        }
    }

    public async Task<bool> SendFrameAsync(ReadOnlyMemory<byte> frame, CancellationToken ct)
    {
        if (!_connected) return false;
        var line = "SEND " + string.Join(" ",
            frame.ToArray().Select(value => value.ToString("X2", CultureInfo.InvariantCulture)));
        await _txGate.WaitAsync(ct);
        try
        {
            StreamWriter? writer;
            lock (_gate) writer = _writer;
            if (writer is null) return false;
            await writer.WriteLineAsync(line.AsMemory(), ct);
            return true;
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException)
        {
            _log.LogWarning(ex, "LocoNet TCP TX failed to {Endpoint}", Endpoint);
            return false;
        }
        finally { _txGate.Release(); }
    }
}
