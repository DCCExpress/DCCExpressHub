using Microsoft.AspNetCore.StaticFiles;

namespace DCCExpressHub.Net.Web;

public sealed class HubFileStorage
{
    private readonly string _root;
    private readonly FileExtensionContentTypeProvider _contentTypes = new();

    public HubFileStorage(IWebHostEnvironment env)
    {
        _root = Path.GetFullPath(Path.Combine(env.ContentRootPath, "data"));
        Directory.CreateDirectory(_root);
        Directory.CreateDirectory(Path.Combine(_root, "config"));
        Directory.CreateDirectory(Path.Combine(_root, "images"));
        Directory.CreateDirectory(Path.Combine(_root, "state"));
    }

    public string Root => _root;

    public string? Resolve(string? virtualPath, bool allowRoot = true)
    {
        var path = string.IsNullOrWhiteSpace(virtualPath) ? "/" : virtualPath.Trim();
        path = path.Replace('\\', '/');
        if (!path.StartsWith('/')) path = "/" + path;
        if (path.Contains("..", StringComparison.Ordinal)) return null;

        // Firmware compatibility:
        // /flash/foo -> internal LittleFS /foo
        // /foo       -> old callers also address internal LittleFS /foo
        if (path.Equals("/flash", StringComparison.OrdinalIgnoreCase))
            path = "/";
        else if (path.StartsWith("/flash/", StringComparison.OrdinalIgnoreCase))
            path = path[6..];

        // .NET backend has no SD card yet.
        if (path.Equals("/sd", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/sd/", StringComparison.OrdinalIgnoreCase))
            return null;

        var relative = path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        var full = Path.GetFullPath(Path.Combine(_root, relative));
        if (!full.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(full, _root, StringComparison.OrdinalIgnoreCase))
            return null;
        if (!allowRoot && string.Equals(full, _root, StringComparison.OrdinalIgnoreCase))
            return null;
        return full;
    }

    public static string ToVirtualPath(string relativePath)
        => "/" + relativePath.Replace('\\', '/').TrimStart('/');

    public object List(string? virtualPath)
    {
        var requested = string.IsNullOrWhiteSpace(virtualPath) ? "/" : virtualPath!.Trim();

        // Match the current firmware File Manager virtual root.
        if (requested == "/")
        {
            return new
            {
                path = "/",
                entries = new object[]
                {
                    new { name="Internal Flash", path="/flash", type="directory", size=0L, deleteAllowed=false },
                    new { name="SD Card (not present)", path="/sd", type="directory", size=0L, deleteAllowed=false }
                }
            };
        }

        if (requested.Equals("/sd", StringComparison.OrdinalIgnoreCase) ||
            requested.StartsWith("/sd/", StringComparison.OrdinalIgnoreCase))
        {
            return new { path=requested, available=false, message="SD card is not available", entries=Array.Empty<object>() };
        }

        var full = Resolve(requested);
        if (full is null || !Directory.Exists(full))
            throw new DirectoryNotFoundException(requested);

        var entries = Directory.EnumerateFileSystemEntries(full)
            .Select(p =>
            {
                var isDir = Directory.Exists(p);
                var name = Path.GetFileName(p);
                var rel = Path.GetRelativePath(_root, p);
                var oldVirtual = ToVirtualPath(rel);
                var responsePath = requested.StartsWith("/flash", StringComparison.OrdinalIgnoreCase)
                    ? "/flash" + oldVirtual
                    : oldVirtual;
                long size = isDir ? 0 : new FileInfo(p).Length;
                return (object)new
                {
                    name,
                    path = responsePath,
                    type = isDir ? "directory" : "file",
                    size,
                    deleteAllowed = !IsProtected(p)
                };
            })
            .OrderBy(x => ((dynamic)x).type == "directory" ? 0 : 1)
            .ThenBy(x => ((dynamic)x).name)
            .ToArray();

        return new { path=requested, entries };
    }

    public bool IsProtected(string full)
    {
        var rel = Path.GetRelativePath(_root, full).Replace('\\','/');
        return rel.Equals(".", StringComparison.OrdinalIgnoreCase)
            || rel.Equals("assets", StringComparison.OrdinalIgnoreCase)
            || rel.StartsWith("assets/", StringComparison.OrdinalIgnoreCase)
            || rel.Equals("index.html", StringComparison.OrdinalIgnoreCase)
            || rel.Equals("state", StringComparison.OrdinalIgnoreCase)
            || rel.StartsWith("state/", StringComparison.OrdinalIgnoreCase);
    }

    public bool IsManagedConfig(string full)
    {
        var rel = Path.GetRelativePath(_root, full).Replace('\\','/');
        return rel is "config/layout.json" or "config/locos.json" or
               "config/signal-logic.ndjson" or "config/automations.json" or
               "config/device-config.json";
    }

    public string ContentType(string path)
        => _contentTypes.TryGetContentType(path, out var ct) ? ct : "application/octet-stream";
}
