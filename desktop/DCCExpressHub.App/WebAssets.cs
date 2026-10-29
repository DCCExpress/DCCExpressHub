namespace DCCExpressHub.App;

/// <summary>Copies the Vite-built wwwroot assets from the APK into the private app directory.</summary>
internal static class WebAssets
{
    public static async Task<string> PrepareAsync(string contentRoot, CancellationToken ct = default)
    {
#if WINDOWS
        var outputRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        if (!File.Exists(Path.Combine(outputRoot, "index.html")))
            throw new InvalidOperationException("Web UI assets missing from MAUI Windows output. Run build-maui-windows.ps1 first.");
        return outputRoot;
#else
        var destination = Path.Combine(contentRoot, "wwwroot");
        Directory.CreateDirectory(destination);
        var assets = global::Android.App.Application.Context.Assets
            ?? throw new InvalidOperationException("Android AssetManager unavailable.");
        var index = assets.List("wwwroot");
        if (index is null || index.Length == 0)
            throw new InvalidOperationException("Web UI assets are missing. Build web-ui and copy its dist to desktop/DCCExpressHub.Net/wwwroot before building the APK.");

        await CopyDirectory("wwwroot", destination, assets, ct);
        if (!File.Exists(Path.Combine(destination, "index.html")))
            throw new InvalidOperationException("wwwroot/index.html not found in the Android package.");
        return destination;
#endif
    }

#if ANDROID
    private static async Task CopyDirectory(string source, string destination,
        global::Android.Content.Res.AssetManager assets, CancellationToken ct)
    {
        Directory.CreateDirectory(destination);
        foreach (var name in assets.List(source) ?? [])
        {
            ct.ThrowIfCancellationRequested();
            var assetPath = source + "/" + name;
            var outputPath = Path.Combine(destination, name);
            var children = assets.List(assetPath);
            if (children is { Length: > 0 })
            {
                await CopyDirectory(assetPath, outputPath, assets, ct);
                continue;
            }
            await using var input = assets.Open(assetPath);
            await using var output = File.Create(outputPath);
            await input.CopyToAsync(output, ct);
        }
    }
#endif
}
