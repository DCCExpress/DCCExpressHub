using Microsoft.Extensions.Logging;

namespace DCCExpressHub.App;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();
        builder.UseMauiApp<App>();
#if ANDROID
        // Keep the embedded browser on the GPU rendering path. MAUI's
        // Android WebView is separate from Chrome and may otherwise inherit
        // a software layer from a parent view on some devices.
        Microsoft.Maui.Handlers.WebViewHandler.Mapper.AppendToMapping("DCCExpressGpuWebView", (handler, view) =>
        {
            var native = handler.PlatformView;
            native.SetLayerType(global::Android.Views.LayerType.Hardware, null);
            native.Settings.DomStorageEnabled = true;
            native.Settings.JavaScriptEnabled = true;
            // Highest renderer binding priority is already Android's default;
            // this does not overclock WebView, but documents our intent.
            native.SetRendererPriorityPolicy(global::Android.Webkit.RendererPriority.Important, false);
        });
#endif
#if DEBUG
        builder.Logging.AddDebug();
#endif
        return builder.Build();
    }
}
