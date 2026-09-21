using System.Text.Json;

namespace DCCExpressHub.Net.Web;

public sealed class RuntimeStateStore
{
    readonly LayoutRuntime _runtime;
    readonly string _path;
    readonly ILogger<RuntimeStateStore> _log;
    static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){WriteIndented=true};

    public RuntimeStateStore(LayoutRuntime runtime,IWebHostEnvironment env,ILogger<RuntimeStateStore> log)
    {
        _runtime=runtime; _log=log;
        _path=Path.Combine(env.ContentRootPath,"data","state","runtime-state.json");
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
    }

    public async Task<bool> LoadAsync()
    {
        if(!File.Exists(_path)){_log.LogInformation("No saved runtime state; defaults remain active");return true;}
        try
        {
            using var doc=JsonDocument.Parse(await File.ReadAllTextAsync(_path));
            var root=doc.RootElement;
            if(root.TryGetProperty("accessories",out var accessories)&&accessories.ValueKind==JsonValueKind.Object)
            foreach(var pair in accessories.EnumerateObject())
            {
                var key=pair.Name; var value=pair.Value;
                if(key.StartsWith("turnout:",StringComparison.Ordinal)&&ushort.TryParse(key[8..],out var address))
                {
                    bool logical=value.TryGetProperty("closed",out var c)&&c.ValueKind==JsonValueKind.True;
                    var turnout=_runtime.FindAccessory(RuntimeAccessoryKind.Turnout,address);
                    if(turnout==null){_log.LogWarning("Runtime state: turnout address {Address} not found during restore",address);continue;}
                    bool physical=logical?turnout.ClosedValue:!turnout.ClosedValue;
                    _runtime.SetTurnout(address,physical);
                }
                else if(key.StartsWith("signal:",StringComparison.Ordinal)&&ushort.TryParse(key[7..],out var signal)&&value.TryGetProperty("aspect",out var a)&&a.ValueKind==JsonValueKind.Number&&a.TryGetInt32(out var aspect))
                    _runtime.SetSignal(signal,aspect);
                else if(key.StartsWith("accessory:",StringComparison.Ordinal)&&ushort.TryParse(key[10..],out var acc))
                    _runtime.SetAccessory(acc,value.TryGetProperty("active",out var ac)&&ac.ValueKind==JsonValueKind.True);
                else if(key.StartsWith("vpin:",StringComparison.Ordinal)&&ushort.TryParse(key[5..],out var vp))
                    _runtime.SetVPin(vp,value.TryGetProperty("active",out var va)&&va.ValueKind==JsonValueKind.True);
            }

            if(root.TryGetProperty("sensors",out var sensors)&&sensors.ValueKind==JsonValueKind.Object)
            foreach(var pair in sensors.EnumerateObject())
                if(ushort.TryParse(pair.Name,out var address))
                    _runtime.SetSensor(address,pair.Value.TryGetProperty("on",out var on)&&on.ValueKind==JsonValueKind.True);

            if(root.TryGetProperty("blocks",out var blocks)&&blocks.ValueKind==JsonValueKind.Object)
            foreach(var pair in blocks.EnumerateObject())
            {
                if(!ushort.TryParse(pair.Name,out var blockId)||blockId==0)continue;
                var v=pair.Value;
                string locoId=v.TryGetProperty("locoId",out var li)&&li.ValueKind==JsonValueKind.String?li.GetString()??"":"";
                ushort locoAddress=0;
                if(v.TryGetProperty("locoAddress",out var la)&&la.TryGetInt32(out var n)&&n is >0 and <=10239)locoAddress=(ushort)n;
                _runtime.SetBlock(blockId,locoId,locoAddress);
            }
            _log.LogInformation("Runtime state restored");
            return true;
        }
        catch(Exception ex){_log.LogWarning(ex,"Runtime state parse failed");return false;}
    }

    public async Task<bool> SaveAsync()
    {
        try
        {
            var accessories=new Dictionary<string,object?>();
            foreach(var x in _runtime.AccessoriesForPersistence())
            {
                switch(x.Kind)
                {
                    case RuntimeAccessoryKind.Turnout: accessories[$"turnout:{x.Address}"]=new{closed=x.Closed}; break;
                    case RuntimeAccessoryKind.Signal: accessories[$"signal:{x.Address}"]=new{aspect=x.Aspect>=0?(int?)x.Aspect:null}; break;
                    case RuntimeAccessoryKind.Accessory: accessories[$"accessory:{x.Address}"]=new{active=x.Active}; break;
                    case RuntimeAccessoryKind.VPin: accessories[$"vpin:{x.Address}"]=new{active=x.Active}; break;
                }
            }
            var sensors=new Dictionary<string,object>();
            foreach(var x in _runtime.SensorsForPersistence()) sensors[x.Address.ToString()]=new{on=x.On};
            var blocks=new Dictionary<string,object>();
            foreach(var x in _runtime.BlocksForPersistence())
                if(!string.IsNullOrEmpty(x.LocoId)||x.LocoAddress>0)
                    blocks[x.Id.ToString()]=new{locoId=string.IsNullOrEmpty(x.LocoId)?null:x.LocoId,locoAddress=x.LocoAddress>0?(ushort?)x.LocoAddress:null};

            var body=JsonSerializer.Serialize(new{version=2,savedAtMs=Environment.TickCount64,accessories,sensors,blocks},Json);
            var tmp=_path+".tmp";
            await File.WriteAllTextAsync(tmp,body);
            File.Move(tmp,_path,true);
            _log.LogInformation("Runtime state saved on POWER OFF");
            return true;
        }
        catch(Exception ex){_log.LogError(ex,"Runtime state atomic save failed");return false;}
    }
}
