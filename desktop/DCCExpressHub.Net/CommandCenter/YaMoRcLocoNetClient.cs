using System.Net.Sockets;

namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Standalone YaMoRC LocoNet feedback client.
///
/// This class owns only the YaMoRC LocoNet transports (LBServer and optional
/// binary TCP), interrogation and OPC_INPUT_REP decoding. It has no dependency
/// on the Z21 LAN protocol and can be evolved independently.
/// </summary>
public sealed class YaMoRcLocoNetClient
{
    public const int DefaultLbServerPort = 1234;
    public const int DefaultBinaryPort = 5560;
    public const int MaxSensorOffset = 65535 - 4096;

    private const int ReconnectDelayMs = 2000;
    private const int ConnectTimeoutMs = 3000;
    private const int InterrogateRestMs = 1250;

    private readonly ILogger _log;
    private readonly string _host;
    private readonly int _lbServerPort;
    private readonly int _binaryPort;
    private readonly bool _lbServerEnabled;
    private readonly bool _binaryFeedbackEnabled;
    private readonly int _sensorOffset;

    private readonly object _stateGate = new();
    private readonly Dictionary<int, bool> _loggedSensorStates = new();
    private readonly SemaphoreSlim _interrogateGate = new(1, 1);

    private bool _lbServerConnected;
    private DateTime _lbServerConnectedSinceUtc = DateTime.MinValue;
    private DateTime _lastLbServerRxUtc = DateTime.MinValue;
    private string _lbServerVersion = "";
    private int _lbServerLinesObserved;
    private int _binaryPacketsObserved;
    private long _sensorFeedbackCount;
    private int _lastSensorAddress;
    private int _lastSensorOn = -1;
    private DateTime _lastSensorFeedbackUtc = DateTime.MinValue;
    private DateTime _lastInterrogateUtc = DateTime.MinValue;
    private long _lastSensorTrafficTicks = DateTime.UtcNow.Ticks;

    public YaMoRcLocoNetClient(
        IConfiguration configuration,
        ILogger log)
    {
        _log = log;

        _host =
            (configuration["LocoNet:Host"] ??
             configuration["Z21:Host"] ??
             configuration["DccEx:Host"] ??
             "127.0.0.1")
            .Trim();

        _lbServerPort =
            NormalizePort(
                configuration.GetValue(
                    "LocoNet:LbServerPort",
                    DefaultLbServerPort),
                DefaultLbServerPort);

        _binaryPort =
            NormalizePort(
                configuration.GetValue(
                    "LocoNet:BinaryPort",
                    DefaultBinaryPort),
                DefaultBinaryPort);

        _lbServerEnabled =
            configuration.GetValue(
                "LocoNet:LbServerFeedback",
                true);

        _binaryFeedbackEnabled =
            configuration.GetValue(
                "LocoNet:BinaryFeedback",
                false);

        _sensorOffset =
            Math.Clamp(
                configuration.GetValue(
                    "LocoNet:SensorOffset",
                    0),
                0,
                MaxSensorOffset);
    }

    public int SensorOffset => _sensorOffset;

    // LocoNet feedback has its own TCP connection, independent of Z21 UDP.
    // If Z21 reconnect invalidates the Hub's sensor table while LBServer has
    // remained online, replay the live LBServer cache instead of waiting for
    // a physical input edge that may never occur.
    public int ReplayLiveSensorStates()
    {
        KeyValuePair<int, bool>[] states;
        lock (_stateGate)
        {
            if (!_lbServerConnected)
                return 0;

            states = _loggedSensorStates.ToArray();
        }

        foreach (var state in states)
            SensorFeedbackChanged?.Invoke(state.Key, state.Value);

        if (states.Length > 0)
            _log.LogInformation(
                "YaMoRC LocoNet: re-synced {Count} known sensor states after Z21 reconnect",
                states.Length);

        return states.Length;
    }

    public event Action<string>? RawInfo;
    public event Action<int, bool>? SensorFeedbackChanged;

    public LocoNetRuntimeDiagnostics Diagnostics
    {
        get
        {
            var now = DateTime.UtcNow;

            long AgeMs(DateTime timestamp) =>
                timestamp == DateTime.MinValue
                    ? -1
                    : Math.Max(
                        0,
                        (long)(now - timestamp).TotalMilliseconds);

            bool connected;
            DateTime connectedSince;
            DateTime lastRx;
            string version;

            lock (_stateGate)
            {
                connected = _lbServerConnected;
                connectedSince = _lbServerConnectedSinceUtc;
                lastRx = _lastLbServerRxUtc;
                version = _lbServerVersion;
            }

            return new LocoNetRuntimeDiagnostics(
                LbServerEnabled: _lbServerEnabled,
                LbServerConnected: connected,
                Host: _host,
                LbServerPort: _lbServerPort,
                LbServerUptimeMs:
                    connectedSince == DateTime.MinValue
                        ? -1
                        : Math.Max(
                            0,
                            (long)(now - connectedSince).TotalMilliseconds),
                LastLbServerRxAgeMs:
                    AgeMs(lastRx),
                LbServerLinesObserved:
                    Volatile.Read(
                        ref _lbServerLinesObserved),
                LbServerVersion:
                    version,
                BinaryFeedbackEnabled:
                    _binaryFeedbackEnabled,
                BinaryPort:
                    _binaryPort,
                SensorFeedbackCount:
                    Interlocked.Read(
                        ref _sensorFeedbackCount),
                LastSensorAddress:
                    Volatile.Read(
                        ref _lastSensorAddress),
                LastSensorOn:
                    Volatile.Read(
                        ref _lastSensorOn) switch
                    {
                        0 => false,
                        1 => true,
                        _ => null
                    },
                LastSensorFeedbackAgeMs:
                    AgeMs(
                        _lastSensorFeedbackUtc),
                LastInterrogateAgeMs:
                    AgeMs(
                        _lastInterrogateUtc),
                InterrogateEnabled:
                    _lbServerEnabled);
        }
    }

    public async Task<LocoNetConnectionTestResult> TestConnectionAsync(
        string? hostOverride = null,
        CancellationToken ct = default)
    {
        var targetHost =
            string.IsNullOrWhiteSpace(
                hostOverride)
                ? _host
                : hostOverride.Trim();

        var started =
            System.Diagnostics.Stopwatch.StartNew();

        if (!_lbServerEnabled)
        {
            return new LocoNetConnectionTestResult(
                Ok: false,
                TcpConnected: false,
                Host: targetHost,
                Port: _lbServerPort,
                Reply: "",
                ElapsedMs: started.ElapsedMilliseconds,
                BackgroundConnected: false,
                LbServerVersion: "",
                LbServerLinesObserved: 0,
                Message: "YaMoRC LocoNet LBServer feedback is disabled.");
        }

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
                targetHost,
                _lbServerPort,
                connectCts.Token);

            var diagnostics =
                Diagnostics;

            var reply =
                !string.IsNullOrWhiteSpace(
                    diagnostics.LbServerVersion)
                    ? diagnostics.LbServerVersion
                    : "TCP connection accepted";

            return new LocoNetConnectionTestResult(
                Ok: true,
                TcpConnected: true,
                Host: targetHost,
                Port: _lbServerPort,
                Reply: reply,
                ElapsedMs: started.ElapsedMilliseconds,
                BackgroundConnected:
                    diagnostics.LbServerConnected,
                LbServerVersion:
                    diagnostics.LbServerVersion,
                LbServerLinesObserved:
                    diagnostics.LbServerLinesObserved,
                Message:
                    diagnostics.LbServerConnected
                        ? "LocoNet LBServer reachable; background feedback stream is connected."
                        : "LocoNet LBServer reachable; background feedback stream is currently reconnecting/offline.");
        }
        catch (OperationCanceledException)
            when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            var diagnostics =
                Diagnostics;

            return new LocoNetConnectionTestResult(
                Ok: false,
                TcpConnected: false,
                Host: targetHost,
                Port: _lbServerPort,
                Reply: "",
                ElapsedMs: started.ElapsedMilliseconds,
                BackgroundConnected:
                    diagnostics.LbServerConnected,
                LbServerVersion:
                    diagnostics.LbServerVersion,
                LbServerLinesObserved:
                    diagnostics.LbServerLinesObserved,
                Message: "LocoNet LBServer connection timed out.");
        }
        catch (Exception ex)
        {
            var diagnostics =
                Diagnostics;

            _log.LogWarning(
                ex,
                "YaMoRC LocoNet LBServer connection test failed: {Host}:{Port}",
                targetHost,
                _lbServerPort);

            return new LocoNetConnectionTestResult(
                Ok: false,
                TcpConnected: false,
                Host: targetHost,
                Port: _lbServerPort,
                Reply: ex.Message,
                ElapsedMs: started.ElapsedMilliseconds,
                BackgroundConnected:
                    diagnostics.LbServerConnected,
                LbServerVersion:
                    diagnostics.LbServerVersion,
                LbServerLinesObserved:
                    diagnostics.LbServerLinesObserved,
                Message: "LocoNet LBServer connection failed.");
        }
    }

    public async Task RunAsync(
        CancellationToken ct)
    {
        var tasks =
            new List<Task>();

        if (_lbServerEnabled)
        {
            tasks.Add(
                RunLbServerAsync(
                    ct));
        }

        if (_binaryFeedbackEnabled)
        {
            tasks.Add(
                RunBinaryAsync(
                    ct));
        }

        if (tasks.Count == 0)
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

        try
        {
            await Task.WhenAll(
                tasks);
        }
        catch (OperationCanceledException)
            when (ct.IsCancellationRequested)
        {
        }
    }

    public async Task<bool> RequestSensorSnapshotAsync(
        CancellationToken ct = default)
    {
        if (!_lbServerEnabled)
            return false;

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
                _lbServerPort,
                connectCts.Token);

            using var stream =
                client.GetStream();

            using var writer =
                new StreamWriter(
                    stream)
                {
                    AutoFlush = true,
                    NewLine = "\r\n"
                };

            return await SendInterrogateAsync(
                writer,
                ct);
        }
        catch (OperationCanceledException)
            when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.LogWarning(
                ex,
                "YaMoRC LocoNet sensor interrogation failed: {Host}:{Port}",
                _host,
                _lbServerPort);

            return false;
        }
    }

    private async Task RunLbServerAsync(
        CancellationToken ct)
    {
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
                    _lbServerPort,
                    connectCts.Token);

                lock (_stateGate)
                {
                    _lbServerConnected = true;
                    _lbServerConnectedSinceUtc =
                        DateTime.UtcNow;
                    _lastLbServerRxUtc =
                        DateTime.MinValue;
                }

                _log.LogInformation(
                    "YaMoRC LocoNet LBServer connected: {Host}:{Port}",
                    _host,
                    _lbServerPort);

                RawInfo?.Invoke(
                    $"LocoNet LBServer connected {_host}:{_lbServerPort}");

                using var stream =
                    client.GetStream();

                using var reader =
                    new StreamReader(
                        stream);

                using var writer =
                    new StreamWriter(
                        stream)
                    {
                        AutoFlush = true,
                        NewLine = "\r\n"
                    };

                var readTask =
                    ReadLbServerAsync(
                        reader,
                        ct);

                _ =
                    await SendInterrogateAsync(
                        writer,
                        ct);

                await readTask;
            }
            catch (OperationCanceledException)
                when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (OperationCanceledException)
            {
                _log.LogDebug(
                    "YaMoRC LocoNet LBServer connect timed out: {Host}:{Port}",
                    _host,
                    _lbServerPort);
            }
            catch (Exception ex)
            {
                _log.LogDebug(
                    ex,
                    "YaMoRC LocoNet LBServer unavailable: {Host}:{Port}",
                    _host,
                    _lbServerPort);
            }
            finally
            {
                lock (_stateGate)
                {
                    _lbServerConnected = false;
                    _lbServerConnectedSinceUtc =
                        DateTime.MinValue;
                }
            }

            if (!await DelayReconnectAsync(ct))
                break;
        }
    }

    private async Task RunBinaryAsync(
        CancellationToken ct)
    {
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
                    _binaryPort,
                    connectCts.Token);

                _log.LogInformation(
                    "YaMoRC LocoNet Binary connected: {Host}:{Port}",
                    _host,
                    _binaryPort);

                RawInfo?.Invoke(
                    $"LocoNet Binary connected {_host}:{_binaryPort}");

                using var stream =
                    client.GetStream();

                await ReadBinaryAsync(
                    stream,
                    ct);
            }
            catch (OperationCanceledException)
                when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (OperationCanceledException)
            {
                _log.LogDebug(
                    "YaMoRC LocoNet Binary connect timed out: {Host}:{Port}",
                    _host,
                    _binaryPort);
            }
            catch (Exception ex)
            {
                _log.LogDebug(
                    ex,
                    "YaMoRC LocoNet Binary unavailable: {Host}:{Port}",
                    _host,
                    _binaryPort);
            }

            if (!await DelayReconnectAsync(ct))
                break;
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

    private void MarkSensorTraffic()
    {
        Interlocked.Exchange(
            ref _lastSensorTrafficTicks,
            DateTime.UtcNow.Ticks);
    }

    private async Task WaitForQuietPeriodAsync(
        CancellationToken ct)
    {
        while (true)
        {
            var lastTicks =
                Interlocked.Read(
                    ref _lastSensorTrafficTicks);

            var elapsed =
                DateTime.UtcNow -
                new DateTime(
                    lastTicks,
                    DateTimeKind.Utc);

            var remaining =
                TimeSpan.FromMilliseconds(
                    InterrogateRestMs) -
                elapsed;

            if (remaining <= TimeSpan.Zero)
                return;

            await Task.Delay(
                remaining >
                    TimeSpan.FromMilliseconds(100)
                    ? TimeSpan.FromMilliseconds(100)
                    : remaining,
                ct);
        }
    }

    private async Task<bool> SendInterrogateAsync(
        StreamWriter writer,
        CancellationToken ct)
    {
        await _interrogateGate.WaitAsync(
            ct);

        try
        {
            var now =
                DateTime.UtcNow;

            if (
                _lastInterrogateUtc !=
                    DateTime.MinValue &&
                now - _lastInterrogateUtc <
                    TimeSpan.FromSeconds(10)
            )
            {
                return true;
            }

            var sw1 =
                new byte[]
                {
                    0x78,
                    0x79,
                    0x7A,
                    0x7B,
                    0x78,
                    0x79,
                    0x7A,
                    0x7B
                };

            var sw2 =
                new byte[]
                {
                    0x27,
                    0x27,
                    0x27,
                    0x27,
                    0x07,
                    0x07,
                    0x07,
                    0x07
                };

            _log.LogInformation(
                "Starting YaMoRC LocoNet sensor interrogation");

            RawInfo?.Invoke(
                "LocoNet sensor interrogation started");

            for (var index = 0;
                 index < sw1.Length;
                 ++index)
            {
                await WaitForQuietPeriodAsync(
                    ct);

                const byte opcode =
                    0xB0;

                var checksum =
                    (byte)(
                        0xFF ^
                        opcode ^
                        sw1[index] ^
                        sw2[index]);

                var line =
                    $"SEND {opcode:X2} {sw1[index]:X2} {sw2[index]:X2} {checksum:X2}";

                _log.LogDebug(
                    "LocoNet interrogate TX {Phase}/8: {Line}",
                    index + 1,
                    line);

                await writer.WriteLineAsync(
                    line.AsMemory(),
                    ct);

                MarkSensorTraffic();
            }

            _lastInterrogateUtc =
                DateTime.UtcNow;

            RawInfo?.Invoke(
                "LocoNet sensor interrogation sent");

            return true;
        }
        finally
        {
            _interrogateGate.Release();
        }
    }

    private async Task ReadLbServerAsync(
        StreamReader reader,
        CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var line =
                await reader.ReadLineAsync(
                    ct);

            if (line is null)
                return;

            var trimmed =
                line.Trim();

            if (trimmed.Length == 0)
                continue;

            lock (_stateGate)
                _lastLbServerRxUtc =
                    DateTime.UtcNow;

            if (trimmed.StartsWith(
                    "VERSION ",
                    StringComparison.OrdinalIgnoreCase))
            {
                lock (_stateGate)
                    _lbServerVersion =
                        SanitizeLbServerVersion(
                            trimmed);
            }

            var observed =
                Interlocked.Increment(
                    ref _lbServerLinesObserved);

            if (observed <= 12)
            {
                _log.LogDebug(
                    "LocoNet LBServer RX #{Count}: {Line}",
                    observed,
                    trimmed);
            }

            var packetText =
                trimmed.StartsWith(
                    "RECEIVE ",
                    StringComparison.OrdinalIgnoreCase)
                    ? trimmed[8..]
                    : trimmed;

            if (
                packetText.Length == 0 ||
                !Uri.IsHexDigit(
                    packetText[0])
            )
            {
                continue;
            }

            var tokens =
                packetText.Split(
                    ' ',
                    StringSplitOptions.RemoveEmptyEntries |
                    StringSplitOptions.TrimEntries);

            if (tokens.Length == 0 ||
                tokens.Length > 128)
            {
                continue;
            }

            var packet =
                new byte[tokens.Length];

            var valid = true;

            for (var index = 0;
                 index < tokens.Length;
                 ++index)
            {
                try
                {
                    packet[index] =
                        Convert.ToByte(
                            tokens[index],
                            16);
                }
                catch
                {
                    valid = false;
                    break;
                }
            }

            if (valid)
                ProcessPacket(
                    packet);
        }
    }

    private async Task ReadBinaryAsync(
        NetworkStream stream,
        CancellationToken ct)
    {
        var readBuffer =
            new byte[512];

        var packet =
            new byte[128];

        var packetLength = 0;
        var expectedLength = 0;

        while (!ct.IsCancellationRequested)
        {
            var count =
                await stream.ReadAsync(
                    readBuffer,
                    ct);

            if (count <= 0)
                return;

            for (var index = 0;
                 index < count;
                 ++index)
            {
                var value =
                    readBuffer[index];

                if ((value & 0x80) != 0)
                {
                    packet[0] = value;
                    packetLength = 1;
                    expectedLength =
                        MessageLength(
                            packet,
                            packetLength);

                    continue;
                }

                if (packetLength == 0)
                    continue;

                if (packetLength >= packet.Length)
                {
                    packetLength = 0;
                    expectedLength = 0;
                    continue;
                }

                packet[packetLength++] =
                    value;

                expectedLength =
                    MessageLength(
                        packet,
                        packetLength);

                if (expectedLength <= 0)
                    continue;

                if (expectedLength >
                    packet.Length)
                {
                    packetLength = 0;
                    expectedLength = 0;
                    continue;
                }

                if (packetLength <
                    expectedLength)
                {
                    continue;
                }

                if (packetLength ==
                    expectedLength)
                {
                    ProcessPacket(
                        packet.AsSpan(
                            0,
                            packetLength));
                }

                packetLength = 0;
                expectedLength = 0;
            }
        }
    }

    private static int MessageLength(
        byte[] packet,
        int packetLength)
    {
        if (packetLength <= 0)
            return 0;

        var opcode =
            packet[0];

        if ((opcode & 0x60) ==
            0x60)
        {
            if (packetLength < 2)
                return 0;

            return packet[1];
        }

        return
            ((opcode & 0x60) >> 4) +
            2;
    }

    private void ProcessPacket(
        ReadOnlySpan<byte> packet)
    {
        if (packet.Length < 2)
            return;

        var observed =
            Interlocked.Increment(
                ref _binaryPacketsObserved);

        if (observed <= 12)
        {
            _log.LogDebug(
                "LocoNet Binary RX #{Count}: {Packet}",
                observed,
                Convert.ToHexString(
                    packet));
        }

        byte checksum = 0;

        foreach (var value in packet)
            checksum ^= value;

        if (checksum != 0xFF)
        {
            _log.LogDebug(
                "Ignoring LocoNet packet with invalid checksum: {Packet}",
                Convert.ToHexString(
                    packet));

            return;
        }

        if (
            packet[0] is
                0xB1 or
                0xB2
        )
        {
            MarkSensorTraffic();
        }
        else if (
            packet.Length >= 4 &&
            packet[0] is
                0xB0 or
                0xBD
        )
        {
            var address =
                (packet[1] & 0x7F) +
                128 *
                (packet[2] & 0x0F);

            if (address is
                0x3F8 or
                0x3F9 or
                0x3FA or
                0x3FB)
            {
                MarkSensorTraffic();
            }
        }

        if (
            packet[0] == 0xB2 &&
            packet.Length >= 4
        )
        {
            ProcessInputReport(
                packet);
        }
    }

    private void ProcessInputReport(
        ReadOnlySpan<byte> packet)
    {
        var in1 =
            packet[1];

        var in2 =
            packet[2];

        var rawAddress =
            (
                in1 |
                (
                    (in2 & 0x0F)
                    << 7
                )
            ) << 1;

        rawAddress +=
            (in2 & 0x20) != 0
                ? 2
                : 1;

        if (rawAddress is < 1 or > 4096)
            return;

        var address =
            rawAddress +
            _sensorOffset;

        if (address is < 1 or > 65535)
            return;

        var occupied =
            (in2 & 0x10) != 0;

        Interlocked.Increment(
            ref _sensorFeedbackCount);

        Volatile.Write(
            ref _lastSensorAddress,
            address);

        Volatile.Write(
            ref _lastSensorOn,
            occupied
                ? 1
                : 0);

        bool changed;
        lock (_stateGate)
        {
            _lastSensorFeedbackUtc = DateTime.UtcNow;
            changed = !_loggedSensorStates.TryGetValue(address, out var previous)
                || previous != occupied;
            _loggedSensorStates[address] = occupied;
        }

        // A small, actionable source log: one line per state transition,
        // not one line per repeat packet. The R-BUS path logs separately.
        if (changed)
            _log.LogInformation(
                "YaMoRC LocoNet/S88 sensor raw #{RawAddress} -> Hub #{Address}: {State}",
                rawAddress,
                address,
                occupied ? "ON" : "OFF");

        SensorFeedbackChanged?.Invoke(
            address,
            occupied);
    }

    private static int NormalizePort(
        int value,
        int fallback) =>
        value is >= 1 and <= 65535
            ? value
            : fallback;

    private static string SanitizeLbServerVersion(
        string line)
    {
        var tokens =
            line.Split(
                ' ',
                StringSplitOptions.RemoveEmptyEntries |
                StringSplitOptions.TrimEntries);

        string serverVersion = "";
        string model = "";
        string firmware = "";

        for (var index = 0;
             index < tokens.Length;
             ++index)
        {
            if (
                string.Equals(
                    tokens[index],
                    "version",
                    StringComparison.OrdinalIgnoreCase) &&
                index + 1 < tokens.Length
            )
            {
                serverVersion =
                    tokens[index + 1];
            }

            if (
                tokens[index].StartsWith(
                    "YD7010",
                    StringComparison.OrdinalIgnoreCase)
            )
            {
                model =
                    tokens[index]
                        .Split(
                            '-',
                            2,
                            StringSplitOptions.TrimEntries)[0];
            }

            if (
                tokens[index].StartsWith(
                    "V",
                    StringComparison.OrdinalIgnoreCase) &&
                tokens[index].Length > 1 &&
                char.IsDigit(
                    tokens[index][1])
            )
            {
                firmware =
                    tokens[index];
            }
        }

        return string.Join(
            " · ",
            new[]
            {
                serverVersion.Length > 0
                    ? "LBServer " + serverVersion
                    : "",
                model,
                firmware
            }.Where(value =>
                value.Length > 0));
    }
}
