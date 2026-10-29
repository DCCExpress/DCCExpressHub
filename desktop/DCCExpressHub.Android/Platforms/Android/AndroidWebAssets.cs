namespace DCCExpressHub.Android;

/// <summary>Copies the Vite-built wwwroot assets from the APK into the private app directory.</summary>
internal static class AndroidWebAssets
{
    public static async Task ExtractAsync(string destination, CancellationToken ct = default)
    {
        var assets = global::Android.App.Application.Context.Assets
            ?? throw new InvalidOperationException("Android AssetManager unavailable.");
        var index = assets.List("wwwroot");
        if (index is null || index.Length == 0)
            throw new InvalidOperationException("Web UI assets are missing. Build web-ui and copy its dist to desktop/DCCExpressHub.Net/wwwroot before building the APK.");

        await CopyDirectory("wwwroot", destination, assets, ct);
        if (!File.Exists(Path.Combine(destination, "index.html")))
            throw new InvalidOperationException("wwwroot/index.html not found in the Android package.");
    }

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
}
