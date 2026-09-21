using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;

namespace DCCExpressHub.Desktop;

public partial class MainWindow : Window
{
    private const string HubUrl = "http://127.0.0.1:5127";
    private const string PidFileName = "dccexpresshub-backend.pid";

    private Process? _backend;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMilliseconds(500) };
    private Mutex? _singleInstanceMutex;
    private bool _isFullscreen;
    private WindowStyle _previousWindowStyle;
    private WindowState _previousWindowState;
    private ResizeMode _previousResizeMode;
    private Rect _previousBounds;

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
            // Only one Desktop launcher owns the backend.
            _singleInstanceMutex = new Mutex(true, @"Local\DCCExpressHub.Desktop", out bool createdNew);
            if (!createdNew)
                throw new InvalidOperationException("A DCCExpressHub Desktop már fut.");

            StartupText.Text = "Korábbi backend ellenőrzése…";
            KillStaleBackend();

            StartupText.Text = "Backend indítása…";
            StartBackend();

            await WaitForBackendAsync(TimeSpan.FromSeconds(20));

            StartupText.Text = "WebUI betöltése…";
            await Browser.EnsureCoreWebView2Async();
            Browser.CoreWebView2.Settings.AreDevToolsEnabled = true;
            Browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            Browser.Source = new Uri(HubUrl + "/");
            StartupOverlay.Visibility = Visibility.Collapsed;
        }
        catch (Exception ex)
        {
            StartupText.Text = "Indítási hiba: " + ex.Message;
        }
    }

    private string PidFilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DCCExpressHub",
        PidFileName);

    private void KillStaleBackend()
    {
        // We only kill a PID previously created and recorded by this Desktop app.
        // Never kill arbitrary dotnet.exe processes.
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
            // PID no longer exists.
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
            // A PID can be reused. Validate command line before killing it.
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
        var index = Path.Combine(backendDir, "wwwroot", "index.html");

        if (!File.Exists(dll))
            throw new FileNotFoundException("A backend nem található.", dll);

        if (!File.Exists(index))
            throw new FileNotFoundException(
                "A React UI nincs a runtime backend/wwwroot könyvtárban. " +
                "Másold/buildeld a frontend dist tartalmát a DCCExpressHub.Net/wwwroot könyvtárba.",
                index);

        var psi = new ProcessStartInfo("dotnet", $"\"{dll}\"")
        {
            WorkingDirectory = backendDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        psi.Environment["DCCEXPRESS_DESKTOP_URL"] = HubUrl;
        psi.Environment["ASPNETCORE_ENVIRONMENT"] = "Production";
        psi.Environment["ASPNETCORE_CONTENTROOT"] = backendDir;

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
            throw new InvalidOperationException("A backend nem indítható.");

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
                throw new InvalidOperationException($"A backend leállt. ExitCode={_backend.ExitCode}");

            try
            {
                // Root is guaranteed by the frontend runtime and is enough to prove Kestrel is listening.
                using var response = await _http.GetAsync(HubUrl + "/");
                if (response.IsSuccessStatusCode)
                    return;
            }
            catch { }

            await Task.Delay(200);
        }

        throw new TimeoutException("A backend 20 másodpercen belül nem indult el.");
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
        // F10: hidden advanced menu. This gives us room for more diagnostic/admin tools later.
        if (e.Key == System.Windows.Input.Key.F10)
        {
            MainMenu.Visibility = MainMenu.Visibility == Visibility.Visible
                ? Visibility.Collapsed
                : Visibility.Visible;
            e.Handled = true;
            return;
        }

        // F11: browser-style fullscreen toggle.
        if (e.Key == System.Windows.Input.Key.F11)
        {
            ToggleFullscreen();
            e.Handled = true;
            return;
        }

        // Escape leaves fullscreen, but does not otherwise interfere with the WebUI.
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

        // Collapse the advanced menu in fullscreen. F10 can still show it if needed.
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
