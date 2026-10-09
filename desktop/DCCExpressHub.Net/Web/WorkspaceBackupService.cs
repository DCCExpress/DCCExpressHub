using System.IO.Compression;

namespace DCCExpressHub.Net.Web;

/// <summary>
/// Complete workspace backup. Restore is staged while the server is running
/// and applied before any runtime services are constructed at next startup.
/// </summary>
public static class WorkspaceBackupService
{
    private const long MaxArchiveBytes = 128L * 1024 * 1024;
    private const long MaxExpandedBytes = 512L * 1024 * 1024;
    private const int MaxEntries = 20000;
    private const string PendingName = ".dcc-backup-pending";
    private const string WorkName = ".dcc-backup-staging";
    private const string PreviousName = ".dcc-backup-previous";

    public static byte[] Export(string root)
    {
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
        {
            foreach (var folder in new[] { "data", "sd" })
            {
                var directory = Path.Combine(root, folder);
                zip.CreateEntry(folder + "/");
                if (!Directory.Exists(directory))
                    continue;
                foreach (var file in Directory.EnumerateFiles(
                             directory, "*", SearchOption.AllDirectories))
                {
                    var info = new FileInfo(file);
                    if ((info.Attributes & FileAttributes.ReparsePoint) != 0)
                        throw new InvalidOperationException("Backup cannot follow symbolic links: " + file);
                    var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
                    var entry = zip.CreateEntry(relative, CompressionLevel.Optimal);
                    using var input = File.Open(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                    using var stream = entry.Open();
                    input.CopyTo(stream);
                }
            }
        }
        if (output.Length > MaxArchiveBytes)
            throw new InvalidOperationException("Workspace backup exceeds 128 MB. Use an offline workspace copy.");
        return output.ToArray();
    }

    public static void Stage(string root, byte[] archive)
    {
        if (archive.Length is 0 || archive.LongLength > MaxArchiveBytes)
            throw new InvalidDataException("Invalid backup archive size.");
        var staging = Path.Combine(root, WorkName);
        var pending = Path.Combine(root, PendingName);
        if (Directory.Exists(staging))
            Directory.Delete(staging, true);
        Directory.CreateDirectory(staging);
        try
        {
            using var input = new MemoryStream(archive);
            using var zip = new ZipArchive(input, ZipArchiveMode.Read);
            if (zip.Entries.Count > MaxEntries)
                throw new InvalidDataException("Too many backup files.");
            long expanded = 0;
            var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in zip.Entries)
            {
                var name = entry.FullName.Replace('\\', '/');
                if (name.StartsWith('/') || name.Contains("..", StringComparison.Ordinal) ||
                    name.Contains(':') || name.Contains("//", StringComparison.Ordinal) ||
                    !(name.StartsWith("data/", StringComparison.Ordinal) ||
                      name.StartsWith("sd/", StringComparison.Ordinal)))
                    throw new InvalidDataException("Unsafe backup path: " + name);
                if (!paths.Add(name))
                    throw new InvalidDataException("Duplicate backup path: " + name);
                // Reject symlink entries encoded in Unix ZIP attributes.
                var unixMode = (entry.ExternalAttributes >> 16) & 0xF000;
                if (unixMode == 0xA000)
                    throw new InvalidDataException("Symbolic links are not supported.");
                expanded += entry.Length;
                if (expanded > MaxExpandedBytes)
                    throw new InvalidDataException("Uncompressed backup exceeds 512 MB.");
                var destination = Path.GetFullPath(Path.Combine(
                    staging, name.Replace('/', Path.DirectorySeparatorChar)));
                if (!FileSystemPath.IsInsideOrEqual(destination, staging))
                    throw new InvalidDataException("Backup path escapes staging.");
                if (name.EndsWith('/'))
                {
                    Directory.CreateDirectory(destination);
                    continue;
                }
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                using var source = entry.Open();
                using var target = File.Create(destination);
                source.CopyTo(target);
                if (target.Length != entry.Length)
                    throw new InvalidDataException("Backup file length mismatch.");
            }
            if (!Directory.Exists(Path.Combine(staging, "data")) ||
                !Directory.Exists(Path.Combine(staging, "sd")))
                throw new InvalidDataException("Backup must contain data/ and sd/.");
            if (Directory.Exists(pending))
                Directory.Delete(pending, true);
            Directory.Move(staging, pending);
        }
        catch
        {
            if (Directory.Exists(staging))
                Directory.Delete(staging, true);
            throw;
        }
    }

    public static bool ApplyPendingOnStartup(string root)
    {
        var pending = Path.Combine(root, PendingName);
        if (!Directory.Exists(pending))
            return false;
        var previous = Path.Combine(root, PreviousName);
        if (Directory.Exists(previous))
            throw new InvalidOperationException(
                "Previous backup recovery exists. Resolve it before applying another restore.");
        Directory.CreateDirectory(previous);
        var movedOld = new List<string>();
        var movedNew = new List<string>();
        try
        {
            foreach (var folder in new[] { "data", "sd" })
            {
                var source = Path.Combine(root, folder);
                if (Directory.Exists(source))
                {
                    Directory.Move(source, Path.Combine(previous, folder));
                    movedOld.Add(folder);
                }
            }
            foreach (var folder in new[] { "data", "sd" })
            {
                Directory.Move(Path.Combine(pending, folder), Path.Combine(root, folder));
                movedNew.Add(folder);
            }
            Directory.Delete(pending, true);
            // Keep the last pre-restore workspace for manual recovery.
            return true;
        }
        catch
        {
            foreach (var folder in movedNew)
            {
                var target = Path.Combine(root, folder);
                if (Directory.Exists(target))
                    Directory.Delete(target, true);
            }
            foreach (var folder in movedOld)
                Directory.Move(Path.Combine(previous, folder), Path.Combine(root, folder));
            throw;
        }
    }
}
