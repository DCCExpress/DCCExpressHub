# DCCExpressHub

Minimal ESP32 firmware + React/Mantine UI for forwarding DCC-EX commands to a CSB1/CommandStation over TCP.

## Current functions

- ESP32 connects to your Wi-Fi.
- Runtime configurable CSB1 host/IP + TCP port, persisted in ESP32 Preferences/NVS.
- Track power ON/OFF (`<1>` / `<0>`).
- Raw DCC-EX console. Missing `< >` are added automatically.
- TX/RX log from the CSB1 TCP connection.
- React + Mantine frontend.
- Vite development mode with `/api` proxy to the ESP32.
- Production frontend is gzip-compressed into LittleFS.

## 1. Wi-Fi configuration

Copy/edit:

`include/config.example.h` -> `include/config.h`

Set:

```cpp
#define WIFI_SSID "..."
#define WIFI_PASSWORD "..."
#define DEFAULT_CSB1_HOST "192.168.1.143"
#define DEFAULT_CSB1_PORT 2560
```

A starter `config.h` is already included in the ZIP so the project opens immediately; edit it before uploading.

## 2. Build the UI for ESP32

```bash
cd web-ui
npm install
npm run build:esp
```

This builds React and writes gzip files to the root `data/` directory, for example:

- `data/index.html.gz`
- `data/assets/*.js.gz`
- `data/assets/*.css.gz`

## 3. Upload with PlatformIO

From the project root:

```bash
pio run -t uploadfs
pio run -t upload
pio device monitor
```

Order does not matter after both firmware and filesystem have been uploaded.

## 4. Vite dev mode

The Vite dev server proxies `/api` to the ESP32.

Windows PowerShell:

```powershell
cd web-ui
$env:ESP32_URL="http://192.168.1.200"
npm run dev
```

CMD:

```cmd
cd web-ui
set ESP32_URL=http://192.168.1.200
npm run dev
```

Then open `http://localhost:5173`.

If `ESP32_URL` is not set, the default proxy target is `http://192.168.1.200`.

## API

- `GET /api/status`
- `GET /api/config`
- `POST /api/config` `{ "host": "192.168.1.143", "port": 2560 }`
- `POST /api/connect`
- `POST /api/power` `{ "on": true }`
- `POST /api/command` `{ "command": "<s>" }`
- `GET /api/log`
- `DELETE /api/log`

## Notes

This first version intentionally stays simple: one TCP client, polling UI, and an in-memory 80-line log. Later it can be upgraded to WebSocket/SSE, Wi-Fi provisioning, device discovery, turnout/signal panels, routes, sensors, and DCCExpressLite-compatible command abstractions.

## 5. ESP32 nélküli local development

A projekt tartalmaz egy PC-n futó mock backend-et, amely ugyanazokat az `/api/...`
végpontokat valósítja meg, mint az ESP32 firmware. A backend nem csak szimulál:
a megadott CSB1 címre valódi TCP kapcsolatot nyit, így VPN-en keresztül a valódi
DCC-EX CommandStation is tesztelhető.

### Egy parancsból Windows PowerShellen

```powershell
.\run-local.ps1 -CsbHost 192.168.1.143 -CsbPort 2560
```

Ez elindítja:

- local API: `http://127.0.0.1:3001`
- Vite UI: `http://localhost:5173`
- Vite `/api` proxy -> local mock API
- local mock API -> TCP -> CSB1

A CSB1 host/port a web UI-ból is átírható a futás során.

### Külön terminálokból

Terminál 1:

```powershell
cd web-ui
$env:CSB1_HOST="192.168.1.143"
$env:CSB1_PORT="2560"
npm run mock
```

Terminál 2:

```powershell
cd web-ui
$env:ESP32_URL="http://127.0.0.1:3001"
npm run dev
```

A mock backend kizárólag Node beépített `http` és `net` moduljait használja,
tehát nincs hozzá Express vagy más extra dependency.
