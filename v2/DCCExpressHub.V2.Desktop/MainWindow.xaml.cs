using System.IO;
using System.Windows;
using DCCExpressHub.V2.Runtime;

namespace DCCExpressHub.V2.Desktop;

public partial class MainWindow : Window
{
    private HubRuntime? _hub;
    private bool _closing;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Closing += OnClosing;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            var webRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
            _hub = new HubRuntime(webRoot);
            await _hub.StartAsync();
            await Browser.EnsureCoreWebView2Async();
            Browser.Source = new Uri("http://127.0.0.1:5180/");
            StatusText.Visibility = Visibility.Collapsed;
            Browser.Visibility = Visibility.Visible;
        }
        catch (Exception ex)
        {
            StatusText.Text = "Failed to start DCCExpressHub V2:\n" + ex.Message;
            if (_hub is not null)
            {
                await _hub.DisposeAsync();
                _hub = null;
            }
        }
    }

    private async void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (_closing) return;
        e.Cancel = true;
        _closing = true;
        try
        {
            if (_hub is not null)
                await _hub.DisposeAsync();
            _hub = null;
        }
        finally
        {
            Closing -= OnClosing;
            Close();
        }
    }
}
