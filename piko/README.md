# DCCExpress PIKO handheld (experimental)

Standalone ESP32-WROOM-32E (16 MB flash) ESP-IDF PlatformIO project.
It does not use the repository-root firmware source tree.

## Implemented source foundation
- Wi-Fi station startup and reconnection
- Z21 UDP client to a configurable DCCExpressHub IP/port
- Z21 GET_SERIAL_NUMBER, GET_LOCO_INFO, 128-step SET_LOCO_DRIVE,
  and F0–F28 ON/OFF frames with XOR
- Receive and parse locomotive state responses, including direction and functions
- Thread-safe locomotive snapshot API, to be consumed by the display/UI
- No automatic drive commands at startup

## Not implemented yet
- Physical display, rotary encoder, keys, battery and power GPIO mappings
- On-device configuration UI and address selection
- Full Z21 handshake/broadcasts, turnouts and emergency stop
- Verified interoperability with the current HUB and physical hardware

Build without flashing:

```powershell
pio run -d piko
```

Configure (local, untracked credentials in `piko/sdkconfig`):

```powershell
pio run -d piko -t menuconfig
```

**Do not upload yet.** First complete the factory 16 MB flash backup,
check security/eFuse settings and restoration, and map the actual hardware.
Flashing this skeleton would replace the factory handheld application.
