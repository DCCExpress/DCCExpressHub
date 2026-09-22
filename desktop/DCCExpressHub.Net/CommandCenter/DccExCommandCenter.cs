using System.Text;

namespace DCCExpressHub.Net.CommandCenter
{



    public sealed class DccExCommandCenter : BackgroundService, ICommandCenter
    {
        private readonly IDccExTransport _transport;
        private readonly ILogger<DccExCommandCenter> _log;
        private readonly DccExProtocol _protocol = new(); private readonly SemaphoreSlim _tx = new(1, 1);
        private volatile bool _alive; private DateTimeOffset _lastHeartbeat = DateTimeOffset.MinValue;
        private volatile bool _paused, _pauseKnown;
        public bool Connected => _transport.IsConnected && _alive;
        public string Type => _transport is SerialDccExTransport ? "dcc-ex-serial" : "dcc-ex-tcp";
        public string Name => "DCC-EX CommandStation"; public string Endpoint => _transport.Endpoint;
        public bool EmergencyPauseStateKnown => _pauseKnown;
        public bool EmergencyPaused => _paused;
        public bool SetEndpoint(string host, int port)
        {
            if (_transport is not TcpDccExTransport tcp) return false;
            tcp.SetEndpoint(host, port); _alive = false; _pauseKnown = false; return true;
        }
        public event Action<string>? RawInfo; public event Action<StationInfo>? StationInfoChanged;
        public event Action<TrackInfo>? TrackConfigurationChanged; public event Action<int[]>? CurrentTelemetryChanged;
        public event Action<int[]>? TripTelemetryChanged; public event Action<PowerFeedback>? PowerFeedbackChanged;
        public event Action<LocoFeedback>? LocoFeedbackChanged; public event Action<int, bool>? SensorFeedbackChanged; public event Action<bool>? ConnectionChanged;

        public DccExCommandCenter(IDccExTransport transport, ILogger<DccExCommandCenter> log)
        {
            _transport = transport; _log = log;
            _protocol.RawInfo += x =>
            {
                if (x == "<!PAUSED>") { _paused = true; _pauseKnown = true; }
                else if (x == "<!RESUMED>") { _paused = false; _pauseKnown = true; }
                RawInfo?.Invoke(x);
            }; _protocol.StationInfoChanged += x => StationInfoChanged?.Invoke(x);
            _protocol.TrackConfigurationChanged += x => TrackConfigurationChanged?.Invoke(x);
            _protocol.CurrentTelemetryChanged += x => CurrentTelemetryChanged?.Invoke(x); _protocol.TripTelemetryChanged += x => TripTelemetryChanged?.Invoke(x);
            _protocol.PowerFeedbackChanged += x => PowerFeedbackChanged?.Invoke(x); _protocol.LocoFeedbackChanged += x => LocoFeedbackChanged?.Invoke(x);
            _protocol.SensorFeedbackChanged += (address, on) => SensorFeedbackChanged?.Invoke(address, on);
            _protocol.HeartbeatReply += () => { var was = _alive; _alive = true; _lastHeartbeat = DateTimeOffset.UtcNow; if (!was) ConnectionChanged?.Invoke(true); };
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            var buffer = new byte[2048]; var frame = new StringBuilder(); bool inside = false;
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    if (!_transport.IsConnected)
                    {
                        _alive = false; await _transport.ConnectAsync(stoppingToken); _log.LogInformation("DCC-EX connected {Endpoint}", _transport.Endpoint);
                        _pauseKnown = false;
                        await WriteCoreAsync("<s><#>", stoppingToken);
                        await SendRawAsync("<!Q>", false, stoppingToken);
                    }
                    using var hb = new PeriodicTimer(TimeSpan.FromSeconds(1));
                    var readTask = _transport.ReadAsync(buffer, stoppingToken);
                    var tickTask = hb.WaitForNextTickAsync(stoppingToken).AsTask();
                    while (_transport.IsConnected && !stoppingToken.IsCancellationRequested)
                    {
                        var done = await Task.WhenAny(readTask, tickTask);
                        if (done == tickTask)
                        {
                            await WriteCoreAsync("<#>", stoppingToken);
                            if (_alive && DateTimeOffset.UtcNow - _lastHeartbeat > TimeSpan.FromSeconds(3)) { _alive = false; ConnectionChanged?.Invoke(false); }
                            if (DateTimeOffset.UtcNow - _lastHeartbeat > TimeSpan.FromSeconds(6)) throw new IOException("heartbeat timeout");
                            tickTask = hb.WaitForNextTickAsync(stoppingToken).AsTask(); continue;
                        }
                        var n = await readTask; if (n <= 0) throw new IOException("connection closed");
                        for (int i = 0; i < n; i++)
                        {
                            char c = (char)buffer[i];
                            if (!inside) { if (c == '<') { inside = true; frame.Clear(); frame.Append(c); } continue; }
                            if (c == '<') { frame.Clear(); frame.Append(c); continue; }
                            frame.Append(c);
                            if (c == '>') { inside = false; var s = frame.ToString(); if (s.Length <= 1024) _protocol.Process(s); frame.Clear(); }
                            else if (frame.Length > 1024) { inside = false; frame.Clear(); }
                        }
                        readTask = _transport.ReadAsync(buffer, stoppingToken);
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception ex) { if (_alive) { _alive = false; ConnectionChanged?.Invoke(false); } _log.LogWarning(ex, "DCC-EX disconnected"); await _transport.DisconnectAsync(); await Task.Delay(3000, stoppingToken); }
            }
        }

        private async Task WriteCoreAsync(string s, CancellationToken ct)
        { await _tx.WaitAsync(ct); try { await _transport.WriteAsync(Encoding.ASCII.GetBytes(s), ct); } finally { _tx.Release(); } }
        public async Task<bool> SendRawAsync(string command, bool log = true, CancellationToken ct = default)
        {
            command = command.Trim(); if (command.Length == 0) return false; if (!command.StartsWith('<')) command = "<" + command; if (!command.EndsWith('>')) command += ">";
            if (!_transport.IsConnected) return false; try { await WriteCoreAsync(command, ct); if (log) _log.LogInformation("DCC-EX TX {Command}", command); return true; } catch { return false; }
        }
        public Task<bool> SetTrackPowerAsync(bool on, bool includeProgramming = true, CancellationToken ct = default) => SendRawAsync(includeProgramming ? (on ? "<1>" : "<0>") : (on ? "<1 MAIN>" : "<0 MAIN>"), true, ct);
        public Task<bool> SetProgrammingPowerAsync(bool on, CancellationToken ct = default) => SendRawAsync(on ? "<1 PROG>" : "<0 PROG>", true, ct);
        public async Task<bool> EmergencyStopAsync(CancellationToken ct = default)
        {
            if (!_pauseKnown || !_paused)
            {
                if (!await SendRawAsync("<!P>", true, ct)) return false;
                _paused = true; _pauseKnown = true;
                return true;
            }

            if (!await SendRawAsync("<!>", true, ct)) return false;
            if (!await SendRawAsync("<!R>", true, ct))
            {
                _paused = true; _pauseKnown = true;
                return false;
            }
            _paused = false; _pauseKnown = true;
            return true;
        }
        public Task<bool> SetLocoAsync(int a, int s, bool f, CancellationToken ct = default) => a is > 0 and <= 10239 && s is >= 0 and <= 126 ? SendRawAsync($"<t {a} {s} {(f ? 1 : 0)}>", true, ct) : Task.FromResult(false);
        public Task<bool> RequestLocoAsync(int a, CancellationToken ct = default) => a is > 0 and <= 10239 ? SendRawAsync($"<t {a}>", false, ct) : Task.FromResult(false);
        public Task<bool> SetLocoFunctionAsync(int a, int fn, bool on, CancellationToken ct = default) => a is > 0 and <= 10239 && fn is >= 0 and <= 28 ? SendRawAsync($"<F {a} {fn} {(on ? 1 : 0)}>", true, ct) : Task.FromResult(false);
        public Task<bool> SetTurnoutAsync(int a, bool c, CancellationToken ct = default) => a > 0 ? SendRawAsync($"<a {a} {(c ? 1 : 0)}>", true, ct) : Task.FromResult(false);
        public Task<bool> SetAccessoryAsync(int a, bool on, CancellationToken ct = default) => SetTurnoutAsync(a, on, ct);
        public Task<bool> SetSignalAspectAsync(int a, int aspect, CancellationToken ct = default) => a > 0 && aspect is >= 0 and <= 255 ? SendRawAsync($"<A {a} {aspect}>", true, ct) : Task.FromResult(false);
        public Task<bool> SetVPinAsync(int p, bool on, CancellationToken ct = default) => p > 0 ? SendRawAsync($"<z {(on ? p : -p)}>", true, ct) : Task.FromResult(false);
        public Task<bool> RequestTrackConfigurationAsync(CancellationToken ct = default) => SendRawAsync("<=>", false, ct);
        public Task<bool> RequestCurrentTelemetryAsync(CancellationToken ct = default) => SendRawAsync("<JI>", false, ct);
        public Task<bool> RequestTripTelemetryAsync(CancellationToken ct = default) => SendRawAsync("<JG>", false, ct);
        public Task<bool> RequestSensorSnapshotAsync(CancellationToken ct = default) => SendRawAsync("<Q>", false, ct);
    }
}