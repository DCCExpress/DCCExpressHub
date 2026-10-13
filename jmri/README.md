# JMRI JSON API Explorer (alpha6)

Isolated **experimental debugger** for the JMRI Web Server. It does not replace DCCExpressHub.Net, load the Hub's data, or change any existing Web UI. No JMRI installation is required to build the UI, but a running JMRI Web Server is required for live responses.

## Requirements

- Node.js 20.19+ or 22.12+ (compatible with Vite 7), npm
- JMRI Web Server enabled (usually HTTP port **12080**)
- For a quick API check, JMRI's own `http://localhost:12080/json/` provides a WebSocket console.

## Run

```bash
cd jmri
npm install
npm run dev
```

Open **http://localhost:5186**.

The dev server proxies `/jmri/json` to `http://127.0.0.1:12080/json` for **both HTTP and WebSocket**. This avoids browser CORS problems and keeps the JMRI address out of the React source.

If JMRI runs on a different machine, set **JMRI_TARGET** on the **Vite host** before starting Vite:

```bash
# Linux
JMRI_TARGET=http://192.168.1.100:12080 npm run dev

# PowerShell
$env:JMRI_TARGET="http://192.168.1.100:12080"
npm run dev
```

If you run Vite inside a container, `127.0.0.1` means the container, not the host. Use the reachable JMRI address.

## Hub-style locomotive throttle

Choose **Loco throttle** in the sidebar, click **Connect WS**, choose a locomotive from the JMRI Roster. Selecting another locomotive automatically releases the old JMRI throttle handle and acquires the new one; no separate Connect/Release buttons are needed.
The panel uses the same socket as the JSON debugger and shows live speed, direction, functions F0–F28 and JMRI client count.
Use **STOP** or **EMERGENCY STOP** as appropriate. Switching the selected locomotive only relinquishes the previous session; it does not stop a moving locomotive.
Direction changes are disabled while nonzero speed is reported. The percentage speed is a normalized JMRI throttle setting, not the Hub's calibrated km/h.
The UI is an experimental test of the JMRI throttle protocol; it is not integrated with the Hub dispatcher, tracking, reservation, or safety logic.

## Explorer functionality

- HTTP GET for `/json/type`, all listed object types and named objects
- Raw JSON response / field inspection (including state/address/identifier data)
- JSON WebSocket connect/disconnect; raw messages and subscription updates
- Sample commands for ping, sensors, turnouts, panels, power, memories and throttle
- Searchable, copyable session diagnostics
- Every non-read-only or ambiguous raw WebSocket command requires explicit confirmation

**Safety**: The debugger is a development tool, not an operator HMI. Raw JMRI commands can move locomotives or throw turnouts. A throttle request may acquire control even if it is formatted as a GET. Use on a disconnected test instance initially. The app has no authentication, and Vite binds to all interfaces for LAN testing; only expose it on a trusted/private network, never directly on the Internet.

## Protocol notes

JMRI supports versioned JSON endpoints, e.g. `/json/version`, and may require a specific protocol version on newer installations. This initial debugger uses the default `/json` protocol for discovery. If the server reports an unsupported default version, version negotiation is the next investigation item.

The live JMRI API may contain separate categories / different singular and plural names. Discovery and raw response display let us verify these rather than hardcoding business assumptions.

References:

- https://www.jmri.org/help/en/html/web/JsonServlet.shtml
- https://www.jmri.org/JavaDoc/doc/jmri/server/json/package-summary.html

## Build

```bash
npm run build
npm test
```

`npm run preview` serves a static build **without** the Vite development proxy. For live connections use `npm run dev` or supply an equivalent reverse proxy for `/jmri`.
