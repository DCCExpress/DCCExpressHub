namespace DCCExpressHub.Net.Web;

/// <summary>
/// WebSocket transport used by WsHub. Host implementations adapt their native
/// WebSocket/session type to this small contract.
/// </summary>
public interface IHubWebSocketClient
{
    bool IsConnected { get; }

    IAsyncEnumerable<string> ReadTextMessagesAsync(
        CancellationToken cancellationToken);

    Task SendTextAsync(
        ReadOnlyMemory<byte> utf8Payload,
        CancellationToken cancellationToken);

    Task CloseAsync(
        CancellationToken cancellationToken);
}
