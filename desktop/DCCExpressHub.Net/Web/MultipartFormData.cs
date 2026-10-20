using System.Text;

namespace DCCExpressHub.Net.Web;

public sealed record MultipartFilePart(
    string FileName,
    byte[] Buffer,
    int Offset,
    int Length)
{
    public Stream OpenReadStream() =>
        new MemoryStream(
            Buffer,
            Offset,
            Length,
            writable:
                false,
            publiclyVisible:
                true);
}

/// <summary>
/// Small multipart/form-data parser for the WebUI's single-file upload
/// contract. It intentionally parses only file parts and leaves all file
/// validation to FileManagerApi.
/// </summary>
public static class MultipartFormData
{
    static readonly byte[] HeaderSeparator =
        Encoding.ASCII.GetBytes(
            "\r\n\r\n");

    public static MultipartFilePart? TryReadFirstFile(
        string? contentType,
        byte[] body)
    {
        var boundary =
            ReadBoundary(
                contentType);

        if (
            string.IsNullOrWhiteSpace(
                boundary) ||
            body.Length == 0
        )
        {
            return null;
        }

        var boundaryBytes =
            Encoding.ASCII.GetBytes(
                "--" + boundary);

        var nextBoundaryPrefix =
            Encoding.ASCII.GetBytes(
                "\r\n--" + boundary);

        var position =
            IndexOf(
                body,
                boundaryBytes,
                0);

        while (
            position >= 0
        )
        {
            var afterBoundary =
                position +
                boundaryBytes.Length;

            if (
                afterBoundary + 1 <
                    body.Length &&
                body[afterBoundary] ==
                    (byte)'-' &&
                body[afterBoundary + 1] ==
                    (byte)'-'
            )
            {
                return null;
            }

            if (
                afterBoundary + 1 >=
                    body.Length ||
                body[afterBoundary] !=
                    (byte)'\r' ||
                body[afterBoundary + 1] !=
                    (byte)'\n'
            )
            {
                return null;
            }

            var headersStart =
                afterBoundary + 2;

            var headersEnd =
                IndexOf(
                    body,
                    HeaderSeparator,
                    headersStart);

            if (headersEnd < 0)
                return null;

            var headers =
                Encoding.UTF8.GetString(
                    body,
                    headersStart,
                    headersEnd -
                    headersStart);

            var contentStart =
                headersEnd +
                HeaderSeparator.Length;

            var contentEnd =
                IndexOf(
                    body,
                    nextBoundaryPrefix,
                    contentStart);

            if (contentEnd < 0)
                return null;

            if (
                TryReadFileName(
                    headers,
                    out var fileName)
            )
            {
                return new MultipartFilePart(
                    fileName,
                    body,
                    contentStart,
                    contentEnd -
                    contentStart);
            }

            position =
                contentEnd + 2;
        }

        return null;
    }

    static string? ReadBoundary(
        string? contentType)
    {
        if (
            string.IsNullOrWhiteSpace(
                contentType)
        )
        {
            return null;
        }

        var parts =
            contentType.Split(
                ';',
                StringSplitOptions
                    .RemoveEmptyEntries |
                StringSplitOptions
                    .TrimEntries);

        if (
            parts.Length == 0 ||
            !parts[0].Equals(
                "multipart/form-data",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return null;
        }

        foreach (
            var part in
                parts.Skip(1)
        )
        {
            if (
                !part.StartsWith(
                    "boundary=",
                    StringComparison.OrdinalIgnoreCase)
            )
            {
                continue;
            }

            var value =
                part[
                    "boundary=".Length..]
                    .Trim();

            if (
                value.Length >= 2 &&
                value[0] == '"' &&
                value[^1] == '"'
            )
            {
                value =
                    value[1..^1];
            }

            return
                value.Length == 0
                    ? null
                    : value;
        }

        return null;
    }

    static bool TryReadFileName(
        string headers,
        out string fileName)
    {
        fileName = "";

        foreach (
            var line in
                headers.Split(
                    "\r\n",
                    StringSplitOptions
                        .RemoveEmptyEntries)
        )
        {
            if (
                !line.StartsWith(
                    "Content-Disposition:",
                    StringComparison.OrdinalIgnoreCase)
            )
            {
                continue;
            }

            var pieces =
                line.Split(
                    ';',
                    StringSplitOptions
                        .RemoveEmptyEntries |
                    StringSplitOptions
                        .TrimEntries);

            var isFile =
                pieces.Any(
                    piece =>
                        piece.Equals(
                            "name=\"file\"",
                            StringComparison.OrdinalIgnoreCase));

            if (!isFile)
                continue;

            foreach (
                var piece in
                    pieces)
            {
                if (
                    piece.StartsWith(
                        "filename=",
                        StringComparison.OrdinalIgnoreCase)
                )
                {
                    fileName =
                        Unquote(
                            piece[
                                "filename=".Length..]);

                    return
                        fileName.Length > 0;
                }

                if (
                    piece.StartsWith(
                        "filename*=",
                        StringComparison.OrdinalIgnoreCase)
                )
                {
                    var encoded =
                        Unquote(
                            piece[
                                "filename*=".Length..]);

                    var marker =
                        encoded.IndexOf(
                            "''",
                            StringComparison.Ordinal);

                    if (marker >= 0)
                    {
                        encoded =
                            encoded[
                                (marker + 2)..];
                    }

                    fileName =
                        Uri.UnescapeDataString(
                            encoded);

                    return
                        fileName.Length > 0;
                }
            }
        }

        return false;
    }

    static string Unquote(
        string value)
    {
        value =
            value.Trim();

        if (
            value.Length >= 2 &&
            value[0] == '"' &&
            value[^1] == '"'
        )
        {
            value =
                value[1..^1];
        }

        return value;
    }

    static int IndexOf(
        byte[] data,
        byte[] pattern,
        int start)
    {
        if (
            start < 0 ||
            start >= data.Length ||
            pattern.Length == 0
        )
        {
            return -1;
        }

        var relative =
            data.AsSpan(
                    start)
                .IndexOf(
                    pattern);

        return
            relative < 0
                ? -1
                : start +
                  relative;
    }
}
