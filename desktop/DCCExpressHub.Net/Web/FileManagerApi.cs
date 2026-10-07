namespace DCCExpressHub.Net.Web;

public sealed record HubFileDownload(
    string FilePath,
    string ContentType,
    bool EnableRangeProcessing = true);

public sealed record HubFileDownloadResult(
    HubApiResponse? Error,
    HubFileDownload? File)
{
    public static HubFileDownloadResult FromFile(
        string filePath,
        string contentType) =>
        new(
            null,
            new HubFileDownload(
                filePath,
                contentType));

    public static HubFileDownloadResult FromError(
        HubApiResponse error) =>
        new(
            error,
            null);
}

public sealed class FileManagerApi
{
    readonly HubFileStorage _files;

    public FileManagerApi(
        HubFileStorage files)
    {
        _files = files;
    }

    public HubApiResponse GetFsInfo()
    {
        var root =
            new DriveInfo(
                Path.GetPathRoot(
                    _files.Root)!);

        var used =
            root.TotalSize -
            root.AvailableFreeSpace;

        return HubApiResponse.Ok(
            new
            {
                total =
                    root.TotalSize,
                used,
                free =
                    root.AvailableFreeSpace
            });
    }

    public HubFileDownloadResult GetFile(
        string? path)
    {
        var full =
            _files.Resolve(
                path);

        if (full is null)
        {
            return HubFileDownloadResult.FromError(
                HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            "Invalid path"
                    }));
        }

        if (!File.Exists(full))
        {
            return HubFileDownloadResult.FromError(
                HubApiResponse.Error(
                    404,
                    new
                    {
                        ok = false,
                        message =
                            "File not found"
                    }));
        }

        return HubFileDownloadResult.FromFile(
            full,
            _files.ContentType(
                full));
    }

    public HubApiResponse List(
        string? path)
    {
        try
        {
            return HubApiResponse.Ok(
                _files.List(
                    path));
        }
        catch (
            DirectoryNotFoundException)
        {
            return HubApiResponse.Error(
                404,
                new
                {
                    ok = false,
                    message =
                        "Directory not found"
                });
        }
    }

    public async Task<HubApiResponse> ReadTextAsync(
        string? path,
        CancellationToken cancellationToken = default)
    {
        var full =
            _files.Resolve(
                path);

        if (full is null)
        {
            return HubApiResponse.Error(
                400,
                new
                {
                    ok = false,
                    message =
                        "Invalid path"
                });
        }

        if (!File.Exists(full))
        {
            return HubApiResponse.Error(
                404,
                new
                {
                    ok = false,
                    message =
                        "File not found"
                });
        }

        return HubApiResponse.Text(
            await File.ReadAllTextAsync(
                full,
                cancellationToken),
            "text/plain; charset=utf-8");
    }

    public async Task<HubApiResponse> UploadAsync(
        string? path,
        string fileName,
        Stream input,
        CancellationToken cancellationToken = default)
    {
        var directory =
            _files.Resolve(
                path,
                allowRoot:
                    false);

        if (directory is null)
        {
            return HubApiResponse.Error(
                400,
                new
                {
                    ok = false,
                    message =
                        "Invalid upload path"
                });
        }

        Directory.CreateDirectory(
            directory);

        var safeName =
            Path.GetFileName(
                fileName);

        if (
            string.IsNullOrWhiteSpace(
                safeName) ||
            safeName.Contains(
                "..",
                StringComparison.Ordinal)
        )
        {
            return HubApiResponse.Error(
                400,
                new
                {
                    ok = false,
                    message =
                        "Invalid upload filename"
                });
        }

        var target =
            Path.GetFullPath(
                Path.Combine(
                    directory,
                    safeName));

        if (
            !FileSystemPath.IsInsideOrEqual(
                target,
                _files.Root)
        )
        {
            return HubApiResponse.Error(
                400,
                new
                {
                    ok = false,
                    message =
                        "Invalid upload target"
                });
        }

        if (
            _files.IsProtected(
                target) ||
            _files.IsManagedConfig(
                target)
        )
        {
            return HubApiResponse.Error(
                403,
                new
                {
                    ok = false,
                    message =
                        "Upload destination is protected or managed"
                });
        }

        await using (
            var output =
                File.Create(
                    target)
        )
        {
            await input.CopyToAsync(
                output,
                cancellationToken);
        }

        return HubApiResponse.Ok(
            new
            {
                ok = true,
                message =
                    $"File uploaded: {path}/{safeName}"
            });
    }

    public HubApiResponse Delete(
        string? path)
    {
        var full =
            _files.Resolve(
                path,
                allowRoot:
                    false);

        if (full is null)
        {
            return HubApiResponse.Error(
                400,
                new
                {
                    ok = false,
                    message =
                        "Invalid path"
                });
        }

        if (
            _files.IsProtected(
                full)
        )
        {
            return HubApiResponse.Error(
                403,
                new
                {
                    ok = false,
                    message =
                        "Path is protected"
                });
        }

        if (File.Exists(full))
        {
            File.Delete(
                full);

            return Deleted();
        }

        if (Directory.Exists(full))
        {
            if (
                Directory
                    .EnumerateFileSystemEntries(
                        full)
                    .Any()
            )
            {
                return HubApiResponse.Error(
                    409,
                    new
                    {
                        ok = false,
                        message =
                            "Directory is not empty"
                    });
            }

            Directory.Delete(
                full);

            return Deleted();
        }

        return HubApiResponse.Error(
            404,
            new
            {
                ok = false,
                message =
                    "Path not found"
            });
    }

    static HubApiResponse Deleted() =>
        HubApiResponse.Ok(
            new
            {
                ok = true,
                message =
                    "Deleted"
            });
}
