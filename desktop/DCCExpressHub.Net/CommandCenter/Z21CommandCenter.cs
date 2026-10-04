using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;

namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Native Windows Z21 LAN client. The implementation mirrors the embedded
/// Z21 backend: UDP transport, X-BUS tunnelling, 128-step locomotive control,
/// turnout/accessory pulses, extended accessories, system telemetry and
/// feedback-bus occupancy.
/// </summary>
public sealed class Z21CommandCenter : BackgroundService, ICommandCenter
{
    public const int DefaultPort = 21105;

    // Z21 clients only need to communicate once per minute to stay registered.
    // Use a lightweight 30 s keepalive and leave system-state/current updates
    // to the subscribed LAN_SYSTEMSTATE_DATACHANGED broadcast.
    private const int KeepAliveMs = 30_000;
    private const int OnlineTimeoutMs = 45_000;
    private const int AccessoryPulseMs = 120;
    private const int AccessorySettleMs = 50;
    private const int LocoNetInterrogateRestMs = 1250;

    // Generic Z21: driving/switching + R-BUS + system state + all changed
    // locos + LocoNet detector occupancy.
    private const uint Z21BroadcastFlags = 0x08010103;

    // YaMoRC additionally exposes raw LocoNet messages. Keep this vendor
    // extension out of the generic Z21 mode.
    private const uint YaMoRcBroadcastFlags = 0x09010103;

    private readonly ILogger<Z21CommandCenter> _log;
    private readonly object _stateGate = new();
    private readonly SemaphoreSlim _connectGate = new(1, 1);
    private readonly SemaphoreSlim _txGate = new(1, 1);
    private readonly SemaphoreSlim _accessoryGate = new(1, 1);
    private readonly SemaphoreSlim _locoNetInterrogateGate = new(1, 1);

    private DateTime _lastLocoNetInterrogateUtc = DateTime.MinValue;

    private readonly bool _isYaMoRc7010;
    private readonly uint _broadcastFlags;
    private readonly bool _locoNetFeedbackEnabled;
    private readonly int _locoNetPort;
    private readonly bool _lbServerFeedbackEnabled;
    private readonly int _lbServerPort;

    private int _binaryPacketsObserved;
    private int _lbServerLinesObserved;

    private UdpClient? _udp;
    private string _host;
    private int _port;

    private bool _online;
    private bool _sessionRegistered;
    private DateTime _lastRxUtc = DateTime.MinValue;
    private DateTime _nextKeepAliveUtc = DateTime.MinValue;

    private bool _emergencyKnown;
    private bool _emergencyPaused;

    private bool _powerFeedbackKnown;
    private bool _lastPowerOn;
    private string _lastPowerTarget = "";

    private StationInfo _stationInfo =
        new(
            Version: "",
            Processor: "Z21 LAN",
            Hardware: "Z21-compatible",
            Build: "",
            MaxLocos: 100);

    public Z21CommandCenter(
        IConfiguration configuration,
        ILogger<Z21CommandCenter> log)
    {
        _log = log;

        _isYaMoRc7010 =
            string.Equals(
                configuration["CommandCenter:Protocol"],
                "yamorc7010",
                StringComparison.OrdinalIgnoreCase);

        _broadcastFlags =
            _isYaMoRc7010
                ? YaMoRcBroadcastFlags
                : Z21BroadcastFlags;

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

        _locoNetFeedbackEnabled =
            configuration.GetValue(
                "Z21:LocoNetFeedback",
                false);

        _locoNetPort =
            configuration.GetValue(
                "Z21:LocoNetPort",
                5560);

        if (_locoNetPort is < 1 or > 65535)
            _locoNetPort = 5560;

        _lbServerFeedbackEnabled =
            configuration.GetValue(
                "Z21:LbServerFeedback",
                _isYaMoRc7010);

        _lbServerPort =
            configuration.GetValue(
                "Z21:LbServerPort",
                1234);

        if (_lbServerPort is < 1 or > 65535)
            _lbServerPort = 1234;

        if (_isYaMoRc7010)
        {
            _stationInfo =
                new(
                    Version: "",
                    Processor: "Z21 LAN + LocoNet LBServer",
                    Hardware: "YaMoRC YD7010",
                    Build: "",
                    MaxLocos: 100);
        }
    }

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
    public string Name =>
        _isYaMoRc7010
            ? "YaMoRC YD7010"
            : "Z21-compatible command station";
    public string Endpoint => $"{_host}:{_port}/udp";
    public bool EmergencyPauseStateKnown => _emergencyKnown;
    public bool EmergencyPaused => _emergencyPaused;

    public event Action<string>? RawInfo;
    public event Action<StationInfo>? StationInfoChanged;
    public event Action<TrackInfo>? TrackConfigurationChanged;
    public event Action<int[]>? CurrentTelemetryChanged;
    public event Action<int[]>? TripTelemetryChanged;
    public event Action<PowerFeedback>? PowerFeedbackChanged;
    public event Action<LocoFeedback>? LocoFeedbackChanged;
    public event Action<int, bool>? SensorFeedbackChanged;
    public event Action<bool>? ConnectionChanged;

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
        var locoNetFeedbackTask =
            _locoNetFeedbackEnabled
                ? RunLocoNetFeedbackAsync(
                    stoppingToken)
                : Task.CompletedTask;

        var lbServerFeedbackTask =
            _lbServerFeedbackEnabled
                ? RunLbServerFeedbackAsync(
                    stoppingToken)
                : Task.CompletedTask;

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

                if (now >= _nextKeepAliveUtc)
                {
                    // Lightweight keepalive. Do not poll system state here:
                    // broadcast flag 0x00000100 already delivers
                    // LAN_SYSTEMSTATE_DATACHANGED asynchronously.
                    await SendPacketAsync(
                        0x0010,
                        ReadOnlyMemory<byte>.Empty,
                        logPacket: false,
                        stoppingToken);

                    _nextKeepAliveUtc =
                        now.AddMilliseconds(
                            KeepAliveMs);
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
            await Task.WhenAll(
                locoNetFeedbackTask,
                lbServerFeedbackTask);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            _log.LogDebug(
                ex,
                "Z21 feedback side-channel task stopped");
        }

        ResetTransport();
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
                _nextKeepAliveUtc =
                    DateTime.UtcNow;
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
            _broadcastFlags);

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
            _nextKeepAliveUtc =
                DateTime.UtcNow.AddMilliseconds(
                    KeepAliveMs);

            EmitTrackConfiguration();
        }
    }

    private void ResetTransport()
    {
        UdpClient? old;
        bool wasOnline;

        lock (_stateGate)
        {
            old = _udp;
            _udp = null;
            _sessionRegistered = false;
            _lastRxUtc = DateTime.MinValue;
            _nextKeepAliveUtc = DateTime.MinValue;
            _powerFeedbackKnown = false;
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
                _lastRxUtc = DateTime.UtcNow;
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
        CancellationToken ct)
    {
        if (!await EnsureTransportAsync(ct))
            return false;

        return await SendPacketCoreAsync(
            header,
            payload,
            logPacket,
            ct);
    }

    private async Task<bool> SendPacketCoreAsync(
        ushort header,
        ReadOnlyMemory<byte> payload,
        bool logPacket,
        CancellationToken ct)
    {
        UdpClient? udp;

        lock (_stateGate)
            udp = _udp;

        if (udp is null)
            return false;

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

        await _txGate.WaitAsync(ct);

        try
        {
            var written =
                udp.Send(
                    packet,
                    packet.Length);

            if (written != packet.Length)
                return false;

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
        finally
        {
            _txGate.Release();
        }
    }

    private Task<bool> SendXBusAsync(
        ReadOnlyMemory<byte> payload,
        bool logPacket,
        CancellationToken ct) =>
        SendXBusInternalAsync(
            payload,
            logPacket,
            ensureTransport: true,
            ct);

    private Task<bool> SendXBusCoreAsync(
        ReadOnlyMemory<byte> payload,
        bool logPacket,
        CancellationToken ct) =>
        SendXBusInternalAsync(
            payload,
            logPacket,
            ensureTransport: false,
            ct);

    private async Task<bool> SendXBusInternalAsync(
        ReadOnlyMemory<byte> payload,
        bool logPacket,
        bool ensureTransport,
        CancellationToken ct)
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
                ct)
            : await SendPacketCoreAsync(
                0x0040,
                data,
                logPacket,
                ct);
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
                ct);

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
                    ct);

            if (resumed)
                UpdateEmergencyState(
                    false,
                    "local release");

            return resumed;
        }

        // Z21 LAN protocol 2.13: emergency stop all locomotives while the
        // track voltage remains switched on.
        var stopped =
            await SendXBusAsync(
                new byte[] { 0x80 },
                true,
                ct);

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

    public Task<bool> SetTurnoutAsync(
        int address,
        bool physicalValue,
        CancellationToken ct = default)
    {
        // Callers pass the already resolved physical accessory value here
        // (ClosedValue polarity has already been applied). Preserve the same
        // bool semantics as DCC-EX: false -> Z21 P=0, true -> Z21 P=1.
        return SendAccessoryCommandAsync(
            address,
            physicalValue,
            ct);
    }

    public Task<bool> SetAccessoryAsync(
        int address,
        bool active,
        CancellationToken ct = default) =>
        SendAccessoryCommandAsync(
            address,
            active,
            ct);

    private async Task<bool> SendAccessoryCommandAsync(
        int address,
        bool position,
        CancellationToken ct)
    {
        if (address is < 1 or > 2048)
            return false;

        var functionAddress =
            address - 1;

        _log.LogInformation(
            "Z21 turnout/accessory #{Address}: physical={PhysicalValue}, functionAddress={FunctionAddress}",
            address,
            position,
            functionAddress);

        await _accessoryGate.WaitAsync(
            ct);

        try
        {
            // Match the conservative/JMRI-compatible Q=0 sequence from the
            // Z21 specification: activate -> pulse -> deactivate -> settle.
            // This avoids depending on a command station's optional queue
            // implementation and guarantees only one active turnout output.
            if (!await SendAccessoryPulseAsync(
                    functionAddress,
                    position,
                    activate: true,
                    queue: false,
                    ct: ct))
            {
                return false;
            }

            await Task.Delay(
                AccessoryPulseMs,
                ct);

            if (!await SendAccessoryPulseAsync(
                    functionAddress,
                    position,
                    activate: false,
                    queue: false,
                    ct: ct))
            {
                return false;
            }

            await Task.Delay(
                AccessorySettleMs,
                ct);

            return true;
        }
        finally
        {
            _accessoryGate.Release();
        }
    }

    private Task<bool> SendAccessoryPulseAsync(
        int functionAddress,
        bool position,
        bool activate,
        bool queue,
        CancellationToken ct)
    {
        // LAN_X_SET_TURNOUT DB2 = 100QA00P.
        byte control = 0x80;

        if (queue)
            control |= 0x20;

        if (activate)
            control |= 0x08;

        if (position)
            control |= 0x01;

        return SendXBusAsync(
            new byte[]
            {
                0x53,
                (byte)(functionAddress >> 8),
                (byte)(functionAddress & 0xFF),
                control
            },
            true,
            ct);
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

    public async Task<bool> RequestSensorSnapshotAsync(
        CancellationToken ct = default)
    {
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

        // Standard Z21 stationary detector interrogation.
        var loconet =
            await SendPacketAsync(
                0x00A4,
                new byte[]
                {
                    0x80,
                    0x00,
                    0x00
                },
                false,
                ct);

        var lbServer =
            await RequestLbServerSensorSnapshotAsync(
                ct);

        return
            rbus0 ||
            rbus1 ||
            loconet ||
            lbServer;
    }

    private async Task<bool> RequestLbServerSensorSnapshotAsync(
        CancellationToken ct)
    {
        if (!_lbServerFeedbackEnabled)
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
                TimeSpan.FromSeconds(3));

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

            return await SendLocoNetInterrogateAsync(
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

    private async Task RunLocoNetFeedbackAsync(
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
                    TimeSpan.FromSeconds(3));

                await client.ConnectAsync(
                    _host,
                    _locoNetPort,
                    connectCts.Token);

                _log.LogInformation(
                    "YaMoRC LocoNet Binary feedback connected: {Host}:{Port}",
                    _host,
                    _locoNetPort);

                RawInfo?.Invoke(
                    $"YaMoRC LocoNet Binary connected {_host}:{_locoNetPort}");

                using var stream =
                    client.GetStream();

                await ReadLocoNetBinaryAsync(
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
                    "YaMoRC LocoNet Binary feedback connect timed out: {Host}:{Port}",
                    _host,
                    _locoNetPort);
            }
            catch (Exception ex)
            {
                _log.LogDebug(
                    ex,
                    "YaMoRC LocoNet Binary feedback unavailable: {Host}:{Port}",
                    _host,
                    _locoNetPort);
            }

            try
            {
                await Task.Delay(
                    2000,
                    ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task RunLbServerFeedbackAsync(
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
                    TimeSpan.FromSeconds(3));

                await client.ConnectAsync(
                    _host,
                    _lbServerPort,
                    connectCts.Token);

                _log.LogInformation(
                    "YaMoRC LocoNet LBServer feedback connected: {Host}:{Port}",
                    _host,
                    _lbServerPort);

                RawInfo?.Invoke(
                    $"YaMoRC LocoNet LBServer connected {_host}:{_lbServerPort}");

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

                // JMRI keeps its receive handler alive while the 8-phase
                // interrogation is sent. Do the same so YaMoRC replies are
                // consumed immediately on the very same LBServer session.
                var readTask =
                    ReadLbServerAsync(
                        reader,
                        ct);

                _ =
                    await SendLocoNetInterrogateAsync(
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

            try
            {
                await Task.Delay(
                    2000,
                    ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task<bool> SendLocoNetInterrogateAsync(
        StreamWriter writer,
        CancellationToken ct)
    {
        await _locoNetInterrogateGate.WaitAsync(
            ct);

        try
        {
            var now =
                DateTime.UtcNow;

            if (
                _lastLocoNetInterrogateUtc !=
                    DateTime.MinValue &&
                now - _lastLocoNetInterrogateUtc <
                    TimeSpan.FromSeconds(10)
            )
            {
                _log.LogDebug(
                    "YaMoRC LocoNet sensor interrogation skipped: recent request still authoritative");

                return true;
            }

            _lastLocoNetInterrogateUtc =
                now;
        // Same 8-phase LocoNet sensor interrogation sequence used by JMRI.
        // A YaMoRC command station with "Interrogate: Report All Feedbacks"
        // enabled responds by publishing the current feedback states.
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

        RawInfo?.Invoke(
            "YaMoRC LocoNet sensor interrogation started");

        _log.LogInformation(
            "Starting YaMoRC LocoNet sensor interrogation");

        for (var index = 0;
             index < sw1.Length;
             ++index)
        {
            var opcode =
                (byte)0xB0;

            var checksum =
                (byte)(
                    0xFF ^
                    opcode ^
                    sw1[index] ^
                    sw2[index]);

            var line =
                $"SEND {opcode:X2} {sw1[index]:X2} {sw2[index]:X2} {checksum:X2}";

            _log.LogInformation(
                "LocoNet interrogate TX {Phase}/8: {Line}",
                index + 1,
                line);

            RawInfo?.Invoke(
                $"LocoNet interrogate TX {index + 1}/8");

            await writer.WriteLineAsync(
                line.AsMemory(),
                ct);

            if (index + 1 <
                sw1.Length)
            {
                await Task.Delay(
                    LocoNetInterrogateRestMs,
                    ct);
            }
        }

        RawInfo?.Invoke(
            "YaMoRC LocoNet sensor interrogation sent");

            return true;
        }
        finally
        {
            _locoNetInterrogateGate.Release();
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

            var observed =
                Interlocked.Increment(
                    ref _lbServerLinesObserved);

            if (observed <= 12)
            {
                _log.LogInformation(
                    "LocoNet LBServer RX #{Count}: {Line}",
                    observed,
                    trimmed);

                RawInfo?.Invoke(
                    $"LocoNet LBServer RX {trimmed}");
            }

            if (!trimmed.StartsWith(
                    "RECEIVE ",
                    StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var tokens =
                trimmed[8..]
                    .Split(
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
            {
                ProcessLocoNetBinaryPacket(
                    packet);
            }
        }
    }

    private async Task ReadLocoNetBinaryAsync(
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
                        LocoNetMessageLength(
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
                    LocoNetMessageLength(
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
                    ProcessLocoNetBinaryPacket(
                        packet.AsSpan(
                            0,
                            packetLength));
                }

                packetLength = 0;
                expectedLength = 0;
            }
        }
    }

    private static int LocoNetMessageLength(
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

    private void ProcessLocoNetBinaryPacket(
        ReadOnlySpan<byte> packet)
    {
        if (packet.Length < 2)
            return;

        var observed =
            Interlocked.Increment(
                ref _binaryPacketsObserved);

        if (observed <= 12)
        {
            var hex =
                Convert.ToHexString(
                    packet);

            _log.LogInformation(
                "LocoNet Binary RX #{Count}: {Packet}",
                observed,
                hex);

            RawInfo?.Invoke(
                $"LocoNet Binary RX {hex}");
        }

        byte checksum = 0;

        foreach (var value in packet)
            checksum ^= value;

        if (checksum != 0xFF)
        {
            _log.LogDebug(
                "Ignoring LocoNet Binary packet with invalid checksum: {Packet}",
                Convert.ToHexString(
                    packet));

            return;
        }

        // OPC_INPUT_REP is the normal LocoNet general sensor report. YaMoRC
        // emits S88 / ES-Link feedback into the same feedback address space.
        if (packet[0] == 0xB2 &&
            packet.Length >= 4)
        {
            ProcessLocoNetInputReport(
                packet);

            return;
        }

        _log.LogTrace(
            "LocoNet Binary RX {Packet}",
            Convert.ToHexString(
                packet));
    }

    private void ProcessLocoNetInputReport(
        ReadOnlySpan<byte> packet)
    {
        var in1 =
            packet[1];

        var in2 =
            packet[2];

        var address =
            (
                in1 |
                (
                    (in2 & 0x0F)
                    << 7
                )
            ) << 1;

        address +=
            (in2 & 0x20) != 0
                ? 2
                : 1;

        if (address is < 1 or > 4096)
            return;

        var occupied =
            (in2 & 0x10) != 0;

        _log.LogInformation(
            "YaMoRC S88/LocoNet feedback #{Address}: {State}",
            address,
            occupied
                ? "ON"
                : "OFF");

        RawInfo?.Invoke(
            $"Z21 sensor #{address} {(occupied ? "ON" : "OFF")}");

        SensorFeedbackChanged?.Invoke(
            address,
            occupied);
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

        var wasOnline = Connected;

        SetOnline(true);

        if (!wasOnline)
        {
            _sessionRegistered = false;

            _ = Task.Run(
                async () =>
                {
                    try
                    {
                        await RegisterSessionAsync(
                            CancellationToken.None);
                    }
                    catch
                    {
                    }
                });
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

            case 0x00A0:
            case 0x00A1:
                ProcessLocoNetMessage(payload);
                break;

            case 0x00A4:
                ProcessLocoNetDetector(payload);
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

            RawInfo?.Invoke(
                $"Z21 turnout {functionAddress + 1} position={data[3] & 0x03}");

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

        CurrentTelemetryChanged?.Invoke(
            [
                BinaryPrimitives.ReadInt16LittleEndian(
                    data.Slice(0, 2)),
                BinaryPrimitives.ReadInt16LittleEndian(
                    data.Slice(2, 2))
            ]);

        var centralState =
            data[12];

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
                    "Z21 LAN",
                Hardware =
                    HardwareName(
                        hardwareType),
                MaxLocos = 100
            };

        StationInfoChanged?.Invoke(
            _stationInfo);
    }

    private void ProcessRBus(
        ReadOnlySpan<byte> data)
    {
        if (data.Length < 11)
            return;

        var group = data[0];

        if (group > 1)
            return;

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
                var address =
                    (
                        group * 10 +
                        byteIndex
                    ) * 8 +
                    bit +
                    1;

                var occupied =
                    (status &
                     (1 << bit)) != 0;

                SensorFeedbackChanged?.Invoke(
                    address,
                    occupied);
            }
        }
    }

    private void ProcessLocoNetMessage(
        ReadOnlySpan<byte> data)
    {
        if (data.Length < 4)
            return;

        // OPC_INPUT_REP:
        //   B2 IN1 IN2 CKSUM
        //
        // IN1 = 0,A6..A0
        // IN2 = 0,X,I,L,A10..A7
        //
        // For general LocoNet sensors the I bit selects the odd/even contact.
        // This is the same 1-based contact-number mapping used by JMRI and
        // allows YaMoRC's S88/ES-Link feedback addresses (1..2048) to pass
        // through unchanged into the Hub sensor address space.
        if (data[0] != 0xB2)
            return;

        var in1 =
            data[1];

        var in2 =
            data[2];

        var baseAddress =
            (
                (
                    (in2 & 0x0F) *
                    128
                ) +
                (in1 & 0x7F)
            );

        var address =
            baseAddress *
            2 +
            (
                (in2 & 0x20) != 0
                    ? 2
                    : 1
            );

        if (address is < 1 or > 4096)
            return;

        var occupied =
            (in2 & 0x10) != 0;

        _log.LogInformation(
            "Z21 LocoNet feedback #{Address}: {State}",
            address,
            occupied
                ? "ON"
                : "OFF");

        RawInfo?.Invoke(
            $"Z21 sensor #{address} {(occupied ? "ON" : "OFF")}");

        SensorFeedbackChanged?.Invoke(
            address,
            occupied);
    }

    private void ProcessLocoNetDetector(
        ReadOnlySpan<byte> data)
    {
        if (data.Length < 4)
            return;

        var type = data[0];

        var address =
            BinaryPrimitives
                .ReadUInt16LittleEndian(
                    data.Slice(1, 2));

        if (address == 0)
            return;

        bool? occupied =
            type switch
            {
                0x01 or 0x11 =>
                    data[3] != 0,

                0x02 =>
                    true,

                0x03 =>
                    false,

                _ =>
                    null
            };

        if (occupied.HasValue)
        {
            _log.LogInformation(
                "Z21 detector feedback #{Address}: {State} type=0x{Type:X2}",
                address,
                occupied.Value
                    ? "ON"
                    : "OFF",
                type);

            RawInfo?.Invoke(
                $"Z21 sensor #{address} {(occupied.Value ? "ON" : "OFF")}");

            SensorFeedbackChanged?.Invoke(
                address,
                occupied.Value);
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
