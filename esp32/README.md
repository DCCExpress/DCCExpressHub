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
