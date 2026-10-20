# DCCExpressHub ESP32-S3 experimental runtime

Isolated PlatformIO + React/Mantine/Vite prototype on branch `feature/esp32-runtime`. This is NOT production-safe and does not change the current .NET backend.

## Firmware
Open `esp32/firmware` in PlatformIO. Verify that the target board is your actual ESP32-S3 variant, then build/upload. The device creates AP `Hub-ESP32-Test`, password `hub-test-1234`, API IP `192.168.4.1`. Change credentials before any use beyond a local bench.

## Web test UI
From `esp32/web-ui`, run `npm install` and `npm run dev` (Node >=20.19). Connect the PC to the ESP32 access point and open Vite's URL.

## API
- GET /api/accessories
- POST /api/accessory/set?address=20&value=true
- POST /api/accessory/feedback?address=20&raw=false (TEST injection only)
- POST /api/accessory/config?address=22&inverted=true

The runtime stores raw feedback, applies XOR on read and outgoing commands, and emits a sequenced ValueChanged event. The simulated CC loops outgoing commands back into feedback. The UI polls full snapshots once per second; events print to Serial. Queues and tables are fixed-size; event queue overflow requires safe resynchronization. No true hardware feedback, authorization, TLS or real command station driver is included.
