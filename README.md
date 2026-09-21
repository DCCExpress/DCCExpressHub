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

The Windows version runs the Hub backend locally and displays the shared WebUI in WebView2.

```text
DCCExpressHub Desktop
        |
        +-- WPF / WebView2
        |       |
        |       +-- React WebUI
        |
        +-- DCCExpressHub.Net (.NET 10)
                |
                +-- DCC-EX TCP / Serial
                        |
                        v
                  Command station
```

The Desktop implementation is currently a **Windows target**.

## Install, configure and recover the ESP32 Hub

The recommended ESP32 installation method is the DCCExpressHub Web Installer:

https://dccexpress.github.io/DCCExpressHubWeb/installer/

Use desktop **Google Chrome** or **Microsoft Edge**. Firmware installation and serial configuration use ESP Web Tools / Web Serial.

### 1. Select the Hub hardware

Official releases currently support:

| Hub hardware | PlatformIO target | Display | Frontend automation scripts | Backend automation scripts |
|---|---|---|---|---|
| **M5Stack Basic** | `m5stack-basic-dccex` | Built-in display | Supported | Not supported |
| **Generic ESP32 DevKit** | `esp32dev-dccex` | None | Supported | Not supported |
| **Waveshare ESP32-S3 LCD 7"** | `waveshare-s3-lcd7-dccex` | Built-in 7" display | Supported | QuickJS |
| **Sunton ESP32-8048S043** | `sunton-8048s043-dccex` | Built-in 4.3" display | Supported | QuickJS |

**Frontend automation scripts** run in the browser and are available on every supported Hub target.

**Backend automation scripts** run directly on the Hub firmware through the QuickJS-based JavaScript Sandbox. They currently require a supported **ESP32-S3** target.

The web installer provides separate hardware and firmware-version selectors. Select the exact hardware before flashing.

Official firmware releases are currently built for **DCC-EX only**.

### 2. Install the firmware

Connect the Hub by USB, select the desired published firmware release and press **Install firmware**.

The installer flashes a complete merged image at:

```text
0x000000
```

A factory / merged installation may erase existing NVS configuration and stored layout data, so creating an **Export / Import** backup before major updates is recommended.

Depending on the ESP32 board, Windows may require a **CH340/CH341** or **CP210x** USB-UART driver.

For development or recovery, the installer can also flash a local merged `.bin` file.

### 3. Configure the Hub

After flashing, connect through the same web tool over USB serial at:

```text
115200 baud
```

Typical settings:

```text
Hub hostname:     dccexpresshub
Browser URL:      http://dccexpresshub.local

DCC-EX host:      dccex.local
DCC-EX TCP port:  2560
```

An IPv4 address can be used instead of an mDNS hostname.

The serial recovery path works even when saved Wi-Fi or command-station settings are incorrect.

Once configured, open:

```text
http://dccexpresshub.local
```

On a fresh installation, use **Locomotive editor** and **Layout editor**, or restore a previous installation through **Export / Import**.

### Serial recovery commands

The ESP32 firmware accepts both the installer JSON protocol and human-readable commands:

```text
<STATUS?>                         Show Hub, Wi-Fi and command-station status
<WIFI?>                           Show stored Wi-Fi configuration
<WIFI "ssid" "password">          Save Wi-Fi credentials
<DCCEX?>                          Show DCC-EX endpoint and connection state
<DCCEX "dccex.local" 2560>        Set DCC-EX host and TCP port
<RESTART>                         Restart the Hub
<HELP?>                           Show available serial commands
```

Examples:

```text
<STATUS?>
<DCCEX "192.168.1.143" 2560>
<WIFI "MyWiFi" "MyPassword">
<RESTART>
```

`<WIFI ...>` requires a restart. DCC-EX endpoint changes are applied immediately.

Because `<WIFI?>` and `<STATUS?>` are intended for **physical USB recovery**, they may expose the stored Wi-Fi password. Treat physical serial access as trusted access.

## Windows Desktop

### Requirements

- Windows
- .NET 10 SDK
- Node.js / npm when rebuilding the shared WebUI
- Microsoft Edge WebView2 Runtime
- Visual Studio 2026 is optional but recommended for development

Desktop projects:

```text
desktop/
├── DCCExpressHub.Desktop.slnx
├── DCCExpressHub.Net/
│   ├── DCCExpressHub.Net.csproj
│   └── wwwroot/
└── DCCExpressHub.Desktop/
    └── DCCExpressHub.Desktop.csproj
```

### Build

From the repository root:

```powershell
.\build-desktop.ps1
```

Release:

```powershell
.\build-desktop.ps1 -Configuration Release
```

Clean Release build:

```powershell
.\build-desktop.ps1 -Configuration Release -Clean
```

Force a fresh npm dependency restore:

```powershell
.\build-desktop.ps1 -Configuration Release -Clean -RestoreNode
```

The Desktop build keeps the shared WebUI and the .NET `wwwroot` synchronized:

```text
web-ui/
   |
   | npm run build
   v
web-ui/dist/
   |
   | clean + copy + verify
   v
desktop/DCCExpressHub.Net/wwwroot/
   |
   | dotnet build
   v
desktop/DCCExpressHub.Desktop/bin/<Configuration>/net10.0-windows/
   |
   └── backend/wwwroot/
```

`web-ui/dist/` is generated output and is ignored by Git.

`desktop/DCCExpressHub.Net/wwwroot/` is the committed WebUI snapshot used by the .NET backend. `build-desktop.ps1` recreates it from the current `web-ui/dist/` and verifies the synchronized files before building the Desktop solution. This prevents stale Vite assets from surviving in `wwwroot`.

The WPF shell starts and owns the local backend process. It also checks the PID information from a previous Desktop run so it does not blindly terminate unrelated `dotnet` processes.

Desktop keyboard shortcuts:

| Key | Function |
|---|---|
| **F10** | Show / hide the advanced menu |
| **F11** | Toggle fullscreen |
| **Esc** | Leave fullscreen |

The advanced menu currently includes **View -> Server Log** for showing or hiding the local backend log panel.

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

### Windows Desktop build

```powershell
.\build-desktop.ps1
```

The script rebuilds the shared WebUI, refreshes and verifies `desktop/DCCExpressHub.Net/wwwroot/`, and builds `desktop/DCCExpressHub.Desktop.slnx`.

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
