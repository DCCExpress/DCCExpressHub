namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Cross-platform serial-port naming rules used by the backend.
///
/// Windows DCC-EX USB devices use COMx names. Unix-like systems expose serial
/// devices below /dev (for example /dev/ttyUSB0, /dev/ttyACM0 or
/// /dev/serial/by-id/...).
/// </summary>
public static class SerialPortName
{
    public static string PlatformDefault =>
        OperatingSystem.IsWindows()
            ? "COM3"
            : OperatingSystem.IsMacOS()
                ? "/dev/cu.usbserial"
                : "/dev/ttyUSB0";

    public static bool IsValidForCurrentPlatform(
        string? value)
    {
        if (!BasicValidation(value))
            return false;

        var text =
            value!.Trim();

        return OperatingSystem.IsWindows()
            ? IsWindowsName(text)
            : IsUnixDevicePath(text);
    }

    /// <summary>
    /// Used only when recognizing legacy configuration where the transport was
    /// encoded in the old host field. Accept both naming families so old files
    /// can still be identified before current-platform normalization.
    /// </summary>
    public static bool LooksLikeSerialPort(
        string? value)
    {
        if (!BasicValidation(value))
            return false;

        var text =
            value!.Trim();

        return
            IsWindowsName(text) ||
            IsUnixDevicePath(text);
    }

    static bool BasicValidation(
        string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return false;

        var text =
            value.Trim();

        if (text.Length > 512)
            return false;

        foreach (var c in text)
        {
            if (char.IsControl(c))
                return false;
        }

        return true;
    }

    static bool IsWindowsName(
        string text)
    {
        if (
            text.StartsWith(
                @"\\.\",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            text =
                text[4..];
        }

        if (
            !text.StartsWith(
                "COM",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return false;
        }

        return
            int.TryParse(
                text[3..],
                out var number) &&
            number > 0;
    }

    static bool IsUnixDevicePath(
        string text)
    {
        if (
            !text.StartsWith(
                "/dev/",
                StringComparison.Ordinal)
        )
        {
            return false;
        }

        try
        {
            var full =
                Path.GetFullPath(
                    text);

            if (
                !full.StartsWith(
                    "/dev/",
                    StringComparison.Ordinal)
            )
            {
                return false;
            }

            var relative =
                full[
                    "/dev/".Length..];

            return
                relative.Length > 0 &&
                !relative
                    .Split(
                        Path.DirectorySeparatorChar,
                        StringSplitOptions.RemoveEmptyEntries)
                    .Any(
                        part =>
                            part == "..");
        }
        catch
        {
            return false;
        }
    }
}
