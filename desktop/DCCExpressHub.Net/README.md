# DCCExpressHub .NET 10 backend

Cross-platform Windows/Linux backend for the existing DCCExpressHub React UI.

## Quick start

1. Install .NET 10 SDK.
2. Edit `appsettings.json`.
3. For DCC-EX TCP use `"Transport": "Tcp"`, host and port 2560.
4. For USB/UART use `"Transport": "Serial"`, e.g. `COM3` on Windows or `/dev/ttyACM0` on Linux.
5. Copy the **contents** of the React/Vite `dist` folder into `wwwroot`.
6. Run:

    dotnet restore
    dotnet run

7. Open `http://localhost:5174`.

## Implemented DCC-EX parity

- TCP and Serial transports
- reconnect loop
- `<#>` heartbeat / alive state
- startup `<s>`
- DCC-EX frame parser
- station info `<i...>` and max locos `<# n>`
- track config `<= A ...>`
- current `<jI...>` and trip `<jG...>` telemetry
- power feedback `<p0...>` / `<p1...>`
- loco feedback `<l ...>`
- track/programming power
- emergency stop
- loco speed/direction
- loco functions F0-F28
- turnout/basic accessory
- extended signal aspect
- VPin
- raw DCC-EX command
- WebSocket `/ws` using the existing `{ type, data }` contract
- basic decoder-programming command sending
- `wwwroot` SPA hosting
- `/api/command-center-info`, `/api/capabilities`, `/api/locos`, `/api/layout`

## Deliberately not claimed as complete firmware parity yet

The ESP32 firmware contains much more than DCC-EX transport: LayoutRuntime, blocks, S88, JS sandbox/automation, file manager, signal automation and device configuration. This first .NET backend focuses on the requested DCC-EX communication + the UI transport contract. Unknown WS commands return the same style `ack` instead of crashing.

One known parity gap in this first build is the firmware's full correlated decoder-programming reply state machine (`<r ...>` / `<v ...>` timeout/correlation). Commands are sent and raw replies are exposed; the complete correlator should be ported next.

## LittleFS compatibility layer

This build adds a native filesystem implementation for the ESP32 LittleFS-facing UI contract.

- `/list?path=...`
- `POST /upload?path=...` (`multipart/form-data`, field `file`)
- `GET|DELETE /delete?path=...`
- `/api/files/text?path=...`
- `/flash/*`
- `/images/*`
- `/version.json` fallback

The ESP32's LittleFS is represented by the local `data/` directory. Copy only the built React `dist` files into `wwwroot/`; configuration and uploaded files stay under `data/`.

Missing `/api/*` routes now return JSON 404 instead of falling through to `index.html`, so frontend errors no longer become `Unexpected token '<'`.
