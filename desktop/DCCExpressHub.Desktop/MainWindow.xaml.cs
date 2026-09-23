using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Text.Json;
using System.Windows;

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
            _singleInstanceMutex = new Mutex(true, @"Local\DCCExpressHub.Desktop", out bool createdNew);
            if (!createdNew)
                throw new InvalidOperationException(L("alreadyRunning"));

            var firstLauncherRun = !DesktopSettingsStore.Exists;

            StartupText.Text = L("startupSettings");

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

            _settings = settingsWindow.Settings;
            DesktopSettingsStore.Save(_settings);

            UpdateWindowTitle();

            StartupText.Text = L("checkingBackend");
            KillStaleBackend();

            StartupText.Text = L("preparingWorkspace");
            PrepareWorkspace(firstLauncherRun);

            StartupText.Text = L("startingBackend");
            StartBackend();

            await WaitForBackendAsync(TimeSpan.FromSeconds(20));

            StartupText.Text = L("loadingWebUi");
            await Browser.EnsureCoreWebView2Async();
            Browser.CoreWebView2.Settings.AreDevToolsEnabled = true;
            Browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            Browser.Source = new Uri(HubUrl + "/");
            StartupOverlay.Visibility = Visibility.Collapsed;
        }
        catch (Exception ex)
        {
            StartupText.Text = L("startupError") + ex.Message;
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
                return commandLine.Contains("DCCExpressHub.Net.dll", StringComparison.OrdinalIgnoreCase);
            }
        }
        catch { }
        return false;
    }

    private void StartBackend()
    {
        var backendDir = Path.Combine(AppContext.BaseDirectory, "backend");
        var dll = Path.Combine(backendDir, "DCCExpressHub.Net.dll");
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

        if (!File.Exists(dll))
            throw new FileNotFoundException(L("backendNotFound"), dll);

        if (!File.Exists(index))
            throw new FileNotFoundException(
                L("backendWebUiNotFound"),
                index);

        // The backend binary remains in bin/backend, but ASP.NET's content root
        // is the persistent user-selected workspace. Existing backend code
        // therefore continues to use ContentRootPath/data, except that it is no
        // longer under bin/ and cannot disappear on Clean/Rebuild.
        var psi = new ProcessStartInfo("dotnet", $"\"{dll}\"")
        {
            WorkingDirectory = backendDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        psi.Environment["DCCEXPRESS_DESKTOP_URL"] = HubListenUrl;
        psi.Environment["ASPNETCORE_URLS"] = HubListenUrl;
        psi.Environment["Urls"] = HubListenUrl;
        psi.Environment["ASPNETCORE_ENVIRONMENT"] = "Production";
        psi.Environment["ASPNETCORE_CONTENTROOT"] = workspace;
        psi.Environment["ASPNETCORE_WEBROOT"] = webRoot;

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

        _backend = new Process { StartInfo = psi, EnableRaisingEvents = true };
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

        Directory.CreateDirectory(Path.GetDirectoryName(PidFilePath)!);
        File.WriteAllText(PidFilePath, _backend.Id.ToString());

        _backend.BeginOutputReadLine();
        _backend.BeginErrorReadLine();
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

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        StopBackend();
        try { _singleInstanceMutex?.ReleaseMutex(); } catch { }
        _singleInstanceMutex?.Dispose();
        _http.Dispose();
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
        try
        {
            if (_backend is { HasExited: false })
            {
                _backend.Kill(entireProcessTree: true);
                _backend.WaitForExit(5000);
            }
        }
        catch { }
        finally
        {
            _backend?.Dispose();
            _backend = null;
            TryDeletePidFile();
        }
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
