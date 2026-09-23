using System.Text;

namespace DCCExpressHub.Net.CommandCenter
{
    public sealed class DccExCommandCenter : BackgroundService, ICommandCenter
    {
        private readonly IDccExTransport _transport;
        private readonly ILogger<DccExCommandCenter> _log;
        private readonly DccExProtocol _protocol = new();
        private readonly SemaphoreSlim _tx = new(1, 1);

        private volatile bool _alive;
        private DateTimeOffset _lastHeartbeat = DateTimeOffset.MinValue;
        private volatile bool _paused;
        private volatile bool _pauseKnown;

        public bool Connected =>
            _transport.IsConnected &&
            _alive;

        public string Type =>
            _transport is SerialDccExTransport
                ? "dcc-ex-serial"
                : "dcc-ex-tcp";

        public string Name =>
            "DCC-EX CommandStation";

        public string Endpoint =>
            _transport.Endpoint;

        public bool EmergencyPauseStateKnown =>
            _pauseKnown;

        public bool EmergencyPaused =>
            _paused;

        // Compatibility entry point used by Program.cs:
        // TCP    -> endpoint = host,  value = TCP port
        // Serial -> endpoint = COMx,  value = baud rate
        public bool SetEndpoint(
            string endpoint,
            int value)
        {
            bool accepted =
                _transport switch
                {
                    TcpDccExTransport tcp =>
                        tcp.SetEndpoint(
                            endpoint,
                            value),

                    SerialDccExTransport serial =>
                        serial.SetEndpoint(
                            endpoint,
                            value),

                    _ => false
                };

            if (!accepted)
                return false;

            var wasAlive = _alive;

            _alive = false;
            _pauseKnown = false;
            _lastHeartbeat =
                DateTimeOffset.MinValue;

            if (wasAlive)
                ConnectionChanged?.Invoke(false);

            return true;
        }

        public event Action<string>? RawInfo;
        public event Action<StationInfo>? StationInfoChanged;
        public event Action<TrackInfo>? TrackConfigurationChanged;
        public event Action<int[]>? CurrentTelemetryChanged;
        public event Action<int[]>? TripTelemetryChanged;
        public event Action<PowerFeedback>? PowerFeedbackChanged;
        public event Action<LocoFeedback>? LocoFeedbackChanged;
        public event Action<int, bool>? SensorFeedbackChanged;
        public event Action<bool>? ConnectionChanged;

        public DccExCommandCenter(
            IDccExTransport transport,
            ILogger<DccExCommandCenter> log)
        {
            _transport = transport;
            _log = log;

            _protocol.RawInfo += x =>
            {
                if (x == "<!PAUSED>")
                {
                    _paused = true;
                    _pauseKnown = true;
                }
                else if (x == "<!RESUMED>")
                {
                    _paused = false;
                    _pauseKnown = true;
                }

                RawInfo?.Invoke(x);
            };

            _protocol.StationInfoChanged +=
                x => StationInfoChanged?.Invoke(x);

            _protocol.TrackConfigurationChanged +=
                x => TrackConfigurationChanged?.Invoke(x);

            _protocol.CurrentTelemetryChanged +=
                x => CurrentTelemetryChanged?.Invoke(x);

            _protocol.TripTelemetryChanged +=
                x => TripTelemetryChanged?.Invoke(x);

            _protocol.PowerFeedbackChanged +=
                x => PowerFeedbackChanged?.Invoke(x);

            _protocol.LocoFeedbackChanged +=
                x => LocoFeedbackChanged?.Invoke(x);

            _protocol.SensorFeedbackChanged +=
                (address, on) =>
                    SensorFeedbackChanged?.Invoke(
                        address,
                        on);

            _protocol.HeartbeatReply += () =>
            {
                var wasAlive = _alive;

                _alive = true;
                _lastHeartbeat =
                    DateTimeOffset.UtcNow;

                if (!wasAlive)
                    ConnectionChanged?.Invoke(true);
            };
        }

        protected override async Task ExecuteAsync(
            CancellationToken stoppingToken)
        {
            var buffer = new byte[2048];
            var frame = new StringBuilder();
            bool inside = false;

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    if (!_transport.IsConnected)
                    {
                        _alive = false;

                        await _transport.ConnectAsync(
                            stoppingToken);

                        _log.LogInformation(
                            "DCC-EX connected {Type} {Endpoint}",
                            Type,
                            _transport.Endpoint);

                        _pauseKnown = false;

                        // Reset the watchdog on every reconnect. This matters
                        // especially for USB serial devices that need a moment
                        // after the COM port is opened.
                        _lastHeartbeat =
                            DateTimeOffset.UtcNow;

                        // Station information + heartbeat. The sensor snapshot
                        // is requested later by WsRuntimeCoordinator with <Q>
                        // after the heartbeat marks the command center alive.
                        await WriteCoreAsync(
                            "<s><#>",
                            stoppingToken);
                    }

                    using var heartbeat =
                        new PeriodicTimer(
                            TimeSpan.FromSeconds(1));

                    var readTask =
                        _transport.ReadAsync(
                            buffer,
                            stoppingToken);

                    var tickTask =
                        heartbeat
                            .WaitForNextTickAsync(
                                stoppingToken)
                            .AsTask();

                    while (
                        _transport.IsConnected &&
                        !stoppingToken.IsCancellationRequested)
                    {
                        var done =
                            await Task.WhenAny(
                                readTask,
                                tickTask);

                        if (done == tickTask)
                        {
                            await WriteCoreAsync(
                                "<#>",
                                stoppingToken);

                            var age =
                                DateTimeOffset.UtcNow -
                                _lastHeartbeat;

                            if (_alive &&
                                age > TimeSpan.FromSeconds(3))
                            {
                                _alive = false;
                                ConnectionChanged?.Invoke(false);
                            }

                            if (age > TimeSpan.FromSeconds(6))
                            {
                                throw new IOException(
                                    "heartbeat timeout");
                            }

                            tickTask =
                                heartbeat
                                    .WaitForNextTickAsync(
                                        stoppingToken)
                                    .AsTask();

                            continue;
                        }

                        var count =
                            await readTask;

                        if (count <= 0)
                        {
                            throw new IOException(
                                "connection closed");
                        }

                        for (int i = 0;
                             i < count;
                             i++)
                        {
                            char c =
                                (char)buffer[i];

                            if (!inside)
                            {
                                if (c == '<')
                                {
                                    inside = true;
                                    frame.Clear();
                                    frame.Append(c);
                                }

                                continue;
                            }

                            if (c == '<')
                            {
                                frame.Clear();
                                frame.Append(c);
                                continue;
                            }

                            frame.Append(c);

                            if (c == '>')
                            {
                                inside = false;

                                var value =
                                    frame.ToString();

                                if (value.Length <= 1024)
                                    _protocol.Process(value);

                                frame.Clear();
                            }
                            else if (frame.Length > 1024)
                            {
                                inside = false;
                                frame.Clear();
                            }
                        }

                        readTask =
                            _transport.ReadAsync(
                                buffer,
                                stoppingToken);
                    }
                }
                catch (OperationCanceledException)
                    when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    if (_alive)
                    {
                        _alive = false;
                        ConnectionChanged?.Invoke(false);
                    }

                    _log.LogWarning(
                        ex,
                        "DCC-EX disconnected {Type} {Endpoint}",
                        Type,
                        _transport.Endpoint);

                    await _transport.DisconnectAsync();

                    await Task.Delay(
                        3000,
                        stoppingToken);
                }
            }
        }

        private async Task WriteCoreAsync(
            string value,
            CancellationToken ct)
        {
            await _tx.WaitAsync(ct);

            try
            {
                await _transport.WriteAsync(
                    Encoding.ASCII.GetBytes(value),
                    ct);
            }
            finally
            {
                _tx.Release();
            }
        }

        public async Task<bool> SendRawAsync(
            string command,
            bool log = true,
            CancellationToken ct = default)
        {
            command = command.Trim();

            if (command.Length == 0)
                return false;

            if (!command.StartsWith('<'))
                command = "<" + command;

            if (!command.EndsWith('>'))
                command += ">";

            if (!_transport.IsConnected)
                return false;

            try
            {
                await WriteCoreAsync(
                    command,
                    ct);

                if (log)
                {
                    _log.LogInformation(
                        "DCC-EX TX {Command}",
                        command);
                }

                return true;
            }
            catch
            {
                return false;
            }
        }

        public Task<bool> SetTrackPowerAsync(
            bool on,
            bool includeProgramming = true,
            CancellationToken ct = default) =>
            SendRawAsync(
                includeProgramming
                    ? (on ? "<1>" : "<0>")
                    : (on ? "<1 MAIN>" : "<0 MAIN>"),
                true,
                ct);

        public Task<bool> SetProgrammingPowerAsync(
            bool on,
            CancellationToken ct = default) =>
            SendRawAsync(
                on ? "<1 PROG>" : "<0 PROG>",
                true,
                ct);

        public async Task<bool> EmergencyStopAsync(
            CancellationToken ct = default)
        {
            if (!_pauseKnown ||
                !_paused)
            {
                if (!await SendRawAsync(
                        "<!P>",
                        true,
                        ct))
                {
                    return false;
                }

                _paused = true;
                _pauseKnown = true;
                return true;
            }

            if (!await SendRawAsync(
                    "<!>",
                    true,
                    ct))
            {
                return false;
            }

            if (!await SendRawAsync(
                    "<!R>",
                    true,
                    ct))
            {
                _paused = true;
                _pauseKnown = true;
                return false;
            }

            _paused = false;
            _pauseKnown = true;

            return true;
        }

        public Task<bool> SetLocoAsync(
            int address,
            int speed,
            bool forward,
            CancellationToken ct = default) =>
            address is > 0 and <= 10239 &&
            speed is >= 0 and <= 126
                ? SendRawAsync(
                    $"<t {address} {speed} {(forward ? 1 : 0)}>",
                    true,
                    ct)
                : Task.FromResult(false);

        public Task<bool> RequestLocoAsync(
            int address,
            CancellationToken ct = default) =>
            address is > 0 and <= 10239
                ? SendRawAsync(
                    $"<t {address}>",
                    false,
                    ct)
                : Task.FromResult(false);

        public Task<bool> SetLocoFunctionAsync(
            int address,
            int function,
            bool active,
            CancellationToken ct = default) =>
            address is > 0 and <= 10239 &&
            function is >= 0 and <= 28
                ? SendRawAsync(
                    $"<F {address} {function} {(active ? 1 : 0)}>",
                    true,
                    ct)
                : Task.FromResult(false);

        public Task<bool> SetTurnoutAsync(
            int address,
            bool closed,
            CancellationToken ct = default) =>
            address > 0
                ? SendRawAsync(
                    $"<a {address} {(closed ? 1 : 0)}>",
                    true,
                    ct)
                : Task.FromResult(false);

        public Task<bool> SetAccessoryAsync(
            int address,
            bool active,
            CancellationToken ct = default) =>
            SetTurnoutAsync(
                address,
                active,
                ct);

        public Task<bool> SetSignalAspectAsync(
            int address,
            int aspect,
            CancellationToken ct = default) =>
            address > 0 &&
            aspect is >= 0 and <= 255
                ? SendRawAsync(
                    $"<A {address} {aspect}>",
                    true,
                    ct)
                : Task.FromResult(false);

        public Task<bool> SetVPinAsync(
            int vpin,
            bool active,
            CancellationToken ct = default) =>
            vpin > 0
                ? SendRawAsync(
                    $"<z {(active ? vpin : -vpin)}>",
                    true,
                    ct)
                : Task.FromResult(false);

        public Task<bool> RequestTrackConfigurationAsync(
            CancellationToken ct = default) =>
            SendRawAsync(
                "<=>",
                false,
                ct);

        public Task<bool> RequestCurrentTelemetryAsync(
            CancellationToken ct = default) =>
            SendRawAsync(
                "<JI>",
                false,
                ct);

        public Task<bool> RequestTripTelemetryAsync(
            CancellationToken ct = default) =>
            SendRawAsync(
                "<JG>",
                false,
                ct);

        public Task<bool> RequestSensorSnapshotAsync(
            CancellationToken ct = default) =>
            SendRawAsync(
                "<Q>",
                false,
                ct);
    }
}
