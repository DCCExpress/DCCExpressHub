# DCCExpressHub local DCC-EX mock

Local development mode does not require an ESP32 or a CSB1.

## Start

Terminal 1, from `web-ui`:

```powershell
npm run mock
```

Terminal 2, from `web-ui`:

```powershell
npm run dev
```

Open `http://localhost:5173`.

The mock currently simulates basic DCC-EX commands including power `<1>` / `<0>`, status `<s>`, turnout `<T ...>`, throttle `<t ...>`, accessory/aspect `<A ...>` and generic replies.

Extra debug endpoints:

- `GET /api/mock/state`
- `POST /api/mock/reset`

## Hub UI mock pages

The local DCC-EX simulator now backs these development pages:

- Home / simulator status
- DCC-EX console
- Mobile controller (throttle + F0-F7)
- Locomotive editor
- Layout editor (mock turnout list)
- Decoder programming (mock CV read/write)
- Device configuration
- Gamepad browser test

Additional mock endpoints:

- `GET/POST /api/locos`, `DELETE /api/locos/:id`
- `GET/POST /api/layout`
- `POST /api/programming`
- `GET/POST /api/devices`, `DELETE /api/devices/:id`

These are intentionally Hub-side contracts. When the real DCC-EX TCP transport is enabled, the UI pages can keep their API surface while the backend implementation changes from simulator state to real DCC-EX commands/storage.
