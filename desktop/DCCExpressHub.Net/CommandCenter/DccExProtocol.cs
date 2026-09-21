using System.Globalization;
using System.Text.RegularExpressions;

namespace DCCExpressHub.Net.CommandCenter;

public sealed class DccExProtocol
{
    public event Action<string>? RawInfo;
    public event Action<StationInfo>? StationInfoChanged;
    public event Action<TrackInfo>? TrackConfigurationChanged;
    public event Action<int[]>? CurrentTelemetryChanged;
    public event Action<int[]>? TripTelemetryChanged;
    public event Action<PowerFeedback>? PowerFeedbackChanged;
    public event Action<LocoFeedback>? LocoFeedbackChanged;
    public event Action<int, bool>? SensorFeedbackChanged;
    public event Action? HeartbeatReply;

    private StationInfo _station = new();

    public void Process(string frame)
    {
        if (!frame.StartsWith("<jI") && !frame.StartsWith("<jG")) RawInfo?.Invoke(frame);

        if (frame.StartsWith("<#"))
        {
            HeartbeatReply?.Invoke();
            var m=Regex.Match(frame, @"^<#\s+(\d+)>");
            if(m.Success) { _station=_station with { MaxLocos=int.Parse(m.Groups[1].Value) }; StationInfoChanged?.Invoke(_station); }
            return;
        }

        if (frame.StartsWith("<i"))
        {
            var body=frame[2..^1].Trim();
            var p=body.Split('/',4);
            string Clean(string s) {
                s=s.Trim();
                if(s.StartsWith("DCC-EX",StringComparison.OrdinalIgnoreCase)) s=s[6..].Trim();
                else if(s.StartsWith("DCCEX",StringComparison.OrdinalIgnoreCase)) s=s[5..].Trim();
                if(s.StartsWith("V-",StringComparison.OrdinalIgnoreCase)) s=s[2..].Trim();
                else if(s.StartsWith("V",StringComparison.OrdinalIgnoreCase)) s=s[1..].Trim();
                return s;
            }
            var version=p.Length>0?Clean(p[0]):"";
            var processor=p.Length>1?p[1].Trim():"";
            var hardware=p.Length>2?p[2].Trim():"";
            var build=p.Length>3?p[3].Trim():"";
            var at=hardware.LastIndexOf(" G-",StringComparison.Ordinal);
            if(at>=0 && string.IsNullOrEmpty(build)){ build=hardware[(at+1)..].Trim(); hardware=hardware[..at].Trim(); }
            _station=_station with {Version=version,Processor=processor,Hardware=hardware,Build=build};
            StationInfoChanged?.Invoke(_station); return;
        }

        var tm=Regex.Match(frame, @"^<=\s+([A-H])\s+(.+)>");
        if(tm.Success){ TrackConfigurationChanged?.Invoke(new(tm.Groups[1].Value[0]-'A',tm.Groups[2].Value.Trim())); return; }

        if(frame.StartsWith("<jI")) { CurrentTelemetryChanged?.Invoke(ParseInts(frame[3..^1])); return; }
        if(frame.StartsWith("<jG")) { TripTelemetryChanged?.Invoke(ParseInts(frame[3..^1])); return; }

        var pm=Regex.Match(frame, @"^<p([01])(?:\s*([^>]*))>");
        if(pm.Success)
        {
            var target=pm.Groups[2].Value.Trim();
            var name="All"; var idx=-1;
            if(target=="MAIN") name="Main"; else if(target=="PROG") name="Programming"; else if(target=="JOIN") name="Joined";
            else if(target.Length==1 && target[0]>='A' && target[0]<='H'){name="Track";idx=target[0]-'A';}
            PowerFeedbackChanged?.Invoke(new(pm.Groups[1].Value=="1",name,idx)); return;
        }

        var sm=Regex.Match(frame, @"^<([Qq])\s+(\d+)>");
        if(sm.Success)
        {
            int address=int.Parse(sm.Groups[2].Value,CultureInfo.InvariantCulture);
            if(address is >0 and <=65535)
                SensorFeedbackChanged?.Invoke(address,sm.Groups[1].Value=="Q");
            return;
        }

        var lm=Regex.Match(frame, @"^<l\s+(\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)>");
        if(lm.Success)
        {
            int address=int.Parse(lm.Groups[1].Value), speedByte=int.Parse(lm.Groups[3].Value);
            if(address is >0 and <=10239 && speedByte<=255)
            {
                var enc=speedByte & 0x7f;
                var speed=enc<=1?0:enc-1;
                LocoFeedbackChanged?.Invoke(new(address,speed,(speedByte&0x80)!=0,uint.Parse(lm.Groups[4].Value,CultureInfo.InvariantCulture)));
            }
        }
    }

    private static int[] ParseInts(string s) =>
        Regex.Matches(s, @"-?\d+").Select(m=>int.Parse(m.Value,CultureInfo.InvariantCulture)).Take(8).ToArray();
}
