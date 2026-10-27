# DCCExpressHub V2 (minimal skeleton)

The V2 is separate from the alpha8 codebase and consists of:

- `DCCExpressHub.V2.Runtime` — shared .NET 10 Watson backend DLL
- `DCCExpressHub.V2.Host` — console launcher for Windows/Linux
- `DCCExpressHub.V2.Desktop` — Windows WPF + WebView2 host referencing the runtime directly
- `web-ui` — clean React + Mantine + Vite homepage

## Build the web UI

```bash
cd v2/web-ui
npm install
npm run build
```

## Start the console host

```bash
dotnet run --project v2/DCCExpressHub.V2.Host
```

## Windows Desktop

Open `v2/DCCExpressHub.V2.slnx` and start `DCCExpressHub.V2.Desktop`.

The HTTP page is served at http://127.0.0.1:5180/. The backend's /health endpoint remains available.

No command center, device manager, or legacy UI functionality is included in V2 yet.

## Windows Desktop build script

Run from the repository root:

```powershell
.\v2\build-desktop.ps1
.\v2\build-desktop.ps1 -Clean -RestoreNode
.\v2\build-desktop.ps1 -Publish
```

The script builds the **V2** React/Vite frontend first, then the V2 .NET solution (Runtime DLL, standalone Host, and WPF Desktop). The UI is copied into the Desktop output under `wwwroot`.

`-Publish` defaults to Release and creates a self-contained Windows x64 Desktop ZIP under `v2/dist/desktop/`. It does **not** publish a separate backend executable: the Desktop references the shared Runtime DLL directly.

Build prerequisites: Windows, .NET 10 SDK, Node.js/npm, and WebView2 Runtime for running the app.
