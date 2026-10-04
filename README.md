# DCCExpressHub

DCCExpressHub is a control and automation system for model railways using **DCC-EX**, **Roco Z21** or compatible command stations.

It provides one interface for driving locomotives, operating turnouts and signals, editing the layout, following trains, running automatic movements and timetables, and using sensors for safer operation.

You can run DCCExpressHub on:

- **Windows Desktop / Server** — the primary platform and recommended choice for automation.
- **ESP32-S3 Hub** — the supported standalone embedded platform.

The same layout can be controlled from PCs, notebooks, tablets and phones on the local network.

> **DCCExpressHub is not a command station.**
>
> The connected command station still generates the DCC track signal. DCCExpressHub sits above it and provides the control, layout and automation functions.

![DCCExpressHub screenshot](doc/images/Screenshot_2026-09-23_182817.png)

## How it works

```text
 PC / tablet / phone
         |
         v
   DCCExpressHub
   Windows or ESP32-S3
         |
         v
  Command station
 DCC-EX / Z21 / YD7010
         |
         v
 Model railway layout
```

## Alpha2 highlights

Alpha2 is a major step forward for automatic operation and layout control.

Main improvements:

- automatic train movements with route and turnout handling,
- train tracking using occupancy sensors,
- safer route execution and unknown occupancy detection,
- timetable operation,
- visual automation flows and scripts,
- improved route preview and block event configuration,
- locomotive calibration,
- improved DCC-EX sensor and console support,
- new layout decorations and buildings,
- Windows as the primary automation platform,
- ESP32-S3 as the supported standalone embedded platform.

### Movement / Dispatcher

The backend Movement engine provides:

- route execution,
- target block reservation,
- turnout reservation and release,
- route and sensor safety checks,
- unknown occupancy handling,
- emergency-stop integration,
- movement events and actions,
- blocking and background action sequences,
- hold / release support,
- cruise speed handling,
- runtime logging.

### Train tracking

Train tracking can follow locomotives through the layout using:

- DCC-EX sensor states,
- the generated route graph,
- turnout positions,
- block occupancy,
- active sensor history,
- direction and movement state.

### Route and block configuration

The layout runtime includes:

- generated route graph,
- route direction validation,
- segment parts,
- composite block / segment sensor nodes,
- dynamic route-vector previews,
- per-direction block event configuration,
- configurable **APPROACH**, **ARRIVED** and **LEAVE** sensor conditions,
- per-event delays.

### Layout editor

The layout editor supports track elements, blocks, sensors, signals, turnouts and decorative layers.

Current decoration elements include:

- trees,
- bushes,
- lamps,
- station building,
- switchman's hut,
- garden house.

Buildings can be hidden independently with the **Building visibility** display option.

## Windows Desktop

The Windows version is the **primary DCCExpressHub platform**.

It can run locally on the same PC as the user interface or as a network server for other PCs, tablets and phones.

The Windows backend supports these command-station connections:

- **DCC-EX TCP/IP**
- **DCC-EX Serial / USB COM port**
- **Roco Z21 UDP**
- **YaMoRC YD7010**

> **Source-code status**
>
> Roco Z21 and YaMoRC YD7010 support are currently available in the source code / development build only.
> They are **not yet included in the current published release package**.

Typical architecture:

```text
 Browser / Desktop UI
         |
      HTTP / WS
         |
         v
 DCCExpressHub.Net
   ASP.NET Core
         |
      TCP / USB
         |
         v
       DCC-EX
```

### Download and install

Download the Windows package from:

https://github.com/DCCExpress/DCCExpressHub/releases

The published package is typically named:

```text
DCCExpressHub-<version>-win-x64.zip
```

Extract the complete archive to a writable directory and run:

```text
DCCExpressHub.Desktop.exe
```

Do not run the application directly from inside the ZIP archive.

### Windows SmartScreen

DCCExpressHub alpha releases may not be digitally signed.

If Microsoft Defender SmartScreen reports an unknown publisher, first verify that the package came from the official DCCExpressHub GitHub Releases page.

### Local mode

The default Desktop Hub port is:

```text
5174
```

Local mode listens only on:

```text
127.0.0.1:5174
```

### Server mode

Server mode exposes the Hub to the local network so another PC, tablet or phone can connect using the Windows PC's LAN address.

Example:

```text
http://192.168.1.100:5174
```

Use Server mode only on a trusted local network.

### Persistent workspace

User data is stored outside the application directory.

Default location:

```text
%LOCALAPPDATA%\DCCExpressHub\workspace
```

This keeps layout, configuration and state data separate from the installed application files.

## ESP32-S3 Hub

**ESP32-S3 is the only supported ESP32 platform for current DCCExpressHub development.**

The current supported embedded hardware is:

- **Sunton ESP32-8048S043**
- ESP32-S3
- 4.3" display
- 16 MB flash
- PSRAM

The ESP32-S3 Hub can host the shared browser interface and connect to the DCC-EX command station over TCP/IP.

```text
 PC / tablet / phone
         |
      HTTP / WS
         |
         v
 DCCExpressHub ESP32-S3
         |
       TCP/IP
         |
         v
       DCC-EX
```

The **Windows backend remains the primary target for advanced automation**. ESP32-S3 is maintained as the embedded / standalone platform.

### Build ESP32-S3 firmware

The current reference PlatformIO environment is:

```text
sunton-8048s043-dccex
```

Build a merged image with:

```powershell
.\build-merged.ps1 -Environment sunton-8048s043-dccex
```

Merged firmware is written to:

```text
dist\firmware
```

### Installation

The DCCExpressHub Web Installer is available at:

https://dccexpress.github.io/DCCExpressHubWeb/installer/

Use desktop **Google Chrome** or **Microsoft Edge** for Web Serial / ESP Web Tools support.

The serial console uses:

```text
115200 baud
```

Typical configuration:

```text
Hub hostname:     dccexpresshub
Browser URL:      http://dccexpresshub.local

DCC-EX host:      dccex.local
DCC-EX TCP port:  2560
```

## Command station support

DCCExpressHub is developed primarily against **DCC-EX**, including **EX-CSB1**, but the Windows backend also contains native support for **Roco Z21** and **YaMoRC YD7010**.

| Command station | Windows backend | Published release |
| --- | --- | --- |
| DCC-EX TCP | Supported | Yes |
| DCC-EX Serial / USB | Supported | Yes |
| Roco Z21 | Supported in source | Not yet |
| YaMoRC YD7010 | Supported in source | Not yet |

### DCC-EX

DCC-EX remains the current reference backend.

Sensor feedback is received through normal DCC-EX sensor events such as:

```text
<Q ...>
<q ...>
```

This allows block occupancy and route sensors to use the same backend runtime that drives tracking, Movement and Dispatcher safety.

### Roco Z21

The Windows backend contains native Z21 LAN support.

Current implementation includes:

- Z21 UDP connection,
- track power control,
- emergency stop and release,
- locomotive speed and direction,
- locomotive functions,
- turnout / basic accessory control,
- Z21 feedback handling.

The default Z21 LAN port is:

```text
21105 / UDP
```

Roco Z21 support is currently **source-code / development-build only** and is not yet included in the published release package.

### YaMoRC YD7010

The Windows backend has a dedicated **YaMoRC YD7010** profile.

Control and feedback use two parallel network connections:

```text
DCCExpressHub.Net
      |
      +---- Z21 UDP 21105 --------> locomotive / turnout / power control
      |
      +---- LocoNet LBServer 1234 -> S88 / occupancy feedback
      |
   YaMoRC YD7010
```

YaMoRC YD7010 support is currently **source-code / development-build only** and is not yet included in the published release package.

#### Required YaMoRC YD7010 settings

In the YaMoRC configuration utility configure the following:

1. Under the network / LAN protocol settings:

   ```text
   Z21                 ON
   Z21 port            21105

   LocoNet LBServer    ON
   LBServer port       1234
   ```

   DCCExpressHub does not require the separate **LocoNet Binary** connection for the YD7010 profile.

2. Under:

   ```text
   LocoNet -> Expert
   ```

   enable:

   ```text
   Interrogate: Report All Feedbacks
   ```

   DCCExpressHub uses the same LocoNet interrogation mechanism used by JMRI to request the current feedback state after connecting.

3. Under:

   ```text
   ES-Link / s88N-IN
   ```

   configure **1ter Kontakt im Rückmeldebereich** so that the generated YaMoRC feedback addresses match the sensor addresses used by the Hub.

   Important: the YaMoRC value is **one below** the first Hub sensor address.

   Example:

   ```text
   First Hub sensor address:                   1001
   YaMoRC "1ter Kontakt im Rückmeldebereich": 1000
   ```

   The resulting S88 addresses are then:

   ```text
   S88 input 1  -> Hub sensor 1001
   S88 input 6  -> Hub sensor 1006
   S88 input 7  -> Hub sensor 1007
   S88 input 20 -> Hub sensor 1020
   ```

4. Save YaMoRC configuration changes with the **green check mark**.

The Desktop launcher provides a **YaMoRC YD7010** connection profile. Its connection test checks both the Z21 control connection and the LBServer feedback connection required for automation.

## S88 / s88-N feedback

With **YaMoRC YD7010**, S88 feedback is received directly through the YD7010 LocoNet LBServer connection described above.

With **DCC-EX**, S88 feedback can be integrated through the companion **DCCExpress-S88Adapter** project:

https://github.com/DCCExpress/DCCExpress-S88Adapter

The preferred integration is through the DCC-EX HAL driver included under:

```text
dcc-ex/
├── IO_DCCExpressS88.h
├── myHal.example.cpp
└── sensors-1001-1032.txt
```

The adapter then appears to DCC-EX as normal VPIN inputs and DCC-EX emits standard sensor messages to DCCExpressHub.

Example:

```cpp
#include "IO_DCCExpressS88.h"

void halSetup() {
    DCCExpressS88::create(1001, 32, 0x30);
}
```

## PC, tablet and mobile use

DCCExpressHub can be controlled from a modern browser on:

- Windows PCs,
- notebooks,
- tablets,
- phones.

Clients connect either to:

- Windows Desktop running in **Server mode**, or
- an ESP32-S3 Hub.

## Build and development

### Requirements

For Windows development:

- Node.js / npm
- .NET 10 SDK
- Microsoft Edge WebView2 Runtime
- Visual Studio optional

For ESP32-S3 development:

- Node.js / npm
- PlatformIO
- ESP32-S3 PlatformIO toolchain

Clone:

```bash
git clone https://github.com/DCCExpress/DCCExpressHub.git
cd DCCExpressHub
```

### Windows Desktop development build

```powershell
.\build-desktop.ps1
```

Release build:

```powershell
.\build-desktop.ps1 -Configuration Release
```

Create a publish package:

```powershell
.\build-desktop.ps1 -Clean -Publish
```

The publish output is written under:

```text
dist\desktop
```

### Web UI development

```powershell
cd web-ui
npm install
$env:DCCEXPRESS_DEVICE_URL="http://127.0.0.1:5174"
npm run dev
```

Vite uses:

```text
http://localhost:5173
```

Demo mode:

```powershell
cd web-ui
npm run dev:demo
```

## Repository structure

```text
DCCExpressHub/
├── src/                         ESP32-S3 firmware
├── include/                     firmware headers / defaults
├── web-ui/                      shared React + Mantine frontend
├── desktop/
│   ├── DCCExpressHub.Net/       ASP.NET Core 10 backend
│   ├── DCCExpressHub.Desktop/   WPF + WebView2 shell
│   └── DCCExpressHub.Desktop.slnx
├── dcc-ex/                      DCC-EX HAL integrations
├── data/                        prepared embedded Web UI / LittleFS data
├── tools/
├── platformio.ini
├── VERSION
├── build-web.ps1
├── build-desktop.ps1
└── build-merged.ps1
```

## Versioning and releases

The repository-root `VERSION` file is the project version source.

Current alpha2 version:

```text
0.1.0-alpha.2
```

GitHub releases:

https://github.com/DCCExpress/DCCExpressHub/releases

Alpha releases are published as **pre-releases**.

## Project status

DCCExpressHub is under active **alpha development**.

The Windows backend is the primary runtime and development target. ESP32-S3 is the supported embedded target.

Interfaces, automation behaviour and hardware support may still change while the project evolves.

## Links

Project website:

https://dccexpress.github.io/DCCExpressHubWeb/

GitHub Releases:

https://github.com/DCCExpress/DCCExpressHub/releases

ESP32-S3 Web Installer:

https://dccexpress.github.io/DCCExpressHubWeb/installer/

DCC-EX:

https://dcc-ex.com/

S88 adapter:

https://github.com/DCCExpress/DCCExpress-S88Adapter

## License

See the repository license for the current project licensing terms.
