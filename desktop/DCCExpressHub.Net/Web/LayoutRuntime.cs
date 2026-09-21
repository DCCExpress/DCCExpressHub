using System.Text.Json;

namespace DCCExpressHub.Net.Web;

public enum RuntimeAccessoryKind { Turnout, Signal, Accessory, VPin }

public sealed class RuntimeAccessory
{
    public ushort Id {get;set;}
    public RuntimeAccessoryKind Kind {get;set;}
    public ushort Address {get;set;}
    public byte Channel {get;set;}
    public bool Closed {get;set;}
    public bool ClosedValue {get;set;}
    public int Aspect {get;set;}=-1;
    public bool SignalExtended {get;set;}=true;
    public byte SignalOutputCount {get;set;}=1;
    public bool Active {get;set;}
}
public sealed class RuntimeSensor { public ushort Id{get;set;} public ushort Address{get;set;} public bool On{get;set;} }
public sealed class RuntimeBlock
{
    public const string TargetLocoPrefix="__dcc_target_loco__:";
    public ushort Id{get;set;} public string LocoId{get;set;}=""; public ushort LocoAddress{get;set;}
    public bool TargetOnly => LocoAddress==0 && LocoId.StartsWith(TargetLocoPrefix,StringComparison.Ordinal);
    public bool Occupied => LocoAddress>0 || (LocoId.Length>0&&!TargetOnly);
    public bool HasRuntimeState => Occupied||TargetOnly;
}

public sealed record RuntimeSnapshotItem(string Type, object Data);

public sealed class LayoutRuntime
{
    readonly object _gate=new();
    readonly IWebHostEnvironment _env;
    List<RuntimeAccessory> _accessories=[];
    List<RuntimeSensor> _sensors=[];
    List<RuntimeBlock> _blocks=[];

    public event Action<string,object>? Changed;
    public int AccessoryCount {get{lock(_gate)return _accessories.Count;}}
    public int SensorCount {get{lock(_gate)return _sensors.Count;}}
    public int BlockCount {get{lock(_gate)return _blocks.Count;}}

    public RuntimeAccessory[] AccessoriesForPersistence()
    {
        lock(_gate) return _accessories.Select(x => new RuntimeAccessory {
            Id=x.Id, Kind=x.Kind, Address=x.Address, Channel=x.Channel,
            Closed=x.Closed, ClosedValue=x.ClosedValue, Aspect=x.Aspect,
            SignalExtended=x.SignalExtended, SignalOutputCount=x.SignalOutputCount, Active=x.Active
        }).ToArray();
    }
    public RuntimeSensor[] SensorsForPersistence()
    {
        lock(_gate) return _sensors.Select(x => new RuntimeSensor { Id=x.Id, Address=x.Address, On=x.On }).ToArray();
    }
    public RuntimeBlock[] BlocksForPersistence()
    {
        lock(_gate) return _blocks.Select(x => new RuntimeBlock {
            Id=x.Id, LocoId=x.LocoId, LocoAddress=x.LocoAddress
        }).ToArray();
    }


    public LayoutRuntime(IWebHostEnvironment env){_env=env;Rebuild();}

    static bool TurnoutType(string t)=>t is "trackturnout" or "trackturnoutleft" or "trackturnoutright" or "trackturnoutdouble" or "trackturnouttwoway" or "trackturnouttreeway";
    static bool SignalType(string t)=>t is "tracksignal" or "tracksignal2" or "tracksignal3" or "tracksignal4" or "tracklevelcrossing";
    static int I(JsonElement e,string n,int d=0)=>e.TryGetProperty(n,out var x)&&x.TryGetInt32(out var v)?v:d;
    static bool B(JsonElement e,string n,bool d=false)=>e.TryGetProperty(n,out var x)?x.ValueKind==JsonValueKind.True?true:x.ValueKind==JsonValueKind.False?false:d:d;
    static string S(JsonElement e,string n,string d="")=>e.TryGetProperty(n,out var x)&&x.ValueKind==JsonValueKind.String?x.GetString()??d:d;

    // Bit-for-bit algorithmic equivalent of firmware/browser migrateSerializedLayoutIds:
    // reserve first unique persisted numeric IDs globally; then retain first occurrence,
    // assigning lowest free uint16 IDs to string/missing/duplicate IDs in persisted order.
    static Dictionary<(int layer,int element),ushort> MigrateIds(JsonElement root,out int migrated)
    {
        migrated=0; var reserved=new HashSet<ushort>(); var seen=new HashSet<ushort>();
        var map=new Dictionary<(int,int),ushort>();
        if(!root.TryGetProperty("layers",out var layers)||layers.ValueKind!=JsonValueKind.Array)return map;
        foreach(var layer in layers.EnumerateArray()){
            if(!layer.TryGetProperty("elements",out var es)||es.ValueKind!=JsonValueKind.Array)continue;
            foreach(var e in es.EnumerateArray())
                if(ReadPersistedNumericId(e,out var id)) reserved.Add(id);
        }
        var used=new HashSet<ushort>(reserved); ushort next=1; int li=0;
        foreach(var layer in layers.EnumerateArray()){
            int ei=0;
            if(layer.TryGetProperty("elements",out var es)&&es.ValueKind==JsonValueKind.Array){
                foreach(var e in es.EnumerateArray()){
                    bool numeric=ReadPersistedNumericId(e,out var persisted); ushort runtime;
                    if(numeric&&seen.Add(persisted)) runtime=persisted;
                    else {
                        runtime=NextFree(used,next);
                        if(runtime==0){ei++;continue;}
                        used.Add(runtime); next=runtime==ushort.MaxValue?(ushort)1:(ushort)(runtime+1); migrated++;
                    }
                    map[(li,ei)]=runtime; ei++;
                }
            }
            li++;
        }
        return map;
    }
    static bool ReadPersistedNumericId(JsonElement e,out ushort id)
    {
        id=0;if(!e.TryGetProperty("id",out var x)||x.ValueKind!=JsonValueKind.Number||!x.TryGetInt32(out var v)||v<=0||v>65535)return false;
        id=(ushort)v;return true;
    }
    static ushort NextFree(HashSet<ushort> used,ushort start)
    {
        uint c = start > 0 ? (uint)start : 1u;
        for(uint a=0;a<65535;a++){if(c>65535)c=1;var id=(ushort)c;if(!used.Contains(id))return id;c++;}
        return 0;
    }

    public bool Rebuild()
    {
        var path=Path.Combine(_env.ContentRootPath,"data","config","layout.json");
        if(!File.Exists(path)){lock(_gate){_accessories=[];_sensors=[];_blocks=[];}Console.WriteLine($"LayoutRuntime: no layout at {path}");return true;}
        try{
            using var doc=JsonDocument.Parse(File.ReadAllText(path)); var root=doc.RootElement;
            var ids=MigrateIds(root,out var migrated);
            List<RuntimeAccessory> oldA;List<RuntimeSensor> oldS;List<RuntimeBlock> oldB;
            lock(_gate){oldA=_accessories;oldS=_sensors;oldB=_blocks;}
            var na=new List<RuntimeAccessory>();var ns=new List<RuntimeSensor>();var nb=new List<RuntimeBlock>();
            if(root.TryGetProperty("layers",out var layers)&&layers.ValueKind==JsonValueKind.Array){
                int li=0;foreach(var layer in layers.EnumerateArray()){
                    int ei=0;if(layer.TryGetProperty("elements",out var es)&&es.ValueKind==JsonValueKind.Array)
                        foreach(var e in es.EnumerateArray()){if(ids.TryGetValue((li,ei),out var id))AddElement(e,id,na,ns,nb);ei++;}
                    li++;
                }
            }
            Restore(na,ns,nb,oldA,oldS,oldB);
            lock(_gate){_accessories=na;_sensors=ns;_blocks=nb;}
            if(migrated>0)Console.WriteLine($"LayoutRuntime: migrated {migrated} legacy/duplicate element ID(s) in RAM");
            Console.WriteLine($"LayoutRuntime rebuilt: {na.Count} accessories, {ns.Count} sensors, {nb.Count} blocks");
            foreach(var a in na.Where(x=>x.Kind is RuntimeAccessoryKind.Turnout or RuntimeAccessoryKind.Signal))
                Console.WriteLine($"LayoutRuntime: {a.Kind} id={a.Id} ch={a.Channel} address={a.Address} closedValue={a.ClosedValue} extended={a.SignalExtended}");
            return true;
        }catch(Exception ex){Console.WriteLine("LayoutRuntime parse failed: "+ex.Message);return false;}
    }

    static void AddElement(JsonElement e,ushort id,List<RuntimeAccessory>a,List<RuntimeSensor>s,List<RuntimeBlock>b)
    {
        var type=S(e,"type");int elementAddress=I(e,"address");bool addressIsSensor=false;
        if(type is "trackstraight" or "trackdirection" or "trackend" or "trackcorner" or "trackcurve" or "trackcrossing" or "tracklevelcrossing" or "tracksensor") addressIsSensor=true;
        else if(TurnoutType(type)){
            bool dual=type is "trackturnoutdouble" or "trackturnouttreeway";
            addressIsSensor=dual ? I(e,"turnout1Address")>0||I(e,"turnout2Address")>0 : I(e,"turnoutAddress")>0;
        } else if(SignalType(type)) addressIsSensor=false;
        if(addressIsSensor&&elementAddress>0&&elementAddress<=65535)s.Add(new(){Id=id,Address=(ushort)elementAddress});

        if(type=="trackblock"){b.Add(new(){Id=id});return;}
        if(TurnoutType(type)){
            bool dual=type is "trackturnoutdouble" or "trackturnouttreeway";
            if(dual){
                int a1=I(e,"turnout1Address"),a2=I(e,"turnout2Address");
                if(a1 is >0 and <=65535)a.Add(new(){Id=id,Kind=RuntimeAccessoryKind.Turnout,Address=(ushort)a1,Channel=0,ClosedValue=B(e,"turnout1ClosedValue")});
                if(a2 is >0 and <=65535)a.Add(new(){Id=id,Kind=RuntimeAccessoryKind.Turnout,Address=(ushort)a2,Channel=1,ClosedValue=B(e,"turnout2ClosedValue")});
                return;
            }
            int addr=I(e,"turnoutAddress");if(addr==0)addr=I(e,"address");if(addr<=0||addr>65535)return;
            a.Add(new(){Id=id,Kind=RuntimeAccessoryKind.Turnout,Address=(ushort)addr,ClosedValue=B(e,"turnoutClosedValue")});return;
        }
        if(SignalType(type)){
            JsonElement so=default;bool has=e.TryGetProperty("signalOutput",out so)&&so.ValueKind==JsonValueKind.Object;
            int addr=has?I(so,"address"):0;bool crossing=type=="tracklevelcrossing";
            if(addr==0&&crossing)addr=I(e,"basicAccessoryAddress");if(addr==0&&!crossing)addr=I(e,"address");if(addr<=0||addr>65535)return;
            string protocol=has?S(so,"protocol",crossing?"dcc":"dccext"):(crossing?"dcc":"dccext");
            int outputs=has?I(so,"outputCount",1):1;
            a.Add(new(){Id=id,Kind=RuntimeAccessoryKind.Signal,Address=(ushort)addr,Aspect=-1,SignalExtended=protocol=="dccext",SignalOutputCount=(byte)Math.Clamp(outputs,1,16)});return;
        }
        if(type=="button"){
            int addr=I(e,"address");if(addr<=0||addr>65535)return;var mode=S(e,"outputMode","accessory");
            a.Add(mode=="extended"?new(){Id=id,Kind=RuntimeAccessoryKind.Signal,Address=(ushort)addr,Aspect=-1,SignalExtended=true}:new(){Id=id,Kind=RuntimeAccessoryKind.Accessory,Address=(ushort)addr});return;
        }
    }

    static void Restore(List<RuntimeAccessory>a,List<RuntimeSensor>s,List<RuntimeBlock>b,List<RuntimeAccessory>oa,List<RuntimeSensor>os,List<RuntimeBlock>ob)
    {
        foreach(var x in a){var o=oa.FirstOrDefault(y=>y.Kind==x.Kind&&y.Address==x.Address);if(o!=null){x.Closed=o.Closed;x.Aspect=o.Aspect;x.Active=o.Active;}}
        foreach(var x in s){var o=os.FirstOrDefault(y=>y.Address==x.Address);if(o!=null)x.On=o.On;}
        foreach(var x in b){var o=ob.FirstOrDefault(y=>y.Id==x.Id);if(o!=null){x.LocoId=o.LocoId;x.LocoAddress=o.LocoAddress;}}
    }

    public RuntimeAccessory? FindAccessoryById(RuntimeAccessoryKind kind,ushort id,byte channel=0){lock(_gate)return _accessories.FirstOrDefault(x=>x.Kind==kind&&x.Id==id&&x.Channel==channel);}
    public RuntimeAccessory? FindAccessory(RuntimeAccessoryKind kind,ushort address){lock(_gate)return _accessories.FirstOrDefault(x=>x.Kind==kind&&x.Address==address);}
    public RuntimeSensor? FindSensorById(ushort id){lock(_gate)return _sensors.FirstOrDefault(x=>x.Id==id);}
    public RuntimeSensor? FindSensor(ushort address){lock(_gate)return _sensors.FirstOrDefault(x=>x.Address==address);}

    public bool SetTurnout(ushort address,bool physicalValue)
    {
        ushort id;byte ch;bool logical,closedValue;
        lock(_gate){var x=_accessories.FirstOrDefault(x=>x.Kind==RuntimeAccessoryKind.Turnout&&x.Address==address);if(x==null){Console.WriteLine($"LayoutRuntime: turnout address {address} not found");return false;}
            logical=physicalValue==x.ClosedValue;x.Closed=logical;id=x.Id;ch=x.Channel;closedValue=x.ClosedValue;}
        Console.WriteLine($"LayoutRuntime: turnout id={id} ch={ch} address={address} physical={(physicalValue?1:0)} closedValue={(closedValue?1:0)} logical={(logical?"CLOSED":"THROWN")}");
        Changed?.Invoke("turnoutChanged",new{address,closed=physicalValue});return true;
    }
    public bool SetSignal(ushort address,int aspect){ushort id;lock(_gate){var x=_accessories.FirstOrDefault(x=>x.Kind==RuntimeAccessoryKind.Signal&&x.Address==address);if(x==null)return false;if(x.Aspect==aspect)return true;x.Aspect=aspect;id=x.Id;}Changed?.Invoke("signalAspectChanged",new{address,aspect});return true;}
    public bool SetAccessory(ushort address,bool active){lock(_gate){var x=_accessories.FirstOrDefault(x=>x.Kind==RuntimeAccessoryKind.Accessory&&x.Address==address);if(x==null)return false;if(x.Active==active)return true;x.Active=active;}Changed?.Invoke("accessoryChanged",new{address,active});return true;}
    public bool SetVPin(ushort address,bool active){lock(_gate){var x=_accessories.FirstOrDefault(x=>x.Kind==RuntimeAccessoryKind.VPin&&x.Address==address);if(x==null)return false;if(x.Active==active)return true;x.Active=active;}Changed?.Invoke("vpinChanged",new{vpin=address,active});return true;}
    public bool SetSensor(ushort address,bool on)
    {
        List<ushort> changed=[];lock(_gate){var xs=_sensors.Where(x=>x.Address==address).ToList();if(xs.Count==0){Console.WriteLine($"LayoutRuntime: sensor address {address} not found");return false;}foreach(var x in xs)if(x.On!=on){x.On=on;changed.Add(x.Id);}}
        foreach(var _ in changed)Changed?.Invoke("sensorChanged",new{address,on});if(changed.Count>0)Console.WriteLine($"LayoutRuntime: sensor address {address} -> {(on?"ON":"OFF")}");return true;
    }

    public bool SetBlock(ushort id,string locoId,ushort locoAddress)
    {
        bool changed=false;lock(_gate){var t=_blocks.FirstOrDefault(x=>x.Id==id);if(t==null)return false;bool clearing=string.IsNullOrEmpty(locoId)&&locoAddress==0;
            if(!clearing)foreach(var x in _blocks)if(x.Id!=id&&x.Occupied&&((locoAddress>0&&x.LocoAddress==locoAddress)||(!string.IsNullOrEmpty(locoId)&&x.LocoId==locoId))){x.LocoId="";x.LocoAddress=0;changed=true;}
            if(clearing){if(t.HasRuntimeState){t.LocoId="";t.LocoAddress=0;changed=true;}}else if(t.LocoId!=locoId||t.LocoAddress!=locoAddress){t.LocoId=locoId;t.LocoAddress=locoAddress;changed=true;}}
        if(changed)Changed?.Invoke("blockStateChanged",BlockSnapshot());return true;
    }
    public bool RemoveBlock(ushort id,string locoId="")
    {
        lock(_gate){var b=_blocks.FirstOrDefault(x=>x.Id==id);if(b==null)return false;if(!b.HasRuntimeState)return true;if(locoId.Length>0&&b.LocoId!=locoId)return false;b.LocoId="";b.LocoAddress=0;}Changed?.Invoke("blockStateChanged",BlockSnapshot());return true;
    }
    public bool ClearBlocks(){bool changed=false;lock(_gate)foreach(var b in _blocks)if(b.HasRuntimeState){b.LocoId="";b.LocoAddress=0;changed=true;}if(changed)Changed?.Invoke("blockStateChanged",BlockSnapshot());return true;}

    public object BlockSnapshot(){lock(_gate)return _blocks.ToDictionary(x=>x.Id.ToString(),x=>(object)new{locoId=x.LocoId,locoAddress=x.LocoAddress});}
    public object SensorSnapshot()
    {
        lock(_gate){var groups=_sensors.GroupBy(x=>(x.Address/16)*16).OrderBy(g=>g.Key).Select(g=>{int active=0,known=0;foreach(var s in g){int bit=s.Address-g.Key;if(bit is >=0 and <16){known|=1<<bit;if(s.On)active|=1<<bit;}}return new[]{g.Key,active,known};}).ToArray();return new{groups};}
    }
    public IReadOnlyList<RuntimeSnapshotItem> RuntimeSnapshot()
    {
        lock(_gate)
        {
            var items = new List<RuntimeSnapshotItem>();
            foreach(var x in _accessories.Where(x=>x.Kind==RuntimeAccessoryKind.Turnout))
                items.Add(new("turnoutChanged", new { address=x.Address, closed=x.Closed }));
            foreach(var x in _accessories.Where(x=>x.Kind==RuntimeAccessoryKind.Signal))
                items.Add(new("signalAspectChanged", new { address=x.Address, aspect=x.Aspect }));
            foreach(var x in _accessories.Where(x=>x.Kind==RuntimeAccessoryKind.Accessory))
                items.Add(new("accessoryChanged", new { address=x.Address, active=x.Active }));
            foreach(var x in _sensors)
                items.Add(new("sensorChanged", new { address=x.Address, on=x.On }));
            items.Add(new("sensorSnapshot", SensorSnapshot()));
            items.Add(new("blockStateChanged", BlockSnapshot()));
            return items;
        }
    }
}
