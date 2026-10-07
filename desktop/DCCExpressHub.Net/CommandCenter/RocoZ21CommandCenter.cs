using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;

namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Native Windows Roco Z21 LAN implementation and base class for Z21-compatible
/// command stations. Vendor-specific behavior belongs in derived classes.
/// </summary>
public class RocoZ21CommandCenter : BackgroundService, ICommandCenter
{
    private sealed record TxRequest(
        byte[] Packet,
        ushort Header,
        bool LogPacket,
        CancellationToken CancellationToken,
        TaskCompletionSource<bool> Completion);

    public const int DefaultPort = 21105;
    public const int MaxRBusOffset = 65535 - 160;

    // Z21 clients only need to communicate once per minute to stay registered.
    // Use a lightweight 30 s keepalive and leave system-state/current updates
    // to the subscribed LAN_SYSTEMSTATE_DATACHANGED broadcast.
    private const int KeepAliveMs = 30_000;
    private const int OnlineTimeoutMs = 45_000;
    private const int AccessoryPulseMs = 120;
    private const int AccessorySettleMs = 50;
    private const int TurnoutActiveMs = 150;

    // Some Z21-compatible command stations answer LAN_RMBUS_GETDATA correctly
    // but do not reliably emit every asynchronous LAN_RMBUS_DATACHANGED frame.
    // Alternate one tiny group request every 100 ms. Each of the two groups is
    // therefore refreshed every 200 ms, while ProcessRBus deduplicates states
    // before they enter the Hub runtime.
    private const int RBusRefreshIntervalMs = 100;

    // Pure Z21 LAN: driving/switching + R-BUS + system state + all changed locos.
    // LocoNet forwarding flags intentionally do not belong to this protocol.
    protected const uint RocoBroadcastFlags = 0x00010103;

    private readonly ILogger _log;
    private readonly object _stateGate = new();
    private readonly SemaphoreSlim _connectGate = new(1, 1);
    private readonly SemaphoreSlim _accessoryGate = new(1, 1);
    private readonly System.Collections.Concurrent.ConcurrentDictionary<int, SemaphoreSlim> _turnoutGates = new();
    private readonly SemaphoreSlim _txSignal = new(0);
    private readonly object _txQueueGate = new();
    private readonly Queue<TxRequest> _priorityTxQueue = new();
    private readonly Queue<TxRequest> _normalTxQueue = new();
    private readonly SemaphoreSlim _programmingGate = new(1, 1);
    private readonly object _programmingStateGate = new();
    private TaskCompletionSource<CommandCenterProgrammingResult>? _programmingCompletion;
    private int _programmingExpectedCv;

    private int _rBusOffset;
    private readonly bool[] _rBusKnown = new bool[160];
    private readonly bool[] _rBusStates = new bool[160];
    private readonly byte[][] _rBusLastGroupPayloads =
    [
        new byte[10],
        new byte[10]
    ];
    private readonly bool[] _rBusGroupPayloadKnown = new bool[2];

    private DateTime _onlineSinceUtc = DateTime.MinValue;

    private int _systemMainCurrentMa;
    private int _systemProgCurrentMa;
    private int _systemFilteredMainCurrentMa;
    private int _systemTemperatureC;
    private int _systemSupplyVoltageMv;
    private int _systemTrackVoltageMv;
    private byte _systemCentralState;
    private byte _systemCentralStateEx;
    private byte _systemCapabilities;
    private DateTime _lastSystemStateUtc = DateTime.MinValue;

    private UdpClient? _udp;
    private string _host;
    private int _port;

    private bool _online;
    private bool _sessionRegistered;
    private DateTime _lastRxUtc = DateTime.MinValue;
    private DateTime _lastTxUtc = DateTime.MinValue;

    private bool _emergencyKnown;
    private bool _emergencyPaused;

    private bool _powerFeedbackKnown;
    private bool _lastPowerOn;
    private string _lastPowerTarget = "";

    protected StationInfo _stationInfo =
        new(
            Version: "",
            Processor: "Z21 LAN",
            Hardware: "Z21-compatible",
            Build: "",
            MaxLocos: 0);

    public RocoZ21CommandCenter(
        IConfiguration configuration,
        ILogger<RocoZ21CommandCenter> log)
        : this(
            configuration,
            log,
            true)
    {
    }

    protected RocoZ21CommandCenter(
        IConfiguration configuration,
        ILogger log,
        bool derivedProfile)
    {
        Configuration = configuration;
        _log = log;

        _host =
            (configuration["Z21:Host"] ??
             configuration["DccEx:Host"] ??
             "127.0.0.1")
            .Trim();

        _port =
            configuration.GetValue(
                "Z21:Port",
                DefaultPort);

        if (_port is < 1 or > 65535)
            _port = DefaultPort;

        SetRBusOffset(
            configuration.GetValue(
                "Z21:RBusOffset",
                0));
    }

    protected IConfiguration Configuration { get; }

    public int RBusOffset =>
        Volatile.Read(
            ref _rBusOffset);

    public bool SetRBusOffset(
        int offset)
    {
        if (offset is < 0 or > MaxRBusOffset)
            return false;

        var previous =
            Interlocked.Exchange(
                ref _rBusOffset,
                offset);

        if (previous != offset)
            ResetRBusState();

        _log.LogInformation(
            "Z21 R-BUS address offset = {Offset}",
            offset);

        return true;
    }
    protected virtual string Z21Profile => "z21";
    protected virtual uint BroadcastFlags => RocoBroadcastFlags;
    protected virtual string Z21ProcessorName => "Z21 LAN";
    protected virtual string Z21HardwareName(uint hardwareType) =>
        HardwareName(hardwareType);

    public bool Connected
    {
        get
        {
            lock (_stateGate)
            {
                return
                    _online &&
                    _lastRxUtc != DateTime.MinValue &&
                    DateTime.UtcNow - _lastRxUtc <=
                    TimeSpan.FromMilliseconds(OnlineTimeoutMs);
            }
        }
    }

    public string Type => "z21";
    public virtual string Name => "Z21";
    public string Endpoint => $"{_host}:{_port}/udp";
    public bool EmergencyPauseStateKnown => _emergencyKnown;
    public bool EmergencyPaused => _emergencyPaused;

    public Z21RuntimeDiagnostics Diagnostics
    {
        get
        {
            var now = DateTime.UtcNow;

            long AgeMs(
                DateTime timestamp) =>
                timestamp == DateTime.MinValue
                    ? -1
                    : Math.Max(
                        0,
                        (long)(now - timestamp).TotalMilliseconds);

            return new Z21RuntimeDiagnostics(
                Profile:
                    Z21Profile,
                BroadcastFlags:
                    BroadcastFlags,
                UdpUptimeMs:
                    _onlineSinceUtc == DateTime.MinValue
                        ? -1
                        : Math.Max(
                            0,
                            (long)(now - _onlineSinceUtc).TotalMilliseconds),
                MainCurrentMa:
                    Volatile.Read(ref _systemMainCurrentMa),
                ProgCurrentMa:
                    Volatile.Read(ref _systemProgCurrentMa),
                FilteredMainCurrentMa:
                    Volatile.Read(ref _systemFilteredMainCurrentMa),
                TemperatureC:
                    Volatile.Read(ref _systemTemperatureC),
                SupplyVoltageMv:
                    Volatile.Read(ref _systemSupplyVoltageMv),
                TrackVoltageMv:
                    Volatile.Read(ref _systemTrackVoltageMv),
                CentralState:
                    _systemCentralState,
                CentralStateEx:
                    _systemCentralStateEx,
                Capabilities:
                    _systemCapabilities,
                LastSystemStateAgeMs:
                    AgeMs(_lastSystemStateUtc));
        }
    }

    public event Action<string>? RawInfo;
    public event Action<StationInfo>? StationInfoChanged;
    public event Action<TrackInfo>? TrackConfigurationChanged;
    public event Action<int[]>? CurrentTelemetryChanged;
    public event Action<int[]>? TripTelemetryChanged;
    public event Action<PowerFeedback>? PowerFeedbackChanged;
    public event Action<LocoFeedback>? LocoFeedbackChanged;
    public event Action<int, bool>? SensorFeedbackChanged;
    public event Action<int, bool>? AccessoryFeedbackChanged;
    public event Action<bool>? ConnectionChanged;

    protected void PublishRawInfo(string raw) =>
        RawInfo?.Invoke(raw);

    protected void PublishSensorFeedback(
        int address,
        bool on) =>
        SensorFeedbackChanged?.Invoke(
            address,
            on);

    public bool SetEndpoint(
        string host,
        int port)
    {
        host = (host ?? "").Trim();

        if (host.Length == 0 ||
            port is < 1 or > 65535)
        {
            return false;
        }

        var changed =
            !string.Equals(
                _host,
                host,
                StringComparison.OrdinalIgnoreCase) ||
            _port != port;

        _host = host;
        _port = port;

        if (changed)
            ResetTransport();

        return true;
    }

    protected override async Task ExecuteAsync(
        CancellationToken stoppingToken)
    {
        using var txCts =
            new CancellationTokenSource();

        var txTask =
            RunTxQueueAsync(
                txCts.Token);

        var rBusRefreshTask =
            RunRBusRefreshAsync(
                stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!await EnsureTransportAsync(
                        stoppingToken))
                {
                    await Task.Delay(
                        1000,
                        stoppingToken);

                    continue;
                }

                if (!_sessionRegistered)
                {
                    await RegisterSessionAsync(
                        stoppingToken);
                }

                UdpClient? udp;

                lock (_stateGate)
                    udp = _udp;

                if (udp is null)
                    continue;

                using var receiveCts =
                    CancellationTokenSource
                        .CreateLinkedTokenSource(
                            stoppingToken);

                receiveCts.CancelAfter(1000);

                try
                {
                    var datagram =
                        await udp.ReceiveAsync(
                            receiveCts.Token);

                    ProcessDatagram(
                        datagram.Buffer);
                }
                catch (OperationCanceledException)
                    when (!stoppingToken.IsCancellationRequested)
                {
                }

                var now = DateTime.UtcNow;

                DateTime lastTx;

                lock (_stateGate)
                    lastTx =
                        _lastTxUtc;

                if (
                    lastTx == DateTime.MinValue ||
                    now - lastTx >=
                        TimeSpan.FromMilliseconds(
                            KeepAliveMs)
                )
                {
                    // Same strategy as JMRI: only send a heartbeat after
                    // 30 seconds with no other outgoing Z21 traffic.
                    await SendPacketAsync(
                        0x0010,
                        ReadOnlyMemory<byte>.Empty,
                        logPacket: false,
                        stoppingToken);
                }

                bool timedOut;

                lock (_stateGate)
                {
                    timedOut =
                        _online &&
                        _lastRxUtc != DateTime.MinValue &&
                        now - _lastRxUtc >
                        TimeSpan.FromMilliseconds(
                            OnlineTimeoutMs);
                }

                if (timedOut)
                {
                    _log.LogWarning(
                        "Z21 UDP session offline: reply timeout");

                    SetOnline(false);
                }
            }
            catch (OperationCanceledException)
                when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (ObjectDisposedException)
                when (!stoppingToken.IsCancellationRequested)
            {
                // Endpoint changed while ReceiveAsync was pending.
            }
            catch (Exception ex)
            {
                _log.LogWarning(
                    ex,
                    "Z21 UDP worker failed; reconnecting");

                ResetTransport();

                try
                {
                    await Task.Delay(
                        1000,
                        stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }

        try
        {
            await SendPacketCoreAsync(
                0x0030,
                ReadOnlyMemory<byte>.Empty,
                false,
                CancellationToken.None);
        }
        catch
        {
        }

        try
        {
            await rBusRefreshTask;
        }
        catch (OperationCanceledException)
            when (stoppingToken.IsCancellationRequested)
        {
        }

        txCts.Cancel();

        try
        {
            await txTask;
        }
        catch (OperationCanceledException)
        {
        }

        CancelPendingTxRequests();

        ResetTransport();
    }

    private async Task RunRBusRefreshAsync(
        CancellationToken ct)
    {
        var group = 0;

        _log.LogInformation(
            "Z21 R-BUS refresh active: each group every {IntervalMs} ms",
            RBusRefreshIntervalMs * 2);

        while (!ct.IsCancellationRequested)
        {
            bool ready;

            lock (_stateGate)
            {
                ready =
                    _sessionRegistered &&
                    _udp is not null;
            }

            if (ready)
            {
                await SendPacketAsync(
                    0x0081,
                    new byte[]
                    {
                        (byte)group
                    },
                    false,
                    ct);

                group =
                    group == 0
                        ? 1
                        : 0;
            }

            await Task.Delay(
                RBusRefreshIntervalMs,
                ct);
        }
    }

    private void ResetRBusState()
    {
        lock (_stateGate)
        {
            Array.Clear(
                _rBusKnown,
                0,
                _rBusKnown.Length);

            Array.Clear(
                _rBusStates,
                0,
                _rBusStates.Length);

            Array.Clear(
                _rBusGroupPayloadKnown,
                0,
                _rBusGroupPayloadKnown.Length);

            foreach (var payload in _rBusLastGroupPayloads)
            {
                Array.Clear(
                    payload,
                    0,
                    payload.Length);
            }
        }
    }

    private async Task<bool> EnsureTransportAsync(
        CancellationToken ct)
    {
        lock (_stateGate)
        {
            if (_udp is not null)
                return true;
        }

        await _connectGate.WaitAsync(ct);

        try
        {
            lock (_stateGate)
            {
                if (_udp is not null)
                    return true;
            }

            IPAddress? address;

            if (IPAddress.TryParse(
                    _host,
                    out var literal))
            {
                address = literal;
            }
            else
            {
                var addresses =
                    await Dns.GetHostAddressesAsync(
                        _host,
                        ct);

                address =
                    addresses.FirstOrDefault(
                        x =>
                            x.AddressFamily ==
                            AddressFamily.InterNetwork) ??
                    addresses.FirstOrDefault();
            }

            if (address is null)
                return false;

            var udp =
                new UdpClient(
                    address.AddressFamily);

            udp.Connect(
                new IPEndPoint(
                    address,
                    _port));

            lock (_stateGate)
            {
                _udp = udp;
                _sessionRegistered = false;
                _lastTxUtc =
                    DateTime.MinValue;
            }

            _log.LogInformation(
                "Z21 UDP endpoint ready: {Host} -> {Address}:{Port}",
                _host,
                address,
                _port);

            return true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.LogWarning(
                ex,
                "Z21 endpoint resolve/connect failed: {Host}:{Port}",
                _host,
                _port);

            return false;
        }
        finally
        {
            _connectGate.Release();
        }
    }

    private async Task RegisterSessionAsync(
        CancellationToken ct)
    {
        var flags =
            new byte[4];

        BinaryPrimitives.WriteUInt32LittleEndian(
            flags,
            BroadcastFlags);

        var ok =
            await SendPacketCoreAsync(
                0x0050,
                flags,
                false,
                ct);

        ok &=
            await SendPacketCoreAsync(
                0x001A,
                ReadOnlyMemory<byte>.Empty,
                false,
                ct);

        ok &=
            await SendXBusCoreAsync(
                new byte[] { 0xF1, 0x0A },
                false,
                ct);

        ok &=
            await SendXBusCoreAsync(
                new byte[] { 0x21, 0x24 },
                false,
                ct);

        ok &=
            await SendPacketCoreAsync(
                0x0085,
                ReadOnlyMemory<byte>.Empty,
                false,
                ct);

        if (ok)
        {
            _sessionRegistered = true;
            EmitTrackConfiguration();
        }
    }

    private void ResetTransport()
    {
        CancelPendingTxRequests();

        UdpClient? old;
        bool wasOnline;

        lock (_stateGate)
        {
            old = _udp;
            _udp = null;
            _sessionRegistered = false;
            _lastRxUtc = DateTime.MinValue;
            _lastTxUtc = DateTime.MinValue;
            _powerFeedbackKnown = false;
            _onlineSinceUtc = DateTime.MinValue;
            wasOnline = _online;
            _online = false;
        }

        try
        {
            old?.Dispose();
        }
        catch
        {
        }

        ResetRBusState();

        if (wasOnline)
            ConnectionChanged?.Invoke(false);
    }

    private void SetOnline(
        bool online)
    {
        bool changed;

        lock (_stateGate)
        {
            changed =
                _online != online;

            _online = online;

            if (online)
            {
                _lastRxUtc = DateTime.UtcNow;

                if (changed)
                    _onlineSinceUtc =
                        _lastRxUtc;
            }
            else if (changed)
            {
                _onlineSinceUtc =
                    DateTime.MinValue;
            }
        }

        if (changed)
        {
            _log.LogInformation(
                "Z21 UDP session {State}",
                online ? "ONLINE" : "OFFLINE");

            ConnectionChanged?.Invoke(
                online);
        }
    }

    private async Task<bool> SendPacketAsync(
        ushort header,
        ReadOnlyMemory<byte> payload,
        bool logPacket,
        CancellationToken ct,
        bool priority = false)
    {
        if (!await EnsureTransportAsync(ct))
            return false;

        return await SendPacketCoreAsync(
            header,
            payload,
            logPacket,
            ct,
            priority);
    }

    private async Task<bool> SendPacketCoreAsync(
        ushort header,
        ReadOnlyMemory<byte> payload,
        bool logPacket,
        CancellationToken ct,
        bool priority = false)
    {
        if (payload.Length > ushort.MaxValue - 4)
            return false;

        var packet =
            new byte[
                4 +
                payload.Length];

        BinaryPrimitives.WriteUInt16LittleEndian(
            packet.AsSpan(0, 2),
            (ushort)packet.Length);

        BinaryPrimitives.WriteUInt16LittleEndian(
            packet.AsSpan(2, 2),
            header);

        payload.Span.CopyTo(
            packet.AsSpan(4));

        var completion =
            new TaskCompletionSource<bool>(
                TaskCreationOptions.RunContinuationsAsynchronously);

        var request =
            new TxRequest(
                packet,
                header,
                logPacket,
                ct,
                completion);

        lock (_txQueueGate)
        {
            if (priority)
                _priorityTxQueue.Enqueue(
                    request);
            else
                _normalTxQueue.Enqueue(
                    request);
        }

        _txSignal.Release();

        try
        {
            return await completion.Task.WaitAsync(
                ct);
        }
        catch (OperationCanceledException)
            when (ct.IsCancellationRequested)
        {
            return false;
        }
    }

    private async Task RunTxQueueAsync(
        CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await _txSignal.WaitAsync(
                    ct);
            }
            catch (OperationCanceledException)
                when (ct.IsCancellationRequested)
            {
                break;
            }

            TxRequest? request = null;

            lock (_txQueueGate)
            {
                if (_priorityTxQueue.Count > 0)
                    request =
                        _priorityTxQueue.Dequeue();
                else if (_normalTxQueue.Count > 0)
                    request =
                        _normalTxQueue.Dequeue();
            }

            if (request is null)
                continue;

            if (request.CancellationToken.IsCancellationRequested)
            {
                request.Completion.TrySetCanceled(
                    request.CancellationToken);

                continue;
            }

            var ok =
                SendPacketDirect(
                    request.Packet,
                    request.Header,
                    request.LogPacket);

            request.Completion.TrySetResult(
                ok);
        }
    }

    private bool SendPacketDirect(
        byte[] packet,
        ushort header,
        bool logPacket)
    {
        UdpClient? udp;

        lock (_stateGate)
            udp = _udp;

        if (udp is null)
            return false;

        try
        {
            var written =
                udp.Send(
                    packet,
                    packet.Length);

            if (written != packet.Length)
                return false;

            lock (_stateGate)
                _lastTxUtc =
                    DateTime.UtcNow;

            if (logPacket)
            {
                _log.LogInformation(
                    "Z21 UDP TX header=0x{Header:X4} bytes={Bytes}",
                    header,
                    packet.Length);
            }

            return true;
        }
        catch (SocketException ex)
        {
            _log.LogWarning(
                ex,
                "Z21 UDP TX failed");

            return false;
        }
        catch (ObjectDisposedException)
        {
            return false;
        }
    }

    private static bool IsLocoDrivePacket(
        TxRequest request) =>
        request.Header == 0x0040 &&
        request.Packet.Length >= 7 &&
        request.Packet[4] == 0xE4 &&
        request.Packet[5] == 0x13;

    private void DropQueuedLocoDriveCommands(
        string reason)
    {
        List<TxRequest> dropped = [];

        lock (_txQueueGate)
        {
            if (_normalTxQueue.Count == 0)
                return;

            var keep =
                new Queue<TxRequest>();

            while (_normalTxQueue.Count > 0)
            {
                var request =
                    _normalTxQueue.Dequeue();

                if (IsLocoDrivePacket(
                        request))
                {
                    dropped.Add(
                        request);
                }
                else
                {
                    keep.Enqueue(
                        request);
                }
            }

            while (keep.Count > 0)
                _normalTxQueue.Enqueue(
                    keep.Dequeue());
        }

        foreach (var request in dropped)
            request.Completion.TrySetResult(
                false);

        if (dropped.Count > 0)
        {
            _log.LogWarning(
                "Dropped {Count} queued Z21 locomotive drive command(s): {Reason}",
                dropped.Count,
                reason);
        }
    }

    private void CancelPendingTxRequests()
    {
        TxRequest[] pending;

        lock (_txQueueGate)
        {
            pending =
                _priorityTxQueue
                    .Concat(
                        _normalTxQueue)
                    .ToArray();

            _priorityTxQueue.Clear();
            _normalTxQueue.Clear();
        }

        foreach (var request in pending)
            request.Completion.TrySetCanceled();
    }

    private Task<bool> SendXBusAsync(
        ReadOnlyMemory<byte> payload,
        bool logPacket,
        CancellationToken ct,
        bool priority = false) =>
        SendXBusInternalAsync(
            payload,
            logPacket,
            ensureTransport: true,
            ct,
            priority);

    private Task<bool> SendXBusCoreAsync(
        ReadOnlyMemory<byte> payload,
        bool logPacket,
        CancellationToken ct,
        bool priority = false) =>
        SendXBusInternalAsync(
            payload,
            logPacket,
            ensureTransport: false,
            ct,
            priority);

    private async Task<bool> SendXBusInternalAsync(
        ReadOnlyMemory<byte> payload,
        bool logPacket,
        bool ensureTransport,
        CancellationToken ct,
        bool priority = false)
    {
        if (payload.Length == 0)
            return false;

        var data =
            new byte[
                payload.Length +
                1];

        payload.Span.CopyTo(data);

        byte xor = 0;

        foreach (var value in payload.Span)
            xor ^= value;

        data[^1] = xor;

        return ensureTransport
            ? await SendPacketAsync(
                0x0040,
                data,
                logPacket,
                ct,
                priority)
            : await SendPacketCoreAsync(
                0x0040,
                data,
                logPacket,
                ct,
                priority);
    }

    private async Task<CommandCenterProgrammingResult> SendProgrammingAndWaitAsync(
        byte[] payload,
        int cv,
        CancellationToken ct)
    {
        if (cv is < 1 or > 1024)
            return new(false, cv, -1, "Invalid CV number.");

        await _programmingGate.WaitAsync(ct);

        try
        {
            var completion =
                new TaskCompletionSource<CommandCenterProgrammingResult>(
                    TaskCreationOptions.RunContinuationsAsynchronously);

            lock (_programmingStateGate)
            {
                _programmingCompletion =
                    completion;

                _programmingExpectedCv =
                    cv;
            }

            var sent =
                await SendXBusAsync(
                    payload,
                    true,
                    ct);

            if (!sent)
            {
                lock (_programmingStateGate)
                {
                    if (ReferenceEquals(
                            _programmingCompletion,
                            completion))
                        _programmingCompletion = null;
                }

                return new(
                    false,
                    cv,
                    -1,
                    "Z21 programming command could not be sent.");
            }

            try
            {
                return await completion.Task.WaitAsync(
                    TimeSpan.FromSeconds(24),
                    ct);
            }
            catch (TimeoutException)
            {
                return new(
                    false,
                    cv,
                    -1,
                    "Z21 programming command timed out.");
            }
            finally
            {
                lock (_programmingStateGate)
                {
                    if (ReferenceEquals(
                            _programmingCompletion,
                            completion))
                        _programmingCompletion = null;
                }
            }
        }
        finally
        {
            _programmingGate.Release();
        }
    }

    private static byte[] ServiceCvPayload(
        bool write,
        int cv,
        int value)
    {
        var cvAddress =
            cv - 1;

        return write
            ? new byte[]
            {
                0x24,
                0x12,
                (byte)(cvAddress >> 8),
                (byte)(cvAddress & 0xFF),
                (byte)value
            }
            : new byte[]
            {
                0x23,
                0x11,
                (byte)(cvAddress >> 8),
                (byte)(cvAddress & 0xFF)
            };
    }

    private static byte[] PomCvPayload(
        bool accessory,
        bool write,
        int address,
        int cv,
        int value)
    {
        var cvAddress =
            cv - 1;

        byte addressMsb;
        byte addressLsb;

        if (accessory)
        {
            // Human-facing accessory decoder address 1..512; Z21 LAN uses
            // Decoder_Address 0..511.
            var decoderAddress =
                address - 1;

            var encoded =
                (decoderAddress & 0x01FF) <<
                4;

            addressMsb =
                (byte)(encoded >> 8);

            addressLsb =
                (byte)(encoded & 0xFF);
        }
        else
        {
            EncodeLocoAddress(
                address,
                out addressMsb,
                out addressLsb);
        }

        var option =
            (byte)(
                (write
                    ? 0xEC
                    : 0xE4) |
                ((cvAddress >> 8) & 0x03));

        return
        [
            0xE6,
            accessory
                ? (byte)0x31
                : (byte)0x30,
            addressMsb,
            addressLsb,
            option,
            (byte)(cvAddress & 0xFF),
            write
                ? (byte)value
                : (byte)0
        ];
    }

    public Task<CommandCenterProgrammingResult> ReadServiceCvAsync(
        int cv,
        CancellationToken ct = default) =>
        SendProgrammingAndWaitAsync(
            ServiceCvPayload(
                false,
                cv,
                0),
            cv,
            ct);

    public Task<CommandCenterProgrammingResult> WriteServiceCvAsync(
        int cv,
        int value,
        CancellationToken ct = default)
    {
        if (cv is < 1 or > 1024 ||
            value is < 0 or > 255)
            return Task.FromResult(
                new CommandCenterProgrammingResult(
                    false,
                    cv,
                    -1,
                    "Invalid CV number or value."));

        return SendProgrammingAndWaitAsync(
            ServiceCvPayload(
                true,
                cv,
                value),
            cv,
            ct);
    }

    public Task<CommandCenterProgrammingResult> ReadPomCvAsync(
        int address,
        int cv,
        CancellationToken ct = default)
    {
        if (address is < 1 or > 9999 ||
            cv is < 1 or > 1024)
            return Task.FromResult(
                new CommandCenterProgrammingResult(
                    false,
                    cv,
                    -1,
                    "Invalid locomotive POM address or CV."));

        return SendProgrammingAndWaitAsync(
            PomCvPayload(
                false,
                false,
                address,
                cv,
                0),
            cv,
            ct);
    }

    public async Task<CommandCenterProgrammingResult> WritePomCvAsync(
        int address,
        int cv,
        int value,
        CancellationToken ct = default)
    {
        if (address is < 1 or > 9999 ||
            cv is < 1 or > 1024 ||
            value is < 0 or > 255)
            return new(
                false,
                cv,
                -1,
                "Invalid locomotive POM address, CV or value.");

        var sent =
            await SendXBusAsync(
                PomCvPayload(
                    false,
                    true,
                    address,
                    cv,
                    value),
                true,
                ct);

        return new(
            sent,
            cv,
            sent ? value : -1,
            sent
                ? "Z21 locomotive POM write sent; the protocol does not confirm the decoder write."
                : "Z21 locomotive POM write could not be sent.",
            sent
                ? "Z21 POM"
                : "");
    }

    public Task<CommandCenterProgrammingResult> ReadAccessoryPomCvAsync(
        int decoderAddress,
        int cv,
        CancellationToken ct = default)
    {
        if (decoderAddress is < 1 or > 512 ||
            cv is < 1 or > 1024)
            return Task.FromResult(
                new CommandCenterProgrammingResult(
                    false,
                    cv,
                    -1,
                    "Invalid accessory decoder address or CV."));

        return SendProgrammingAndWaitAsync(
            PomCvPayload(
                true,
                false,
                decoderAddress,
                cv,
                0),
            cv,
            ct);
    }

    public async Task<CommandCenterProgrammingResult> WriteAccessoryPomCvAsync(
        int decoderAddress,
        int cv,
        int value,
        CancellationToken ct = default)
    {
        if (decoderAddress is < 1 or > 512 ||
            cv is < 1 or > 1024 ||
            value is < 0 or > 255)
            return new(
                false,
                cv,
                -1,
                "Invalid accessory decoder address, CV or value.");

        var sent =
            await SendXBusAsync(
                PomCvPayload(
                    true,
                    true,
                    decoderAddress,
                    cv,
                    value),
                true,
                ct);

        return new(
            sent,
            cv,
            sent ? value : -1,
            sent
                ? "Z21 accessory POM write sent; the protocol does not confirm the decoder write."
                : "Z21 accessory POM write could not be sent.",
            sent
                ? "Z21 accessory POM"
                : "");
    }

    public Task<bool> SendRawAsync(
        string command,
        bool log = true,
        CancellationToken ct = default)
    {
        if (log)
        {
            _log.LogWarning(
                "Z21 does not accept DCC-EX raw commands: {Command}",
                command);
        }

        return Task.FromResult(false);
    }

    public async Task<bool> SetTrackPowerAsync(
        bool on,
        bool includeProgramming = true,
        CancellationToken ct = default)
    {
        if (!on)
        {
            DropQueuedLocoDriveCommands(
                "track power OFF");
        }

        var ok =
            await SendXBusAsync(
                new byte[]
                {
                    0x21,
                    on
                        ? (byte)0x81
                        : (byte)0x80
                },
                true,
                ct,
                priority:
                    !on);

        if (ok && on)
        {
            UpdateEmergencyState(
                false,
                "track power on command");
        }

        return ok;
    }

    public Task<bool> SetProgrammingPowerAsync(
        bool on,
        CancellationToken ct = default)
    {
        _log.LogWarning(
            "Z21 programming-track power is controlled by programming commands, not a separate power toggle");

        return Task.FromResult(false);
    }

    public async Task<bool> EmergencyStopAsync(
        CancellationToken ct = default)
    {
        if (_emergencyKnown &&
            _emergencyPaused)
        {
            // Z21 LAN protocol 2.6: TRACK_POWER_ON also terminates an
            // emergency stop while leaving track voltage enabled.
            var resumed =
                await SendXBusAsync(
                    new byte[]
                    {
                        0x21,
                        0x81
                    },
                    true,
                    ct,
                    priority: true);

            if (resumed)
                UpdateEmergencyState(
                    false,
                    "local release");

            return resumed;
        }

        // Z21 LAN protocol 2.13: emergency stop all locomotives while the
        // track voltage remains switched on. Drop stale queued throttle
        // commands before the priority E-STOP packet is enqueued.
        DropQueuedLocoDriveCommands(
            "emergency stop");

        var stopped =
            await SendXBusAsync(
                new byte[] { 0x80 },
                true,
                ct,
                priority: true);

        if (stopped)
            UpdateEmergencyState(
                true,
                "local request");

        return stopped;
    }

    public async Task<bool> SetLocoAsync(
        int address,
        int speed,
        bool forward,
        CancellationToken ct = default)
    {
        if (address is < 1 or > 9999 ||
            speed is < 0 or > 126)
        {
            return false;
        }

        if (_emergencyKnown &&
            _emergencyPaused &&
            speed > 0)
        {
            _log.LogWarning(
                "Z21 loco #{Address} speed {Speed} rejected while emergency stop is active",
                address,
                speed);

            return false;
        }

        EncodeLocoAddress(
            address,
            out var msb,
            out var lsb);

        byte speedByte =
            speed == 0
                ? (byte)0
                : (byte)(speed + 1);

        if (forward)
            speedByte |= 0x80;

        return await SendXBusAsync(
            new byte[]
            {
                0xE4,
                0x13,
                msb,
                lsb,
                speedByte
            },
            true,
            ct);
    }

    public Task<bool> RequestLocoAsync(
        int address,
        CancellationToken ct = default)
    {
        if (address is < 1 or > 9999)
            return Task.FromResult(false);

        EncodeLocoAddress(
            address,
            out var msb,
            out var lsb);

        return SendXBusAsync(
            new byte[]
            {
                0xE3,
                0xF0,
                msb,
                lsb
            },
            false,
            ct);
    }

    public Task<bool> SetLocoFunctionAsync(
        int address,
        int fn,
        bool active,
        CancellationToken ct = default)
    {
        if (address is < 1 or > 9999 ||
            fn is < 0 or > 28)
        {
            return Task.FromResult(false);
        }

        EncodeLocoAddress(
            address,
            out var msb,
            out var lsb);

        var function =
            (byte)(
                (active
                    ? 0x40
                    : 0x00) |
                (fn & 0x3F));

        return SendXBusAsync(
            new byte[]
            {
                0xE4,
                0xF8,
                msb,
                lsb,
                function
            },
            true,
            ct);
    }

    public async Task<bool> SetTurnoutAsync(
        int address,
        bool physicalValue,
        CancellationToken ct = default)
    {
        if (address is < 1 or > 2048)
            return false;

        // Serialize a complete ON -> OFF pulse per physical turnout address.
        // JMRI and Rocrail use the same principle: a second operation must not
        // overlap the first turnout activation/deactivation cycle.
        var gate =
            _turnoutGates.GetOrAdd(
                address,
                static _ =>
                    new SemaphoreSlim(1, 1));

        await gate.WaitAsync(
            ct);

        var functionAddress =
            address - 1;

        var activated = false;

        try
        {
            _log.LogInformation(
                "Z21 turnout #{Address}: physical={PhysicalValue}, functionAddress={FunctionAddress}, Q=1, activeMs={ActiveMs}",
                address,
                physicalValue,
                functionAddress,
                TurnoutActiveMs);

            if (!await SendAccessoryPulseAsync(
                    functionAddress,
                    physicalValue,
                    activate: true,
                    ct: ct))
            {
                return false;
            }

            activated = true;

            await Task.Delay(
                TurnoutActiveMs,
                ct);

            var ok =
                await SendAccessoryPulseAsync(
                    functionAddress,
                    physicalValue,
                    activate: false,
                    ct: CancellationToken.None,
                    priority: true,
                    ensureTransport: false);

            activated = false;

            if (!ok)
            {
                _log.LogWarning(
                    "Z21 turnout #{Address}: deactivate failed",
                    address);

                return false;
            }

            // Keep the per-address gate until the decoder output has had time
            // to settle. WsHub therefore also keeps the SwitchMan lease for the
            // whole physical switching operation.
            await Task.Delay(
                AccessorySettleMs,
                CancellationToken.None);

            return true;
        }
        catch (OperationCanceledException)
            when (ct.IsCancellationRequested)
        {
            return false;
        }
        finally
        {
            if (activated)
            {
                try
                {
                    await SendAccessoryPulseAsync(
                        functionAddress,
                        physicalValue,
                        activate: false,
                        ct: CancellationToken.None,
                        priority: true);
                }
                catch (Exception ex)
                {
                    _log.LogWarning(
                        ex,
                        "Z21 turnout #{Address}: emergency deactivate failed",
                        address);
                }
            }

            gate.Release();
        }
    }

    public Task<bool> SetAccessoryAsync(
        int address,
        bool active,
        CancellationToken ct = default) =>
        SendTimedAccessoryPulseAsync(
            address,
            active,
            ct);

    private async Task<bool> SendTimedAccessoryPulseAsync(
        int address,
        bool position,
        CancellationToken ct)
    {
        if (address is < 1 or > 2048)
            return false;

        var functionAddress =
            address - 1;

        await _accessoryGate.WaitAsync(
            ct);

        var activated = false;

        try
        {
            if (!await SendAccessoryPulseAsync(
                    functionAddress,
                    position,
                    activate: true,
                    ct: ct))
            {
                return false;
            }

            activated = true;

            await Task.Delay(
                AccessoryPulseMs,
                ct);

            var ok =
                await SendAccessoryPulseAsync(
                    functionAddress,
                    position,
                    activate: false,
                    ct: CancellationToken.None,
                    priority: true,
                    ensureTransport: false);

            activated = false;

            if (!ok)
                return false;

            await Task.Delay(
                AccessorySettleMs,
                CancellationToken.None);

            return true;
        }
        catch (OperationCanceledException)
            when (ct.IsCancellationRequested)
        {
            return false;
        }
        finally
        {
            if (activated)
            {
                try
                {
                    await SendAccessoryPulseAsync(
                        functionAddress,
                        position,
                        activate: false,
                        ct: CancellationToken.None,
                        priority: true);
                }
                catch
                {
                }
            }

            _accessoryGate.Release();
        }
    }

    private Task<bool> SendAccessoryPulseAsync(
        int functionAddress,
        bool position,
        bool activate,
        CancellationToken ct,
        bool priority = false,
        bool ensureTransport = true)
    {
        // LAN_X_SET_TURNOUT DB2 = 100QA00P.
        //
        // Q=1 is intentional for the Windows Z21 backend: every
        // turnout/basic-accessory activate and deactivate command is placed
        // into the command station's own switching FIFO. Do not mix Q=0 and
        // Q=1 commands in this backend.
        byte control = 0xA0;

        if (activate)
            control |= 0x08;

        if (position)
            control |= 0x01;

        var payload =
            new byte[]
            {
                0x53,
                (byte)(functionAddress >> 8),
                (byte)(functionAddress & 0xFF),
                control
            };

        return ensureTransport
            ? SendXBusAsync(
                payload,
                true,
                ct,
                priority)
            : SendXBusCoreAsync(
                payload,
                true,
                ct,
                priority);
    }

    public Task<bool> SetSignalAspectAsync(
        int address,
        int aspect,
        CancellationToken ct = default)
    {
        if (address is < 1 or > 2044 ||
            aspect is < 0 or > 255)
        {
            return Task.FromResult(false);
        }

        var rawAddress =
            address + 3;

        return SendXBusAsync(
            new byte[]
            {
                0x54,
                (byte)(rawAddress >> 8),
                (byte)(rawAddress & 0xFF),
                (byte)aspect,
                0x00
            },
            true,
            ct);
    }

    public Task<bool> SetVPinAsync(
        int vpin,
        bool active,
        CancellationToken ct = default)
    {
        _log.LogWarning(
            "Z21 does not support DCC-EX VPin commands");

        return Task.FromResult(false);
    }

    public Task<bool> RequestTrackConfigurationAsync(
        CancellationToken ct = default)
    {
        EmitTrackConfiguration();
        return Task.FromResult(true);
    }

    public Task<bool> RequestCurrentTelemetryAsync(
        CancellationToken ct = default)
    {
        // WsRuntimeCoordinator asks command centers for current telemetry at
        // 1 Hz. Z21 does not need that polling because our broadcast flags
        // include 0x00000100, which asynchronously delivers the same
        // LAN_SYSTEMSTATE_DATACHANGED dataset whenever it changes.
        // RegisterSessionAsync still requests one authoritative snapshot.
        return Task.FromResult(true);
    }

    public Task<bool> RequestTripTelemetryAsync(
        CancellationToken ct = default)
    {
        TripTelemetryChanged?.Invoke([]);
        return Task.FromResult(true);
    }

    public virtual async Task<bool> RequestSensorSnapshotAsync(
        CancellationToken ct = default)
    {
        _log.LogInformation(
            "Z21 R-BUS snapshot request: groups 0 and 1");

        var rbus0 =
            await SendPacketAsync(
                0x0081,
                new byte[] { 0x00 },
                false,
                ct);

        var rbus1 =
            await SendPacketAsync(
                0x0081,
                new byte[] { 0x01 },
                false,
                ct);

        _log.LogInformation(
            "Z21 R-BUS snapshot request sent: group0={Group0} group1={Group1}",
            rbus0,
            rbus1);

        return
            rbus0 ||
            rbus1;
    }

    private void ProcessDatagram(
        byte[] buffer)
    {
        var offset = 0;
        var valid = false;

        while (offset + 4 <= buffer.Length)
        {
            var dataLen =
                BinaryPrimitives
                    .ReadUInt16LittleEndian(
                        buffer.AsSpan(
                            offset,
                            2));

            if (dataLen < 4 ||
                offset + dataLen > buffer.Length)
            {
                _log.LogWarning(
                    "Z21 malformed UDP dataset");

                break;
            }

            ProcessDataset(
                buffer.AsSpan(
                    offset,
                    dataLen));

            valid = true;
            offset += dataLen;
        }

        if (!valid)
            return;

        bool hadPreviousReply;
        var wasOnline =
            Connected;

        lock (_stateGate)
            hadPreviousReply =
                _lastRxUtc !=
                DateTime.MinValue;

        SetOnline(true);

        if (
            hadPreviousReply &&
            !wasOnline
        )
        {
            // The normal worker performs registration. Mark the session stale
            // on a real recovery, but never launch a second parallel
            // registration from the first startup reply.
            lock (_stateGate)
                _sessionRegistered = false;
        }
    }

    private void ProcessDataset(
        ReadOnlySpan<byte> dataset)
    {
        if (dataset.Length < 4)
            return;

        var header =
            BinaryPrimitives
                .ReadUInt16LittleEndian(
                    dataset.Slice(2, 2));

        var payload =
            dataset[4..];

        switch (header)
        {
            case 0x0040:
                ProcessXBus(payload);
                break;

            case 0x0080:
                ProcessRBus(payload);
                break;

            case 0x0084:
                ProcessSystemState(payload);
                break;

            case 0x001A:
                ProcessHardwareInfo(payload);
                break;

        }
    }

    private void EmitPowerFeedbackIfChanged(
        bool on,
        string target)
    {
        if (
            _powerFeedbackKnown &&
            _lastPowerOn == on &&
            string.Equals(
                _lastPowerTarget,
                target,
                StringComparison.Ordinal)
        )
        {
            return;
        }

        _powerFeedbackKnown = true;
        _lastPowerOn = on;
        _lastPowerTarget = target;

        _log.LogInformation(
            "Z21 power state changed: {State} target={Target}",
            on
                ? "ON"
                : "OFF",
            target);

        PowerFeedbackChanged?.Invoke(
            new PowerFeedback(
                on,
                target));
    }

    private void UpdateEmergencyState(
        bool active,
        string source)
    {
        var changed =
            !_emergencyKnown ||
            _emergencyPaused != active;

        _emergencyKnown = true;
        _emergencyPaused = active;

        if (!changed)
            return;

        _log.LogInformation(
            "Z21 emergency stop {State} ({Source})",
            active
                ? "ACTIVE"
                : "CLEARED",
            source);

        // WsHub uses RawInfo as the generic immediate state-sync hook for
        // EmergencyPauseStateKnown/EmergencyPaused.
        RawInfo?.Invoke(
            active
                ? "Z21: emergency stop active"
                : "Z21: emergency stop cleared");
    }

    private void ProcessXBus(
        ReadOnlySpan<byte> data)
    {
        if (data.Length < 2)
            return;

        var xHeader = data[0];

        if (xHeader == 0x64 &&
            data.Length >= 6 &&
            data[1] == 0x14)
        {
            var cv =
                ((data[2] << 8) |
                 data[3]) +
                1;

            var value =
                data[4];

            TaskCompletionSource<CommandCenterProgrammingResult>? completion;

            lock (_programmingStateGate)
                completion =
                    _programmingCompletion;

            completion?.TrySetResult(
                new(
                    true,
                    cv,
                    value,
                    "CV operation completed.",
                    "Z21 CV_RESULT"));

            return;
        }

        if (xHeader == 0x61 &&
            data.Length >= 3 &&
            data[1] is 0x12 or 0x13)
        {
            TaskCompletionSource<CommandCenterProgrammingResult>? completion;
            int cv;

            lock (_programmingStateGate)
            {
                completion =
                    _programmingCompletion;

                cv =
                    _programmingExpectedCv;
            }

            var shortCircuit =
                data[1] == 0x12;

            completion?.TrySetResult(
                new(
                    false,
                    cv,
                    -1,
                    shortCircuit
                        ? "Programming track short circuit."
                        : "Decoder did not acknowledge the programming command.",
                    shortCircuit
                        ? "Z21 CV_NACK_SC"
                        : "Z21 CV_NACK"));

            return;
        }

        if (xHeader == 0x61 &&
            data.Length >= 3)
        {
            var target =
                data[1] == 0x02
                    ? "Programming"
                    : "All";

            var on =
                data[1] is 0x01 or 0x02;

            EmitPowerFeedbackIfChanged(
                on,
                target);

            if (data[1] == 0x01)
            {
                UpdateEmergencyState(
                    false,
                    "track power on");
            }

            return;
        }

        if (xHeader == 0x81)
        {
            UpdateEmergencyState(
                true,
                "LAN_X_BC_STOPPED");

            return;
        }

        if (xHeader == 0x62 &&
            data.Length >= 4 &&
            data[1] == 0x22)
        {
            var status = data[2];

            UpdateEmergencyState(
                (status & 0x01) != 0,
                "LAN_X_STATUS_CHANGED");

            EmitPowerFeedbackIfChanged(
                (status & 0x02) == 0,
                (status & 0x20) != 0
                    ? "Programming"
                    : "All");

            return;
        }

        if (xHeader == 0xF3 &&
            data.Length >= 5 &&
            data[1] == 0x0A)
        {
            _stationInfo =
                _stationInfo with
                {
                    Version =
                        $"{BcdByte(data[2])}.{BcdByte(data[3]):D2}"
                };

            StationInfoChanged?.Invoke(
                _stationInfo);

            return;
        }

        if (xHeader == 0xEF &&
            data.Length >= 7)
        {
            var address =
                ((data[1] & 0x3F) << 8) |
                data[2];

            var speedMode =
                data[3] & 0x07;

            var rawSpeed = data[4];
            var encodedSpeed =
                rawSpeed & 0x7F;

            int speed;

            if (speedMode == 4)
            {
                speed =
                    encodedSpeed <= 1
                        ? 0
                        : encodedSpeed - 1;
            }
            else
            {
                speed =
                    encodedSpeed <= 1
                        ? 0
                        : Math.Min(
                            126,
                            encodedSpeed);
            }

            uint functions = 0;
            var f0f4 = data[5];

            if ((f0f4 & 0x10) != 0)
                functions |= 1u << 0;

            if ((f0f4 & 0x01) != 0)
                functions |= 1u << 1;

            if ((f0f4 & 0x02) != 0)
                functions |= 1u << 2;

            if ((f0f4 & 0x04) != 0)
                functions |= 1u << 3;

            if ((f0f4 & 0x08) != 0)
                functions |= 1u << 4;

            if (data.Length >= 8)
                functions |= (uint)data[6] << 5;

            if (data.Length >= 9)
                functions |= (uint)data[7] << 13;

            if (data.Length >= 10)
                functions |= (uint)data[8] << 21;

            LocoFeedbackChanged?.Invoke(
                new LocoFeedback(
                    address,
                    speed,
                    (rawSpeed & 0x80) != 0,
                    functions));

            return;
        }

        if (xHeader == 0x43 &&
            data.Length >= 5)
        {
            var functionAddress =
                (data[1] << 8) |
                data[2];

            var address =
                functionAddress + 1;

            var position =
                data[3] & 0x03;

            RawInfo?.Invoke(
                $"Z21 turnout {address} position={position}");

            // LAN_X_TURNOUT_INFO: 1=P0, 2=P1, 0=unknown, 3=inconsistent.
            // Hub runtime stores the physical output bool, so only publish
            // authoritative states and leave unknown/inconsistent untouched.
            if (position is 1 or 2)
            {
                var physicalValue =
                    position == 2;

                AccessoryFeedbackChanged?.Invoke(
                    address,
                    physicalValue);
            }
            else
            {
                _log.LogDebug(
                    "Z21 turnout #{Address} feedback not authoritative: position={Position}",
                    address,
                    position);
            }

            return;
        }

        if (xHeader == 0x44 &&
            data.Length >= 6)
        {
            var rawAddress =
                (data[1] << 8) |
                data[2];

            RawInfo?.Invoke(
                $"Z21 extended accessory {(rawAddress >= 4 ? rawAddress - 3 : rawAddress)} aspect={data[3]}");
        }
    }

    private void ProcessSystemState(
        ReadOnlySpan<byte> data)
    {
        if (data.Length < 16)
            return;

        var mainCurrent =
            BinaryPrimitives.ReadInt16LittleEndian(
                data.Slice(0, 2));

        var progCurrent =
            BinaryPrimitives.ReadInt16LittleEndian(
                data.Slice(2, 2));

        var filteredMainCurrent =
            BinaryPrimitives.ReadInt16LittleEndian(
                data.Slice(4, 2));

        var temperature =
            BinaryPrimitives.ReadInt16LittleEndian(
                data.Slice(6, 2));

        var supplyVoltage =
            BinaryPrimitives.ReadUInt16LittleEndian(
                data.Slice(8, 2));

        var trackVoltage =
            BinaryPrimitives.ReadUInt16LittleEndian(
                data.Slice(10, 2));

        var centralState =
            data[12];

        Volatile.Write(
            ref _systemMainCurrentMa,
            mainCurrent);
        Volatile.Write(
            ref _systemProgCurrentMa,
            progCurrent);
        Volatile.Write(
            ref _systemFilteredMainCurrentMa,
            filteredMainCurrent);
        Volatile.Write(
            ref _systemTemperatureC,
            temperature);
        Volatile.Write(
            ref _systemSupplyVoltageMv,
            supplyVoltage);
        Volatile.Write(
            ref _systemTrackVoltageMv,
            trackVoltage);

        lock (_stateGate)
        {
            _systemCentralState =
                centralState;
            _systemCentralStateEx =
                data[13];
            _systemCapabilities =
                data[15];
            _lastSystemStateUtc =
                DateTime.UtcNow;
        }

        CurrentTelemetryChanged?.Invoke(
            [
                mainCurrent,
                progCurrent
            ]);

        UpdateEmergencyState(
            (centralState & 0x01) != 0,
            "LAN_SYSTEMSTATE_DATACHANGED");

        EmitPowerFeedbackIfChanged(
            (centralState & 0x02) == 0,
            (centralState & 0x20) != 0
                ? "Programming"
                : "All");
    }

    private void ProcessHardwareInfo(
        ReadOnlySpan<byte> data)
    {
        if (data.Length < 8)
            return;

        var hardwareType =
            BinaryPrimitives
                .ReadUInt32LittleEndian(
                    data[..4]);

        var firmware =
            BinaryPrimitives
                .ReadUInt32LittleEndian(
                    data.Slice(4, 4));

        _stationInfo =
            _stationInfo with
            {
                Version =
                    BcdVersion(firmware),
                Processor =
                    Z21ProcessorName,
                Hardware =
                    Z21HardwareName(
                        hardwareType),
                MaxLocos = 0
            };

        StationInfoChanged?.Invoke(
            _stationInfo);
    }

    private void ProcessRBus(
        ReadOnlySpan<byte> data)
    {
        if (data.Length < 11)
        {
            _log.LogWarning(
                "Z21 R-BUS packet too short: {Length} byte(s)",
                data.Length);
            return;
        }

        var group = data[0];

        if (group > 1)
        {
            _log.LogWarning(
                "Z21 R-BUS unsupported group {Group}",
                group);
            return;
        }

        var groupPayload =
            data.Slice(
                1,
                10);

        bool groupPayloadChanged;

        lock (_stateGate)
        {
            groupPayloadChanged =
                !_rBusGroupPayloadKnown[
                    group] ||
                !groupPayload.SequenceEqual(
                    _rBusLastGroupPayloads[
                        group]);

            if (groupPayloadChanged)
            {
                groupPayload.CopyTo(
                    _rBusLastGroupPayloads[
                        group]);

                _rBusGroupPayloadKnown[
                    group] =
                    true;
            }
        }

        if (groupPayloadChanged)
        {
            _log.LogInformation(
                "Z21 R-BUS RAW group {Group} changed: {Bytes}",
                group,
                Convert.ToHexString(
                    groupPayload));
        }

        for (var byteIndex = 0;
             byteIndex < 10;
             ++byteIndex)
        {
            var status =
                data[
                    1 +
                    byteIndex];

            for (var bit = 0;
                 bit < 8;
                 ++bit)
            {
                var rawAddress =
                    (
                        group * 10 +
                        byteIndex
                    ) * 8 +
                    bit +
                    1;

                var occupied =
                    (status &
                     (1 << bit)) != 0;

                var stateIndex =
                    rawAddress - 1;

                bool changed;

                lock (_stateGate)
                {
                    changed =
                        !_rBusKnown[
                            stateIndex] ||
                        _rBusStates[
                            stateIndex] !=
                            occupied;

                    _rBusKnown[
                        stateIndex] =
                        true;

                    _rBusStates[
                        stateIndex] =
                        occupied;
                }

                if (!changed)
                    continue;

                var address =
                    rawAddress +
                    RBusOffset;

                _log.LogInformation(
                    "Z21 R-BUS sensor raw #{RawAddress} -> Hub #{Address}: {State} (module {Module}, input {Input})",
                    rawAddress,
                    address,
                    occupied
                        ? "ON"
                        : "OFF",
                    group * 10 + byteIndex + 1,
                    bit + 1);

                SensorFeedbackChanged?.Invoke(
                    address,
                    occupied);
            }
        }
    }

    private void EmitTrackConfiguration()
    {
        TrackConfigurationChanged?.Invoke(
            new TrackInfo(
                0,
                "MAIN"));

        TrackConfigurationChanged?.Invoke(
            new TrackInfo(
                1,
                "PROG"));
    }

    private static void EncodeLocoAddress(
        int address,
        out byte msb,
        out byte lsb)
    {
        msb =
            (byte)(
                (address >> 8) &
                0x3F);

        lsb =
            (byte)(
                address &
                0xFF);

        if (address >= 128)
            msb |= 0xC0;
    }

    private static string BcdVersion(
        uint value)
    {
        var b0 =
            (byte)(value & 0xFF);

        var b1 =
            (byte)((value >> 8) & 0xFF);

        var major =
            b1 != 0
                ? b1
                : b0;

        var minor =
            b1 != 0
                ? b0
                : (byte)((value >> 8) & 0xFF);

        return
            $"{BcdByte(major)}.{BcdByte(minor):D2}";
    }

    private static int BcdByte(
        byte value) =>
        ((value >> 4) & 0x0F) * 10 +
        (value & 0x0F);

    private static string HardwareName(
        uint hardwareType) =>
        hardwareType switch
        {
            0x00000200 =>
                "Z21 black (2012)",

            0x00000201 =>
                "Z21 black",

            0x00000203 =>
                "z21 white",

            0x00000204 =>
                "z21 start",

            0x00000211 =>
                "Z21 XL",

            _ =>
                $"Z21 compatible HW 0x{hardwareType:X8}"
        };
}
