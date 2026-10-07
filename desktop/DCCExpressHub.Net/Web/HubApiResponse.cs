namespace DCCExpressHub.Net.Web;

public enum HubApiBodyKind
{
    Json,
    Text
}

/// <summary>
/// Transport-neutral API result. HTTP server adapters decide how the status
/// code, body and content type are written to the client.
/// </summary>
public sealed record HubApiResponse(
    int StatusCode,
    object Body,
    HubApiBodyKind BodyKind = HubApiBodyKind.Json,
    string ContentType = "application/json")
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

    public static HubApiResponse Text(
        string body,
        string contentType = "text/plain",
        int statusCode = 200) =>
        new(
            statusCode,
            body,
            HubApiBodyKind.Text,
            contentType);
}
