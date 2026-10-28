using System.Net.Http;
using DCCExpressHub.Net;
using Microsoft.Maui.Controls;

namespace DCCExpressHub.Android;

public sealed class MainPage : ContentPage
{
    private readonly Label _status = new() { Text = "HUB stopped", VerticalTextAlignment = TextAlignment.Center };
    private readonly Button _start = new() { Text = "Start HUB" };
    private readonly Button _stop = new() { Text = "Stop", IsEnabled = false };
    private readonly Button _reload = new() { Text = "Reload UI", IsEnabled = false };
    private readonly WebView _browser = new() { IsVisible = false };
    private readonly SemaphoreSlim _gate = new(1, 1);
    private HubRuntime? _runtime;

    public MainPage()
    {
        Title = "DCCExpress HUB";
        _start.Clicked += async (_, _) => await StartHubAsync();
        _stop.Clicked += async (_, _) => await StopHubAsync();
        _reload.Clicked += (_, _) => _browser.Reload();
        var toolbar = new HorizontalStackLayout { Spacing = 8, Padding = new Thickness(12, 8) };
        toolbar.Children.Add(_start);
        toolbar.Children.Add(_stop);
        toolbar.Children.Add(_reload);
        var page = new Grid
        {
            RowDefinitions = { new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star) }
        };
        page.Add(toolbar, 0, 0);
        page.Add(_status, 0, 1);
        page.Add(_browser, 0, 2);
        Content = page;
    }

    private async Task StartHubAsync()
    {
        if (!await _gate.WaitAsync(0)) return;
        _start.IsEnabled = false;
        _status.Text = "Preparing local HUB files…";
        try
        {
            var root = Path.Combine(FileSystem.AppDataDirectory, "hub");
            var webRoot = Path.Combine(root, "wwwroot");
            Directory.CreateDirectory(webRoot);
            // Packaged wwwroot is copied once per install/update from Android assets.
            await AndroidWebAssets.ExtractAsync(webRoot);
            Environment.SetEnvironmentVariable("DCCEXPRESS_CONTENT_ROOT", root);
            Environment.SetEnvironmentVariable("DCCEXPRESS_WEB_ROOT", webRoot);
            Environment.SetEnvironmentVariable("DCCEXPRESS_HTTP_URL", "http://127.0.0.1:5174");

            _runtime = new HubRuntime();
            await _runtime.StartAsync();
            _status.Text = "HUB running · http://127.0.0.1:5174";
            _browser.Source = new UrlWebViewSource { Url = "http://127.0.0.1:5174/#tablet" };
            _browser.IsVisible = true;
            _stop.IsEnabled = true;
            _reload.IsEnabled = true;
        }
        catch (Exception ex)
        {
            _status.Text = "HUB startup failed: " + ex.Message;
            if (_runtime is not null)
            {
                await _runtime.DisposeAsync();
                _runtime = null;
            }
            _start.IsEnabled = true;
        }
        finally { _gate.Release(); }
    }

    private async Task StopHubAsync()
    {
        if (!await _gate.WaitAsync(0)) return;
        _stop.IsEnabled = false;
        _reload.IsEnabled = false;
        try
        {
            _browser.IsVisible = false;
            _browser.Source = null;
            if (_runtime is not null)
            {
                await _runtime.DisposeAsync();
                _runtime = null;
            }
            _status.Text = "HUB stopped";
        }
        catch (Exception ex) { _status.Text = "Stop failed: " + ex.Message; }
        finally
        {
            _start.IsEnabled = true;
            _gate.Release();
        }
    }
}
