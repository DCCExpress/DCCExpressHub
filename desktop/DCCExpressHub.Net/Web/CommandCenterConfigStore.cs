using System.Text.Json;

namespace DCCExpressHub.Net.Web;
public sealed record CommandCenterSettings(string Host,int Port,bool PowerIncludesProgramming);
public sealed class CommandCenterConfigStore
{
    readonly string _path; readonly IConfiguration _cfg; readonly object _gate=new();
    CommandCenterSettings _current;
    public CommandCenterConfigStore(IWebHostEnvironment env,IConfiguration cfg)
    {
        _cfg=cfg;_path=Path.Combine(env.ContentRootPath,"data","config","command-center.json");
        _current=Load();
    }
    CommandCenterSettings Load()
    {
        try{
            if(File.Exists(_path)){
                var x=JsonSerializer.Deserialize<CommandCenterSettings>(File.ReadAllText(_path),new JsonSerializerOptions{PropertyNameCaseInsensitive=true});
                if(x!=null&&x.Host.Length>0&&x.Port is >=1 and <=65535)return x;
            }}catch{}
        return new(_cfg["DccEx:Host"]??"127.0.0.1",_cfg.GetValue("DccEx:Port",2560),true);
    }
    public CommandCenterSettings Current{get{lock(_gate)return _current;}}
    public async Task<bool> SaveAsync(CommandCenterSettings x)
    {
        try{
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            var tmp=_path+".tmp";
            await File.WriteAllTextAsync(tmp,JsonSerializer.Serialize(x,new JsonSerializerOptions{WriteIndented=true}));
            File.Move(tmp,_path,true);lock(_gate)_current=x;return true;
        }catch{return false;}
    }
}
