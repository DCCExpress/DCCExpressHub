using DCCExpressHub.Net;

await using var hub = new HubRuntime();
await hub.StartAsync(args);
using var shutdown = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; shutdown.Cancel(); };
try { await Task.Delay(Timeout.InfiniteTimeSpan, shutdown.Token); }
catch (OperationCanceledException) { }
await hub.StopAsync();
