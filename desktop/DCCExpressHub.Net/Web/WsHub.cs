using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed class WsHub
{
    private readonly ICommandCenter _cc; private readonly HubState _state; private readonly CommandCenterConfigStore _ccConfig;
    readonly LayoutRuntime _runtime; readonly RuntimeStateStore _stateStore; private readonly ILogger<WsHub> _log;
    private readonly ConcurrentDictionary<Guid,WebSocket> _clients=new();
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private readonly object _programmingGate=new();
    private PendingProgramming? _pendingProgramming;
    private sealed record PendingProgramming(string RequestId,string Action,int ExpectedCv,long Token);
    private long _programmingToken;
    private const int ProgrammingTimeoutMs=24000;
    public int ClientCount=>_clients.Count;

    public WsHub(ICommandCenter cc,HubState state,LayoutRuntime runtime,RuntimeStateStore stateStore,CommandCenterConfigStore ccConfig,ILogger<WsHub> log)
    {
        _cc=cc;_state=state;_runtime=runtime;_stateStore=stateStore;_ccConfig=ccConfig;
        _runtime.Changed += (type,data) => _ = Broadcast(type,data);_log=log;
        cc.RawInfo+=raw=>{
            HandleProgrammingRawResponse(raw);
            if(_cc.EmergencyPauseStateKnown && _state.EmergencyStop!=_cc.EmergencyPaused){
                _state.EmergencyStop=_cc.EmergencyPaused;
                _=BroadcastPower();
            }
            _=Broadcast("rawInfo",new{raw});
        };
        cc.StationInfoChanged+=x=>_state.Station=x;
        cc.TrackConfigurationChanged+=x=>_state.Tracks.GetOrAdd(x.Index,_=>new()).Mode=x.Mode;
        cc.CurrentTelemetryChanged+=x=>{for(int i=0;i<x.Length;i++){var t=_state.Tracks.GetOrAdd(i,_=>new());t.Overload=x[i]<0;t.CurrentMa=Math.Max(0,x[i]);}};
        cc.TripTelemetryChanged+=x=>{for(int i=0;i<x.Length;i++)_state.Tracks.GetOrAdd(i,_=>new()).TripMa=Math.Max(0,x[i]);};
        cc.PowerFeedbackChanged+=x=>{
            var wasMainOn=_state.TrackPower;
            ApplyPower(x);
            if(wasMainOn&&!_state.TrackPower)_=_stateStore.SaveAsync();
            _=BroadcastPower();
        };
        cc.LocoFeedbackChanged+=x=>{_state.Locos[x.Address]=x;_=BroadcastLoco(x);};
        cc.ConnectionChanged += connected =>
        {
            _ = BroadcastStatus();
        };
    }

    private void ApplyPower(PowerFeedback p)
    {
        if(p.Target=="All"){_state.TrackPower=p.On;_state.ProgrammingPower=p.On;}
        else if(p.Target=="Main")_state.TrackPower=p.On;
        else if(p.Target=="Programming"){_state.ProgrammingPower=p.On;_state.ProgrammingJoined=false;}
        else if(p.Target=="Joined"){_state.TrackPower=p.On;_state.ProgrammingPower=p.On;_state.ProgrammingJoined=p.On;}
        else if(p.Target=="Track"&&p.TrackIndex>=0)_state.Tracks.GetOrAdd(p.TrackIndex,_=>new()).Power=p.On;
    }

    public async Task Accept(HttpContext ctx)
    {
        var ws=await ctx.WebSockets.AcceptWebSocketAsync();var id=Guid.NewGuid();_clients[id]=ws;
        try
        {
            await Send(ws,"ws:welcome",new{message="DCCExpressHub"});
            await SendSnapshot(ws);
            var buf=new byte[64*1024];
            while(ws.State==WebSocketState.Open)
            {
                var ms=new MemoryStream();WebSocketReceiveResult r;
                do{r=await ws.ReceiveAsync(buf,ctx.RequestAborted);if(r.MessageType==WebSocketMessageType.Close)return;ms.Write(buf,0,r.Count);}while(!r.EndOfMessage);
                var text=Encoding.UTF8.GetString(ms.ToArray()); await Handle(ws,text,ctx.RequestAborted);
            }
        } finally {_clients.TryRemove(id,out _);try{await ws.CloseAsync(WebSocketCloseStatus.NormalClosure,"bye",CancellationToken.None);}catch{}}
    }

    private async Task Handle(WebSocket ws,string text,CancellationToken ct)
    {
        JsonDocument d;try{d=JsonDocument.Parse(text);}catch{await Send(ws,"error",new{message="invalid_json"});return;}
        using(d)
        {
            var root=d.RootElement;var type=root.TryGetProperty("type",out var t)?t.GetString()??"":"";var data=root.TryGetProperty("data",out var x)?x:default;
            bool ok=true;
            switch(type)
            {
                case "heartbeat": await Send(ws,"heartbeatAck",new{});await SendCommandCenterInfo(ws);await SendPower(ws);return;
                case "setTrackPower": ok=await _cc.SetTrackPowerAsync(B(data,"on"),_ccConfig.Current.PowerIncludesProgramming,ct);break;
                case "setProgrammingPower": ok=await _cc.SetProgrammingPowerAsync(B(data,"on"),ct);break;
                case "emergencyStop":
                    ok=await _cc.EmergencyStopAsync(ct);
                    if(ok){
                        _state.EmergencyStop=_cc.EmergencyPauseStateKnown?_cc.EmergencyPaused:true;
                        await BroadcastPower();
                    }
                    break;
                case "writeDccExDirectCommand":
                {
                    var command=S(data,"command");
                    ok=await _cc.SendRawAsync(command,true,ct);
                    if(ok)
                    {
                        var normalized=command.Trim().ToUpperInvariant();
                        if(normalized=="<1 JOIN>")
                        {
                            _state.ProgrammingJoined=true;
                            _state.TrackPower=true;
                            _state.ProgrammingPower=true;
                            await BroadcastPower();
                        }
                        else if(normalized=="<1 PROG>")
                        {
                            _state.ProgrammingJoined=false;
                            _state.ProgrammingPower=true;
                            await BroadcastPower();
                        }
                    }
                    await Send(ws,"dccExDirectCommandResponse",new{response=ok?"sent":"send failed"});
                    return;
                }
                case "setLoco": {int a=I(data,"locoAddress"),s=Math.Clamp(I(data,"speed"),0,126);bool f=S(data,"direction")!="reverse";ok=await _cc.SetLocoAsync(a,s,f,ct);if(ok){var old=_state.Locos.GetValueOrDefault(a,new(a,0,true,0));var l=old with{Speed=s,Forward=f};_state.Locos[a]=l;await BroadcastLoco(l);}break;}
                case "getLoco": ok=await _cc.RequestLocoAsync(I(data,"locoAddress"),ct);break;
                case "setLocoFunction":
                {
                    int a=I(data,"locoAddress"),fn=I(data,"functionNumber");
                    if(fn is <0 or >28)return; // firmware MAX_LOCO_FUNCTION
                    bool on=B(data,"active");
                    ok=await _cc.SetLocoFunctionAsync(a,fn,on,ct);
                    if(ok){var old=_state.Locos.GetValueOrDefault(a,new(a,0,true,0));uint bit=1u<<fn;var l=old with{FunctionsMask=on?old.FunctionsMask|bit:old.FunctionsMask&~bit};_state.Locos[a]=l;await BroadcastLoco(l);}
                    break;
                }
                case "setTurnout": { var a=(ushort)I(data,"address"); var v=B(data,"closed"); ok=await _cc.SetTurnoutAsync(a,v,ct); if(ok)_runtime.SetTurnout(a,v); break; }
                case "setSignalAspect":
                {
                    var a=(ushort)I(data,"address");var v=I(data,"aspect");
                    ok=await _cc.SetSignalAspectAsync(a,v,ct);
                    if(ok)
                    {
                        _runtime.SetSignal(a,v);
                        if(data.TryGetProperty("turnoutPhysicalValue",out var tp) && tp.ValueKind is JsonValueKind.True or JsonValueKind.False)
                            _runtime.SetTurnout(a,tp.GetBoolean());
                    }
                    break;
                }
                case "setBasicAccessory": { var a=(ushort)I(data,"address"); var v=B(data,"active"); ok=await _cc.SetAccessoryAsync(a,v,ct); if(ok)_runtime.SetAccessory(a,v); break; }
                case "setVpin": { var a=(ushort)I(data,"vpin"); var v=B(data,"active"); ok=await _cc.SetVPinAsync(a,v,ct); if(ok)_runtime.SetVPin(a,v); break; }
                case "setSensor": { var a=(ushort)I(data,"address"); _runtime.SetSensor(a,B(data,"on")); break; }
                case "setBlock":
                {
                    var idValue=I(data,"blockId");
                    var lid=S(data,"locoId");
                    var addressValue=I(data,"locoAddress");
                    var id=idValue is >0 and <=65535?(ushort)idValue:(ushort)0;
                    var la=addressValue is >0 and <=10239?(ushort)addressValue:(ushort)0;
                    if(id==0||(lid.Length==0&&la==0)||!_runtime.SetBlock(id,lid,la))
                        await Send(ws,"error",new{message="invalid_block_assignment"});
                    break;
                }
                case "setBlockRemove":
                {
                    var idValue=I(data,"blockId");
                    var id=idValue is >0 and <=65535?(ushort)idValue:(ushort)0;
                    var lid=S(data,"locoId");
                    if(id==0||!_runtime.RemoveBlock(id,lid))await Send(ws,"error",new{message="invalid_block_remove"});
                    break;
                }
                case "setBlocksReset": _runtime.ClearBlocks(); break;
                case "getBlocks": await Send(ws,"blockStateChanged",_runtime.BlockSnapshot()); return;
                case "getLayoutRuntimeSnapshot": foreach(var item in _runtime.RuntimeSnapshot()) await Send(ws,item.Type,item.Data); return;
                case "programmingCommand": await Programming(data,ct);return;
                default: await Send(ws,"ack",new{ok=true,message="Not implemented yet: "+type});return;
            }
            if(!ok)await Send(ws,"error",new{message="command_center_send_failed",operation=type});
        }
    }

    private async Task Programming(JsonElement d,CancellationToken ct)
    {
        string id=S(d,"requestId"),action=S(d,"action");
        async Task Fail(string message)=>await SendProgrammingResponse(id,action,false,message);

        if(string.IsNullOrEmpty(id)||string.IsNullOrEmpty(action)){await Fail("Invalid programming request.");return;}
        if(!_cc.Connected){await Fail("Command center is not connected.");return;}

        lock(_programmingGate)
            if(_pendingProgramming!=null){_=Fail("Another decoder programming request is already running.");return;}

        string cmd; int expectedCv=-1; bool wait=true;
        if(action=="readAddress") cmd="<R>";
        else if(action=="writeAddress")
        {
            int address=I(d,"address"); if(address<=0||address>10239){await Fail("Invalid locomotive address.");return;}
            cmd=$"<W {address}>";
        }
        else if(action=="readCv")
        {
            int cv=I(d,"cv"); if(cv<=0||cv>1024){await Fail("Invalid CV number.");return;}
            expectedCv=cv;cmd=$"<R {cv}>";
        }
        else if(action=="writeCv")
        {
            int cv=I(d,"cv"),value=IOr(d,"value",-1);
            if(cv<=0||cv>1024||value<0||value>255){await Fail("Invalid CV number or value.");return;}
            expectedCv=cv;cmd=$"<W {cv} {value}>";
        }
        else if(action=="pomWriteCv")
        {
            int address=I(d,"address"),cv=I(d,"cv"),value=IOr(d,"value",-1);
            if(address<=0||address>10239||cv<=0||cv>1024||value<0||value>255){await Fail("Invalid POM address, CV or value.");return;}
            cmd=$"<w {address} {cv} {value}>";wait=false;
        }
        else if(action=="accessoryLearn")
        {
            int address=I(d,"address");
            if(address<=0||address>2044){await Fail("Invalid accessory address.");return;}
            bool sent=await _cc.SetAccessoryAsync(address,B(d,"active"),ct);
            await SendProgrammingResponse(id,action,sent,sent?"Accessory programming command sent.":"Accessory programming command could not be sent.",address);
            return;
        }
        else {await Fail("Unsupported programming action.");return;}

        long token=0;
        if(wait)
        {
            // Firmware returns the programming output to PROG semantics before a service-mode request.
            if(_state.ProgrammingJoined){_state.ProgrammingJoined=false;await BroadcastPower();}
            lock(_programmingGate)
            {
                token=++_programmingToken;
                _pendingProgramming=new(id,action,expectedCv,token);
            }
        }

        bool ok=await _cc.SendRawAsync(cmd,true,ct);
        if(!ok)
        {
            if(wait)ClearPendingProgramming(token);
            await Fail("Programming command could not be sent.");
            return;
        }

        _log.LogInformation("Programming command sent: {Action} {Command}",action,cmd);
        if(!wait)
        {
            await SendProgrammingResponse(id,action,true,"Programming command sent.",IOr(d,"value",-1),cmd);
            return;
        }
        _=ProgrammingTimeout(token);
    }

    private async Task ProgrammingTimeout(long token)
    {
        await Task.Delay(ProgrammingTimeoutMs);
        PendingProgramming? p=null;
        lock(_programmingGate)
        {
            if(_pendingProgramming?.Token!=token)return;
            p=_pendingProgramming;_pendingProgramming=null;
        }
        if(p!=null)await SendProgrammingResponse(p.RequestId,p.Action,false,"Programming command timed out.");
    }

    private void ClearPendingProgramming(long token)
    {
        lock(_programmingGate)if(_pendingProgramming?.Token==token)_pendingProgramming=null;
    }

    private void HandleProgrammingRawResponse(string raw)
    {
        PendingProgramming? p;
        lock(_programmingGate)p=_pendingProgramming;
        if(p==null||raw.Length<4||!raw.EndsWith('>'))return;
        bool isR=raw.StartsWith("<r ",StringComparison.Ordinal);
        bool isV=raw.StartsWith("<v ",StringComparison.Ordinal);
        if(!isR&&!isV)return;
        if(p.Action=="readCv"&&!isV)return;
        if((p.Action=="readAddress"||p.Action=="writeAddress"||p.Action=="writeCv")&&!isR)return;

        var body=raw.Substring(3,raw.Length-4).Trim();
        var parts=body.Split((char[]?)null,StringSplitOptions.RemoveEmptyEntries);
        if(parts.Length<1||!long.TryParse(parts[0],out var first))return;
        long second=-1; bool hasSecond=parts.Length>1&&long.TryParse(parts[1],out second);

        if(p.Action is "readAddress" or "writeAddress")
        {
            bool ok=first>=0;
            ClearPendingProgramming(p.Token);
            _=SendProgrammingResponse(p.RequestId,p.Action,ok,
                ok?"Decoder address operation completed.":"Decoder address operation failed.",
                ok?(int)first:-1,raw);
            return;
        }

        if(p.Action is "readCv" or "writeCv")
        {
            if(!hasSecond)return;
            if(p.ExpectedCv>=0&&first!=p.ExpectedCv)return;
            bool ok=second>=0;
            ClearPendingProgramming(p.Token);
            _=SendProgrammingResponse(p.RequestId,p.Action,ok,
                ok?"CV operation completed.":"CV operation failed.",
                ok?(int)second:-1,raw);
        }
    }

    private Task SendProgrammingResponse(string requestId,string action,bool ok,string message,int value=-1,string raw="")
    {
        if(value>=0&&raw.Length>0)return Broadcast("programmingResponse",new{requestId,action,ok,message,value,raw});
        if(value>=0)return Broadcast("programmingResponse",new{requestId,action,ok,message,value});
        if(raw.Length>0)return Broadcast("programmingResponse",new{requestId,action,ok,message,raw});
        return Broadcast("programmingResponse",new{requestId,action,ok,message});
    }

    public async Task BroadcastRuntimeSnapshot()
    {
        var x=_ccConfig.Current;
        await Broadcast("commandCenterInfo",new{alive=_cc.Connected,power=_state.TrackPower,type=_cc.Type,name=_cc.Name,ip=x.Host,port=x.Port,connectionString=$"{x.Host}:{x.Port}"});
        await BroadcastPower();
        await BroadcastStatus();
        foreach(var item in _runtime.RuntimeSnapshot())await Broadcast(item.Type,item.Data);
    }
    public Task BroadcastStatus()=>Broadcast("dccExStatus",Status());
    private object Status()=>new{version=_state.Station.Version,processor=_state.Station.Processor,hardware=_state.Station.Hardware,build=_state.Station.Build,host=_cc.Endpoint,port=0,alive=_cc.Connected,maxLocos=_state.Station.MaxLocos,trackVoltageOn=_state.TrackPower,mainCurrentMa=_state.Tracks.GetValueOrDefault(0)?.CurrentMa??0,progCurrentMa=_state.Tracks.GetValueOrDefault(1)?.CurrentMa??0,tracks=_state.Tracks.OrderBy(x=>x.Key).Select(x=>new{letter=((char)('A'+x.Key)).ToString(),mode=x.Value.Mode,currentMa=x.Value.CurrentMa,overload=x.Value.Overload,tripMa=x.Value.TripMa}),hub=new{platform=Environment.OSVersion.Platform.ToString(),framework=Environment.Version.ToString(),wsClients=ClientCount}};
    public Task BroadcastPowerState()=>BroadcastPower();
    private Task BroadcastPower()=>Broadcast("powerInfo",new{emergencyStop=_state.EmergencyStop,trackVoltageOn=_state.TrackPower,trackVoltageOff=!_state.TrackPower,shortCircuit=false,programmingModeActive=_state.ProgrammingPower,programmingJoined=_state.ProgrammingJoined});
    private Task BroadcastLoco(LocoFeedback l)=>Broadcast("locoState",new{loco=new{address=l.Address,speed=l.Speed,direction=l.Forward?"forward":"reverse",functionsMask=l.FunctionsMask}});

    private async Task SendSnapshot(WebSocket ws){await SendCommandCenterInfo(ws);await SendPower(ws);await Send(ws,"dccExStatus",Status());foreach(var l in _state.Locos.Values)await Send(ws,"locoState",new{loco=new{address=l.Address,speed=l.Speed,direction=l.Forward?"forward":"reverse",functionsMask=l.FunctionsMask}});foreach(var item in _runtime.RuntimeSnapshot())await Send(ws,item.Type,item.Data);}
    private Task SendCommandCenterInfo(WebSocket ws)
    {
        var x=_ccConfig.Current;
        return Send(ws,"commandCenterInfo",new{alive=_cc.Connected,power=_state.TrackPower,type=_cc.Type,name=_cc.Name,ip=x.Host,port=x.Port,connectionString=$"{x.Host}:{x.Port}"});
    }
    private Task SendPower(WebSocket ws)=>Send(ws,"powerInfo",new{emergencyStop=_state.EmergencyStop,trackVoltageOn=_state.TrackPower,trackVoltageOff=!_state.TrackPower,shortCircuit=false,programmingModeActive=_state.ProgrammingPower,programmingJoined=_state.ProgrammingJoined});
    public async Task Broadcast(string type,object data){foreach(var kv in _clients.ToArray()){try{await Send(kv.Value,type,data);}catch{_clients.TryRemove(kv.Key,out _);}}}
    private static async Task Send(WebSocket ws,string type,object data){if(ws.State!=WebSocketState.Open)return;var bytes=JsonSerializer.SerializeToUtf8Bytes(new{type,data},Json);await ws.SendAsync(bytes,WebSocketMessageType.Text,true,CancellationToken.None);}
    private static int I(JsonElement d,string n)=>d.ValueKind==JsonValueKind.Object&&d.TryGetProperty(n,out var x)&&x.TryGetInt32(out var v)?v:0;
    private static int IOr(JsonElement d,string n,int fallback)=>d.ValueKind==JsonValueKind.Object&&d.TryGetProperty(n,out var x)&&x.TryGetInt32(out var v)?v:fallback;
    private static bool B(JsonElement d,string n)=>d.ValueKind==JsonValueKind.Object&&d.TryGetProperty(n,out var x)&&x.ValueKind==JsonValueKind.True;
    private static string S(JsonElement d,string n)=>d.ValueKind==JsonValueKind.Object&&d.TryGetProperty(n,out var x)?x.GetString()??"":"";
}
