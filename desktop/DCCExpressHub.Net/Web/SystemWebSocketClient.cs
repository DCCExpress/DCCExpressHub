using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text;

namespace DCCExpressHub.Net.Web;

/// <summary>
/// Adapter for the current ASP.NET/Kestrel System.Net.WebSockets transport.
/// Kept only while the host is being migrated to Watson.
/// </summary>
public sealed class SystemWebSocketClient : IHubWebSocketClient
{
    readonly WebSocket _socket;

    public SystemWebSocketClient(
        WebSocket socket)
    {
        _socket = socket;
    }

    public bool IsConnected =>
        _socket.State ==
        WebSocketState.Open;

    public async IAsyncEnumerable<string> ReadTextMessagesAsync(
        [EnumeratorCancellation]
        CancellationToken cancellationToken)
    {
        var buffer =
            new byte[64 * 1024];

        while (
            _socket.State ==
            WebSocketState.Open
        )
        {
            using var memory =
                new MemoryStream();

            WebSocketReceiveResult result;

            do
            {
                result =
                    await _socket.ReceiveAsync(
                        buffer,
                        cancellationToken);

                if (
                    result.MessageType ==
                    WebSocketMessageType.Close
                )
                {
                    yield break;
                }

                if (
                    result.MessageType ==
                    WebSocketMessageType.Text
                )
                {
                    memory.Write(
                        buffer,
                        0,
                        result.Count);
                }
            }
            while (
                !result.EndOfMessage
            );

            if (
                result.MessageType !=
                WebSocketMessageType.Text
            )
            {
                continue;
            }

            yield return
                Encoding.UTF8.GetString(
                    memory.ToArray());
        }
    }

    public Task SendTextAsync(
        ReadOnlyMemory<byte> utf8Payload,
        CancellationToken cancellationToken) =>
        _socket.SendAsync(
            utf8Payload,
            WebSocketMessageType.Text,
            true,
            cancellationToken)
            .AsTask();

    public async Task CloseAsync(
        CancellationToken cancellationToken)
    {
        if (
            _socket.State is
                WebSocketState.Open or
                WebSocketState.CloseReceived
        )
        {
            await _socket.CloseAsync(
                WebSocketCloseStatus.NormalClosure,
                "bye",
                cancellationToken);
        }
        else if (
            _socket.State !=
            WebSocketState.Closed
        )
        {
            _socket.Abort();
        }
    }
}
