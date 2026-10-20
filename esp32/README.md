# DCCExpressHub ESP32-S3 experimental runtime

Isolated PlatformIO + React/Mantine/Vite prototype on branch `feature/esp32-runtime`. No changes to existing .NET backend.

## Firmware
Open `esp32/firmware` in PlatformIO and check the actual ESP32-S3 board model. Build/upload the firmware. It creates AP `Hub-ESP32-Test`, password `hub-test-1234`, IP `192.168.4.1`. These fixed credentials are only for isolated lab testing.

HTTP async server: `GET http://192.168.4.1/api/health`
WebSocket: `ws://192.168.4.1/ws`

## Web UI
From `esp32/web-ui`, run `npm install` then `npm run dev`. Connect the computer to the test AP. The page connects via WS and receives snapshots and changes. It reconnects after a broken connection; no polling.

## WebSocket protocol
Outgoing client JSON:
- `{"type":"snapshot.get"}`
- `{"type":"accessory.set","address":20,"value":true}` (logical state)
- `{"type":"accessory.feedback","address":20,"raw":false}` (TEST injection only)
- `{"type":"accessory.config","address":22,"inverted":true}`
- `{"type":"accessory.invalidate","address":20}`

Incoming server JSON:
- `{"type":"snapshot","sequence":0,"overflow":false,"accessories":[...]}`
- `{"type":"accessory.changed","address":20,"value":"on","sequence":1}`
- `{"type":"accepted"}` (queued/accepted only, NOT physically executed)
- `{"type":"error","reason":"..."}`
- `{"type":"resync.required"}`

Callbacks enqueue compact messages using a FreeRTOS queue; Arduino loop owns the Runtime and broadcasts events. The mock command center loops outgoing commands back into hardware feedback. No real DCC hardware interaction yet.

**Not production safe:** no authentication, fixed test AP password, no TLS, no physical state verification, limited queue capacity, no automatic safety recovery from event overflow. The ArduinoJson and asynchronous WebSocket internals use dynamic allocation; the Runtime arrays and command/event queues remain fixed-capacity.

## Command centers
- `ICommandCenter` is hardware-neutral.
- `MockCommandCenter` is the default and synthesizes feedback.
- `DccExSerialCommandCenter` uses ESP32-S3 Serial1 UART (3.3V TTL), 115200 8N1. Define `HUB_USE_DCCEX_SERIAL=1` in firmware build_flags, with UART RX/TX pin macros defaulting to GPIO17/18.
- Connect TX to RX, RX to TX, and GND with matched 3.3V logic; verify pins are free on your board. **USB to the DCC-EX Arduino needs an ESP32-S3 USB-host transport, not covered by this UART implementation.**
- DCC-EX uses `<a LINEAR_ADDRESS ACTIVATE>` for a basic accessory command; this does not verify physical turnout state. Real mode does not fake feedback.
- Periodic `<s>` probes establish serial responsiveness. The driver currently does not implement locomotive control or decoder programming.

## DCC-EX TCP configuration (new)

Default driver is Mock. The React/Mantine UI now offers **Command Center connection**:
- Driver: Mock or DCC-EX TCP
- TCP host/IP and port (default 2560; verify against your station)
- Wi-Fi SSID/password for the ESP32 station connection

Press **Save & reconnect** to persist settings using ESP32 Preferences/NVS and reconfigure the command-center driver. The ESP32 keeps its bench access point (`Hub-ESP32-Test`) active while attempting to join the configured Wi-Fi network (AP+STA). The DCC-EX host must be reachable on that Wi-Fi network. If you are using the device's AP only, a remote TCP command station on another network is not reachable without configuring STA connectivity.

The WebSocket settings protocol is:
- `{"type":"cc.config.get"}`
- `{"type":"cc.config.set","driver":"dcc-ex-tcp","host":"192.168.1.100","port":2560,"wifiSsid":"YourNetwork","wifiPassword":"YourPassword"}`
- `{"type":"cc.config","driver":"dcc-ex-tcp","host":"192.168.1.100","port":2560,"wifiSsid":"YourNetwork","wifiConnected":true,"ccConnected":true}`

Blank password in a setting update preserves the previously stored password; no password is sent in config snapshots. Do not expose this unauthenticated bench-only WebSocket to untrusted clients. The previous UART driver source is retained for reference, but the running firmware now selects Mock/TCP and does not instantiate the UART driver.

DCC-EX TCP uses `<s>` status probes and `<a address 0|1>` accessory commands. The connection status reports responsiveness, **not** verified physical turnout position. A real DCC-EX connection does not fabricate hardware feedback: accessory state remains Unknown unless actual feedback handling is added.

This is an initial implementation without a verified ESP32-S3/PlatformIO hardware build. 
