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

## Hardware identification

See [HARDWARE-MAPPING.md](HARDWARE-MAPPING.md). An opt-in read-only GPIO candidate monitor logs changes to serial console; it is **off by default** and must not be used as a reason to flash over the factory firmware.

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

## Current firmware mode: hardware discovery

The main application currently runs **hardware-discovery-only**: no Wi-Fi,
no Z21 network operations. It prints a heartbeat every second and watches
18 candidate input pins for transitions at 10 ms intervals. It deliberately
excludes flash, UART0 and boot strapping pins. No display driver is present:
the screen is expected to stay dark until its controller/bus/power lines
are identified. The physical controls might use an I2C/SPI GPIO expander or
keyboard matrix, so **no GPIO transitions does not prove broken controls**.

When testing, keep the serial monitor open, press keys, rotate the encoder
slowly and copy any `piko_hw: GPIO ...` lines. No changes means next steps
are PCB photos and factory firmware pin tracing, not random GPIO driving.

## Reverse-engineering the factory firmware (offline, no flashing)

For your full 16 MB factory backup, run:

```powershell
python piko/tools/trace_handheld.py .\\piko\\PIKO-Handheld-Original-16MB.bin
```

The script reads the ESP-IDF partition table and selects a valid `factory` app by default (if present), otherwise the first valid app. For OTA images, use `--partition ota_0` or `--partition ota_1`. You can also specify `--app-offset 0x10000` if the partition table is missing. It never modifies the input.



A confirmed `Firmware-Handheld.bin` image contains keypad, rotary
and LCD string references but **not a known pin map**.

On Windows with PlatformIO installed, run:

```powershell
python piko/tools/trace_handheld.py "C:\\path\\to\\2025-12-11_Update_PSCW_1_3_0_0.zip"
```

The script accepts the original PIKO update ZIP, an extracted Firmware-Handheld.bin,\nor a complete 16 MB ESP32 flash dump. It detects the PlatformIO Xtensa objdump, disassembles the ESP32 image
code segments, and writes candidate `l32r` callers to
`piko/analysis/handheld_xrefs.txt`. Share the relevant report excerpts
for further GPIO/SPI tracing. This is a heuristic: disassembly of raw
binary may be misaligned, and candidate instructions must be verified.
Do **not** put the vendor firmware or flash dump into Git.

For deeper analysis use Ghidra's ESP32 flash-image loader, which
supports application images and maps the ESP32 memory segments.


### Verified keypad pin candidates from original firmware

All three versions in the user's full flash backup call the keypad setup
routine with six GPIO arguments: **26, 14, 27, 32, 33, 34**.
This is strong evidence of a six-wire keypad interface, **not yet
a confirmed row/column, HC595 or encoder pin map**.
Details and code addresses: [HARDWARE-MAPPING.md](HARDWARE-MAPPING.md).

To extract full Xtensa disassembly near the keypad, rotary and LCD
handlers from the original 16 MB backup, run:

```powershell
python piko/tools/trace_peripherals.py .\\piko\\PIKO-Handheld-Original-16MB.bin --partition ota_1
```

Output: `piko/analysis/peripheral_calls.txt`. This performs offline
read-only analysis. The output contains code and pointers, not personal
configuration secrets from NVS.
