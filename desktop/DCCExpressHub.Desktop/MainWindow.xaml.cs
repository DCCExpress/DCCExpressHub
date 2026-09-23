using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;

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

    private async void OnLoaded(object sender, RoutedEventArgs e)
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

            var firstLauncherRun =
                !DesktopSettingsStore.Exists;

            // Kill an orphan from the previous launcher session before the
            // settings dialog checks whether the selected HTTP port is free.
            StartupText.Text =
                L("checkingBackend");

            KillStaleBackend();

            while (true)
            {
                StartupText.Text =
                    L("startupSettings");

                var settingsWindow =
                    new StartupSettingsWindow(
                        _settings,
                        GetHubVersion())
                    {
                        Owner = this
                    };

                if (settingsWindow.ShowDialog() != true)
                {
                    Close();
                    return;
                }

                _settings =
                    settingsWindow.Settings;

                DesktopSettingsStore.Save(
                    _settings);

                UpdateWindowTitle();

                if (IsHubPortAvailable(
                        out var portError))
                {
                    break;
                }

                MessageBox.Show(
                    this,
                    portError,
                    L("httpPortInUseTitle"),
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning);
            }

            StartupText.Text =
                L("preparingWorkspace");

            PrepareWorkspace(
                firstLauncherRun);

            if (!IsWebView2RuntimeAvailable())
            {
                MessageBox.Show(
                    this,
                    L("webView2RuntimeMissing"),
                    L("webView2RuntimeMissingTitle"),
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);

                Close();
                return;
            }

            StartupText.Text =
                L("startingBackend");

            StartBackend();

            await WaitForBackendAsync(
                TimeSpan.FromSeconds(20));

            StartupText.Text =
                L("loadingWebUi");

            await Browser.EnsureCoreWebView2Async();

            var coreWebView = Browser.CoreWebView2
                ?? throw new InvalidOperationException(L("webView2InitializationFailed"));

            coreWebView.Settings.AreDevToolsEnabled = true;
            coreWebView.Settings.AreDefaultContextMenusEnabled = true;
            Browser.Source = new Uri(HubUrl + "/");

            if (FindName("RestartBackendButton") is System.Windows.Controls.Button restartButton)
                restartButton.Visibility = Visibility.Collapsed;

            StartupOverlay.Visibility =
                Visibility.Collapsed;
        }
        catch (Exception ex)
        {
            StartupText.Text =
                L("startupError") +
                ex.Message;
        }
    }

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
        }
        catch (Exception ex)
        {
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

        // Closing is asynchronous because "Yes" first requests track power OFF.
        // Cancel this close attempt and call Close() again only after the user's
        // choice has been handled.
        e.Cancel = true;

        if (_closeDialogActive)
            return;

        _closeDialogActive = true;

        try
        {
            var choice =
                MessageBox.Show(
                    this,
                    L("closeConfirmMessage"),
                    L("closeConfirmTitle"),
                    MessageBoxButton.YesNoCancel,
                    MessageBoxImage.Warning,
                    MessageBoxResult.Cancel);

            if (choice == MessageBoxResult.Cancel)
                return;

            if (choice == MessageBoxResult.Yes)
            {
                var powerOffOk =
                    await RequestTrackPowerOffAsync();

                if (!powerOffOk)
                {
                    var exitAnyway =
                        MessageBox.Show(
                            this,
                            L("powerOffFailedMessage"),
                            L("powerOffFailedTitle"),
                            MessageBoxButton.YesNo,
                            MessageBoxImage.Warning,
                            MessageBoxResult.No);

                    if (exitAnyway != MessageBoxResult.Yes)
                        return;
                }
                else
                {
                    // Give DCC-EX feedback / runtime state persistence a brief
                    // opportunity to complete before the backend is stopped.
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
            }
        }
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
