# DCCExpressHub .NET 10 backend

Cross-platform DCCExpressHub backend for Windows and Linux.

The backend uses the .NET Generic Host for dependency injection, logging and
background services, and Watson 7 for HTTP, WebSocket, static-file and SSE
transport. It does not depend on ASP.NET Core or Kestrel.

The Windows WPF/WebView2 desktop shell is a separate Windows-only application;
`DCCExpressHub.Net` itself can run headless on Linux.

## Quick start

1. Install the .NET 10 SDK.
2. Edit `appsettings.json` or provide configuration through environment variables.
3. Copy the contents of the React/Vite `dist` directory into `wwwroot`.
4. Run:

       dotnet restore
       dotnet run

5. Open `http://localhost:5174`.

The default listen URL is `http://0.0.0.0:5174`.

You can override it with either:

    DCCEXPRESS_HTTP_URL=http://0.0.0.0:5174

or the existing configuration key/environment variable:

    Urls=http://0.0.0.0:5174

## Filesystem roots

By default the process content root is used. For a service installation the
roots can be set explicitly:

    DCCEXPRESS_CONTENT_ROOT=/opt/dccexpresshub
    DCCEXPRESS_WEB_ROOT=/opt/dccexpresshub/wwwroot

The Windows desktop launcher still supplies the older
`ASPNETCORE_CONTENTROOT` and `ASPNETCORE_WEBROOT` names. They are accepted
only as backward-compatible aliases; ASP.NET Core is not used by the backend.

## Command-center transports

DCC-EX TCP:

    DccEx__Transport=Tcp
    DccEx__Host=192.168.1.100
    DccEx__Port=2560

DCC-EX Serial on Windows:

    DccEx__Transport=Serial
    DccEx__SerialPort=COM3

DCC-EX Serial on Linux:

    DccEx__Transport=Serial
    DccEx__SerialPort=/dev/ttyACM0

Linux USB serial devices are commonly exposed as `/dev/ttyACM*`,
`/dev/ttyUSB*`, or stable `/dev/serial/by-id/...` paths. The service user
must have permission to open the device (for example through the appropriate
serial-device group on the distribution).

Z21/YaMoRC use the normal network configuration and do not require a
platform-specific transport layer.

## Linux publish examples

Framework-dependent x64 build:

    dotnet publish -c Release -r linux-x64 --self-contained false

Framework-dependent ARM64 build:

    dotnet publish -c Release -r linux-arm64 --self-contained false

The same backend source targets `net10.0`; there is no `-windows` target
framework on `DCCExpressHub.Net`.

## HTTP/WebSocket contract

The existing React UI contract is preserved.

- WebSocket: `/ws` using the existing `{ type, data }` JSON contract
- command-center/configuration APIs under `/api/*`
- server-sent events for script info
- SPA hosting from `wwwroot`
- byte-range file serving for audio/media
- multipart file upload
- firmware-compatible virtual storage paths

The Watson migration changes the backend transport implementation, not the
WebUI API contract.

## Storage compatibility

The native backend keeps the firmware-facing storage namespaces:

- `/list?path=...`
- `POST /upload?path=...` (`multipart/form-data`, field `file`)
- `GET|DELETE /delete?path=...`
- `/api/files/text?path=...`
- `/flash/*`
- `/sd/*`
- `/images/*`
- `/version.json` fallback

The ESP32 LittleFS-facing `/flash` namespace is represented by the local
`data/` directory. The `/sd` namespace is represented by the local `sd/`
directory. Built React files live separately under `wwwroot/`.

Missing `/api/*` routes return JSON 404 instead of falling through to the SPA
index.
