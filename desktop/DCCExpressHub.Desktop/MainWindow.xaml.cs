using System.Diagnostics;
using System.IO;
using System.IO.Ports;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace DCCExpressHub.Desktop;

public partial class MainWindow : Window
{
    private const string PidFileName = "dccexpresshub-backend.pid";

    private Process? _backend;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMilliseconds(500) };
    private Mutex? _singleInstanceMutex;
    private DesktopSettings _settings = DesktopSettingsStore.Load();
    private bool _isFullscreen;
    private WindowStyle _previousWindowStyle;
    private WindowState _previousWindowState;
    private ResizeMode _previousResizeMode;
    private Rect _previousBounds;
    private bool _isClosing;
    private bool _backendExpectedStop;
    private bool _restartInProgress;
    private bool _closeApproved;
    private bool _closeDialogActive;
    private string? _backendShutdownToken;

    private bool _initializingSetup;
    private bool _setupBusy;
    private bool _firstLauncherRun;
    private TaskCompletionSource<CloseChoice>? _confirmTcs;
    private ConfirmMode _confirmMode;
    private bool _browserHiddenForConfirm;

    private enum ConfirmMode
    {
        Exit,
        PowerOffFailed
    }

    private enum CloseChoice
    {
        Cancel,
        PowerOffAndExit,
        ExitWithoutPowerOff,
        ExitAnyway
    }

    private int HubPort => _settings.HttpPort;
    private string HubUrl => $"http://127.0.0.1:{HubPort}";
    private string HubListenUrl =>
        _settings.RunMode == "server"
            ? $"http://0.0.0.0:{HubPort}"
            : $"http://127.0.0.1:{HubPort}";

    private string L(string key) =>
        DesktopLocalization.T(
            _settings.Language,
            key);

    private System.Windows.Controls.Button? RestartButton =>
        FindName("RestartBackendButton") as System.Windows.Controls.Button;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Closing += OnClosing;
    }

    private void OnLoaded(
        object sender,
        RoutedEventArgs e)
    {
        try
        {
            _singleInstanceMutex =
                new Mutex(
                    true,
                    @"Local\DCCExpressHub.Desktop",
                    out bool createdNew);

            if (!createdNew)
            {
                throw new InvalidOperationException(
                    L("alreadyRunning"));
            }

            _firstLauncherRun =
                !DesktopSettingsStore.Exists;

            Browser.Visibility =
                Visibility.Collapsed;

            StartupOverlay.Visibility =
                Visibility.Visible;

            StartupText.Text =
                L("checkingBackend");

            KillStaleBackend();

            InitializeSetupPanel();

            StartupOverlay.Visibility =
                Visibility.Collapsed;

            SetupPanel.Visibility =
                Visibility.Visible;
        }
        catch (Exception ex)
        {
            SetupPanel.Visibility =
                Visibility.Collapsed;

            Browser.Visibility =
                Visibility.Collapsed;

            StartupText.Text =
                L("startupError") +
                ex.Message;

            StartupOverlay.Visibility =
                Visibility.Visible;
        }
    }

    private void InitializeSetupPanel()
    {
        _initializingSetup = true;

        _settings.Language =
            DesktopLocalization.NormalizeLanguage(
                _settings.Language);

        VersionText.Text =
            $"v{GetHubVersion()}";

        TcpHostText.Text =
            _settings.TcpHost;

        TcpPortText.Text =
            _settings.TcpPort.ToString();

        HttpPortText.Text =
            _settings.HttpPort.ToString();

        WorkspaceText.Text =
            _settings.WorkspaceDirectory;

        LocalModeRadio.IsChecked =
            _settings.RunMode != "server";

        ServerModeRadio.IsChecked =
            _settings.RunMode == "server";

        RefreshSerialPorts(
            _settings.SerialPort);

        SelectLanguage(
            _settings.Language);

        SelectProtocol(
            _settings.Protocol);

        _initializingSetup = false;

        ApplySetupLanguage();
        UpdateProtocolPanels();
        ValidationText.Text = "";
        HideTestResult();
    }

    private string SelectedProtocol =>
        (ProtocolCombo.SelectedItem as ComboBoxItem)?
            .Tag?
            .ToString() ?? "";

    private string SelectedLanguage =>
        DesktopLocalization.NormalizeLanguage(
            (LanguageCombo.SelectedItem as ComboBoxItem)?
                .Tag?
                .ToString());

    private void SelectLanguage(
        string language)
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
                LanguageCombo.SelectedItem =
                    item;
                return;
            }
        }

        LanguageCombo.SelectedIndex = 0;
    }

    private void LanguageCombo_SelectionChanged(
        object sender,
        SelectionChangedEventArgs e)
    {
        if (_initializingSetup)
            return;

        _settings.Language =
            SelectedLanguage;

        ApplySetupLanguage();

        ValidationText.Text = "";
        HideTestResult();
    }

    private void ApplySetupLanguage()
    {
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

        SetupCancelButton.Content =
            L("cancel");

        StartBackendButton.Content =
            L("okStart");

        if (_confirmMode == ConfirmMode.Exit &&
            ConfirmOverlay.Visibility == Visibility.Visible)
        {
            ConfigureExitConfirm();
        }
        else if (_confirmMode == ConfirmMode.PowerOffFailed &&
                 ConfirmOverlay.Visibility == Visibility.Visible)
        {
            ConfigurePowerOffFailedConfirm();
        }
    }

    private void SelectProtocol(
        string protocol)
    {
        foreach (var item in
                 ProtocolCombo.Items.OfType<ComboBoxItem>())
        {
            if (string.Equals(
                    item.Tag?.ToString() ?? "",
                    protocol,
                    StringComparison.OrdinalIgnoreCase))
            {
                ProtocolCombo.SelectedItem =
                    item;
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
        var protocol =
            SelectedProtocol;

        TcpPanel.Visibility =
            protocol == "tcp"
                ? Visibility.Visible
                : Visibility.Collapsed;

        SerialPanel.Visibility =
            protocol == "serial"
                ? Visibility.Visible
                : Visibility.Collapsed;

        TestButton.IsEnabled =
            !_setupBusy &&
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
            string.IsNullOrWhiteSpace(
                preferred)
                ? SerialPortCombo.Text
                : preferred;

        var ports =
            SerialPort
                .GetPortNames()
                .OrderBy(
                    port => port,
                    StringComparer.OrdinalIgnoreCase)
                .ToArray();

        SerialPortCombo.Items.Clear();

        foreach (var port in ports)
            SerialPortCombo.Items.Add(port);

        if (!string.IsNullOrWhiteSpace(
                selected))
        {
            SerialPortCombo.Text =
                selected;
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
        var dialog =
            new OpenFolderDialog
            {
                Title = L("folderDialogTitle"),
                Multiselect = false
            };

        try
        {
            var current =
                Path.GetFullPath(
                    Environment
                        .ExpandEnvironmentVariables(
                            WorkspaceText.Text.Trim()));

            if (Directory.Exists(current))
                dialog.InitialDirectory = current;
        }
        catch
        {
        }

        if (dialog.ShowDialog(this) == true)
        {
            WorkspaceText.Text =
                dialog.FolderName;
        }
    }

    private async void TestButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        if (_setupBusy)
            return;

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
                    ? await TestTcpAsync(
                        testSettings)
                    : await TestSerialAsync(
                        testSettings);

            ShowTestResult(
                result.Message,
                result.Ok);
        }
        catch (Exception ex)
        {
            ShowTestResult(
                L("failed") +
                ex.Message,
                false);
        }
        finally
        {
            TestButton.IsEnabled =
                !_setupBusy &&
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
            ? new TestResult(
                false,
                L("tcpNoHeartbeat"))
            : new TestResult(
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

            for (int i = 0;
                 i < count;
                 i++)
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
                        115200,
                        Parity.None,
                        8,
                        StopBits.One)
                    {
                        Handshake = Handshake.None,
                        ReadTimeout = 250,
                        WriteTimeout = 2000,
                        DtrEnable = false,
                        RtsEnable = false
                    };

                port.Open();

                // Keep the startup test aligned with the backend's stable
                // Serial transport: allow USB CDC / Arduino-class boards to
                // settle after opening before the first DCC-EX command.
                Thread.Sleep(1200);

                try
                {
                    port.DiscardInBuffer();
                    port.DiscardOutBuffer();
                }
                catch
                {
                }

                port.Write("<#>");

                var deadline =
                    DateTime.UtcNow
                        .AddSeconds(3);

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

        if (protocol is not
            ("tcp" or "serial"))
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
                        Environment
                            .ExpandEnvironmentVariables(
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

    private void SetSetupBusy(
        bool busy)
    {
        _setupBusy = busy;

        ProtocolCombo.IsEnabled = !busy;
        LanguageCombo.IsEnabled = !busy;
        TcpHostText.IsEnabled = !busy;
        TcpPortText.IsEnabled = !busy;
        SerialPortCombo.IsEnabled = !busy;
        RefreshSerialButton.IsEnabled = !busy;
        LocalModeRadio.IsEnabled = !busy;
        ServerModeRadio.IsEnabled = !busy;
        HttpPortText.IsEnabled = !busy;
        WorkspaceText.IsEnabled = !busy;
        BrowseWorkspaceButton.IsEnabled = !busy;
        SetupCancelButton.IsEnabled = !busy;
        StartBackendButton.IsEnabled = !busy;

        UpdateProtocolPanels();
    }

    private void SetupCancelButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        if (_setupBusy)
            return;

        Close();
    }

    private async void StartBackendButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        if (_setupBusy ||
            _isClosing)
        {
            return;
        }

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

        DesktopSettingsStore.Save(
            _settings);

        UpdateWindowTitle();

        if (!IsHubPortAvailable(
                out var portError))
        {
            ShowValidation(
                portError);
            return;
        }

        SetSetupBusy(true);
        ValidationText.Text = "";

        SetupPanel.Visibility =
            Visibility.Collapsed;

        Browser.Visibility =
            Visibility.Collapsed;

        StartupOverlay.Visibility =
            Visibility.Visible;

        try
        {
            StartupText.Text =
                L("preparingWorkspace");

            PrepareWorkspace(
                _firstLauncherRun);

            _firstLauncherRun = false;

            if (!IsWebView2RuntimeAvailable())
            {
                throw new InvalidOperationException(
                    L("webView2RuntimeMissing"));
            }

            StartupText.Text =
                L("startingBackend");

            StartBackend();

            await WaitForBackendAsync(
                TimeSpan.FromSeconds(20));

            StartupText.Text =
                L("loadingWebUi");

            await Browser
                .EnsureCoreWebView2Async();

            var coreWebView =
                Browser.CoreWebView2
                ?? throw new InvalidOperationException(
                    L("webView2InitializationFailed"));

            coreWebView.Settings
                .AreDevToolsEnabled = true;

            coreWebView.Settings
                .AreDefaultContextMenusEnabled = true;

            Browser.Source =
                new Uri(
                    HubUrl + "/");

            RestartBackendButton.Visibility =
                Visibility.Collapsed;

            StartupOverlay.Visibility =
                Visibility.Collapsed;

            SetupPanel.Visibility =
                Visibility.Collapsed;

            Browser.Visibility =
                Visibility.Visible;
        }
        catch (Exception ex)
        {
            StopBackend();

            Browser.Visibility =
                Visibility.Collapsed;

            StartupOverlay.Visibility =
                Visibility.Collapsed;

            SetupPanel.Visibility =
                Visibility.Visible;

            ShowValidation(
                L("startupError") +
                ex.Message);
        }
        finally
        {
            SetSetupBusy(false);
        }
    }

    private readonly record struct TestResult(
        bool Ok,
        string Message);

    private bool IsHubPortAvailable(
        out string error)
    {
        error = "";
        TcpListener? listener = null;

        try
        {
            var address =
                _settings.RunMode == "server"
                    ? IPAddress.Any
                    : IPAddress.Loopback;

            listener =
                new TcpListener(
                    address,
                    HubPort);

            listener.Server.ExclusiveAddressUse = true;
            listener.Start();

            return true;
        }
        catch (SocketException)
        {
            error =
                string.Format(
                    L("httpPortInUse"),
                    HubPort);

            return false;
        }
        finally
        {
            try
            {
                listener?.Stop();
            }
            catch
            {
            }
        }
    }

    private static bool IsWebView2RuntimeAvailable()
    {
        try
        {
            var version =
                CoreWebView2Environment
                    .GetAvailableBrowserVersionString();

            return !string.IsNullOrWhiteSpace(
                version);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            return false;
        }
    }

    private void PrepareWorkspace(bool migrateLegacyData)
    {
        var workspace =
            Path.GetFullPath(
                _settings.WorkspaceDirectory);

        Directory.CreateDirectory(workspace);

        var dataRoot =
            Path.Combine(
                workspace,
                "data");

        Directory.CreateDirectory(
            Path.Combine(
                dataRoot,
                "config"));

        Directory.CreateDirectory(
            Path.Combine(
                dataRoot,
                "images"));

        Directory.CreateDirectory(
            Path.Combine(
                dataRoot,
                "state"));

        if (migrateLegacyData)
            TryMigrateLegacyData(dataRoot);

        var backendDir =
            Path.Combine(
                AppContext.BaseDirectory,
                "backend");

        var sourceWebRoot =
            Path.Combine(
                backendDir,
                "wwwroot");

        if (!Directory.Exists(sourceWebRoot))
        {
            throw new DirectoryNotFoundException(
                L("backendWebUiNotFound") + $" {sourceWebRoot}");
        }

        // The workspace contains persistent user data only.
        // Built/static WebUI files stay with the application under backend/wwwroot.
        if (_settings.Protocol == "tcp")
            PersistTcpCommandCenterInstance(dataRoot);
    }

    private void TryMigrateLegacyData(string targetDataRoot)
    {
        try
        {
            var targetLayout =
                Path.Combine(
                    targetDataRoot,
                    "config",
                    "layout.json");

            if (File.Exists(targetLayout))
                return;

            var legacyData =
                Path.Combine(
                    AppContext.BaseDirectory,
                    "backend",
                    "data");

            if (!Directory.Exists(legacyData))
                return;

            if (!Directory.EnumerateFiles(
                    legacyData,
                    "*",
                    SearchOption.AllDirectories)
                .Any())
            {
                return;
            }

            CopyDirectoryMissingOnly(
                legacyData,
                targetDataRoot);

            AppendServerLog(
                "INFO",
                L("legacyDataMigrated") + $"{legacyData} -> {targetDataRoot}");
        }
        catch (Exception ex)
        {
            AppendServerLog(
                "WARN",
                L("legacyDataMigrationFailed") +
                ex.Message);
        }
    }

    private void PersistTcpCommandCenterInstance(
        string dataRoot)
    {
        var path =
            Path.Combine(
                dataRoot,
                "config",
                "command-center.json");

        bool powerIncludesProgramming =
            true;

        try
        {
            if (File.Exists(path))
            {
                using var document =
                    JsonDocument.Parse(
                        File.ReadAllText(path));

                if (document.RootElement.TryGetProperty(
                        "PowerIncludesProgramming",
                        out var value) &&
                    value.ValueKind is
                        JsonValueKind.True or
                        JsonValueKind.False)
                {
                    powerIncludesProgramming =
                        value.GetBoolean();
                }
                else if (document.RootElement.TryGetProperty(
                             "powerIncludesProgramming",
                             out value) &&
                         value.ValueKind is
                             JsonValueKind.True or
                             JsonValueKind.False)
                {
                    powerIncludesProgramming =
                        value.GetBoolean();
                }
            }
        }
        catch
        {
        }

        var payload =
            new
            {
                Host = _settings.TcpHost,
                Port = _settings.TcpPort,
                PowerIncludesProgramming =
                    powerIncludesProgramming
            };

        var temp =
            path + ".tmp";

        File.WriteAllText(
            temp,
            JsonSerializer.Serialize(
                payload,
                new JsonSerializerOptions
                {
                    WriteIndented = true
                }));

        File.Move(
            temp,
            path,
            true);
    }

    private static void CopyDirectoryMissingOnly(
        string source,
        string destination)
    {
        Directory.CreateDirectory(destination);

        foreach (var file in Directory.GetFiles(source))
        {
            var target =
                Path.Combine(
                    destination,
                    Path.GetFileName(file));

            if (!File.Exists(target))
                File.Copy(file, target);
        }

        foreach (var directory in Directory.GetDirectories(source))
        {
            CopyDirectoryMissingOnly(
                directory,
                Path.Combine(
                    destination,
                    Path.GetFileName(directory)));
        }
    }

    private void UpdateWindowTitle()
    {
        var version = GetHubVersion();

        if (_settings.RunMode != "server")
        {
            Title =
                $"DCCExpressHub v{version} — local: 127.0.0.1:{HubPort}";
            return;
        }

        var lanIp =
            GetLanIpv4Address();

        Title =
            lanIp is null
                ? $"DCCExpressHub v{version} — server: 0.0.0.0:{HubPort}"
                : $"DCCExpressHub v{version} — server: {lanIp}:{HubPort}";
    }

    private static string GetHubVersion()
    {
        try
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir is not null)
            {
                var versionFile = Path.Combine(dir.FullName, "VERSION");
                if (File.Exists(versionFile))
                {
                    var value = File.ReadAllText(versionFile).Trim();
                    if (!string.IsNullOrWhiteSpace(value))
                        return value;
                }
                dir = dir.Parent;
            }
        }
        catch { }

        var informational = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;

        if (!string.IsNullOrWhiteSpace(informational))
        {
            var plus = informational.IndexOf('+');
            return plus >= 0 ? informational[..plus] : informational;
        }

        return Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "unknown";
    }

    private static string? GetLanIpv4Address()
    {
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up ||
                    nic.NetworkInterfaceType == NetworkInterfaceType.Loopback ||
                    nic.NetworkInterfaceType == NetworkInterfaceType.Tunnel)
                    continue;

                var properties = nic.GetIPProperties();
                if (!properties.GatewayAddresses.Any(g =>
                        g.Address.AddressFamily == AddressFamily.InterNetwork &&
                        !IPAddress.Any.Equals(g.Address)))
                    continue;

                var address = properties.UnicastAddresses
                    .Select(x => x.Address)
                    .FirstOrDefault(x =>
                        x.AddressFamily == AddressFamily.InterNetwork &&
                        !IPAddress.IsLoopback(x) &&
                        !x.ToString().StartsWith("169.254.", StringComparison.Ordinal));

                if (address is not null)
                    return address.ToString();
            }

            return Dns.GetHostEntry(Dns.GetHostName()).AddressList
                .FirstOrDefault(x =>
                    x.AddressFamily == AddressFamily.InterNetwork &&
                    !IPAddress.IsLoopback(x) &&
                    !x.ToString().StartsWith("169.254.", StringComparison.Ordinal))
                ?.ToString();
        }
        catch
        {
            return null;
        }
    }

    private string PidFilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DCCExpressHub",
        PidFileName);

    private void KillStaleBackend()
    {
        if (!File.Exists(PidFilePath))
            return;

        try
        {
            var text = File.ReadAllText(PidFilePath).Trim();
            if (!int.TryParse(text, out var pid))
                return;

            using var process = Process.GetProcessById(pid);
            if (!process.HasExited && IsOurBackend(process))
            {
                process.Kill(entireProcessTree: true);
                process.WaitForExit(5000);
            }
        }
        catch (ArgumentException)
        {
        }
        catch (InvalidOperationException)
        {
        }
        finally
        {
            TryDeletePidFile();
        }
    }

    private static bool IsOurBackend(Process process)
    {
        try
        {
            using var searcher = new System.Management.ManagementObjectSearcher(
                $"SELECT CommandLine FROM Win32_Process WHERE ProcessId = {process.Id}");

            foreach (System.Management.ManagementObject obj in searcher.Get())
            {
                var commandLine = obj["CommandLine"]?.ToString() ?? "";

                return
                    commandLine.Contains(
                        "DCCExpressHub.Net.exe",
                        StringComparison.OrdinalIgnoreCase) ||
                    commandLine.Contains(
                        "DCCExpressHub.Net.dll",
                        StringComparison.OrdinalIgnoreCase);
            }
        }
        catch
        {
        }

        return false;
    }

    private void StartBackend()
    {
        var backendDir =
            Path.Combine(
                AppContext.BaseDirectory,
                "backend");

        var exe =
            Path.Combine(
                backendDir,
                "DCCExpressHub.Net.exe");

        var dll =
            Path.Combine(
                backendDir,
                "DCCExpressHub.Net.dll");

        var workspace =
            Path.GetFullPath(
                _settings.WorkspaceDirectory);

        var webRoot =
            Path.Combine(
                backendDir,
                "wwwroot");

        var index =
            Path.Combine(
                webRoot,
                "index.html");

        if (!File.Exists(exe) &&
            !File.Exists(dll))
        {
            throw new FileNotFoundException(
                L("backendNotFound"),
                exe);
        }

        if (!File.Exists(index))
        {
            throw new FileNotFoundException(
                L("backendWebUiNotFound"),
                index);
        }

        ProcessStartInfo psi;

        if (File.Exists(exe))
        {
            // Published release: self-contained single-file backend.
            psi = new ProcessStartInfo(exe)
            {
                WorkingDirectory = backendDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
        }
        else
        {
            // Normal Visual Studio/debug build: framework-dependent DLL.
            psi = new ProcessStartInfo(
                "dotnet",
                $"\"{dll}\"")
            {
                WorkingDirectory = backendDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
        }

        psi.Environment["DCCEXPRESS_DESKTOP_URL"] = HubListenUrl;
        psi.Environment["ASPNETCORE_URLS"] = HubListenUrl;
        psi.Environment["Urls"] = HubListenUrl;
        psi.Environment["ASPNETCORE_ENVIRONMENT"] = "Production";
        psi.Environment["ASPNETCORE_CONTENTROOT"] = workspace;
        psi.Environment["ASPNETCORE_WEBROOT"] = webRoot;

        _backendShutdownToken =
            Guid.NewGuid().ToString("N");

        psi.Environment["DCCEXPRESS_DESKTOP_SHUTDOWN_TOKEN"] =
            _backendShutdownToken;

        psi.Environment["DccEx__Transport"] =
            _settings.Protocol == "serial"
                ? "Serial"
                : "Tcp";

        psi.Environment["DccEx__Host"] =
            _settings.TcpHost;

        psi.Environment["DccEx__Port"] =
            _settings.TcpPort.ToString();

        psi.Environment["DccEx__SerialPort"] =
            _settings.SerialPort;

        psi.Environment["DccEx__BaudRate"] =
            _settings.SerialBaudRate.ToString();

        _backendExpectedStop = false;

        _backend = new Process
        {
            StartInfo = psi,
            EnableRaisingEvents = true
        };

        _backend.Exited +=
            Backend_Exited;

        _backend.OutputDataReceived += (_, a) =>
        {
            if (a.Data == null) return;
            Debug.WriteLine("[Hub] " + a.Data);
            AppendServerLog("OUT", a.Data);
        };

        _backend.ErrorDataReceived += (_, a) =>
        {
            if (a.Data == null) return;
            Debug.WriteLine("[Hub:ERR] " + a.Data);
            AppendServerLog("ERR", a.Data);
        };

        if (!_backend.Start())
            throw new InvalidOperationException(L("backendStartFailed"));

        Directory.CreateDirectory(
            Path.GetDirectoryName(PidFilePath)!);

        File.WriteAllText(
            PidFilePath,
            _backend.Id.ToString());

        _backend.BeginOutputReadLine();
        _backend.BeginErrorReadLine();
    }

    private void Backend_Exited(
        object? sender,
        EventArgs e)
    {
        if (_isClosing ||
            _backendExpectedStop)
        {
            return;
        }

        int exitCode = -1;

        try
        {
            if (sender is Process process)
                exitCode = process.ExitCode;
        }
        catch
        {
        }

        TryDeletePidFile();

        Dispatcher.BeginInvoke(() =>
        {
            if (_isClosing)
                return;

            StartupText.Text =
                string.Format(
                    L("backendCrashed"),
                    exitCode);

            if (RestartButton is { } restartButton)
            {
                restartButton.Content = L("restartBackend");
                restartButton.IsEnabled = true;
                restartButton.Visibility = Visibility.Visible;
            }

            Browser.Visibility =
                Visibility.Collapsed;

            StartupOverlay.Visibility =
                Visibility.Visible;
        });
    }

    private async void RestartBackendButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        if (_restartInProgress ||
            _isClosing)
        {
            return;
        }

        _restartInProgress = true;

        var restartButton = RestartButton;
        if (restartButton is not null)
            restartButton.IsEnabled = false;

        StartupText.Text = L("restartingBackend");

        try
        {
            _backendExpectedStop = true;

            try
            {
                _backend?.Dispose();
            }
            catch
            {
            }

            _backend = null;
            _backendShutdownToken = null;
            TryDeletePidFile();

            if (!IsHubPortAvailable(
                    out var portError))
            {
                throw new InvalidOperationException(
                    portError);
            }

            StartBackend();

            await WaitForBackendAsync(
                TimeSpan.FromSeconds(20));

            if (Browser.CoreWebView2 is null)
                await Browser.EnsureCoreWebView2Async();

            var coreWebView = Browser.CoreWebView2
                ?? throw new InvalidOperationException(L("webView2InitializationFailed"));

            coreWebView.Settings.AreDevToolsEnabled = true;
            coreWebView.Settings.AreDefaultContextMenusEnabled = true;
            Browser.Source = new Uri(HubUrl + "/");

            if (restartButton is not null)
                restartButton.Visibility = Visibility.Collapsed;

            StartupOverlay.Visibility =
                Visibility.Collapsed;

            Browser.Visibility =
                Visibility.Visible;
        }
        catch (Exception ex)
        {
            Browser.Visibility =
                Visibility.Collapsed;

            StartupText.Text =
                L("backendRestartFailed") +
                ex.Message;

            if (restartButton is not null)
            {
                restartButton.Content = L("restartBackend");
                restartButton.Visibility = Visibility.Visible;
            }
        }
        finally
        {
            if (restartButton is not null)
                restartButton.IsEnabled = true;
            _restartInProgress = false;
        }
    }

    private async Task WaitForBackendAsync(TimeSpan timeout)
    {
        var until = DateTime.UtcNow + timeout;

        while (DateTime.UtcNow < until)
        {
            if (_backend?.HasExited == true)
                throw new InvalidOperationException(L("backendExited") + _backend.ExitCode);

            try
            {
                using var response = await _http.GetAsync(HubUrl + "/");
                if (response.IsSuccessStatusCode)
                    return;
            }
            catch { }

            await Task.Delay(200);
        }

        throw new TimeoutException(L("backendTimeout"));
    }

    private async void OnClosing(
        object? sender,
        System.ComponentModel.CancelEventArgs e)
    {
        if (_closeApproved)
        {
            FinalizeClose();
            return;
        }

        // If no backend is running there is nothing that needs a power-off
        // decision. This also makes Cancel on the startup panel a clean exit.
        if (_backend is null ||
            _backend.HasExited)
        {
            _closeApproved = true;
            FinalizeClose();
            return;
        }

        e.Cancel = true;

        if (_closeDialogActive)
            return;

        _closeDialogActive = true;

        try
        {
            var choice =
                await ShowCloseConfirmAsync();

            if (choice == CloseChoice.Cancel)
                return;

            if (choice == CloseChoice.PowerOffAndExit)
            {
                var powerOffOk =
                    await RequestTrackPowerOffAsync();

                if (!powerOffOk)
                {
                    var failedChoice =
                        await ShowPowerOffFailedConfirmAsync();

                    if (failedChoice != CloseChoice.ExitAnyway)
                        return;
                }
                else
                {
                    await Task.Delay(300);
                }
            }

            _isClosing = true;
            StopBackend();

            _closeApproved = true;
            Close();
        }
        finally
        {
            if (!_closeApproved)
            {
                _isClosing = false;
                _closeDialogActive = false;
                HideConfirmOverlay();
            }
        }
    }

    private Task<CloseChoice> ShowCloseConfirmAsync()
    {
        _confirmMode =
            ConfirmMode.Exit;

        ConfigureExitConfirm();
        return ShowConfirmOverlayAsync();
    }

    private Task<CloseChoice> ShowPowerOffFailedConfirmAsync()
    {
        _confirmMode =
            ConfirmMode.PowerOffFailed;

        ConfigurePowerOffFailedConfirm();
        return ShowConfirmOverlayAsync();
    }

    private void ConfigureExitConfirm()
    {
        ConfirmTitleText.Text =
            L("closeConfirmTitle");

        ConfirmMessageText.Text =
            L("closeConfirmMessage");

        ConfirmPrimaryButton.Content =
            L("closePowerOffExit");

        ConfirmSecondaryButton.Content =
            L("closeExitWithoutPowerOff");

        ConfirmSecondaryButton.Visibility =
            Visibility.Visible;

        ConfirmCancelButton.Content =
            L("closeCancel");
    }

    private void ConfigurePowerOffFailedConfirm()
    {
        ConfirmTitleText.Text =
            L("powerOffFailedTitle");

        ConfirmMessageText.Text =
            L("powerOffFailedMessage");

        ConfirmPrimaryButton.Content =
            L("exitAnyway");

        ConfirmSecondaryButton.Visibility =
            Visibility.Collapsed;

        ConfirmCancelButton.Content =
            L("closeCancel");
    }

    private Task<CloseChoice> ShowConfirmOverlayAsync()
    {
        _confirmTcs =
            new TaskCompletionSource<CloseChoice>(
                TaskCreationOptions.RunContinuationsAsynchronously);

        _browserHiddenForConfirm =
            Browser.Visibility ==
            Visibility.Visible;

        if (_browserHiddenForConfirm)
        {
            Browser.Visibility =
                Visibility.Collapsed;
        }

        ConfirmOverlay.Visibility =
            Visibility.Visible;

        ConfirmCancelButton.Focus();

        return _confirmTcs.Task;
    }

    private void HideConfirmOverlay()
    {
        ConfirmOverlay.Visibility =
            Visibility.Collapsed;

        _confirmTcs = null;

        if (_browserHiddenForConfirm &&
            !_isClosing)
        {
            Browser.Visibility =
                Visibility.Visible;
        }

        _browserHiddenForConfirm = false;
    }

    private void ResolveConfirm(
        CloseChoice choice)
    {
        var completion =
            _confirmTcs;

        if (completion is null)
            return;

        ConfirmOverlay.Visibility =
            Visibility.Collapsed;

        _confirmTcs = null;

        if (_browserHiddenForConfirm &&
            !_isClosing)
        {
            Browser.Visibility =
                Visibility.Visible;
        }

        _browserHiddenForConfirm = false;

        completion.TrySetResult(
            choice);
    }

    private void ConfirmPrimaryButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        ResolveConfirm(
            _confirmMode == ConfirmMode.PowerOffFailed
                ? CloseChoice.ExitAnyway
                : CloseChoice.PowerOffAndExit);
    }

    private void ConfirmSecondaryButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        if (_confirmMode == ConfirmMode.Exit)
        {
            ResolveConfirm(
                CloseChoice.ExitWithoutPowerOff);
        }
    }

    private void ConfirmCancelButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        ResolveConfirm(
            CloseChoice.Cancel);
    }

    private void FinalizeClose()
    {
        _isClosing = true;

        // StopBackend() is normally already completed by the first close pass.
        // Keep this call idempotent so programmatic shutdown is safe as well.
        StopBackend();

        try
        {
            _singleInstanceMutex?.ReleaseMutex();
        }
        catch
        {
        }

        _singleInstanceMutex?.Dispose();
        _singleInstanceMutex = null;

        _http.Dispose();
    }

    private async Task<bool> RequestTrackPowerOffAsync()
    {
        if (string.IsNullOrWhiteSpace(
                _backendShutdownToken))
        {
            return false;
        }

        try
        {
            using var client =
                new HttpClient
                {
                    Timeout =
                        TimeSpan.FromSeconds(3)
                };

            using var request =
                new HttpRequestMessage(
                    HttpMethod.Post,
                    HubUrl + "/__desktop/power-off");

            request.Headers.TryAddWithoutValidation(
                "X-DCCExpressHub-Shutdown-Token",
                _backendShutdownToken);

            using var response =
                await client.SendAsync(request);

            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private void Window_PreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Escape &&
            ConfirmOverlay.Visibility == Visibility.Visible)
        {
            ResolveConfirm(CloseChoice.Cancel);
            e.Handled = true;
            return;
        }

        if (e.Key == System.Windows.Input.Key.F10)
        {
            MainMenu.Visibility = MainMenu.Visibility == Visibility.Visible
                ? Visibility.Collapsed
                : Visibility.Visible;
            e.Handled = true;
            return;
        }

        if (e.Key == System.Windows.Input.Key.F11)
        {
            ToggleFullscreen();
            e.Handled = true;
            return;
        }

        if (e.Key == System.Windows.Input.Key.Escape && _isFullscreen)
        {
            ExitFullscreen();
            e.Handled = true;
        }
    }

    private void ToggleFullscreen()
    {
        if (_isFullscreen)
        {
            ExitFullscreen();
            return;
        }

        _previousWindowStyle = WindowStyle;
        _previousWindowState = WindowState;
        _previousResizeMode = ResizeMode;
        _previousBounds = new Rect(Left, Top, Width, Height);

        MainMenu.Visibility = Visibility.Collapsed;

        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        WindowState = WindowState.Maximized;
        _isFullscreen = true;
    }

    private void ExitFullscreen()
    {
        if (!_isFullscreen) return;

        WindowState = WindowState.Normal;
        WindowStyle = _previousWindowStyle;
        ResizeMode = _previousResizeMode;

        Left = _previousBounds.Left;
        Top = _previousBounds.Top;
        Width = _previousBounds.Width;
        Height = _previousBounds.Height;

        if (_previousWindowState == WindowState.Maximized)
            WindowState = WindowState.Maximized;

        _isFullscreen = false;
    }

    private void AppendServerLog(string source, string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        Dispatcher.BeginInvoke(() =>
        {
            ServerLogText.AppendText($"[{DateTime.Now:HH:mm:ss.fff}] {source}: {line}{Environment.NewLine}");
            ServerLogText.ScrollToEnd();
        });
    }

    private void ServerLogMenuItem_Click(object sender, RoutedEventArgs e)
    {
        LogRow.Height = ServerLogMenuItem.IsChecked
            ? new GridLength(260)
            : new GridLength(0);
    }

    private void ClearLog_Click(object sender, RoutedEventArgs e)
    {
        ServerLogText.Clear();
    }

    private void StopBackend()
    {
        var process =
            _backend;

        _backendExpectedStop = true;

        try
        {
            if (process is { HasExited: false })
            {
                bool graceful = false;

                try
                {
                    graceful =
                        RequestGracefulBackendShutdownAsync()
                            .GetAwaiter()
                            .GetResult();
                }
                catch
                {
                }

                if (!graceful ||
                    !process.WaitForExit(5000))
                {
                    process.Kill(
                        entireProcessTree: true);

                    process.WaitForExit(5000);
                }
            }
        }
        catch
        {
        }
        finally
        {
            try
            {
                process?.Dispose();
            }
            catch
            {
            }

            _backend = null;
            _backendShutdownToken = null;
            TryDeletePidFile();
        }
    }

    private async Task<bool> RequestGracefulBackendShutdownAsync()
    {
        if (string.IsNullOrWhiteSpace(
                _backendShutdownToken))
        {
            return false;
        }

        using var client =
            new HttpClient
            {
                Timeout =
                    TimeSpan.FromSeconds(2)
            };

        using var request =
            new HttpRequestMessage(
                HttpMethod.Post,
                HubUrl + "/__desktop/shutdown");

        request.Headers.TryAddWithoutValidation(
            "X-DCCExpressHub-Shutdown-Token",
            _backendShutdownToken);

        using var response =
            await client
                .SendAsync(request)
                .ConfigureAwait(false);

        return response.IsSuccessStatusCode;
    }

    private void TryDeletePidFile()
    {
        try
        {
            if (File.Exists(PidFilePath))
                File.Delete(PidFilePath);
        }
        catch { }
    }
}
