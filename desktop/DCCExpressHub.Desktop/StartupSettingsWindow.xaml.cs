using System.IO;
using System.IO.Ports;
using System.Net.Sockets;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Microsoft.Win32;

namespace DCCExpressHub.Desktop;

public partial class StartupSettingsWindow : Window
{
    private DesktopSettings _settings;
    private bool _initializing;

    public DesktopSettings Settings => _settings;

    public StartupSettingsWindow(
        DesktopSettings settings,
        string version)
    {
        InitializeComponent();

        _initializing = true;
        _settings = settings.Clone();
        _settings.Language =
            DesktopLocalization.NormalizeLanguage(
                _settings.Language);

        VersionText.Text = $"v{version}";

        TcpHostText.Text = _settings.TcpHost;
        TcpPortText.Text = _settings.TcpPort.ToString();
        HttpPortText.Text = _settings.HttpPort.ToString();
        WorkspaceText.Text = _settings.WorkspaceDirectory;

        LocalModeRadio.IsChecked =
            _settings.RunMode != "server";
        ServerModeRadio.IsChecked =
            _settings.RunMode == "server";

        RefreshSerialPorts(_settings.SerialPort);
        SelectLanguage(_settings.Language);
        SelectProtocol(_settings.Protocol);

        _initializing = false;

        ApplyLanguage();
        UpdateProtocolPanels();
    }

    private string L(string key) =>
        DesktopLocalization.T(
            _settings.Language,
            key);

    private string SelectedProtocol =>
        (ProtocolCombo.SelectedItem as ComboBoxItem)?
            .Tag?
            .ToString() ?? "";

    private string SelectedLanguage =>
        DesktopLocalization.NormalizeLanguage(
            (LanguageCombo.SelectedItem as ComboBoxItem)?
                .Tag?
                .ToString());

    private void SelectLanguage(string language)
    {
        var normalized =
            DesktopLocalization.NormalizeLanguage(
                language);

        foreach (var item in
                 LanguageCombo.Items.OfType<ComboBoxItem>())
        {
            if (string.Equals(
                    item.Tag?.ToString() ?? "",
                    normalized,
                    StringComparison.OrdinalIgnoreCase))
            {
                LanguageCombo.SelectedItem = item;
                return;
            }
        }

        LanguageCombo.SelectedIndex = 0;
    }

    private void LanguageCombo_SelectionChanged(
        object sender,
        SelectionChangedEventArgs e)
    {
        if (_initializing)
            return;

        _settings.Language =
            SelectedLanguage;

        ApplyLanguage();

        ValidationText.Text = "";
        HideTestResult();
    }

    private void ApplyLanguage()
    {
        Title = L("windowTitle");

        SubtitleText.Text =
            L("subtitle");

        LanguageLabelText.Text =
            L("language");

        ConnectionTitleText.Text =
            L("connectionTitle");

        ConnectionDescriptionText.Text =
            L("connectionDescription");

        ProtocolLabelText.Text =
            L("protocol");

        ProtocolChooseItem.Content =
            L("choose");

        TcpHostLabelText.Text =
            L("tcpHost");

        TcpPortLabelText.Text =
            L("port");

        SerialPortLabelText.Text =
            L("serialPort");

        RefreshSerialButton.Content =
            L("refresh");

        TestButton.Content =
            L("testConnection");

        WebServerTitleText.Text =
            L("webServerTitle");

        WebServerDescriptionText.Text =
            L("webServerDescription");

        LocalModeRadio.Content =
            L("localMode");

        ServerModeRadio.Content =
            L("serverMode");

        HttpPortLabelText.Text =
            L("httpPort");

        WorkspaceTitleText.Text =
            L("workspaceTitle");

        WorkspaceDescriptionText.Text =
            L("workspaceDescription");

        BrowseWorkspaceButton.Content =
            L("browse");

        FooterHintText.Text =
            L("footerHint");

        CancelButton.Content =
            L("cancel");

        OkButton.Content =
            L("okStart");
    }

    private void SelectProtocol(string protocol)
    {
        foreach (var item in ProtocolCombo.Items.OfType<ComboBoxItem>())
        {
            if (string.Equals(
                    item.Tag?.ToString() ?? "",
                    protocol,
                    StringComparison.OrdinalIgnoreCase))
            {
                ProtocolCombo.SelectedItem = item;
                return;
            }
        }

        ProtocolCombo.SelectedIndex = 0;
    }

    private void ProtocolCombo_SelectionChanged(
        object sender,
        SelectionChangedEventArgs e)
    {
        UpdateProtocolPanels();
        HideTestResult();
    }

    private void UpdateProtocolPanels()
    {
        var protocol = SelectedProtocol;

        TcpPanel.Visibility =
            protocol == "tcp"
                ? Visibility.Visible
                : Visibility.Collapsed;

        SerialPanel.Visibility =
            protocol == "serial"
                ? Visibility.Visible
                : Visibility.Collapsed;

        TestButton.IsEnabled =
            protocol is "tcp" or "serial";
    }

    private void RefreshSerialButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        RefreshSerialPorts(
            SerialPortCombo.Text);
    }

    private void RefreshSerialPorts(
        string? preferred)
    {
        var selected =
            string.IsNullOrWhiteSpace(preferred)
                ? SerialPortCombo.Text
                : preferred;

        var ports =
            SerialPort
                .GetPortNames()
                .OrderBy(
                    p => p,
                    StringComparer.OrdinalIgnoreCase)
                .ToArray();

        SerialPortCombo.Items.Clear();

        foreach (var port in ports)
            SerialPortCombo.Items.Add(port);

        if (!string.IsNullOrWhiteSpace(selected))
        {
            SerialPortCombo.Text = selected;
        }
        else if (ports.Length > 0)
        {
            SerialPortCombo.SelectedIndex = 0;
        }
    }

    private void BrowseWorkspaceButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog
        {
            Title = L("folderDialogTitle"),
            Multiselect = false
        };

        try
        {
            var current =
                Path.GetFullPath(
                    Environment.ExpandEnvironmentVariables(
                        WorkspaceText.Text.Trim()));

            if (Directory.Exists(current))
                dialog.InitialDirectory = current;
        }
        catch
        {
        }

        if (dialog.ShowDialog(this) == true)
            WorkspaceText.Text =
                dialog.FolderName;
    }

    private async void TestButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        if (!TryReadSettings(
                out var testSettings,
                out var error,
                validateWorkspace: false))
        {
            ShowValidation(error);
            return;
        }

        ValidationText.Text = "";
        TestButton.IsEnabled = false;

        ShowTestResult(
            L("testing"),
            success: null);

        try
        {
            TestResult result =
                testSettings.Protocol == "tcp"
                    ? await TestTcpAsync(testSettings)
                    : await TestSerialAsync(testSettings);

            ShowTestResult(
                result.Message,
                result.Ok);
        }
        catch (Exception ex)
        {
            ShowTestResult(
                L("failed") + ex.Message,
                false);
        }
        finally
        {
            TestButton.IsEnabled =
                SelectedProtocol is
                    "tcp" or
                    "serial";
        }
    }

    private async Task<TestResult> TestTcpAsync(
        DesktopSettings settings)
    {
        using var timeout =
            new CancellationTokenSource(
                TimeSpan.FromSeconds(3));

        using var client =
            new TcpClient
            {
                NoDelay = true
            };

        await client.ConnectAsync(
            settings.TcpHost,
            settings.TcpPort,
            timeout.Token);

        using var stream =
            client.GetStream();

        await stream.WriteAsync(
            Encoding.ASCII.GetBytes("<#>"),
            timeout.Token);

        var reply =
            await ReadHeartbeatAsync(
                stream,
                timeout.Token);

        return reply is null
            ? new(
                false,
                L("tcpNoHeartbeat"))
            : new(
                true,
                L("dccReachable") + reply);
    }

    private static async Task<string?> ReadHeartbeatAsync(
        Stream stream,
        CancellationToken ct)
    {
        var buffer = new byte[512];
        var frame = new StringBuilder();
        bool inside = false;

        while (!ct.IsCancellationRequested)
        {
            int count =
                await stream.ReadAsync(
                    buffer,
                    ct);

            if (count <= 0)
                return null;

            for (int i = 0; i < count; i++)
            {
                var c =
                    (char)buffer[i];

                if (!inside)
                {
                    if (c == '<')
                    {
                        inside = true;
                        frame.Clear();
                        frame.Append(c);
                    }

                    continue;
                }

                if (c == '<')
                {
                    frame.Clear();
                    frame.Append(c);
                    continue;
                }

                frame.Append(c);

                if (c != '>')
                    continue;

                inside = false;

                var reply =
                    frame.ToString();

                frame.Clear();

                if (reply.StartsWith(
                        "<#",
                        StringComparison.Ordinal))
                {
                    return reply;
                }
            }
        }

        return null;
    }

    private Task<TestResult> TestSerialAsync(
        DesktopSettings settings)
    {
        var language =
            _settings.Language;

        return Task.Run(
            () =>
            {
                using var port =
                    new SerialPort(
                        settings.SerialPort,
                        settings.SerialBaudRate,
                        Parity.None,
                        8,
                        StopBits.One)
                    {
                        Handshake = Handshake.None,
                        ReadTimeout = 250,
                        WriteTimeout = 2000
                    };

                port.Open();
                port.DiscardInBuffer();
                port.Write("<#>");

                var deadline =
                    DateTime.UtcNow.AddSeconds(3);

                var frame =
                    new StringBuilder();

                bool inside = false;

                while (DateTime.UtcNow < deadline)
                {
                    try
                    {
                        int value =
                            port.ReadByte();

                        if (value < 0)
                            continue;

                        char c =
                            (char)value;

                        if (!inside)
                        {
                            if (c == '<')
                            {
                                inside = true;
                                frame.Clear();
                                frame.Append(c);
                            }

                            continue;
                        }

                        if (c == '<')
                        {
                            frame.Clear();
                            frame.Append(c);
                            continue;
                        }

                        frame.Append(c);

                        if (c != '>')
                            continue;

                        inside = false;

                        var reply =
                            frame.ToString();

                        frame.Clear();

                        if (reply.StartsWith(
                                "<#",
                                StringComparison.Ordinal))
                        {
                            return new TestResult(
                                true,
                                DesktopLocalization.T(
                                    language,
                                    "dccReachable") +
                                reply);
                        }
                    }
                    catch (TimeoutException)
                    {
                    }
                }

                return new TestResult(
                    false,
                    DesktopLocalization.T(
                        language,
                        "serialNoHeartbeat"));
            });
    }

    private void OkButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        if (!TryReadSettings(
                out var next,
                out var error,
                validateWorkspace: true))
        {
            ShowValidation(error);
            return;
        }

        next.Language =
            SelectedLanguage;

        _settings = next;

        DialogResult = true;
        Close();
    }

    private bool TryReadSettings(
        out DesktopSettings settings,
        out string error,
        bool validateWorkspace)
    {
        settings =
            _settings.Clone();

        settings.Language =
            SelectedLanguage;

        error = "";

        var protocol =
            SelectedProtocol;

        if (protocol is not ("tcp" or "serial"))
        {
            error =
                L("validationChooseProtocol");
            return false;
        }

        if (!int.TryParse(
                HttpPortText.Text.Trim(),
                out var httpPort) ||
            httpPort is < 1 or > 65535)
        {
            error =
                L("validationHttpPort");
            return false;
        }

        settings.Protocol = protocol;
        settings.HttpPort = httpPort;
        settings.RunMode =
            ServerModeRadio.IsChecked == true
                ? "server"
                : "local";

        if (protocol == "tcp")
        {
            var host =
                TcpHostText.Text.Trim();

            if (host.Length == 0 ||
                host.Any(char.IsWhiteSpace))
            {
                error =
                    L("validationTcpHost");
                return false;
            }

            if (!int.TryParse(
                    TcpPortText.Text.Trim(),
                    out var port) ||
                port is < 1 or > 65535)
            {
                error =
                    L("validationTcpPort");
                return false;
            }

            settings.TcpHost = host;
            settings.TcpPort = port;
        }
        else
        {
            var serialPort =
                SerialPortCombo.Text.Trim();

            if (serialPort.Length == 0)
            {
                error =
                    L("validationSerialPort");
                return false;
            }

            settings.SerialPort =
                serialPort;

            settings.SerialBaudRate =
                115200;
        }

        if (validateWorkspace)
        {
            var workspace =
                WorkspaceText.Text.Trim();

            if (workspace.Length == 0)
            {
                error =
                    L("validationWorkspace");
                return false;
            }

            try
            {
                workspace =
                    Path.GetFullPath(
                        Environment.ExpandEnvironmentVariables(
                            workspace));

                var appBase =
                    Path.GetFullPath(
                        AppContext.BaseDirectory)
                        .TrimEnd(
                            Path.DirectorySeparatorChar,
                            Path.AltDirectorySeparatorChar);

                var normalizedWorkspace =
                    workspace.TrimEnd(
                        Path.DirectorySeparatorChar,
                        Path.AltDirectorySeparatorChar);

                if (
                    string.Equals(
                        normalizedWorkspace,
                        appBase,
                        StringComparison.OrdinalIgnoreCase) ||
                    normalizedWorkspace.StartsWith(
                        appBase +
                        Path.DirectorySeparatorChar,
                        StringComparison.OrdinalIgnoreCase)
                )
                {
                    error =
                        L("validationWorkspaceInBuild");
                    return false;
                }

                Directory.CreateDirectory(
                    workspace);
            }
            catch (Exception ex)
            {
                error =
                    L("validationWorkspaceInvalid") +
                    ex.Message;
                return false;
            }

            settings.WorkspaceDirectory =
                workspace;
        }

        return true;
    }

    private void ShowValidation(
        string message)
    {
        ValidationText.Text =
            message;
    }

    private void HideTestResult()
    {
        TestStatusBorder.Visibility =
            Visibility.Collapsed;
    }

    private void ShowTestResult(
        string message,
        bool? success)
    {
        TestStatusText.Text =
            message;

        if (success == true)
        {
            TestStatusBorder.Background =
                new SolidColorBrush(
                    Color.FromRgb(
                        20,
                        83,
                        45));

            TestStatusBorder.BorderBrush =
                new SolidColorBrush(
                    Color.FromRgb(
                        34,
                        197,
                        94));

            TestStatusText.Foreground =
                new SolidColorBrush(
                    Color.FromRgb(
                        187,
                        247,
                        208));
        }
        else if (success == false)
        {
            TestStatusBorder.Background =
                new SolidColorBrush(
                    Color.FromRgb(
                        76,
                        29,
                        35));

            TestStatusBorder.BorderBrush =
                new SolidColorBrush(
                    Color.FromRgb(
                        244,
                        63,
                        94));

            TestStatusText.Foreground =
                new SolidColorBrush(
                    Color.FromRgb(
                        254,
                        205,
                        211));
        }
        else
        {
            TestStatusBorder.Background =
                new SolidColorBrush(
                    Color.FromRgb(
                        16,
                        36,
                        58));

            TestStatusBorder.BorderBrush =
                new SolidColorBrush(
                    Color.FromRgb(
                        40,
                        81,
                        114));

            TestStatusText.Foreground =
                new SolidColorBrush(
                    Color.FromRgb(
                        186,
                        230,
                        253));
        }

        TestStatusBorder.Visibility =
            Visibility.Visible;
    }

    private void CancelButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }

    private void TitleBar_MouseLeftButtonDown(
        object sender,
        MouseButtonEventArgs e)
    {
        if (e.ButtonState ==
            MouseButtonState.Pressed)
        {
            DragMove();
        }
    }

    private readonly record struct TestResult(
        bool Ok,
        string Message);
}
