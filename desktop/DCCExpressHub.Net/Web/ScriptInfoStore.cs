using System.Collections.Concurrent;
using System.Threading.Channels;

namespace DCCExpressHub.Net.Web;

public sealed record ScriptInfoItem(string executionId,string ownerId,string message);

public sealed class ScriptInfoStore
{
    public const int MaxEntries=32, MaxExecutionIdLength=128, MaxOwnerIdLength=192, MaxMessageLength=512;
    readonly object _gate=new();
    readonly Dictionary<string,ScriptInfoItem> _items=new(StringComparer.Ordinal);
    readonly ConcurrentDictionary<Guid,Channel<(string EventName,object Data)>> _subscribers=new();

    public ScriptInfoItem[] Snapshot(){lock(_gate)return _items.Values.ToArray();}

    public (bool ok,int status,string? error,bool cleared) Update(string executionId,string ownerId,string message,bool force)
    {
        executionId=(executionId??"").Trim(); ownerId=(ownerId??"").Trim(); message??="";
        if(executionId.Length==0||executionId.Length>MaxExecutionIdLength)return(false,400,"Invalid executionId",false);
        if(ownerId.Length==0||ownerId.Length>MaxOwnerIdLength)return(false,400,"Invalid ownerId",false);
        if(message.Length>MaxMessageLength)return(false,413,"Script info message is too long",false);

        ScriptInfoItem? changed=null; bool cleared=false;
        lock(_gate){
            _items.TryGetValue(executionId,out var existing);
            if(message.Length==0){
                if(existing!=null&&(force||existing.ownerId==ownerId)){
                    _items.Remove(executionId); cleared=true;
                    changed=new(executionId,ownerId,"");
                }
            }else{
                if(existing==null&&_items.Count>=MaxEntries)return(false,507,"Script info runtime store is full",false);
                changed=new(executionId,ownerId,message); _items[executionId]=changed;
            }
        }
        if(changed!=null)Broadcast("changed",changed);
        return(true,200,null,cleared);
    }

    public (Guid Id,ChannelReader<(string EventName,object Data)> Reader) Subscribe()
    {
        var id=Guid.NewGuid();
        var c=Channel.CreateUnbounded<(string,object)>();
        _subscribers[id]=c;
        c.Writer.TryWrite(("snapshot",new{items=Snapshot()}));
        return(id,c.Reader);
    }
    public void Unsubscribe(Guid id){if(_subscribers.TryRemove(id,out var c))c.Writer.TryComplete();}
    void Broadcast(string eventName,object data){foreach(var c in _subscribers.Values)c.Writer.TryWrite((eventName,data));}
}
