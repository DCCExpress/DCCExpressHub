using System.Text.Json;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed class SignalAutomationEngine
{
    enum Source { Turnout, Sensor }
    sealed class Condition { public Source Source; public ushort Id; public ushort Address; public byte Channel; public bool Value; }
    sealed class Rule { public int Value; public List<Condition> Conditions=[]; }
    sealed class SignalRuleSet
    {
        public ushort SignalId; public ushort SignalAddress; public bool Extended=true; public byte Outputs=1;
        public int DefaultValue; public List<Rule> Rules=[]; public bool HasAppliedValue; public int AppliedValue;
    }

    readonly ICommandCenter _cc;
    readonly LayoutRuntime _runtime;
    readonly IWebHostEnvironment _env;
    readonly SemaphoreSlim _evalGate=new(1,1);
    List<SignalRuleSet> _signals=[];
    volatile bool _enabled;

    string PathName => Path.Combine(_env.ContentRootPath,"data","config","signal-logic.ndjson");
    public bool Enabled => _enabled;
    public int SignalCount => _signals.Count;

    public SignalAutomationEngine(ICommandCenter cc, LayoutRuntime runtime, IWebHostEnvironment env)
    {
        _cc=cc; _runtime=runtime; _env=env;
        _runtime.Changed += RuntimeChanged;
        Reload();
        _=EvaluateAsync();
    }

    void RuntimeChanged(string type, object _)
    {
        if(type is "turnoutChanged" or "sensorChanged") {
            Console.WriteLine($"SignalAutomation: runtime change {type} -> evaluate");
            _=EvaluateAsync();
        }
    }

    static bool Fits(bool extended, byte outputs, int value)
    {
        if(extended) return value is >=0 and <=255;
        if(value<0||value>65535) return false;
        uint mask=outputs>=16?0xffffu:(1u<<outputs)-1u;
        return (uint)value<=mask;
    }

    public bool Validate(string text) => Parse(text,out _,out _);

    public bool Reload()
    {
        if(!File.Exists(PathName)){_enabled=false;_signals=[];return true;}
        try{
            if(!Parse(File.ReadAllText(PathName),out var enabled,out var signals)) return false;
            _enabled=enabled; _signals=signals; return true;
        }catch{return false;}
    }

    bool Parse(string text,out bool enabled,out List<SignalRuleSet> signals)
    {
        enabled=false; signals=[];
        foreach(var raw in text.Split('\n')){
            var line=raw.Trim(); if(line.Length==0)continue;
            JsonDocument doc;
            try{doc=JsonDocument.Parse(line);}catch{continue;}
            using(doc){
                var o=doc.RootElement; if(o.ValueKind!=JsonValueKind.Object)continue;
                var kind=o.TryGetProperty("kind",out var k)&&k.ValueKind==JsonValueKind.String?k.GetString():"";
                if(kind=="meta"){enabled=o.TryGetProperty("enabled",out var e)&&e.ValueKind==JsonValueKind.True;continue;}
                if(kind!="signal")continue;
                if(ParseSignal(o,out var sig)){
                    var ix=signals.FindIndex(x=>x.SignalId==sig.SignalId);
                    if(ix>=0)signals[ix]=sig;else signals.Add(sig);
                    
                }
            }
        }
        // Firmware accepts a syntactically readable file even if no recognized row exists.
        return true;
    }

    bool ParseSignal(JsonElement row,out SignalRuleSet signal)
    {
        signal=new();
        int rawId=GetInt(row,"id"), rawAddress=GetInt(row,"address");
        ushort id=rawId is >0 and <=65535?(ushort)rawId:(ushort)0;
        ushort address=rawAddress is >0 and <=65535?(ushort)rawAddress:(ushort)0;
        RuntimeAccessory? target=id!=0?_runtime.FindAccessoryById(RuntimeAccessoryKind.Signal,id):null;
        if(target!=null&&address!=0&&target.Address!=address)target=null;
        if(target==null&&address!=0){target=_runtime.FindAccessory(RuntimeAccessoryKind.Signal,address);if(target!=null)id=target.Id;}
        if(id==0)return false;

        var mode=GetString(row,"mode");
        bool extended=mode=="extended"; if(!extended&&mode!="basic")return false;
        byte outputs=(byte)Math.Clamp(GetInt(row,"outputs",1),1,16);
        int def=GetInt(row,"default");
        if(!Fits(extended,outputs,def))return false;
        if(!row.TryGetProperty("rules",out var rules)||rules.ValueKind!=JsonValueKind.Array)return false;

        signal=new(){SignalId=id,SignalAddress=address,Extended=extended,Outputs=outputs,DefaultValue=def};
        foreach(var rr in rules.EnumerateArray()){
            if(rr.ValueKind!=JsonValueKind.Object)continue;
            int value=GetInt(rr,"value"); if(!Fits(extended,outputs,value))continue;
            if(!rr.TryGetProperty("conditions",out var cs)||cs.ValueKind!=JsonValueKind.Array||cs.GetArrayLength()==0)continue;
            var rule=new Rule{Value=value}; bool valid=true;
            foreach(var c in cs.EnumerateArray()){
                if(c.ValueKind!=JsonValueKind.Array||(c.GetArrayLength()!=3&&c.GetArrayLength()!=4)){valid=false;break;}
                var a=c.EnumerateArray().ToArray();
                string source=a[0].ValueKind==JsonValueKind.String?a[0].GetString()??"":"";
                var cond=new Condition();
                if(a.Length==4){
                    int cid=AsInt(a[1]), ch=AsInt(a[2]), val=AsInt(a[3]);
                    if(cid<=0||cid>65535||ch<0||ch>1||(val!=0&&val!=1)){valid=false;break;}
                    cond.Id=(ushort)cid;cond.Channel=(byte)ch;cond.Value=val!=0;
                    if(source=="turnout"){
                        cond.Source=Source.Turnout;
                        if(_runtime.FindAccessoryById(RuntimeAccessoryKind.Turnout,cond.Id,cond.Channel)==null){valid=false;break;}
                    } else if(source=="sensor"){
                        cond.Source=Source.Sensor;cond.Channel=0;
                        var sensor=_runtime.FindSensorById(cond.Id);if(sensor==null){valid=false;break;}cond.Address=sensor.Address;
                    } else {valid=false;break;}
                } else {
                    int addr=AsInt(a[1]), physical=AsInt(a[2]);
                    if(addr<=0||addr>65535||(physical!=0&&physical!=1)){valid=false;break;}
                    if(source=="turnout"){
                        var turnout=_runtime.FindAccessory(RuntimeAccessoryKind.Turnout,(ushort)addr);if(turnout==null){valid=false;break;}
                        cond.Source=Source.Turnout;cond.Id=turnout.Id;cond.Channel=turnout.Channel;cond.Value=(physical!=0)==turnout.ClosedValue;
                    } else if(source=="sensor"){
                        var sensor=_runtime.FindSensor((ushort)addr);if(sensor==null){valid=false;break;}
                        cond.Source=Source.Sensor;cond.Address=(ushort)addr;cond.Value=physical!=0;
                    } else {valid=false;break;}
                }
                rule.Conditions.Add(cond);
            }
            if(valid&&rule.Conditions.Count==cs.GetArrayLength())signal.Rules.Add(rule);
        }
        return signal.Rules.Count>0;
    }

    bool Matches(Condition c)
    {
        if(c.Source==Source.Sensor){var s=_runtime.FindSensor(c.Address);return s!=null&&s.On==c.Value;}
        var t=_runtime.FindAccessoryById(RuntimeAccessoryKind.Turnout,c.Id,c.Channel);return t!=null&&t.Closed==c.Value;
    }
    int Desired(SignalRuleSet s)
    {
        foreach(var r in s.Rules)if(r.Conditions.All(Matches))return r.Value;
        return s.DefaultValue;
    }

    public async Task EvaluateAsync()
    {
        if(!_enabled){Console.WriteLine("SignalAutomation: evaluate skipped (disabled)");return;}
        if(!await _evalGate.WaitAsync(0)){Console.WriteLine("SignalAutomation: evaluate coalesced");return;}
        Console.WriteLine($"SignalAutomation: evaluate {_signals.Count} signal(s)");
        try{foreach(var s in _signals)await ApplyAsync(s,Desired(s));}
        finally{_evalGate.Release();}
    }

    async Task ApplyAsync(SignalRuleSet s,int value)
    {
        var target=_runtime.FindAccessoryById(RuntimeAccessoryKind.Signal,s.SignalId);
        if(target!=null&&s.SignalAddress!=0&&target.Address!=s.SignalAddress)target=null;
        if(target==null&&s.SignalAddress!=0){target=_runtime.FindAccessory(RuntimeAccessoryKind.Signal,s.SignalAddress);if(target!=null)s.SignalId=target.Id;}
        if(target==null){Console.WriteLine($"SignalAutomation: target not found id={s.SignalId} address={s.SignalAddress}");return;}
        if(s.HasAppliedValue&&s.AppliedValue==value){Console.WriteLine($"SignalAutomation: signal address={target.Address} unchanged value={value}");return;}
        Console.WriteLine($"SignalAutomation: apply signal id={s.SignalId} address={target.Address} mode={(s.Extended?"extended":"basic")} value={value}");

        if(s.Extended){
            if(!await _cc.SetSignalAspectAsync(target.Address,value))return;
            _runtime.SetSignal(target.Address,value);
        }else{
            for(byte i=0;i<s.Outputs;i++){
                bool active=((value>>i)&1)!=0;
                if(!await _cc.SetAccessoryAsync(target.Address+i,active))return;
                _runtime.SetAccessory((ushort)(target.Address+i),active);
            }
            _runtime.SetSignal(target.Address,value);
        }
        s.AppliedValue=value;s.HasAppliedValue=true;
    }

    static int GetInt(JsonElement e,string n,int d=0)=>e.TryGetProperty(n,out var x)&&x.TryGetInt32(out var v)?v:d;
    static string GetString(JsonElement e,string n,string d="")=>e.TryGetProperty(n,out var x)&&x.ValueKind==JsonValueKind.String?x.GetString()??d:d;
    static int AsInt(JsonElement e)=>e.TryGetInt32(out var v)?v:int.MinValue;
}
