using System.Net.Sockets;

namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// YaMoRC XpressNet-LAN feedback side channel.
///
/// YD7010 exposes XpressNet-LAN independently from its Z21 and LocoNet
/// endpoints. Physical R-BUS feedback is forwarded by the command station as
/// XpressNet feedback broadcasts, so it must not be expected on the Z21 UDP
/// R-BUS channel.
///
/// Framing follows the Lenz LI-USB/Ethernet convention used by the YaMoRC
/// XpressNet-LAN endpoint:
///   FF FD = unsolicited message
///   FF FE = reply to a request
/// followed by a normal XpressNet message including XOR byte.
/// </summary>
public sealed class YaMoRcXpressNetClient
{
    public const int DefaultPort = 5550;

    private const int ReconnectDelayMs = 2000;
    private const int ConnectTimeoutMs = 3000;
    private static readonly TimeSpan KeepAliveInterval =
        TimeSpan.FromSeconds(30);

    private readonly ILogger _log;
    private string _host;
    private readonly int _port;
    private readonly bool _enabled;

    private readonly object _stateGate = new();
    private readonly Dictionary<int, bool> _sensorStates = new();

    private bool _connected;
    private DateTime _connectedSinceUtc = DateTime.MinValue;
    private DateTime _lastRxUtc = DateTime.MinValue;
    private long _feedbackFrames;
    private long _sensorFeedbackCount;

    public YaMoRcXpressNetClient(
        IConfiguration configuration,
        ILogger log)
    {
        _log = log;

        _host =
            (configuration["XpressNet:Host"] ??
             configuration["Z21:Host"] ??
             configuration["DccEx:Host"] ??
             "127.0.0.1")
            .Trim();

        _port =
            NormalizePort(
                configuration.GetValue(
                    "XpressNet:Port",
                    DefaultPort),
                DefaultPort);

        _enabled =
            configuration.GetValue(
                "XpressNet:Feedback",
                true);
    }

    public event Action<string>? RawInfo;
    public event Action<int, bool>? SensorFeedbackChanged;

    public bool SetHost(string host)
    {
        host = (host ?? "").Trim();

        if (host.Length == 0)
            return false;

        _host = host;
        return true;
    }

    public bool Enabled => _enabled;

    public bool Connected
    {
        get
        {
            lock (_stateGate)
                return _connected;
        }
    }

    public long FeedbackFrames =>
        Interlocked.Read(
            ref _feedbackFrames);

    public long SensorFeedbackCount =>
        Interlocked.Read(
            ref _sensorFeedbackCount);

    public async Task RunAsync(
        CancellationToken ct)
    {
        if (!_enabled)
        {
            try
            {
                await Task.Delay(
                    Timeout.Infinite,
                    ct);
            }
            catch (OperationCanceledException)
                when (ct.IsCancellationRequested)
            {
            }

            return;
        }

        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var client =
                    new TcpClient
                    {
                        NoDelay = true
                    };

                using var connectCts =
                    CancellationTokenSource
                        .CreateLinkedTokenSource(
                            ct);

                connectCts.CancelAfter(
                    TimeSpan.FromMilliseconds(
                        ConnectTimeoutMs));

                await client.ConnectAsync(
                    _host,
                    _port,
                    connectCts.Token);

                lock (_stateGate)
                {
                    _connected = true;
                    _connectedSinceUtc =
                        DateTime.UtcNow;
                    _lastRxUtc =
                        DateTime.MinValue;
                }

                _log.LogInformation(
                    "YaMoRC XpressNet-LAN connected: {Host}:{Port}",
                    _host,
                    _port);

                RawInfo?.Invoke(
                    $"XpressNet-LAN connected {_host}:{_port}");

                using var stream =
                    client.GetStream();

                using var linkedCts =
                    CancellationTokenSource
                        .CreateLinkedTokenSource(
                            ct);

                var readTask =
                    ReadAsync(
                        stream,
                        linkedCts.Token);

                var keepAliveTask =
                    KeepAliveAsync(
                        stream,
                        linkedCts.Token);

                var completed =
                    await Task.WhenAny(
                        readTask,
                        keepAliveTask);

                linkedCts.Cancel();

                try
                {
                    await completed;
                }
                finally
                {
                    try
                    {
                        await Task.WhenAll(
                            readTask,
                            keepAliveTask);
                    }
                    catch (OperationCanceledException)
                        when (linkedCts.IsCancellationRequested)
                    {
                    }
                }
            }
            catch (OperationCanceledException)
                when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (OperationCanceledException)
            {
                _log.LogDebug(
                    "YaMoRC XpressNet-LAN connect timed out: {Host}:{Port}",
                    _host,
                    _port);
            }
            catch (Exception ex)
            {
                _log.LogDebug(
                    ex,
                    "YaMoRC XpressNet-LAN unavailable: {Host}:{Port}",
                    _host,
                    _port);
            }
            finally
            {
                lock (_stateGate)
                {
                    _connected = false;
                    _connectedSinceUtc =
                        DateTime.MinValue;
                }
            }

            if (!await DelayReconnectAsync(ct))
                break;
        }
    }

    /// <summary>
    /// XpressNet feedback is event-driven. Do not brute-force all 2048 YaMoRC
    /// feedback contacts here: doing that creates a large OFF-event burst and
    /// can make the UI/runtime lag. YD7010's "Report all contacts after Power
    /// On" option provides the cold-start snapshot; subsequent R-BUS changes
    /// arrive as unsolicited XpressNet feedback broadcasts.
    /// </summary>
    public Task<bool> RequestSensorSnapshotAsync(
        CancellationToken ct = default) =>
        Task.FromResult(
            _enabled);

    private async Task ReadAsync(
        NetworkStream stream,
        CancellationToken ct)
    {
        var one =
            new byte[1];

        while (!ct.IsCancellationRequested)
        {
            var marker =
                await ReadByteAsync(
                    stream,
                    one,
                    ct);

            if (marker != 0xFF)
                continue;

            var direction =
                await ReadByteAsync(
                    stream,
                    one,
                    ct);

            // 0xFD = unsolicited broadcast, 0xFE = response.
            if (direction is not 0xFD and not 0xFE)
                continue;

            var header =
                await ReadByteAsync(
                    stream,
                    one,
                    ct);

            var messageLength =
                (header & 0x0F) + 2;

            if (messageLength is < 2 or > 17)
                continue;

            var message =
                new byte[messageLength];

            message[0] =
                (byte)header;

            for (var index = 1;
                 index < message.Length;
                 ++index)
            {
                message[index] =
                    (byte)await ReadByteAsync(
                        stream,
                        one,
                        ct);
            }

            lock (_stateGate)
                _lastRxUtc =
                    DateTime.UtcNow;

            byte checksum = 0;

            foreach (var value in message)
                checksum ^= value;

            if (checksum != 0)
            {
                _log.LogDebug(
                    "Ignoring YaMoRC XpressNet-LAN packet with invalid checksum: {Packet}",
                    Convert.ToHexString(
                        message));

                continue;
            }

            if ((message[0] & 0xF0) == 0x40)
            {
                Interlocked.Increment(
                    ref _feedbackFrames);

                ProcessFeedbackBroadcast(
                    message);
            }
        }
    }

    private void ProcessFeedbackBroadcast(
        ReadOnlySpan<byte> message)
    {
        var dataBytes =
            message[0] & 0x0F;

        // Feedback broadcasts contain address/data pairs. The final byte is
        // the XOR checksum and is not included in dataBytes.
        if (
            dataBytes < 2 ||
            (dataBytes & 1) != 0 ||
            message.Length != dataBytes + 2
        )
        {
            return;
        }

        for (var index = 1;
             index + 1 <= dataBytes;
             index += 2)
        {
            var moduleAddress =
                message[index];

            var data =
                message[index + 1];

            // XpressNet feedback type 2 (bits 5..6 == 10) is a feedback
            // encoder. Bit 4 selects lower/upper four contacts.
            if ((data & 0x60) != 0x40)
                continue;

            var firstAddress =
                moduleAddress * 8 +
                ((data & 0x10) != 0
                    ? 5
                    : 1);

            for (var bit = 0;
                 bit < 4;
                 ++bit)
            {
                var address =
                    firstAddress +
                    bit;

                if (address is < 1 or > 2048)
                    continue;

                var occupied =
                    (data & (1 << bit)) != 0;

                bool changed;

                lock (_stateGate)
                {
                    changed =
                        !_sensorStates
                            .TryGetValue(
                                address,
                                out var previous) ||
                        previous != occupied;

                    _sensorStates[address] =
                        occupied;
                }

                if (!changed)
                    continue;

                Interlocked.Increment(
                    ref _sensorFeedbackCount);

                _log.LogInformation(
                    "YaMoRC XpressNet/R-BUS sensor #{Address}: {State}",
                    address,
                    occupied
                        ? "ON"
                        : "OFF");

                SensorFeedbackChanged?.Invoke(
                    address,
                    occupied);
            }
        }
    }

    private static async Task<int> ReadByteAsync(
        NetworkStream stream,
        byte[] one,
        CancellationToken ct)
    {
        var count =
            await stream.ReadAsync(
                one.AsMemory(
                    0,
                    1),
                ct);

        if (count <= 0)
            throw new IOException(
                "XpressNet-LAN connection closed");

        return one[0];
    }

    private async Task KeepAliveAsync(
        NetworkStream stream,
        CancellationToken ct)
    {
        // Lenz CS status request:
        //   21 24 05
        // YaMoRC XpressNet-LAN uses the LI-USB/Ethernet FF FE framing.
        var packet =
            new byte[]
            {
                0xFF,
                0xFE,
                0x21,
                0x24,
                0x05
            };

        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(
                KeepAliveInterval,
                ct);

            await stream.WriteAsync(
                packet,
                ct);

            await stream.FlushAsync(
                ct);
        }
    }

    private static async Task<bool> DelayReconnectAsync(
        CancellationToken ct)
    {
        try
        {
            await Task.Delay(
                ReconnectDelayMs,
                ct);

            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    private static int NormalizePort(
        int value,
        int fallback) =>
        value is >= 1 and <= 65535
            ? value
            : fallback;
}
