using System.Text;
using System.Text.Json;
using WatsonWebserver.Core;
using WatsonHttpMethod = WatsonWebserver.Core.HttpMethod;

namespace DCCExpressHub.Net.Web;

public sealed partial class WatsonWebServerService
{
    async Task DefaultRouteAsync(
        HttpContextBase ctx)
    {
        var requestPath =
            NormalizeRequestPath(
                ctx.Request.Url
                    .RawWithoutQuery);

        if (
            requestPath.StartsWith(
                "/api/",
                StringComparison.OrdinalIgnoreCase) ||
            requestPath.Equals(
                "/api",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            await SendAsync(
                ctx,
                HubApiResponse.Error(
                    404,
                    new
                    {
                        ok = false,
                        error =
                            "api_endpoint_not_found",
                        path =
                            requestPath
                    }));

            return;
        }

        if (
            ctx.Request.Method is not
                WatsonHttpMethod.GET and not
                WatsonHttpMethod.HEAD
        )
        {
            ctx.Response.StatusCode =
                404;

            await ctx.Response.Send(
                "Not found",
                ctx.Token);

            return;
        }

        var publicFile =
            ResolvePublicFile(
                requestPath);

        if (
            publicFile is not null &&
            File.Exists(
                publicFile)
        )
        {
            await SendPhysicalFileAsync(
                ctx,
                publicFile,
                Service<HubFileStorage>()
                    .ContentType(
                        publicFile),
                true);

            return;
        }

        var index =
            Path.Combine(
                _paths.WebRootPath,
                "index.html");

        if (File.Exists(index))
        {
            await SendPhysicalFileAsync(
                ctx,
                index,
                "text/html; charset=utf-8",
                false);

            return;
        }

        ctx.Response.StatusCode =
            200;

        ctx.Response.ContentType =
            "text/plain; charset=utf-8";

        await ctx.Response.Send(
            "DCCExpressHub .NET is running. Copy the built React UI into wwwroot/.",
            ctx.Token);
    }

    async Task SendPhysicalFileAsync(
        HttpContextBase ctx,
        string physicalPath,
        string contentType,
        bool enableRanges)
    {
        var file =
            new FileInfo(
                physicalPath);

        if (!file.Exists)
        {
            ctx.Response.StatusCode =
                404;

            await ctx.Response.Send(
                "Not found",
                ctx.Token);

            return;
        }

        ctx.Response.ContentType =
            contentType;

        if (enableRanges)
        {
            ctx.Response.Headers[
                "Accept-Ranges"] =
                "bytes";
        }

        var rangeHeader =
            enableRanges
                ? ctx.Request
                    .RetrieveHeaderValue(
                        "Range")
                : null;

        if (
            enableRanges &&
            !string.IsNullOrWhiteSpace(
                rangeHeader)
        )
        {
            if (
                !TryParseSingleRange(
                    rangeHeader,
                    file.Length,
                    out var start,
                    out var end)
            )
            {
                ctx.Response.StatusCode =
                    416;

                ctx.Response.Headers[
                    "Content-Range"] =
                    $"bytes */{file.Length}";

                await ctx.Response.Send(
                    Array.Empty<byte>(),
                    ctx.Token);

                return;
            }

            var count =
                end -
                start +
                1;

            ctx.Response.StatusCode =
                206;

            ctx.Response.Headers[
                "Content-Range"] =
                $"bytes {start}-{end}/{file.Length}";

            await using var stream =
                new FileStream(
                    physicalPath,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.Read,
                    64 * 1024,
                    FileOptions.Asynchronous |
                    FileOptions.SequentialScan);

            stream.Seek(
                start,
                SeekOrigin.Begin);

            await ctx.Response.Send(
                count,
                stream,
                ctx.Token);

            return;
        }

        ctx.Response.StatusCode =
            200;

        if (
            ctx.Request.Method ==
            WatsonHttpMethod.HEAD
        )
        {
            ctx.Response.Headers[
                "Content-Length"] =
                file.Length.ToString();

            await ctx.Response.Send(
                Array.Empty<byte>(),
                ctx.Token);

            return;
        }

        await using var fullStream =
            new FileStream(
                physicalPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                64 * 1024,
                FileOptions.Asynchronous |
                FileOptions.SequentialScan);

        await ctx.Response.Send(
            file.Length,
            fullStream,
            ctx.Token);
    }

    async Task SendAsync(
        HttpContextBase ctx,
        HubApiResponse response)
    {
        ctx.Response.StatusCode =
            response.StatusCode;

        ctx.Response.ContentType =
            response.ContentType;

        if (
            response.BodyKind ==
            HubApiBodyKind.Text
        )
        {
            await ctx.Response.Send(
                response.Body as string ??
                "",
                ctx.Token);

            return;
        }

        ctx.Response.ContentType =
            "application/json";

        var body =
            response.Body is null
                ? Encoding.UTF8.GetBytes(
                    "null")
                : JsonSerializer
                    .SerializeToUtf8Bytes(
                        response.Body,
                        response.Body.GetType(),
                        Json);

        await ctx.Response.Send(
            body,
            ctx.Token);
    }

    static async Task<MemoryStream> ReadBodyStreamAsync(
        HttpContextBase ctx)
    {
        var body =
            await ctx.Request
                .ReadBodyAsync(
                    ctx.Token) ??
            Array.Empty<byte>();

        return new MemoryStream(
            body,
            writable:
                false);
    }

    static bool IsUrlEncodedForm(
        HttpContextBase ctx) =>
        !string.IsNullOrWhiteSpace(
            ctx.Request.ContentType) &&
        ctx.Request.ContentType.StartsWith(
            "application/x-www-form-urlencoded",
            StringComparison.OrdinalIgnoreCase);

    static async Task<Dictionary<string, string>>
        ReadUrlEncodedFormAsync(
            HttpContextBase ctx)
    {
        var body =
            await ctx.Request
                .ReadBodyAsync(
                    ctx.Token) ??
            Array.Empty<byte>();

        var text =
            Encoding.UTF8.GetString(
                body);

        var result =
            new Dictionary<string, string>(
                StringComparer.OrdinalIgnoreCase);

        foreach (
            var pair in
                text.Split(
                    '&',
                    StringSplitOptions
                        .RemoveEmptyEntries)
        )
        {
            var equals =
                pair.IndexOf(
                    '=');

            var rawKey =
                equals >= 0
                    ? pair[..equals]
                    : pair;

            var rawValue =
                equals >= 0
                    ? pair[
                        (equals + 1)..]
                    : "";

            var key =
                DecodeFormValue(
                    rawKey);

            if (key.Length == 0)
                continue;

            result[key] =
                DecodeFormValue(
                    rawValue);
        }

        return result;
    }

    static string DecodeFormValue(
        string value) =>
        Uri.UnescapeDataString(
            value.Replace(
                '+',
                ' '));

    static string Get(
        IReadOnlyDictionary<string, string> values,
        string key) =>
        values.TryGetValue(
            key,
            out var value)
                ? value
                : "";

    static string? Optional(
        IReadOnlyDictionary<string, string> values,
        string key) =>
        values.TryGetValue(
            key,
            out var value)
                ? value
                : null;

    static long? DeclaredLength(
        HttpContextBase ctx) =>
        ctx.Request.ContentLength > 0
            ? ctx.Request.ContentLength
            : null;

    static string? Query(
        HttpContextBase ctx,
        string key)
    {
        try
        {
            return
                ctx.Request
                    .RetrieveQueryValue(
                        key);
        }
        catch
        {
            return null;
        }
    }

    string? ResolvePublicFile(
        string requestPath)
    {
        if (
            requestPath.Equals(
                "/",
                StringComparison.Ordinal)
        )
        {
            return Path.Combine(
                _paths.WebRootPath,
                "index.html");
        }

        if (
            requestPath.Equals(
                "/flash",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return null;
        }

        if (
            requestPath.StartsWith(
                "/flash/",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return ResolveUnderRoot(
                _paths.DataRootPath,
                requestPath[
                    "/flash/".Length..]);
        }

        if (
            requestPath.Equals(
                "/sd",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return null;
        }

        if (
            requestPath.StartsWith(
                "/sd/",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return ResolveUnderRoot(
                _paths.SdRootPath,
                requestPath[
                    "/sd/".Length..]);
        }

        if (
            requestPath.Equals(
                "/images",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return null;
        }

        if (
            requestPath.StartsWith(
                "/images/",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return ResolveUnderRoot(
                Path.Combine(
                    _paths.DataRootPath,
                    "images"),
                requestPath[
                    "/images/".Length..]);
        }

        return ResolveUnderRoot(
            _paths.WebRootPath,
            requestPath
                .TrimStart('/'));
    }

    static string? ResolveUnderRoot(
        string root,
        string relative)
    {
        try
        {
            relative =
                Uri.UnescapeDataString(
                    relative)
                    .Replace(
                        '/',
                        Path.DirectorySeparatorChar)
                    .TrimStart(
                        Path.DirectorySeparatorChar,
                        Path.AltDirectorySeparatorChar);

            if (
                relative.Contains(
                    "..",
                    StringComparison.Ordinal)
            )
            {
                return null;
            }

            var fullRoot =
                Path.GetFullPath(
                    root)
                    .TrimEnd(
                        Path.DirectorySeparatorChar,
                        Path.AltDirectorySeparatorChar);

            var full =
                Path.GetFullPath(
                    Path.Combine(
                        fullRoot,
                        relative));

            return
                FileSystemPath.IsInsideOrEqual(
                    full,
                    fullRoot)
                    ? full
                    : null;
        }
        catch
        {
            return null;
        }
    }

    static string NormalizeRequestPath(
        string? path)
    {
        if (
            string.IsNullOrWhiteSpace(
                path)
        )
        {
            return "/";
        }

        var result =
            path.Replace(
                '\\',
                '/');

        if (!result.StartsWith('/'))
            result =
                "/" + result;

        return result;
    }

    static bool TryParseSingleRange(
        string value,
        long length,
        out long start,
        out long end)
    {
        start = 0;
        end = 0;

        if (
            length <= 0 ||
            string.IsNullOrWhiteSpace(
                value) ||
            !value.StartsWith(
                "bytes=",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            return false;
        }

        var raw =
            value[
                "bytes=".Length..]
                .Trim();

        if (
            raw.Contains(
                ',')
        )
        {
            return false;
        }

        var dash =
            raw.IndexOf(
                '-');

        if (dash < 0)
            return false;

        var startText =
            raw[..dash]
                .Trim();

        var endText =
            raw[
                (dash + 1)..]
                .Trim();

        if (startText.Length == 0)
        {
            if (
                !long.TryParse(
                    endText,
                    out var suffixLength) ||
                suffixLength <= 0
            )
            {
                return false;
            }

            suffixLength =
                Math.Min(
                    suffixLength,
                    length);

            start =
                length -
                suffixLength;

            end =
                length -
                1;

            return true;
        }

        if (
            !long.TryParse(
                startText,
                out start) ||
            start < 0 ||
            start >= length
        )
        {
            return false;
        }

        if (endText.Length == 0)
        {
            end =
                length -
                1;

            return true;
        }

        if (
            !long.TryParse(
                endText,
                out end) ||
            end < start
        )
        {
            return false;
        }

        end =
            Math.Min(
                end,
                length -
                1);

        return true;
    }


}
