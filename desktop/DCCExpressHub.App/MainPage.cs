using DCCExpressHub.Net;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using Microsoft.Maui.Controls;

namespace DCCExpressHub.App;

public sealed class MainPage : ContentPage
{
    readonly HubStartupSettings _settings = HubStartupSettings.Load();
    readonly Picker _protocol = new() { Title = "Command center" };
    readonly Entry _host = new() { Placeholder = "IP address or hostname" };
    readonly Entry _port = new() { Keyboard = Keyboard.Numeric };
    readonly Entry _serial = new()
    {
#if ANDROID
        Placeholder = "Serial device path (USB requires Android adapter)"
#else
        Placeholder = "COM port (e.g. COM3)"
#endif
    };
    readonly Entry _baud = new() { Keyboard = Keyboard.Numeric };
    readonly Entry _rbus = new() { Keyboard = Keyboard.Numeric };
    readonly Entry _loconetOffset = new() { Keyboard = Keyboard.Numeric };
    readonly Entry _httpPort = new() { Keyboard = Keyboard.Numeric };
    readonly Entry _workspace = new() { Placeholder = "Workspace directory" };
    readonly Switch _lan = new();
    readonly VerticalStackLayout _tcpFields = new() { Spacing = 8 };
    readonly VerticalStackLayout _serialFields = new() { Spacing = 8 };
    readonly Label _status = new() { Text = "Ready to start", TextColor = Colors.LightGray };
    readonly Button _start = new() { Text = "Start HUB", BackgroundColor = Color.FromArgb("#2563EB"), TextColor = Colors.White };
    readonly Label _lanAddress = new() { TextColor = Color.FromArgb("#93C5FD"), FontSize = 13 };
    readonly WebView _browser = new() { IsVisible = false };
    readonly ScrollView _startup = new();
    readonly VerticalStackLayout _config = new() { Spacing = 14 };
    readonly SemaphoreSlim _gate = new(1, 1);
    HubRuntime? _runtime;

    static readonly (string Name, string Id, int Port)[] Protocols =
    [
        ("DCC-EX · TCP", "tcp", 2560),
        ("DCC-EX · Serial (experimental)", "serial", 2560),
        ("Z21 + R-BUS", "z21", 21105),
        ("LocoNet TCP", "loconet", 1234),
        ("LocoNet Serial (experimental)", "loconet-serial", 1234),
        ("Z21 + R-BUS + LocoNet (legacy)", "yamorc7010", 21105)
    ];

    static View Field(string caption, View input) => new VerticalStackLayout
    {
        Spacing = 3,
        Children =
        {
            new Label { Text = caption, TextColor = Color.FromArgb("#94A3B8"), FontSize = 12 },
            input
        }
    };

    static Grid TwoColumns(View left, View right)
    {
        var grid = new Grid
        {
            ColumnSpacing = 14,
            ColumnDefinitions =
            {
                new ColumnDefinition { Width = GridLength.Star },
                new ColumnDefinition { Width = new GridLength(160) }
            }
        };
        grid.Children.Add(left);
        grid.Children.Add(right);
        Grid.SetColumn(right, 1);
        return grid;
    }

    public MainPage()
    {
        BackgroundColor = Color.FromArgb("#0F172A");
        // Explicit colors: Android may default to a light text theme regardless
        // of the page background, making Picker/Entry/Button text unreadable.
        var inputBackground = Color.FromArgb("#1E293B");
        var foreground = Colors.White;
        foreach (var entry in new[] { _host, _port, _serial, _baud, _rbus, _loconetOffset, _httpPort, _workspace })
        {
            entry.TextColor = foreground;
            entry.PlaceholderColor = Color.FromArgb("#94A3B8");
            entry.BackgroundColor = inputBackground;
        }
        _protocol.TextColor = foreground;
        _protocol.TitleColor = Color.FromArgb("#94A3B8");
        _protocol.BackgroundColor = inputBackground;
        _status.TextColor = Color.FromArgb("#CBD5E1");


        foreach (var option in Protocols) _protocol.Items.Add(option.Name);
        _protocol.SelectedIndex = Math.Max(0, Array.FindIndex(Protocols, p => p.Id == _settings.Protocol));
        _host.Text = _settings.TcpHost;
        _port.Text = _settings.TcpPort.ToString();
        _serial.Text = _settings.SerialPort;
        _baud.Text = _settings.SerialBaudRate.ToString();
        _rbus.Text = _settings.RBusOffset.ToString();
        _loconetOffset.Text = _settings.LocoNetSensorOffset.ToString();
        _httpPort.Text = _settings.HttpPort.ToString();
        _workspace.Text = _settings.WorkspaceDirectory;
        _lan.IsToggled = _settings.AllowLan;

        _tcpFields.Children.Add(TwoColumns(
            Field("Host / IP", _host), Field("Command center port", _port)));
        _serialFields.Children.Add(TwoColumns(
            Field("Serial port", _serial), Field("Baud rate", _baud)));

        _protocol.SelectedIndexChanged += (_, _) =>
        {
            if (_protocol.SelectedIndex < 0) return;
            var option = Protocols[_protocol.SelectedIndex];
            // When switching transports update the default port, but preserve custom values on load.
            if (_settings.Protocol != option.Id) _port.Text = option.Port.ToString();
            UpdateConnectionFields();
        };
        UpdateConnectionFields();

        _start.Clicked += async (_, _) => await StartHubAsync();
        _lan.Toggled += (_, _) => RefreshLanAddress();
        _httpPort.TextChanged += (_, _) => RefreshLanAddress();
        RefreshLanAddress();

        _start.HorizontalOptions = LayoutOptions.Start;
        _start.MinimumWidthRequest = 154;
        _start.HeightRequest = 42;
        _start.BackgroundColor = Color.FromArgb("#0369A1");
        _browser.BackgroundColor = Color.FromArgb("#111827");

        // WPF-inspired desktop layout: centered, capped form instead of
        // full-window text entries; the same layout can shrink on tablets.
        _config.Children.Add(new Label
        {
            Text = "DCCEXPRESSHUB",
            TextColor = Color.FromArgb("#F8FAFC"),
            FontAttributes = FontAttributes.Bold,
            FontSize = 26
        });
        _config.Children.Add(new Label
        {
            Text = "Command center and HUB startup",
            TextColor = Color.FromArgb("#94A3B8"),
            FontSize = 13
        });
        _config.Children.Add(new BoxView
        {
            HeightRequest = 1,
            Color = Color.FromArgb("#334155"),
            Margin = new Thickness(0, 7)
        });
        _config.Children.Add(_status);
        _config.Children.Add(Field("Connection protocol", _protocol));
        _config.Children.Add(_tcpFields);
        _config.Children.Add(_serialFields);
        _config.Children.Add(TwoColumns(
            Field("R-BUS sensor offset", _rbus),
            Field("LocoNet sensor offset", _loconetOffset)));
        _config.Children.Add(Field("HUB HTTP port", _httpPort));
#if WINDOWS
        _config.Children.Add(Field("Workspace directory", _workspace));
#endif
        _config.Children.Add(new HorizontalStackLayout
        {
            Spacing = 12,
            Children =
            {
                new Label
                {
                    Text = "Allow other devices on LAN",
                    TextColor = Colors.White,
                    VerticalTextAlignment = TextAlignment.Center
                },
                _lan
            }
        });
#if ANDROID
        _config.Children.Add(new Label
        {
            Text = "Android USB serial needs a native transport adapter. Use TCP/UDP command stations.",
            TextColor = Color.FromArgb("#FBBF24"),
            FontSize = 12
        });
#endif
        _config.Children.Add(_lanAddress);
        _config.Children.Add(_start);

        var panel = new Border
        {
            BackgroundColor = Color.FromArgb("#172033"),
            Stroke = new SolidColorBrush(Color.FromArgb("#334155")),
            StrokeThickness = 1,
            Padding = new Thickness(24),
            Content = _config
        };
        // MaximumWidthRequest keeps the form comfortable at desktop sizes;
        // a single scrollable view can narrow it for tablet/mobile widths.
        panel.MaximumWidthRequest = 640;
        panel.HorizontalOptions = LayoutOptions.Fill;
        var centered = new VerticalStackLayout
        {
            Padding = new Thickness(18, 28),
            Children = { panel }
        };
        _startup.Content = centered;

        var page = new Grid();
        page.Children.Add(_startup);
        page.Children.Add(_browser);
        _browser.IsVisible = false;
        Content = page;
    }

    static string[] GetLanAddresses()
    {
        try
        {
            return NetworkInterface.GetAllNetworkInterfaces()
                .Where(n => n.OperationalStatus == OperationalStatus.Up &&
                            n.NetworkInterfaceType != NetworkInterfaceType.Loopback &&
                            n.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
                .SelectMany(n => n.GetIPProperties().UnicastAddresses)
                .Select(a => a.Address)
                .Where(a => a.AddressFamily == AddressFamily.InterNetwork &&
                            !IPAddress.IsLoopback(a))
                .Select(a => a.ToString())
                .Distinct().ToArray();
        }
        catch { return []; }
    }

    void RefreshLanAddress()
    {
        if (!_lan.IsToggled)
        {
            _lanAddress.Text = "Local only · other devices cannot connect";
            return;
        }
        var port = int.TryParse(_httpPort.Text, out var parsed) ? parsed : 5174;
        var addresses = GetLanAddresses();
        _lanAddress.Text = addresses.Length == 0
            ? "LAN enabled · no active IPv4 address (connect to Wi-Fi)"
            : "Connect from another device: " + string.Join("  ·  ", addresses.Select(ip => $"http://{ip}:{port}"));
    }

    protected override bool OnBackButtonPressed()
    {
        if (_runtime is null) return base.OnBackButtonPressed();
        _ = ConfirmStopAsync();
        return true;
    }

    async Task ConfirmStopAsync()
    {
        if (await DisplayAlert("Stop HUB?", "Stop the running HUB and return to connection settings?", "Stop HUB", "Cancel"))
            await StopHubAsync();
    }

    void UpdateConnectionFields()
    {
        if (_protocol.SelectedIndex < 0) return;
        var id = Protocols[_protocol.SelectedIndex].Id;
        var serial = id is "serial" or "loconet-serial";
        _tcpFields.IsVisible = !serial;
        _serialFields.IsVisible = serial;
        _rbus.IsEnabled = id is "z21" or "yamorc7010";
        _loconetOffset.IsEnabled = id is "loconet" or "loconet-serial" or "yamorc7010";
    }

    void ShowStartup()
    {
        _browser.IsVisible = false;
        _startup.IsVisible = true;
        RefreshLanAddress();
    }

    static int ParsePort(string? value, string name)
    {
        if (!int.TryParse(value, out var port) || port is < 1 or > 65535)
            throw new InvalidOperationException($"{name} must be between 1 and 65535.");
        return port;
    }

    async Task StartHubAsync()
    {
        if (!await _gate.WaitAsync(0)) return;
        _start.IsEnabled = false;
        _status.Text = "Preparing HUB…";
        try
        {
            var protocol = Protocols[_protocol.SelectedIndex].Id;
#if ANDROID
            if (protocol is "serial" or "loconet-serial")
                throw new NotSupportedException("Android USB serial transport is not implemented yet. Select a TCP or UDP command center.");
#endif

            _settings.Protocol = protocol;
            _settings.TcpHost = _host.Text?.Trim() ?? "";
            _settings.TcpPort = ParsePort(_port.Text, "Command center port");
            _settings.SerialPort = _serial.Text?.Trim() ?? "";
            if (!int.TryParse(_baud.Text, out var baudRate) || baudRate is < 300 or > 4000000)
                throw new InvalidOperationException("Invalid serial baud rate.");
            _settings.SerialBaudRate = baudRate;
            _settings.RBusOffset = int.TryParse(_rbus.Text, out var rbus) ? Math.Clamp(rbus, 0, 65375) : 0;
            _settings.LocoNetSensorOffset = int.TryParse(_loconetOffset.Text, out var offset) ? Math.Clamp(offset, 0, 61439) : 0;
            _settings.HttpPort = ParsePort(_httpPort.Text, "HUB HTTP port");
            _settings.AllowLan = _lan.IsToggled;
            var isSerial = protocol is "serial" or "loconet-serial";
            if (isSerial && string.IsNullOrWhiteSpace(_settings.SerialPort))
                throw new InvalidOperationException("Enter the serial port.");
            if (!isSerial && string.IsNullOrWhiteSpace(_settings.TcpHost))
                throw new InvalidOperationException("Enter the command center IP address.");
#if WINDOWS
            if (string.IsNullOrWhiteSpace(_workspace.Text))
                throw new InvalidOperationException("Enter a workspace directory.");
            _settings.WorkspaceDirectory = Path.GetFullPath(
                Environment.ExpandEnvironmentVariables(_workspace.Text.Trim()));
#endif
            _settings.Save();

#if WINDOWS
            var root = _settings.WorkspaceDirectory;
#else
            var root = Path.Combine(FileSystem.AppDataDirectory, "hub");
#endif
            Directory.CreateDirectory(root);
            var webRoot = await WebAssets.PrepareAsync(root);
            var endpoint = $"http://127.0.0.1:{_settings.HttpPort}";
            Environment.SetEnvironmentVariable("DCCEXPRESS_CONTENT_ROOT", root);
            Environment.SetEnvironmentVariable("DCCEXPRESS_WEB_ROOT", webRoot);
            Environment.SetEnvironmentVariable("DCCEXPRESS_HTTP_URL",
                $"http://{(_settings.AllowLan ? "0.0.0.0" : "127.0.0.1")}:{_settings.HttpPort}");
            Environment.SetEnvironmentVariable("CommandCenter__Protocol", protocol);
            Environment.SetEnvironmentVariable("DccEx__Transport", protocol == "serial" ? "Serial" : "Tcp");
            Environment.SetEnvironmentVariable("DccEx__Host", _settings.TcpHost);
            Environment.SetEnvironmentVariable("DccEx__Port", _settings.TcpPort.ToString());
            Environment.SetEnvironmentVariable("DccEx__SerialPort", _settings.SerialPort);
            Environment.SetEnvironmentVariable("DccEx__BaudRate", _settings.SerialBaudRate.ToString());
            Environment.SetEnvironmentVariable("Z21__Host", _settings.TcpHost);
            Environment.SetEnvironmentVariable("Z21__Port", _settings.TcpPort.ToString());
            Environment.SetEnvironmentVariable("Z21__RBusOffset", _settings.RBusOffset.ToString());
            Environment.SetEnvironmentVariable("LocoNet__Host", _settings.TcpHost);
            Environment.SetEnvironmentVariable("LocoNet__LbServerPort", (protocol == "loconet" ? _settings.TcpPort : 1234).ToString());
            Environment.SetEnvironmentVariable("LocoNet__SensorOffset", _settings.LocoNetSensorOffset.ToString());
            Environment.SetEnvironmentVariable("LocoNet__SerialPort", _settings.SerialPort);
            Environment.SetEnvironmentVariable("LocoNet__SerialBaudRate", _settings.SerialBaudRate.ToString());
            Environment.SetEnvironmentVariable("LocoNet__LbServerFeedback", "false");
            Environment.SetEnvironmentVariable("LocoNet__SerialFeedback", (protocol == "loconet-serial").ToString());
            Environment.SetEnvironmentVariable("LocoNet__BinaryFeedback", "false");

            _runtime = new HubRuntime();
            await _runtime.StartAsync();
            _status.Text = "HUB running · " + endpoint;
#if ANDROID
            _browser.Source = new UrlWebViewSource { Url = endpoint + "/#tablet" };
#else
            _browser.Source = new UrlWebViewSource { Url = endpoint + "/" };
#endif
            _startup.IsVisible = false;
            _browser.IsVisible = true;
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

    public Task ShutdownAsync() => StopHubAsync();

    async Task StopHubAsync()
    {
        if (!await _gate.WaitAsync(0)) return;
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
            ShowStartup();
        }
        catch (Exception ex) { _status.Text = "Stop failed: " + ex.Message; }
        finally { _start.IsEnabled = true; _gate.Release(); }
    }
}
