namespace DCCExpressHub.Net.Web;

/// <summary>
/// Application-owned filesystem locations.
///
/// Runtime, automation, storage and command-center services depend on this
/// class instead of ASP.NET hosting abstractions. The current web host only
/// supplies the initial paths; a different web server can construct the same
/// object directly.
/// </summary>
public sealed class AppPaths
{
    public string ContentRootPath { get; }
    public string WebRootPath { get; }

    public string DataRootPath =>
        Path.Combine(ContentRootPath, "data");

    public string ConfigRootPath =>
        Path.Combine(DataRootPath, "config");

    public string StateRootPath =>
        Path.Combine(DataRootPath, "state");

    public string SdRootPath =>
        Path.Combine(ContentRootPath, "sd");

    public AppPaths(
        string contentRootPath,
        string? webRootPath = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(
            contentRootPath);

        ContentRootPath =
            Path.GetFullPath(
                contentRootPath);

        WebRootPath =
            Path.GetFullPath(
                string.IsNullOrWhiteSpace(
                    webRootPath)
                    ? Path.Combine(
                        ContentRootPath,
                        "wwwroot")
                    : webRootPath);
    }
}
