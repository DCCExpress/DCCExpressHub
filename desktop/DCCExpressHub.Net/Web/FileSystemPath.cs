namespace DCCExpressHub.Net.Web;

/// <summary>
/// Filesystem path comparison helpers.
///
/// Windows filesystems used by the desktop build are normally case-insensitive,
/// while Linux/macOS paths must be treated case-sensitively for containment
/// checks.
/// </summary>
public static class FileSystemPath
{
    public static StringComparison Comparison =>
        OperatingSystem.IsWindows()
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;

    public static bool Equals(
        string left,
        string right) =>
        string.Equals(
            left,
            right,
            Comparison);

    public static bool IsInsideOrEqual(
        string fullPath,
        string rootPath)
    {
        var full =
            Path.GetFullPath(
                fullPath)
                .TrimEnd(
                    Path.DirectorySeparatorChar,
                    Path.AltDirectorySeparatorChar);

        var root =
            Path.GetFullPath(
                rootPath)
                .TrimEnd(
                    Path.DirectorySeparatorChar,
                    Path.AltDirectorySeparatorChar);

        if (Equals(
                full,
                root))
        {
            return true;
        }

        return full.StartsWith(
            root +
            Path.DirectorySeparatorChar,
            Comparison);
    }
}
