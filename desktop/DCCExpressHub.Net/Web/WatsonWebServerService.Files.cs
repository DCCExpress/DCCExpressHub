using WatsonWebserver;
using WatsonWebserver.Core;
using WatsonHttpMethod = WatsonWebserver.Core.HttpMethod;

namespace DCCExpressHub.Net.Web;

public sealed partial class WatsonWebServerService
{
    void RegisterFileRoutes(
        Webserver server)
    {
        Add(server, WatsonHttpMethod.GET, "/api/backup/workspace", async ctx =>
        {
            try
            {
                var bytes = WorkspaceBackupService.Export(_paths.ContentRootPath);
                ctx.Response.ContentType = "application/zip";
                ctx.Response.Headers["Content-Disposition"] =
                    "attachment; filename=\"dccexpresshub-workspace.zip\"";
                await ctx.Response.Send(bytes, ctx.Token);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Workspace export failed");
                await SendAsync(ctx, HubApiResponse.Error(500,
                    new { ok = false, message = ex.Message }));
            }
        });

        Add(server, WatsonHttpMethod.POST, "/api/backup/workspace", async ctx =>
        {
            try
            {
                var bytes = await ctx.Request.ReadBodyAsync(ctx.Token) ?? Array.Empty<byte>();
                WorkspaceBackupService.Stage(_paths.ContentRootPath, bytes);
                await SendAsync(ctx, HubApiResponse.Ok(new
                {
                    ok = true,
                    restartRequired = true,
                    message = "Full workspace restore staged. Restart the backend to apply it."
                }));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Workspace restore staging rejected");
                await SendAsync(ctx, HubApiResponse.Error(400,
                    new { ok = false, message = ex.Message }));
            }
        });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/fsinfo",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<FileManagerApi>()
                        .GetFsInfo());
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/storage/file",
            StorageFileAsync);

        Add(
            server,
            WatsonHttpMethod.GET,
            "/list",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    Service<FileManagerApi>()
                        .List(
                            Query(
                                ctx,
                                "path")));
            });

        Add(
            server,
            WatsonHttpMethod.GET,
            "/api/files/text",
            async ctx =>
            {
                await SendAsync(
                    ctx,
                    await Service<FileManagerApi>()
                        .ReadTextAsync(
                            Query(
                                ctx,
                                "path"),
                            ctx.Token));
            });

        Add(
            server,
            WatsonHttpMethod.POST,
            "/upload",
            UploadAsync);

        Add(
            server,
            WatsonHttpMethod.DELETE,
            "/delete",
            DeleteAsync);

        Add(
            server,
            WatsonHttpMethod.GET,
            "/delete",
            DeleteAsync);
    }

    async Task StorageFileAsync(
        HttpContextBase ctx)
    {
        var result =
            Service<FileManagerApi>()
                .GetFile(
                    Query(
                        ctx,
                        "path"));

        if (result.Error is not null)
        {
            await SendAsync(
                ctx,
                result.Error);

            return;
        }

        var file =
            result.File!;

        await SendPhysicalFileAsync(
            ctx,
            file.FilePath,
            file.ContentType,
            file.EnableRangeProcessing);
    }


    async Task UploadAsync(
        HttpContextBase ctx)
    {
        if (
            string.IsNullOrWhiteSpace(
                ctx.Request.ContentType) ||
            !ctx.Request.ContentType.StartsWith(
                "multipart/form-data",
                StringComparison.OrdinalIgnoreCase)
        )
        {
            await SendAsync(
                ctx,
                HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            "multipart/form-data required"
                    }));

            return;
        }

        var body =
            await ctx.Request
                .ReadBodyAsync(
                    ctx.Token) ??
            Array.Empty<byte>();

        var part =
            MultipartFormData
                .TryReadFirstFile(
                    ctx.Request.ContentType,
                    body);

        if (part is null)
        {
            await SendAsync(
                ctx,
                HubApiResponse.Error(
                    400,
                    new
                    {
                        ok = false,
                        message =
                            "No uploaded file received"
                    }));

            return;
        }

        using var input =
            part.OpenReadStream();

        await SendAsync(
            ctx,
            await Service<FileManagerApi>()
                .UploadAsync(
                    Query(
                        ctx,
                        "path"),
                    part.FileName,
                    input,
                    ctx.Token));
    }


    async Task DeleteAsync(
        HttpContextBase ctx)
    {
        await SendAsync(
            ctx,
            Service<FileManagerApi>()
                .Delete(
                    Query(
                        ctx,
                        "path")));
    }


}
