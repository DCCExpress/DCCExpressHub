using DCCExpressHub.Net;

await using var hub = new HubRuntime();
await hub.StartAsync(args);
await hub.WaitForShutdownAsync();
