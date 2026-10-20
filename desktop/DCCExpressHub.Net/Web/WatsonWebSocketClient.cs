using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text;
using WatsonWebserver.Core.WebSockets;

namespace DCCExpressHub.Net.Web;

/// <summary>
/// Watson 7 WebSocket transport adapter for WsHub.
/// </summary>
public sealed class WatsonWebSocketClient : IHubWebSocketClient
{
    readonly WebSocketSession _session;

    public WatsonWebSocketClient(
        WebSocketSession session)
    {
        _session = session;
    }

    public bool IsConnected =>
        _session.IsConnected;

    public async IAsyncEnumerable<string> ReadTextMessagesAsync(
        [EnumeratorCancellation]
        CancellationToken cancellationToken)
    {
        await foreach (
            var message in
                _session.ReadMessagesAsync(
                    cancellationToken)
        )
        {
            if (
                message.MessageType ==
                WebSocketMessageType.Text
            )
            {
                yield return
                    message.Text ?? "";
            }
        }
    }

    public Task SendTextAsync(
        ReadOnlyMemory<byte> utf8Payload,
        CancellationToken cancellationToken) =>
        _session.SendTextAsync(
            Encoding.UTF8.GetString(
                utf8Payload.Span),
            cancellationToken);

    public Task CloseAsync(
        CancellationToken cancellationToken) =>
        _session.CloseAsync(
            WebSocketCloseStatus.NormalClosure,
            "bye",
            cancellationToken);
}
