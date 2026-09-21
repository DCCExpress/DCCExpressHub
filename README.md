# DCCExpressHub

DCCExpressHub is a web-based control and integration layer for **DCC-EX** model railway command stations.

The project currently has two runtime targets:

- **ESP32 Hub firmware** — a standalone embedded Hub that serves the WebUI from LittleFS and connects to DCC-EX over the local network.
- **Windows Desktop** — a native .NET 10 backend with a WPF + WebView2 shell using the same React WebUI.

> **DCCExpressHub is not a command station.**
>
> The connected DCC-EX command station still generates the DCC signal. DCCExpressHub provides the user interface, configuration, automation and integration layer around it.

![DCCExpressHub screenshot](doc/images/Screenshot%202026-09-05%20110304.png)

```text
                         shared React WebUI
                                |
                  +-------------+-------------+
                  |                           |
                  v                           v
          ESP32 Hub firmware           Windows Desktop
          LittleFS / HTTP / WS        .NET 10 + WPF/WebView2
                  |                           |
                  +-------------+-------------+
                                |
                         DCC-EX protocol
                                |
                                v
                         Command station
                                |
                               DCC
                                |
                                v
                       Model railway layout
```

## Features

Current functionality includes:

- locomotive control, locomotive editor and function control,
- responsive PC, tablet and mobile WebUI,
- browser-based layout editor and runtime layout operation,
- turnouts, accessories, signals and signal logic,
- occupancy / sensor integration,
- decoder programming,
- browser-side frontend automation scripts,
- QuickJS backend automation / JavaScript Sandbox on supported ESP32-S3 targets,
- track power and emergency control,
- DCC-EX connection configuration,
- raw command console and diagnostics,
- gamepad support,
- external device configuration,
- LittleFS file browser on embedded targets,
- SD-card storage and audio playback on M5Stack Basic,
- complete Export / Import backup,
- browser-based ESP32 firmware installation,
- USB serial configuration and recovery for ESP32 targets,
- Windows Desktop runtime with local .NET backend and integrated server log.

## Runtime targets

### ESP32 Hub

The embedded version is a self-contained Hub. It serves the WebUI directly and communicates with the DCC-EX command station.

```text
PC / tablet / phone
        |
        | HTTP / WebSocket
        v
 DCCExpressHub ESP32
        |
        | DCC-EX native TCP protocol
        v
 Command station
```

### Windows Desktop

DCCExpressHub is also available as a native Windows Desktop application.

Download the current Windows package from the GitHub Releases page:

```text
DCCExpressHub-<version>-win-x64.zip
```

Then:

1. Extract the ZIP to a directory.
2. Start `DCCExpressHub.Desktop.exe`.
3. Configure the DCC-EX connection from the application.

The Windows package contains the DCCExpressHub backend and the shared WebUI. It does **not** require a separate ESP32 Hub.

The published `win-x64` package is self-contained, so the user does not need to install the .NET SDK.

Desktop keyboard shortcuts:

| Key | Function |
|---|---|
| **F10** | Show / hide the advanced menu |
| **F11** | Toggle fullscreen |
| **Esc** | Leave fullscreen |

The advanced menu includes **View -> Server Log** for showing or hiding the local backend log panel.

## Command-station support

DCCExpressHub is designed first and foremost for **DCC-EX / EX-CSB1**. DCC-EX is the current priority, reference implementation and officially supported command-station backend.

**Roco/Fleischmann Z21 LAN support is planned for a future release.** Experimental Z21 implementation remains in the source tree, but Z21 is not currently an officially supported target and no Z21 firmware is published in DCCExpressHub releases.

## S88 / s88-N feedback

DCCExpressHub can use S88 / s88-N occupancy feedback with the companion **DCCExpress-S88Adapter** project.

The current adapter implementation has been tested with the **YaMoRC YD6016ES-CS**.

Project repository:

https://github.com/DCCExpress/DCCExpress-S88Adapter

There are currently two integration paths in the repository.

### Hub-side adapter integration

The ESP32 Hub contains S88 adapter/device configuration support and can read supported adapter data over I2C on configured hardware.

### DCC-EX HAL integration

The repository also contains a DCC-EX HAL driver under:

```text
dcc-ex/
├── IO_DCCExpressS88.h
├── myHal.example.cpp
└── sensors-1001-1032.txt
```

This allows the S88 adapter to appear to DCC-EX as ordinary VPIN inputs. Standard DCC-EX Sensor objects can then emit normal `<Q>` / `<q>` sensor messages, so DCCExpressHub does not need an S88-specific protocol for that path.

Example:

```cpp
#include "IO_DCCExpressS88.h"

void halSetup() {
    DCCExpressS88::create(1001, 32, 0x30);
}
```

Mapping:

```text
S88 input 1  -> VPIN 1001
S88 input 2  -> VPIN 1002
...
S88 input 32 -> VPIN 1032
```

See `dcc-ex/README.md` for the integration details.

## M5Stack SD card and audio

The **M5Stack Basic** can use its built-in microSD slot for larger user files such as locomotive sounds and announcements.

Recommended card format:

```text
File system:          FAT32
Allocation unit size: 32 KB
Volume label:         DCCEXPRESS (optional)
```

**FAT32 is recommended. Do not use NTFS.** Large SDXC cards may need to be reformatted from exFAT to FAT32.

After a successful SD mount, the Hub automatically ensures this directory exists:

```text
/audio
```

Recommended layout:

```text
SD Card
└── audio
    ├── horn.mp3
    ├── station.mp3
    ├── crossing.mp3
    └── mav_szignal.mp3
```

MP3 is recommended. The browser performs audio decoding; the ESP32 streams the file from the SD card.

Upload sounds from:

```text
Files / File Manager
-> SD Card
-> audio
```

Virtual Hub paths look like:

```text
/sd/audio/mav_szignal.mp3
```

To use a sound on the layout:

1. Open **Layout editor**.
2. Add an **Audio Button**.
3. Set its label.
4. Select a file from `/audio`.
5. Use **Play / Test** if needed.
6. Save the layout.

Large audio files should be stored on SD rather than LittleFS.

## PC, tablet and mobile use

The shared WebUI works from a desktop PC, notebook, tablet or phone using a modern browser when it is served by an ESP32 Hub.

For a permanently mounted Android tablet, a fullscreen / kiosk browser such as **Fully Kiosk Browser** is useful. On iPhone/iPad, Safari works normally and Guided Access can be used for a dedicated control device.

On Windows, the native Desktop target provides an integrated alternative to running the Hub on a separate ESP32.

## Build and development

### Requirements

For ESP32 development:

- Node.js / npm
- PlatformIO
- ESP32 PlatformIO toolchain

For Windows Desktop development:

- Node.js / npm
- .NET 10 SDK
- Microsoft Edge WebView2 Runtime
- Visual Studio 2026 optional

Clone:

```bash
git clone https://github.com/DCCExpress/DCCExpressHub.git
cd DCCExpressHub
```

### ESP32 WebUI / LittleFS build

Build the shared WebUI and prepare the ESP32 LittleFS data:

```powershell
.\build-web.ps1
```

This builds `web-ui/dist/` and then prepares the firmware `data/` directory.

### ESP32 merged firmware

Build an official DCC-EX target:

```powershell
.\build-merged.ps1 -Environment m5stack-basic-dccex
.\build-merged.ps1 -Environment esp32dev-dccex
.\build-merged.ps1 -Environment waveshare-s3-lcd7-dccex
.\build-merged.ps1 -Environment sunton-8048s043-dccex
```

Merged firmware is written to:

```text
dist/firmware/
```

### Windows Desktop development build

```powershell
.\build-desktop.ps1
```

Release development build:

```powershell
.\build-desktop.ps1 -Configuration Release
```

The script rebuilds the shared WebUI, refreshes and verifies `desktop/DCCExpressHub.Net/wwwroot/`, and builds `desktop/DCCExpressHub.Desktop.slnx`.

To create the distributable Windows release package:

```powershell
.\build-desktop.ps1 -Configuration Release -Clean -Publish
```

This creates a self-contained `win-x64` publish and packages it as:

```text
dist/desktop/DCCExpressHub-<VERSION>-win-x64.zip
```

The version is read from the repository-root `VERSION` file.

### WebUI development

The frontend is **React + Mantine + TypeScript + Vite** and is shared by the embedded and Windows targets.

Against a real Hub:

```powershell
cd web-ui
npm install
$env:DCCEXPRESS_DEVICE_URL="http://dccexpresshub.local"
npm run dev
```

Open:

```text
http://localhost:5174
```

Development without hardware:

```powershell
# Terminal 1
cd web-ui
npm run mock

# Terminal 2
npm run dev:mock
```

The mock backend is useful for UI, editor, API and WebSocket development without repeatedly flashing an ESP32.

## Versioning and ESP32 releases

The repository-root `VERSION` file is the single source of truth for the current firmware release flow.

Example:

```text
0.1.0-alpha.2
```

Create an official firmware release with:

```powershell
.\release.ps1 0.1.0-alpha.2
```

The release helper:

- updates `VERSION`,
- synchronizes the WebUI npm package version,
- creates a release commit,
- creates the matching annotated Git tag,
- pushes the branch and tag,
- starts the GitHub Actions release workflow.

The workflow refuses to publish if the Git tag and `VERSION` do not match.

Official firmware releases currently contain:

```text
m5stack-basic-dccex
esp32dev-dccex
waveshare-s3-lcd7-dccex
sunton-8048s043-dccex
```

Z21 remains a future-development target and is not included in official releases.

## Repository structure

```text
DCCExpressHub/
├── src/                         ESP32 firmware
├── include/                     firmware headers / defaults
├── web-ui/                      shared React + Mantine frontend
├── desktop/                     Windows native runtime
│   ├── DCCExpressHub.Net/       .NET 10 Hub backend + committed wwwroot
│   ├── DCCExpressHub.Desktop/   WPF + WebView2 shell
│   └── DCCExpressHub.Desktop.slnx
├── dcc-ex/                      DCC-EX HAL integrations
├── data/                        prepared ESP32 LittleFS content
├── tools/firmware/              merged firmware tools
├── platformio.ini               ESP32 hardware / command-station targets
├── VERSION                      firmware release version source
├── release.ps1                  firmware release helper
├── build-web.ps1                WebUI + ESP32 LittleFS preparation
├── build-desktop.ps1            Windows Desktop + wwwroot build
├── build-merged.ps1
└── build-all-merged.ps1
```

The ESP32 firmware remains at the repository root (`src/`, `include/`, `platformio.ini`). The native Windows implementation lives under `desktop/`. Both targets share `web-ui/`.

## Project status and links

DCCExpressHub is under active **alpha development**. Interfaces, hardware support, Desktop support and command-station backends may change while the project evolves.

Project website:

https://dccexpress.github.io/DCCExpressHubWeb/

ESP32 Web Installer:

https://dccexpress.github.io/DCCExpressHubWeb/installer/

DCC-EX:

https://dcc-ex.com/

Related website / installer repository:

https://github.com/DCCExpress/DCCExpressHubWeb

S88 adapter:

https://github.com/DCCExpress/DCCExpress-S88Adapter

## License

See the repository license for the current project licensing terms.
