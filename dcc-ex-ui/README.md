# DCCExpressHub Browser Edition (alpha7)

Standalone React + Vite + Mantine proof of concept. No DCCExpressHub .NET backend and no ESP32-hosted Hub runtime.

## Run

```bash
cd dcc-ex-ui
npm install
npm run dev
```

## Connection

Enter a **real WebSocket URL** accepting and returning **raw DCC-EX ASCII frames**. This is *not* the existing Hub JSON WebSocket protocol. The usual DCC-EX Wi-Fi/TCP interface (often port 2560) is raw TCP, **not WebSocket**, and cannot be opened by `new WebSocket(...)`. For raw TCP-only stations, Web Serial or an optional WS-to-TCP bridge is needed in a later step. The URL shown in the form is only an editable example, not a confirmed endpoint.

Supported prototype commands: `<s>` station status; `<t addr speed dir>` speed and direction; `<F addr fn state>` F0; `<1>`/`<0>` track power. Use a test locomotive and have physical emergency stop available. The app stops the active locomotive on manual disconnect where possible, but network loss/browser closure cannot guarantee a stop.

The DCC-EX protocol handling is based on the existing repository's `desktop/DCCExpressHub.Net/CommandCenter/DccExProtocol.cs` and DCC-EX command usage; this is a fresh browser-only implementation. Further steps: Web Serial transport, reusable connection service, status parsing, IndexedDB project storage, multi-function throttle and import/export.
