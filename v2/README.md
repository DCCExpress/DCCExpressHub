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
