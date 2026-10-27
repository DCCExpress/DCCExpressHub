using DCCExpressHub.V2.Runtime;

var webRoot = Environment.GetEnvironmentVariable("DCCEXPRESS_V2_WEBROOT")
    ?? Path.Combine(AppContext.BaseDirectory, "wwwroot");
var host = Environment.GetEnvironmentVariable("DCCEXPRESS_V2_HOST") ?? "127.0.0.1";
var port = int.TryParse(Environment.GetEnvironmentVariable("DCCEXPRESS_V2_PORT"), out var parsed)
    ? parsed : 5180;

await using var hub = new HubRuntime(webRoot);
await hub.StartAsync(host, port);
Console.WriteLine($"DCCExpressHub V2: http://{host}:{port}");
using var shutdown = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; shutdown.Cancel(); };
try { await Task.Delay(Timeout.InfiniteTimeSpan, shutdown.Token); }
catch (OperationCanceledException) { }
await hub.StopAsync();
