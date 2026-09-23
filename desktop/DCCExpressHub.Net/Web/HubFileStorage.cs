using Microsoft.AspNetCore.StaticFiles;

namespace DCCExpressHub.Net.Web;

public sealed class HubFileStorage
{
    private readonly string _workspaceRoot;
    private readonly string _flashRoot;
    private readonly string _sdRoot;

    private readonly FileExtensionContentTypeProvider _contentTypes =
        new();

    public HubFileStorage(
        IWebHostEnvironment env)
    {
        _workspaceRoot =
            Path.GetFullPath(
                env.ContentRootPath)
                .TrimEnd(
                    Path.DirectorySeparatorChar,
                    Path.AltDirectorySeparatorChar);

        _flashRoot =
            Path.GetFullPath(
                Path.Combine(
                    _workspaceRoot,
                    "data"));

        _sdRoot =
            Path.GetFullPath(
                Path.Combine(
                    _workspaceRoot,
                    "sd"));

        Directory.CreateDirectory(
            _flashRoot);

        Directory.CreateDirectory(
            Path.Combine(
                _flashRoot,
                "config"));

        Directory.CreateDirectory(
            Path.Combine(
                _flashRoot,
                "images"));

        Directory.CreateDirectory(
            Path.Combine(
                _flashRoot,
                "state"));

        // Native Windows SD-card emulation.
        //
        // Firmware virtual paths stay identical:
        //   /sd/audio/horn.mp3
        //
        // while the actual files live here:
        //   <workspace>/sd/audio/horn.mp3
        Directory.CreateDirectory(
            _sdRoot);

        Directory.CreateDirectory(
            Path.Combine(
                _sdRoot,
                "audio"));
    }

    /*
     * Program.cs uses Root only as the security boundary for multipart upload
     * targets and to resolve the containing drive for capacity information.
     *
     * Return the workspace root rather than the flash root so both emulated
     * storage volumes are valid upload targets:
     *
     *   <workspace>/data  -> /flash
     *   <workspace>/sd    -> /sd
     */
    public string Root =>
        _workspaceRoot;

    public string FlashRoot =>
        _flashRoot;

    public string SdRoot =>
        _sdRoot;

    public string? Resolve(
        string? virtualPath,
        bool allowRoot = true)
    {
        var path =
            string.IsNullOrWhiteSpace(
                virtualPath)
                ? "/"
                : virtualPath.Trim();

        path =
            path.Replace(
                '\\',
                '/');

        if (!path.StartsWith('/'))
            path = "/" + path;

        if (path.Contains(
                "..",
                StringComparison.Ordinal))
        {
            return null;
        }

        // Native firmware-compatible SD namespace.
        if (path.Equals(
                "/sd",
                StringComparison.OrdinalIgnoreCase))
        {
            return allowRoot
                ? _sdRoot
                : null;
        }

        if (path.StartsWith(
                "/sd/",
                StringComparison.OrdinalIgnoreCase))
        {
            var relative =
                path[4..];

            return ResolveUnderRoot(
                _sdRoot,
                relative,
                allowRoot);
        }

        // Firmware compatibility:
        //
        //   /flash/foo -> internal LittleFS /foo
        //   /foo       -> legacy callers also address internal LittleFS /foo
        if (path.Equals(
                "/flash",
                StringComparison.OrdinalIgnoreCase))
        {
            return allowRoot
                ? _flashRoot
                : null;
        }

        if (path.StartsWith(
                "/flash/",
                StringComparison.OrdinalIgnoreCase))
        {
            path =
                path[6..];
        }

        var flashRelative =
            path.TrimStart('/');

        return ResolveUnderRoot(
            _flashRoot,
            flashRelative,
            allowRoot);
    }

    private static string? ResolveUnderRoot(
        string root,
        string relativePath,
        bool allowRoot)
    {
        var relative =
            relativePath
                .Replace(
                    '/',
                    Path.DirectorySeparatorChar)
                .TrimStart(
                    Path.DirectorySeparatorChar,
                    Path.AltDirectorySeparatorChar);

        var full =
            Path.GetFullPath(
                Path.Combine(
                    root,
                    relative));

        if (!IsPathInsideOrEqual(
                full,
                root))
        {
            return null;
        }

        if (!allowRoot &&
            string.Equals(
                full,
                root,
                StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return full;
    }

    private static bool IsPathInsideOrEqual(
        string full,
        string root)
    {
        if (string.Equals(
                full,
                root,
                StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return
            full.StartsWith(
                root +
                Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase);
    }

    public static string ToVirtualPath(
        string relativePath) =>
        "/" +
        relativePath
            .Replace(
                '\\',
                '/')
            .TrimStart('/');

    public object List(
        string? virtualPath)
    {
        var requested =
            string.IsNullOrWhiteSpace(
                virtualPath)
                ? "/"
                : virtualPath!
                    .Trim()
                    .Replace(
                        '\\',
                        '/');

        if (!requested.StartsWith('/'))
            requested = "/" + requested;

        // Match the firmware File Manager virtual root.
        if (requested == "/")
        {
            return new
            {
                path = "/",

                entries =
                    new object[]
                    {
                        new
                        {
                            name = "Internal Flash",
                            path = "/flash",
                            type = "directory",
                            size = 0L,
                            deleteAllowed = false
                        },

                        new
                        {
                            name = "SD Card (emulated)",
                            path = "/sd",
                            type = "directory",
                            size = 0L,
                            deleteAllowed = false
                        }
                    }
            };
        }

        var isSd =
            requested.Equals(
                "/sd",
                StringComparison.OrdinalIgnoreCase) ||
            requested.StartsWith(
                "/sd/",
                StringComparison.OrdinalIgnoreCase);

        var isFlashPrefix =
            requested.Equals(
                "/flash",
                StringComparison.OrdinalIgnoreCase) ||
            requested.StartsWith(
                "/flash/",
                StringComparison.OrdinalIgnoreCase);

        var full =
            Resolve(
                requested);

        if (full is null ||
            !Directory.Exists(full))
        {
            throw new DirectoryNotFoundException(
                requested);
        }

        var root =
            isSd
                ? _sdRoot
                : _flashRoot;

        var entries =
            Directory
                .EnumerateFileSystemEntries(
                    full)
                .Select(
                    physicalPath =>
                    {
                        var isDirectory =
                            Directory.Exists(
                                physicalPath);

                        var name =
                            Path.GetFileName(
                                physicalPath);

                        var relative =
                            Path.GetRelativePath(
                                root,
                                physicalPath);

                        var relativeVirtual =
                            ToVirtualPath(
                                relative);

                        string responsePath;

                        if (isSd)
                        {
                            responsePath =
                                "/sd" +
                                relativeVirtual;
                        }
                        else if (isFlashPrefix)
                        {
                            responsePath =
                                "/flash" +
                                relativeVirtual;
                        }
                        else
                        {
                            responsePath =
                                relativeVirtual;
                        }

                        long size =
                            isDirectory
                                ? 0
                                : new FileInfo(
                                    physicalPath)
                                    .Length;

                        return (object)new
                        {
                            name,
                            path = responsePath,
                            type =
                                isDirectory
                                    ? "directory"
                                    : "file",
                            size,

                            deleteAllowed =
                                !IsProtected(
                                    physicalPath)
                        };
                    })
                .OrderBy(
                    item =>
                        ((dynamic)item).type ==
                        "directory"
                            ? 0
                            : 1)
                .ThenBy(
                    item =>
                        ((dynamic)item).name)
                .ToArray();

        return new
        {
            path = requested,
            available = true,
            entries
        };
    }

    public bool IsProtected(
        string full)
    {
        // Only internal flash has protected Hub runtime files.
        // The emulated SD is user storage and is intentionally writable.
        if (!IsPathInsideOrEqual(
                Path.GetFullPath(full),
                _flashRoot))
        {
            return false;
        }

        var relative =
            Path.GetRelativePath(
                    _flashRoot,
                    full)
                .Replace(
                    '\\',
                    '/');

        return
            relative.Equals(
                ".",
                StringComparison.OrdinalIgnoreCase) ||

            relative.Equals(
                "assets",
                StringComparison.OrdinalIgnoreCase) ||

            relative.StartsWith(
                "assets/",
                StringComparison.OrdinalIgnoreCase) ||

            relative.Equals(
                "index.html",
                StringComparison.OrdinalIgnoreCase) ||

            relative.Equals(
                "state",
                StringComparison.OrdinalIgnoreCase) ||

            relative.StartsWith(
                "state/",
                StringComparison.OrdinalIgnoreCase);
    }

    public bool IsManagedConfig(
        string full)
    {
        if (!IsPathInsideOrEqual(
                Path.GetFullPath(full),
                _flashRoot))
        {
            return false;
        }

        var relative =
            Path.GetRelativePath(
                    _flashRoot,
                    full)
                .Replace(
                    '\\',
                    '/');

        return
            relative is
                "config/layout.json" or
                "config/locos.json" or
                "config/signal-logic.ndjson" or
                "config/automations.json" or
                "config/device-config.json";
    }

    public string ContentType(
        string path) =>
        _contentTypes
            .TryGetContentType(
                path,
                out var contentType)
            ? contentType
            : "application/octet-stream";
}
