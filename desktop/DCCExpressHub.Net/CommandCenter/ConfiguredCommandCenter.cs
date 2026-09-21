using System.Text.Json;

namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Logical Hub-facing wrapper. Locomotive directions are logical here;
/// the wrapped command center continues to speak physical direction.
/// </summary>
public sealed class ConfiguredCommandCenter : ICommandCenter
{
    private readonly DccExCommandCenter _inner;
    private readonly ILogger<ConfiguredCommandCenter> _log;
    private readonly object _gate=new();
    private HashSet<int> _inverted=[];
    private string _locosPath="";

    public ConfiguredCommandCenter(DccExCommandCenter inner,IWebHostEnvironment env,ILogger<ConfiguredCommandCenter> log)
    {
        _inner=inner;_log=log;
        _locosPath=Path.Combine(env.ContentRootPath,"data","config","locos.json");

        _inner.RawInfo+=x=>RawInfo?.Invoke(x);
        _inner.StationInfoChanged+=x=>StationInfoChanged?.Invoke(x);
        _inner.TrackConfigurationChanged+=x=>TrackConfigurationChanged?.Invoke(x);
        _inner.CurrentTelemetryChanged+=x=>CurrentTelemetryChanged?.Invoke(x);
        _inner.TripTelemetryChanged+=x=>TripTelemetryChanged?.Invoke(x);
        _inner.PowerFeedbackChanged+=x=>PowerFeedbackChanged?.Invoke(x);
        _inner.ConnectionChanged+=x=>ConnectionChanged?.Invoke(x);
        _inner.LocoFeedbackChanged+=x=>LocoFeedbackChanged?.Invoke(x with { Forward=MapDirection(x.Address,x.Forward) });
    }

    public bool ReloadLocomotiveConfiguration()
    {
        if(!File.Exists(_locosPath))
        {
            lock(_gate)_inverted=[];
            _log.LogInformation("Locomotive direction config: no locos.json; inversion disabled");
            return true;
        }
        try
        {
            using var doc=JsonDocument.Parse(File.ReadAllText(_locosPath));
            if(doc.RootElement.ValueKind!=JsonValueKind.Array)return false;
            var next=new HashSet<int>();
            foreach(var item in doc.RootElement.EnumerateArray())
            {
                if(item.ValueKind!=JsonValueKind.Object)continue;
                int address=item.TryGetProperty("address",out var a)&&a.TryGetInt32(out var av)?av:0;
                bool invert=item.TryGetProperty("invert",out var i)&&i.ValueKind==JsonValueKind.True;
                if(address>0&&address<=10239&&invert)next.Add(address);
            }
            lock(_gate)_inverted=next;
            _log.LogInformation("Locomotive direction config reloaded: {Count} inverted locomotive(s)",next.Count);
            return true;
        }
        catch(Exception ex){_log.LogWarning(ex,"Locomotive direction config: invalid {Path}",_locosPath);return false;}
    }

    public bool LocomotiveDirectionInverted(int address){lock(_gate)return _inverted.Contains(address);}
    private bool MapDirection(int address,bool forward)=>LocomotiveDirectionInverted(address)?!forward:forward;

    public bool Connected=>_inner.Connected;
    public string Type=>_inner.Type;
    public string Name=>_inner.Name;
    public string Endpoint=>_inner.Endpoint;
    public bool EmergencyPauseStateKnown=>_inner.EmergencyPauseStateKnown;
    public bool EmergencyPaused=>_inner.EmergencyPaused;

    public event Action<string>? RawInfo;
    public event Action<StationInfo>? StationInfoChanged;
    public event Action<TrackInfo>? TrackConfigurationChanged;
    public event Action<int[]>? CurrentTelemetryChanged;
    public event Action<int[]>? TripTelemetryChanged;
    public event Action<PowerFeedback>? PowerFeedbackChanged;
    public event Action<LocoFeedback>? LocoFeedbackChanged;
    public event Action<bool>? ConnectionChanged;

    public Task<bool> SendRawAsync(string command,bool log=true,CancellationToken ct=default)=>_inner.SendRawAsync(command,log,ct);
    public Task<bool> SetTrackPowerAsync(bool on,bool includeProgramming=true,CancellationToken ct=default)=>_inner.SetTrackPowerAsync(on,includeProgramming,ct);
    public Task<bool> SetProgrammingPowerAsync(bool on,CancellationToken ct=default)=>_inner.SetProgrammingPowerAsync(on,ct);
    public Task<bool> EmergencyStopAsync(CancellationToken ct=default)=>_inner.EmergencyStopAsync(ct);
    public Task<bool> SetLocoAsync(int address,int speed,bool forward,CancellationToken ct=default)=>_inner.SetLocoAsync(address,speed,MapDirection(address,forward),ct);
    public Task<bool> RequestLocoAsync(int address,CancellationToken ct=default)=>_inner.RequestLocoAsync(address,ct);
    public Task<bool> SetLocoFunctionAsync(int address,int fn,bool active,CancellationToken ct=default)=>_inner.SetLocoFunctionAsync(address,fn,active,ct);
    public Task<bool> SetTurnoutAsync(int address,bool closed,CancellationToken ct=default)=>_inner.SetTurnoutAsync(address,closed,ct);
    public Task<bool> SetAccessoryAsync(int address,bool active,CancellationToken ct=default)=>_inner.SetAccessoryAsync(address,active,ct);
    public Task<bool> SetSignalAspectAsync(int address,int aspect,CancellationToken ct=default)=>_inner.SetSignalAspectAsync(address,aspect,ct);
    public Task<bool> SetVPinAsync(int vpin,bool active,CancellationToken ct=default)=>_inner.SetVPinAsync(vpin,active,ct);
    public Task<bool> RequestTrackConfigurationAsync(CancellationToken ct=default)=>_inner.RequestTrackConfigurationAsync(ct);
    public Task<bool> RequestCurrentTelemetryAsync(CancellationToken ct=default)=>_inner.RequestCurrentTelemetryAsync(ct);
    public Task<bool> RequestTripTelemetryAsync(CancellationToken ct=default)=>_inner.RequestTripTelemetryAsync(ct);
}
