using DCCExpressHub.Net.CommandCenter;
using System.Collections.Concurrent;

namespace DCCExpressHub.Net.Web;

public sealed class HubState
{
    public bool TrackPower, ProgrammingPower, ProgrammingJoined, EmergencyStop;
    public StationInfo Station=new();
    public ConcurrentDictionary<int,TrackState> Tracks=new();
    public ConcurrentDictionary<int,LocoFeedback> Locos=new();
    public sealed class TrackState { public string Mode=""; public int? CurrentMa; public int? TripMa; public bool Overload; public bool? Power; }
}
