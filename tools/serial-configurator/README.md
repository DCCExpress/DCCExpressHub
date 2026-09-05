# DCCExpressHub Serial Configurator

Vanilla JS recovery/configuration/firmware tool for DCCExpressHub.

## Requirements

- Windows
- Chrome or Microsoft Edge
- Node.js
- PlatformIO Core / VS Code PlatformIO
- Hub connected through USB serial

There is no npm install and no frontend build for this tool.

## Start

Double-click:

```text
start.cmd
```

or:

```powershell
node serve.mjs
```

Then open:

```text
http://127.0.0.1:8765/
```

The local server binds only to `127.0.0.1`.

## Firmware installer

The Firmware installer discovers COM ports through:

```text
pio device list --json-output
```

and uses PlatformIO's installed official `esptool.py`.

No CDN and no browser flashing dependency are required.

### Factory merged image

Select:

```text
Factory merged image — 0x000000
```

Use a file created by:

```powershell
.\build-merged.ps1
```

This is a full recovery image containing:
- bootloader
- partition table
- boot_app0
- firmware
- LittleFS

IMPORTANT: a factory merged image is written from address zero and resets NVS
configuration. After flashing, reconnect with `Connect configurator` and set the
Hub network and EX-CSB1 settings again.

### Application-only update

Select:

```text
Application firmware only — 0x010000
```

and choose PlatformIO's `firmware.bin`.

This preserves NVS configuration but does not update LittleFS / the embedded web UI.

### Flash flow

1. Choose COM port.
2. Choose image mode.
3. Choose local `.bin`.
4. Press `Flash selected firmware`.
5. If Web Serial is connected, the tool releases it first.
6. Local Node server starts esptool.py.
7. esptool output is streamed to the Firmware log.
8. ESP32 is hard-reset after a successful write.
9. Press `Connect configurator` and configure/test the Hub.

## Serial configuration

Hub network:
- Wi-Fi SSID
- Wi-Fi password
- hostname
- DHCP / static IPv4
- static IP
- gateway
- subnet
- DNS 1 / DNS 2
- HTTP + WebSocket port

EX-CSB1:
- host / hostname / IP
- TCP port
- POWER controls MAIN only vs MAIN + PROG

Network changes require Hub restart.
EX-CSB1 settings are applied immediately.

## EX-CSB1 test

The test performs:
1. hostname / DNS / mDNS resolution
2. TCP connect
3. sends DCC-EX `<#>`
4. requires a valid `<# ...>` reply
5. reports resolved IP and elapsed time

## Minimal console

Plain commands:

```text
help
status
config
restart
dcc <s>
dcc <t 18>
```

In the browser console a line starting with `<` is automatically wrapped as a
DCC-EX direct command.

## Serial protocol

Structured firmware responses begin with:

```text
@HUBCFG 
```

and the remainder of the line is JSON.

Example:

```json
{"id":1,"cmd":"status"}
```

Response:

```text
@HUBCFG {"id":1,"ok":true,"cmd":"status","status":{...}}
```

Normal firmware logger output remains separate and is shown in the console.


## v3 serial connection behavior

There is no separate COM selector for firmware flashing.

`Connect configurator` is the single device-selection step. The tool maps the
selected Web Serial USB VID/PID to the Windows COM port automatically before the
browser locks it.

Opening some ESP32 USB-UART adapters can reset the ESP32. Therefore the tool
does not send one immediate `hello` and disconnect on failure. It waits and
retries the HUBCFG handshake.

If the firmware does not implement HUBCFG, the serial connection remains open
in `RECOVERY MODE`, so firmware flashing and serial log access still work.
