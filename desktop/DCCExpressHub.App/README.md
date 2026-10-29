# DCCExpressHub.App — Windows + Android MAUI host (alpha9)

This is the **one shared MAUI project** for Windows and Android. It starts the real
`DCCExpressHub.Runtime` DLL and opens the existing React UI in a native WebView.
The Linux/Windows headless server remains `DCCExpressHub.Net`.

## Windows (experimental, replaces WPF after validation)

Requires Windows 10/11, .NET 10 SDK, MAUI Windows workload / Visual Studio MAUI
tooling, and WebView2 Runtime. From repository root:

```powershell
dotnet workload install maui-windows
.\build-maui-windows.ps1
```

Then launch or debug `desktop/DCCExpressHub.App/DCCExpressHub.App.csproj`
using **Windows Machine** and the `net10.0-windows10.0.19041.0` target.
On Windows, the MAUI project defaults to the Windows target so an Android workload
is **not** required for Windows builds or solution restore.

The unpackaged Windows app opens the normal Layout Page and runs the full shared
HUB in-process. Its default workspace is `%LOCALAPPDATA%\DCCExpressHub\workspace`
(the same default as WPF), but a custom workspace directory can be entered.
`Allow other devices on LAN` exposes the HTTP/WebSocket HUB to other devices
on the trusted LAN. TCP, Z21 UDP, LocoNet TCP, DCC-EX Serial and LocoNet Serial
are offered as on desktop; verify serial paths on your hardware.

The original WPF project and `build-desktop.ps1` remain intact as the known-good
fallback while this MAUI Windows prototype is tested. Do not use `-Publish` from
the old WPF script to package the new MAUI executable.

## Android

Requires .NET 10 Android/MAUI workload and Android SDK. On Windows, explicitly
select the Android target to opt in to the Android workload:

```powershell
dotnet build desktop/DCCExpressHub.App/DCCExpressHub.App.csproj -f net10.0-android -p:TargetFrameworks=net10.0-android
```

On non-Windows development hosts, Android remains the default target.
Android opens `/#tablet`, keeps the existing
`hu.dccexpress.hub` package identity and previous `android-startup.json`
preferences. USB serial is not implemented on Android; use a network command station.

The Android HUB is foreground-only. Background operation/screen-off persistence
is not implemented. LAN exposure is opt-in via the startup switch.

## Shared Web UI

Build the React UI and copy `web-ui/dist` into
`desktop/DCCExpressHub.Net/wwwroot` before building either target.
`build-maui-windows.ps1` does this automatically for Windows.
Windows serves the copied output alongside its executable; Android bundles
the assets into its APK and extracts them to the app-private directory.

## Validation before retiring WPF

Check Windows startup, custom/default workspace, DCC-EX TCP/Serial, Z21 UDP,
LocoNet TCP/Serial, Power OFF/E-STOP, Wi-Fi LAN browser access, WebView and
HUB stop/restart. The MAUI Windows project has not yet been compiled on a Windows
machine in this environment. The headless Linux server and WPF release
pipeline remain unchanged until these tests pass.
