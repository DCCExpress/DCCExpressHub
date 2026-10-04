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

    private const int KeepAliveMs = 10_000;
    private const int OnlineTimeoutMs = 30_000;
    private const int AccessoryPulseMs = 120;

    // Driving/switching + R-BUS + system state + all changed locos +
    // LocoNet detector occupancy.
    private const uint BroadcastFlags = 0x08010103;

    private readonly ILogger<Z21CommandCenter> _log;
    private readonly object _stateGate = new();
    private readonly SemaphoreSlim _connectGate = new(1, 1);
    private readonly SemaphoreSlim _txGate = new(1, 1);

    private UdpClient? _udp;
    private string _host;
    private int _port;

    private bool _online;
    private bool _sessionRegistered;
    private DateTime _lastRxUtc = DateTime.MinValue;
    private DateTime _nextKeepAliveUtc = DateTime.MinValue;

    private bool _emergencyKnown = true;
    private bool _emergencyPaused;

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
    public string Name => "Z21-compatible command station";
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
                    await SendPacketAsync(
                        0x0085,
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
                [0xF1, 0x0A],
                false,
                ct);

        ok &=
            await SendXBusCoreAsync(
                [0x21, 0x24],
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

            _ = RequestSensorSnapshotAsync(
                CancellationToken.None);
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
                [
                    0x21,
                    on
                        ? (byte)0x81
                        : (byte)0x80
                ],
                true,
                ct);

        if (ok && on)
        {
            _emergencyKnown = true;
            _emergencyPaused = false;
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
        // Z21 emergency stop is not a DCC-EX-style latched pause. The first
        // press sends native LAN_X_SET_STOP. The second press releases only
        // the Hub latch; subsequent throttle commands can continue normally.
        if (_emergencyPaused)
        {
            _emergencyKnown = true;
            _emergencyPaused = false;
            return true;
        }

        var ok =
            await SendXBusAsync(
                [0x80],
                true,
                ct);

        if (ok)
        {
            _emergencyKnown = true;
            _emergencyPaused = true;
        }

        return ok;
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
            [
                0xE4,
                0x13,
                msb,
                lsb,
                speedByte
            ],
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
            [
                0xE3,
                0xF0,
                msb,
                lsb
            ],
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
            [
                0xE4,
                0xF8,
                msb,
                lsb,
                function
            ],
            true,
            ct);
    }

    public async Task<bool> SetTurnoutAsync(
        int address,
        bool closed,
        CancellationToken ct = default)
    {
        if (address is < 1 or > 2048)
            return false;

        var functionAddress =
            address - 1;

        // Hub closed -> Z21 P=0; thrown -> P=1.
        var position =
            !closed;

        var ok =
            await SendAccessoryPulseAsync(
                functionAddress,
                position,
                activate: true,
                ct);

        if (ok)
        {
            ScheduleAccessoryDeactivate(
                functionAddress,
                position);
        }

        return ok;
    }

    public async Task<bool> SetAccessoryAsync(
        int address,
        bool active,
        CancellationToken ct = default)
    {
        if (address is < 1 or > 2048)
            return false;

        var functionAddress =
            address - 1;

        var ok =
            await SendAccessoryPulseAsync(
                functionAddress,
                active,
                activate: true,
                ct);

        if (ok)
        {
            ScheduleAccessoryDeactivate(
                functionAddress,
                active);
        }

        return ok;
    }

    private Task<bool> SendAccessoryPulseAsync(
        int functionAddress,
        bool position,
        bool activate,
        CancellationToken ct)
    {
        byte control = 0xA0;

        if (activate)
            control |= 0x08;

        if (position)
            control |= 0x01;

        return SendXBusAsync(
            [
                0x53,
                (byte)(functionAddress >> 8),
                (byte)(functionAddress & 0xFF),
                control
            ],
            true,
            ct);
    }

    private void ScheduleAccessoryDeactivate(
        int functionAddress,
        bool position)
    {
        _ = Task.Run(
            async () =>
            {
                try
                {
                    await Task.Delay(
                        AccessoryPulseMs);

                    await SendAccessoryPulseAsync(
                        functionAddress,
                        position,
                        activate: false,
                        CancellationToken.None);
                }
                catch
                {
                }
            });
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
            [
                0x54,
                (byte)(rawAddress >> 8),
                (byte)(rawAddress & 0xFF),
                (byte)aspect,
                0x00
            ],
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
        CancellationToken ct = default) =>
        SendPacketAsync(
            0x0085,
            ReadOnlyMemory<byte>.Empty,
            false,
            ct);

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

        // Stationary interrogate request for LocoNet occupancy detectors.
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

        return
            rbus0 ||
            rbus1 ||
            loconet;
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

            case 0x00A4:
                ProcessLocoNetDetector(payload);
                break;
        }
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

            PowerFeedbackChanged?.Invoke(
                new PowerFeedback(
                    on,
                    target));

            if (data[1] == 0x01)
            {
                _emergencyKnown = true;
                _emergencyPaused = false;
            }

            return;
        }

        if (xHeader == 0x81)
        {
            _emergencyKnown = true;
            _emergencyPaused = true;

            RawInfo?.Invoke(
                "Z21: emergency stop active");

            return;
        }

        if (xHeader == 0x62 &&
            data.Length >= 4 &&
            data[1] == 0x22)
        {
            var status = data[2];

            PowerFeedbackChanged?.Invoke(
                new PowerFeedback(
                    (status & 0x02) == 0,
                    (status & 0x20) != 0
                        ? "Programming"
                        : "All"));

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

        PowerFeedbackChanged?.Invoke(
            new PowerFeedback(
                (centralState & 0x02) == 0,
                (centralState & 0x20) != 0
                    ? "Programming"
                    : "All"));
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
