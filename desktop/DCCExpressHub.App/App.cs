namespace DCCExpressHub.App;

public sealed class App : Application
{
    protected override Window CreateWindow(IActivationState? activationState)
    {
        var page = new MainPage();
        var window = new Window(page);
#if WINDOWS
        window.Title = "DCCExpress HUB";
        window.Width = 1280;
        window.Height = 820;
        window.Destroying += async (_, _) => await page.ShutdownAsync();
#endif
        return window;
    }
}
