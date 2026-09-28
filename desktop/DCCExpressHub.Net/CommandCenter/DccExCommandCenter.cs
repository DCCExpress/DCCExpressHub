using System.Text;

namespace DCCExpressHub.Net.CommandCenter
{
    public sealed class DccExCommandCenter : BackgroundService, ICommandCenter
    {
        private readonly IDccExTransport _transport;
        private readonly ILogger<DccExCommandCenter> _log;
        private readonly DccExProtocol _protocol = new();
        private readonly SemaphoreSlim _tx = new(1, 1);

        private readonly object _txQueueGate = new();
        private readonly LinkedList<TxQueueItem> _txQueue = new();
        private readonly SemaphoreSlim _txQueueSignal = new(0);

        private const int MaxQueuedCommands = 512;
        private const int MaxCommandIntervalMs = 1000;

        private int _commandIntervalMs = 25;
        private long _queueGeneration;
        private long _motionEpoch;
        private DateTimeOffset _lastNormalTxAt =
            DateTimeOffset.MinValue;

        private sealed class TxQueueItem
        {
            public TxQueueItem(
                string command,
                bool log,
                bool cancelOnEmergency,
                long generation,
                long motionEpoch,
                CancellationToken cancellationToken)
            {
                Command = command;
                Log = log;
                CancelOnEmergency = cancelOnEmergency;
                Generation = generation;
                MotionEpoch = motionEpoch;
                CancellationToken = cancellationToken;
            }

            public string Command { get; }
            public bool Log { get; }
            public bool CancelOnEmergency { get; }
            public long Generation { get; }
            public long MotionEpoch { get; }
            public CancellationToken CancellationToken { get; }

            public TaskCompletionSource<bool> Completion { get; } =
                new(TaskCreationOptions.RunContinuationsAsynchronously);
        }

        private volatile bool _alive;
        private DateTimeOffset _lastHeartbeat = DateTimeOffset.MinValue;
        private volatile bool _paused;
        private volatile bool _pauseKnown;
        private volatile bool _publishedConnected;

        private bool IsSerial =>
            _transport is SerialDccExTransport;

        public bool Connected =>
            IsSerial
                ? _transport.IsConnected
                : _transport.IsConnected && _alive;

        public string Type =>
            IsSerial
                ? "dcc-ex-serial"
                : "dcc-ex-tcp";

        public string Name =>
            "DCC-EX CommandStation";

        public string Endpoint =>
            _transport.Endpoint;

        public int CommandIntervalMs =>
            Volatile.Read(
                ref _commandIntervalMs);

        public void SetCommandIntervalMs(
            int intervalMs)
        {
            var normalized =
                Math.Clamp(
                    intervalMs,
                    0,
                    MaxCommandIntervalMs);

            Volatile.Write(
                ref _commandIntervalMs,
                normalized);

            _log.LogInformation(
                "DCC-EX TX pacing set to {IntervalMs} ms",
                normalized);
        }

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

            InvalidateTxQueue();

            _alive = false;
            _pauseKnown = false;
            _lastHeartbeat =
                DateTimeOffset.MinValue;

            PublishConnectionState();

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
                _lastHeartbeat =
                    DateTimeOffset.UtcNow;

                // TCP uses the DCC-EX heartbeat as its liveness proof.
                // Serial liveness is the COM transport itself.
                if (!IsSerial)
                {
                    _alive = true;
                    PublishConnectionState();
                }
            };
        }

        private void PublishConnectionState()
        {
            var connected =
                Connected;

            if (
                _publishedConnected ==
                connected)
            {
                return;
            }

            _publishedConnected =
                connected;

            ConnectionChanged?.Invoke(
                connected);
        }

        protected override async Task ExecuteAsync(
            CancellationToken stoppingToken)
        {
            var txQueueTask =
                RunTxQueueAsync(
                    stoppingToken);

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
                        PublishConnectionState();

                        await _transport.ConnectAsync(
                            stoppingToken);

                        _log.LogInformation(
                            "DCC-EX connected {Type} {Endpoint}",
                            Type,
                            _transport.Endpoint);

                        _pauseKnown = false;
                        _lastHeartbeat =
                            DateTimeOffset.UtcNow;

                        /*
                         * Do the first DCC-EX request before announcing a new
                         * Serial connection. That prevents WsRuntimeCoordinator
                         * from racing a full bootstrap burst against the very
                         * first write after opening the USB COM port.
                         */
                        await WriteCoreAsync(
                            "<s><#><!Q>",
                            stoppingToken);

                        if (IsSerial)
                        {
                            PublishConnectionState();
                        }
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
                            if (!IsSerial)
                            {
                                await WriteCoreAsync(
                                    "<#>",
                                    stoppingToken);

                                var age =
                                    DateTimeOffset.UtcNow -
                                    _lastHeartbeat;

                                if (
                                    _alive &&
                                    age >
                                    TimeSpan.FromSeconds(3))
                                {
                                    _alive = false;
                                    PublishConnectionState();
                                }

                                if (
                                    age >
                                    TimeSpan.FromSeconds(6))
                                {
                                    throw new IOException(
                                        "heartbeat timeout");
                                }
                            }

                            // Serial deliberately does not send a periodic
                            // heartbeat here. Its liveness is the COM port and
                            // normal runtime traffic already exercises it.
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

                    if (!_transport.IsConnected)
                    {
                        InvalidateTxQueue();

                        _alive = false;
                        PublishConnectionState();
                    }
                }
                catch (OperationCanceledException)
                    when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _log.LogWarning(
                        ex,
                        "DCC-EX disconnected {Type} {Endpoint}",
                        Type,
                        _transport.Endpoint);

                    InvalidateTxQueue();

                    await _transport.DisconnectAsync();

                    _alive = false;
                    _pauseKnown = false;
                    PublishConnectionState();

                    await Task.Delay(
                        3000,
                        stoppingToken);
                }
            }

            InvalidateTxQueue();

            await _transport.DisconnectAsync();

            _alive = false;
            PublishConnectionState();

            try
            {
                await txQueueTask;
            }
            catch (OperationCanceledException)
                when (stoppingToken.IsCancellationRequested)
            {
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

        private static string NormalizeCommand(
            string command)
        {
            command =
                command.Trim();

            if (command.Length == 0)
                return "";

            if (!command.StartsWith('<'))
                command = "<" + command;

            if (!command.EndsWith('>'))
                command += ">";

            return command;
        }

        private static bool IsLocoSpeedCommand(
            string command)
        {
            if (!command.StartsWith(
                    "<t ",
                    StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var body =
                command.Length >= 2 &&
                command[0] == '<' &&
                command[^1] == '>'
                    ? command[1..^1]
                    : command;

            var parts =
                body.Split(
                    ' ',
                    StringSplitOptions.RemoveEmptyEntries);

            // <t address> is only a state query.
            // <t address speed direction> changes motion.
            return
                parts.Length >= 4 &&
                string.Equals(
                    parts[0],
                    "t",
                    StringComparison.OrdinalIgnoreCase);
        }

        private void InvalidateTxQueue()
        {
            Interlocked.Increment(
                ref _queueGeneration);

            List<TxQueueItem> removed;

            lock (_txQueueGate)
            {
                removed =
                    _txQueue.ToList();

                _txQueue.Clear();

                _lastNormalTxAt =
                    DateTimeOffset.MinValue;
            }

            foreach (var item in removed)
                item.Completion.TrySetResult(false);
        }

        private void CancelPendingMotionCommands()
        {
            Interlocked.Increment(
                ref _motionEpoch);

            var removed =
                new List<TxQueueItem>();

            lock (_txQueueGate)
            {
                var node =
                    _txQueue.First;

                while (node is not null)
                {
                    var next =
                        node.Next;

                    if (node.Value.CancelOnEmergency)
                    {
                        removed.Add(
                            node.Value);

                        _txQueue.Remove(
                            node);
                    }

                    node = next;
                }
            }

            foreach (var item in removed)
                item.Completion.TrySetResult(false);
        }

        private async Task<bool> QueueRawAsync(
            string command,
            bool log,
            CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();

            command =
                NormalizeCommand(
                    command);

            if (
                command.Length == 0 ||
                !_transport.IsConnected)
            {
                return false;
            }

            var cancelOnEmergency =
                IsLocoSpeedCommand(
                    command);

            var item =
                new TxQueueItem(
                    command,
                    log,
                    cancelOnEmergency,
                    Volatile.Read(
                        ref _queueGeneration),
                    Volatile.Read(
                        ref _motionEpoch),
                    ct);

            lock (_txQueueGate)
            {
                if (
                    !_transport.IsConnected ||
                    _txQueue.Count >=
                        MaxQueuedCommands)
                {
                    if (
                        _txQueue.Count >=
                        MaxQueuedCommands)
                    {
                        _log.LogWarning(
                            "DCC-EX TX queue full ({Depth}); command rejected {Command}",
                            _txQueue.Count,
                            command);
                    }

                    return false;
                }

                _txQueue.AddLast(
                    item);
            }

            _txQueueSignal.Release();

            return await item
                .Completion
                .Task
                .WaitAsync(ct);
        }

        private bool ItemStillValid(
            TxQueueItem item)
        {
            if (
                item.CancellationToken.IsCancellationRequested ||
                item.Generation !=
                    Volatile.Read(
                        ref _queueGeneration))
            {
                return false;
            }

            if (
                item.CancelOnEmergency &&
                item.MotionEpoch !=
                    Volatile.Read(
                        ref _motionEpoch))
            {
                return false;
            }

            return true;
        }

        private async Task<bool> WriteQueuedItemAsync(
            TxQueueItem item,
            CancellationToken stoppingToken)
        {
            await _tx.WaitAsync(
                stoppingToken);

            try
            {
                // Re-check after acquiring the physical writer lock. ESTOP can
                // invalidate a loco command while it is waiting behind another
                // write, and that stale speed must never leak out afterwards.
                if (
                    !ItemStillValid(item) ||
                    !_transport.IsConnected)
                {
                    return false;
                }

                await _transport.WriteAsync(
                    Encoding.ASCII.GetBytes(
                        item.Command),
                    stoppingToken);

                if (item.Log)
                {
                    _log.LogInformation(
                        "DCC-EX TX {Command}",
                        item.Command);
                }

                return true;
            }
            finally
            {
                _tx.Release();
            }
        }

        private async Task RunTxQueueAsync(
            CancellationToken stoppingToken)
        {
            try
            {
                while (!stoppingToken.IsCancellationRequested)
                {
                    await _txQueueSignal.WaitAsync(
                        stoppingToken);

                    TxQueueItem? item =
                        null;

                    lock (_txQueueGate)
                    {
                        if (_txQueue.First is not null)
                        {
                            item =
                                _txQueue.First.Value;

                            _txQueue.RemoveFirst();
                        }
                    }

                    if (item is null)
                        continue;

                    if (!ItemStillValid(item))
                    {
                        item.Completion.TrySetResult(false);
                        continue;
                    }

                    var intervalMs =
                        Volatile.Read(
                            ref _commandIntervalMs);

                    var lastTx =
                        _lastNormalTxAt;

                    if (
                        intervalMs > 0 &&
                        lastTx !=
                            DateTimeOffset.MinValue)
                    {
                        var remaining =
                            lastTx
                                .AddMilliseconds(
                                    intervalMs) -
                            DateTimeOffset.UtcNow;

                        if (remaining > TimeSpan.Zero)
                        {
                            await Task.Delay(
                                remaining,
                                stoppingToken);
                        }
                    }

                    if (!ItemStillValid(item))
                    {
                        item.Completion.TrySetResult(false);
                        continue;
                    }

                    bool sent;

                    try
                    {
                        sent =
                            await WriteQueuedItemAsync(
                                item,
                                stoppingToken);
                    }
                    catch (OperationCanceledException)
                        when (stoppingToken.IsCancellationRequested)
                    {
                        item.Completion.TrySetResult(false);
                        break;
                    }
                    catch (Exception ex)
                    {
                        _log.LogWarning(
                            ex,
                            "DCC-EX queued TX failed {Type} {Endpoint} {Command}",
                            Type,
                            _transport.Endpoint,
                            item.Command);

                        sent =
                            false;
                    }

                    if (sent)
                    {
                        _lastNormalTxAt =
                            DateTimeOffset.UtcNow;
                    }

                    item.Completion.TrySetResult(
                        sent);
                }
            }
            catch (OperationCanceledException)
                when (stoppingToken.IsCancellationRequested)
            {
            }
            finally
            {
                InvalidateTxQueue();
            }
        }

        private async Task<bool> SendEmergencySequenceAsync(
            string[] commands,
            CancellationToken ct)
        {
            if (!_transport.IsConnected)
                return false;

            CancelPendingMotionCommands();

            await _tx.WaitAsync(ct);

            try
            {
                if (!_transport.IsConnected)
                    return false;

                foreach (var raw in commands)
                {
                    var command =
                        NormalizeCommand(
                            raw);

                    if (command.Length == 0)
                        continue;

                    await _transport.WriteAsync(
                        Encoding.ASCII.GetBytes(
                            command),
                        ct);

                    _log.LogWarning(
                        "DCC-EX PRIORITY TX {Command}",
                        command);
                }

                return true;
            }
            catch (Exception ex)
                when (ex is not OperationCanceledException)
            {
                _log.LogWarning(
                    ex,
                    "DCC-EX priority TX failed {Type} {Endpoint}",
                    Type,
                    _transport.Endpoint);

                return false;
            }
            finally
            {
                _tx.Release();
            }
        }

        public Task<bool> SendRawAsync(
            string command,
            bool log = true,
            CancellationToken ct = default) =>
            QueueRawAsync(
                command,
                log,
                ct);

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
                if (!await SendEmergencySequenceAsync(
                        ["<!P>"],
                        ct))
                {
                    return false;
                }

                _paused = true;
                _pauseKnown = true;
                return true;
            }

            // Safe release is one priority transaction under the same physical
            // writer lock. No queued command can slip between ESTOPALL and
            // RESUME, and all pending locomotive speed commands were invalidated
            // before the sequence started.
            if (!await SendEmergencySequenceAsync(
                    ["<!>", "<!R>"],
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
