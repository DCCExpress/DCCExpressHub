using System.Diagnostics;
using System.Windows.Forms;

namespace DCCExpressHub.Launcher;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var directory = AppContext.BaseDirectory;
        var appDirectory = Path.Combine(directory, "app");
        var executable = Path.Combine(appDirectory, "DCCExpressHub.App.exe");

        if (!File.Exists(executable))
        {
            MessageBox.Show(
                $"Missing application executable:\\n{executable}".Replace("\\n", Environment.NewLine),
                "DCCExpressHub",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        try
        {
            var start = new ProcessStartInfo(executable)
            {
                WorkingDirectory = appDirectory,
                UseShellExecute = false
            };
            foreach (var arg in args)
                start.ArgumentList.Add(arg);

            // Start is non-blocking: disposing the Process wrapper does not
            // terminate the MAUI app. This launcher exits immediately.
            using var process = Process.Start(start);
            if (process is null)
                throw new InvalidOperationException("Windows could not start the MAUI application.");
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"Cannot start DCCExpressHub:{Environment.NewLine}{ex.Message}",
                "DCCExpressHub",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }
}
