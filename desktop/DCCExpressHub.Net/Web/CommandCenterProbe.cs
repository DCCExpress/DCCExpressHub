using System.Buffers.Binary;
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
    public static async Task<CommandCenterProbeResult> ProbeZ21Async(
        string host,
        int port,
        CancellationToken requestCt)
    {
        var sw =
            Stopwatch.StartNew();

        IPAddress? address = null;

        try
        {
            using var resolveCts =
                CancellationTokenSource
                    .CreateLinkedTokenSource(
                        requestCt);

            resolveCts.CancelAfter(1200);

            if (IPAddress.TryParse(
                    host,
                    out var literal))
            {
                address = literal;
            }
            else
            {
                var addresses =
                    await Dns.GetHostAddressesAsync(
                        host,
                        resolveCts.Token);

                address =
                    addresses.FirstOrDefault(
                        x =>
                            x.AddressFamily ==
                            AddressFamily.InterNetwork) ??
                    addresses.FirstOrDefault();
            }
        }
        catch
        {
            return new(
                false,
                false,
                false,
                "",
                sw.ElapsedMilliseconds);
        }

        if (address is null)
        {
            return new(
                false,
                false,
                false,
                "",
                sw.ElapsedMilliseconds);
        }

        using var totalCts =
            CancellationTokenSource
                .CreateLinkedTokenSource(
                    requestCt);

        totalCts.CancelAfter(
            TimeSpan.FromMilliseconds(
                Math.Max(
                    1,
                    2200 -
                    sw.ElapsedMilliseconds)));

        using var udp =
            new UdpClient(
                address.AddressFamily);

        try
        {
            udp.Connect(
                new IPEndPoint(
                    address,
                    port));

            // LAN_SYSTEMSTATE_GETDATA:
            // DataLen=4, Header=0x0085.
            var request =
                new byte[]
                {
                    0x04,
                    0x00,
                    0x85,
                    0x00
                };

            await udp.SendAsync(
                request,
                request.Length);

            while (!totalCts.IsCancellationRequested)
            {
                var datagram =
                    await udp.ReceiveAsync(
                        totalCts.Token);

                var buffer =
                    datagram.Buffer;

                var offset = 0;

                while (offset + 4 <= buffer.Length)
                {
                    var dataLen =
                        BinaryPrimitives
                            .ReadUInt16LittleEndian(
                                buffer.AsSpan(
                                    offset,
                                    2));

                    if (dataLen < 4 ||
                        offset + dataLen > buffer.Length)
                    {
                        break;
                    }

                    var header =
                        BinaryPrimitives
                            .ReadUInt16LittleEndian(
                                buffer.AsSpan(
                                    offset + 2,
                                    2));

                    if (header == 0x0084)
                    {
                        return new(
                            true,
                            true,
                            true,
                            "Z21 LAN system-state reply",
                            sw.ElapsedMilliseconds);
                    }

                    offset += dataLen;
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
        }

        return new(
            true,
            false,
            false,
            "",
            sw.ElapsedMilliseconds);
    }

}
