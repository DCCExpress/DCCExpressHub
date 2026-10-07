using System.Text.Json;

namespace DCCExpressHub.Net.Web;

public sealed class ScriptInfoApi
{
    readonly ScriptInfoStore _store;

    public ScriptInfoApi(
        ScriptInfoStore store)
    {
        _store = store;
    }

    public HubApiResponse Get() =>
        HubApiResponse.Ok(
            new
            {
                items =
                    _store.Snapshot()
            });

    public async Task<HubApiResponse> UpdateAsync(
        Stream input,
        CancellationToken cancellationToken = default)
    {
        JsonDocument document;

        try
        {
            document =
                await JsonDocument.ParseAsync(
                    input,
                    cancellationToken:
                        cancellationToken);
        }
        catch
        {
            return JsonObjectExpected();
        }

        using (document)
        {
            if (
                document.RootElement.ValueKind !=
                    JsonValueKind.Object
            )
            {
                return JsonObjectExpected();
            }

            var root =
                document.RootElement;

            var executionId =
                root.TryGetProperty(
                    "executionId",
                    out var executionIdElement) &&
                executionIdElement.ValueKind ==
                    JsonValueKind.String
                    ? executionIdElement.GetString() ?? ""
                    : "";

            var ownerId =
                root.TryGetProperty(
                    "ownerId",
                    out var ownerIdElement) &&
                ownerIdElement.ValueKind ==
                    JsonValueKind.String
                    ? ownerIdElement.GetString() ?? ""
                    : "";

            var message =
                root.TryGetProperty(
                    "message",
                    out var messageElement) &&
                messageElement.ValueKind ==
                    JsonValueKind.String
                    ? messageElement.GetString() ?? ""
                    : "";

            var force =
                root.TryGetProperty(
                    "force",
                    out var forceElement) &&
                forceElement.ValueKind ==
                    JsonValueKind.True;

            var result =
                _store.Update(
                    executionId,
                    ownerId,
                    message,
                    force);

            if (!result.ok)
            {
                return HubApiResponse.Error(
                    result.status,
                    new
                    {
                        ok = false,
                        message =
                            result.error
                    });
            }

            return message.Length == 0
                ? HubApiResponse.Ok(
                    new
                    {
                        ok = true,
                        cleared =
                            result.cleared
                    })
                : HubApiResponse.Ok(
                    new
                    {
                        ok = true
                    });
        }
    }

    public (
        Guid Id,
        System.Threading.Channels.ChannelReader<(
            string EventName,
            object Data)> Reader) Subscribe() =>
        _store.Subscribe();

    public void Unsubscribe(
        Guid id) =>
        _store.Unsubscribe(
            id);

    static HubApiResponse JsonObjectExpected() =>
        HubApiResponse.Error(
            400,
            new
            {
                ok = false,
                message =
                    "JSON object expected"
            });
}
