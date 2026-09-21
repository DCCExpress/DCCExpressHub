using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace DCCExpressHub.Net.Web;

public sealed record CommandCenterProbeResult(bool Resolved,bool TcpConnected,bool DccExAlive,string Reply,long ElapsedMs);

public static class CommandCenterProbe
{
    public static async Task<CommandCenterProbeResult> ProbeDccExAsync(string host,int port,CancellationToken requestCt)
    {
        var sw=Stopwatch.StartNew();
        IPAddress? address=null;
        try
        {
            using(var resolveCts=CancellationTokenSource.CreateLinkedTokenSource(requestCt))
            {
                resolveCts.CancelAfter(1200);
                if(IPAddress.TryParse(host,out var literal)) address=literal;
                else
                {
                    var addresses=await Dns.GetHostAddressesAsync(host,resolveCts.Token);
                    address=addresses.FirstOrDefault(x=>x.AddressFamily==AddressFamily.InterNetwork)
                            ?? addresses.FirstOrDefault();
                }
            }
        }
        catch { return new(false,false,false,"",sw.ElapsedMilliseconds); }
        if(address==null)return new(false,false,false,"",sw.ElapsedMilliseconds);

        using var totalCts=CancellationTokenSource.CreateLinkedTokenSource(requestCt);
        totalCts.CancelAfter(TimeSpan.FromMilliseconds(Math.Max(1,2200-sw.ElapsedMilliseconds)));
        using var tcp=new TcpClient{NoDelay=true};
        try
        {
            using var connectCts=CancellationTokenSource.CreateLinkedTokenSource(totalCts.Token);
            connectCts.CancelAfter(1200);
            await tcp.ConnectAsync(address,port,connectCts.Token);
        }
        catch { return new(true,false,false,"",sw.ElapsedMilliseconds); }

        string reply="";
        try
        {
            var stream=tcp.GetStream();
            await stream.WriteAsync(Encoding.ASCII.GetBytes("<#>"),totalCts.Token);
            var buf=new byte[256];var frame=new StringBuilder(64);bool inside=false;
            while(!totalCts.IsCancellationRequested)
            {
                int n=await stream.ReadAsync(buf,totalCts.Token);
                if(n<=0)break;
                for(int i=0;i<n;i++)
                {
                    char c=(char)buf[i];
                    if(!inside){if(c=='<'){inside=true;frame.Clear();frame.Append(c);}continue;}
                    if(c=='<'){frame.Clear();frame.Append(c);continue;}
                    frame.Append(c);
                    if(c=='>')
                    {
                        inside=false;reply=frame.ToString();
                        if(reply.StartsWith("<#",StringComparison.Ordinal))
                            return new(true,true,true,reply,sw.ElapsedMilliseconds);
                        frame.Clear();
                    }
                    else if(frame.Length>128){inside=false;frame.Clear();}
                }
            }
        }
        catch(OperationCanceledException){}
        catch{}
        return new(true,true,false,reply,sw.ElapsedMilliseconds);
    }
}
