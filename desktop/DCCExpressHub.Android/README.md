# DCCExpressHub.Android (MAUI host prototype)

Android-only .NET 10 MAUI host for **DCCExpressHub.Runtime**. This app **references and starts the real shared runtime DLL**, serves the existing built web UI through the runtime HTTP/WebSocket host, and opens the tablet view in Android WebView.

## Requirements

- .NET 10 SDK with the Android/MAUI workload (`dotnet workload install maui-android`).
- Android SDK + device/emulator, Android 8.0+ (API 26).
- Built Vite UI in `desktop/DCCExpressHub.Net/wwwroot` (including `index.html` and `assets/`).
- Network-accessible command center, preferably DCC-EX TCP, Z21 UDP or LocoNet TCP. Serial/USB is **not** wired up for Android yet.

## Build

From the repo root, after building the web frontend into `desktop/DCCExpressHub.Net/wwwroot`:

```powershell
dotnet workload install maui-android
dotnet restore desktop/DCCExpressHub.Android/DCCExpressHub.Android.csproj
dotnet build desktop/DCCExpressHub.Android/DCCExpressHub.Android.csproj -f net10.0-android -c Debug
```

Deploy using Visual Studio's Android target or `dotnet build ... -t:Run` with a connected device.

## Runtime behavior

- **Start HUB** copies packaged web assets to Android's private app data and starts the **real** `DCCExpressHub.Net.HubRuntime`.
- The Watson HTTP/WebSocket listener binds to **127.0.0.1:5174**. The in-app WebView opens `/#tablet`.
- **Stop** disposes the backend runtime, which stops its hosted services.
- Configuration and state are persisted under the app-private `hub/data` directory.
- This intentionally uses a loopback-only endpoint. Remote browsers cannot connect in this prototype.
- This is a **foreground-only experimental host**, not an Android foreground service. Background execution, screen-off operation, wake locks, automatic restart and process-death recovery are **not implemented**.
- Packaged assets require rebuilding the APK when the Vite frontend changes.

## Integration caveats

The shared runtime has dependencies including Watson Webserver, Jint and `System.IO.Ports`. Their Android compatibility and actual network transports still need to be verified on a physical device. The prototype is **not yet Android-tested**. If Watson or any library is incompatible, adapt the transport/web host layer rather than duplicating the Dispatcher, SwitchMan, Tracking or automation runtime.

Do not use an untested prototype to operate unattended trains. Validate power-off, E-STOP, disconnect and Stop handling on test track first.
