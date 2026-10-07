namespace DCCExpressHub.Net.Web;

/// <summary>
/// Transport-neutral API result. HTTP/WebSocket adapters decide how the
/// status code and body are written to the client.
/// </summary>
public sealed record HubApiResponse(
    int StatusCode,
    object Body)
{
    public static HubApiResponse Ok(
        object body) =>
        new(
            200,
            body);

    public static HubApiResponse Error(
        int statusCode,
        object body) =>
        new(
            statusCode,
            body);
}
