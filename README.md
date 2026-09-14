# DCCExpressHub

DCCExpressHub is an ESP32-based companion and web control hub for **DCC-EX** model railway command stations.

It provides a responsive browser interface for locomotive control, layout operation, decoder programming, configuration, diagnostics and automation. The Hub serves the UI itself from LittleFS and communicates with the command station over the local network.

> **DCCExpressHub is not a command station.**
>
> The connected command station still generates the DCC signal. DCCExpressHub is the web, control and integration layer around it.

![DCCExpressHub screenshot](doc/images/Screenshot%202026-09-05%20110304.png)

```text
PC / tablet / phone
        |
        | HTTP / WebSocket
        v
 DCCExpressHub
 ESP32 / M5Stack
        |
        +-- DCC-EX native TCP protocol
        |
        v
 Command station
        |
        | DCC
        v
 Model railway layout
```

## Features

Current functionality includes:

- locomotive control, locomotive editor and function control,
- responsive PC, tablet and mobile UI,
- browser-based layout editor and runtime layout operation,
- turnouts, accessories, signals and signal logic,
- occupancy / sensor integration,
- decoder programming,
- automation scripts,
- track power and emergency control,
- EX-CSB1 / DCC-EX connection configuration,
- raw command console and diagnostics,
- gamepad support,
- external device configuration,
- LittleFS file browser,
- SD-card storage and audio playback on M5Stack Basic,
- complete Export / Import backup,
- browser-based firmware installation,
- USB serial configuration and recovery.

## Install, configure and recover

The recommended installation method is the DCCExpressHub Web Installer:

https://dccexpress.github.io/DCCExpressHubWeb/installer/

Use desktop **Google Chrome** or **Microsoft Edge**. Firmware installation and serial configuration use ESP Web Tools / Web Serial.

### 1. Select the Hub hardware

Official releases currently support:

| Hub hardware | PlatformIO target | Display |
|---|---|---|
| **M5Stack Basic** | `m5stack-basic-dccex` | Built-in display |
| **Generic ESP32 DevKit** | `esp32dev-dccex` | None |

The web installer provides separate hardware and firmware-version selectors. Select the exact hardware before flashing.

Official releases are currently built for **DCC-EX only**.

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

The firmware accepts both the installer JSON protocol and human-readable commands:

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

## Command-station support

DCCExpressHub is designed first and foremost for **DCC-EX / EX-CSB1**. DCC-EX is the current priority, reference implementation and officially supported command-station backend.

**Roco/Fleischmann Z21 LAN support is planned for a future release.** Experimental Z21 implementation remains in the source tree, but Z21 is not currently an officially supported target and no Z21 firmware is published in DCCExpressHub releases.

## S88 / s88-N feedback

DCCExpressHub supports S88 / s88-N occupancy feedback through the companion **DCCExpress-S88Adapter** project.

The adapter reads standard S88 / s88-N feedback modules and forwards occupancy states to DCCExpressHub.

The current implementation has been tested with the **YaMoRC YD6016ES-CS**.

Project repository:

https://github.com/DCCExpress/DCCExpress-S88Adapter

## M5Stack SD card and audio

The **M5Stack Basic** can use its built-in microSD slot for larger user files such as locomotive sounds and announcements.

Recommended card format:

```text
File system:          FAT32
Allocation unit size: 32 KB
Volume label:         DCCEXPRESS (optional)
```

**FAT32 is recommended. Do not use NTFS.** Large SDXC cards may need to be reformatted from exFAT to FAT32.

> **WARNING:** If using DiskPart or another partitioning tool, verify the selected disk carefully. Repartitioning the wrong disk can erase unrelated data.

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
→ SD Card
→ audio
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

The same Hub UI works from a desktop PC, notebook, tablet or phone using a modern browser.

For a permanently mounted Android tablet, a fullscreen / kiosk browser such as **Fully Kiosk Browser** is useful. On iPhone/iPad, Safari works normally and Guided Access can be used for a dedicated control device.

## Build and development

Requirements:

- Node.js / npm
- PlatformIO
- ESP32 PlatformIO toolchain

Clone:

```bash
git clone https://github.com/DCCExpress/DCCExpressHub.git
cd DCCExpressHub
```

Build the web UI and prepare LittleFS:

```powershell
.\build-web.ps1
```

Build the official DCC-EX targets:

```powershell
.\build-merged.ps1 -Environment m5stack-basic-dccex
.\build-merged.ps1 -Environment esp32dev-dccex
```

Merged firmware is written to:

```text
dist/firmware/
```

### Versioning and releases

The repository-root `VERSION` file is the single source of truth.

Example:

```text
0.1.0-alpha.2
```

Create an official release with:

```powershell
.\release.ps1 0.1.0-alpha.2
```

The release helper:

- updates `VERSION`,
- synchronizes the web UI npm package version,
- creates a release commit,
- creates the matching annotated Git tag,
- pushes the branch and tag,
- starts the GitHub Actions release workflow.

The workflow refuses to publish if the Git tag and `VERSION` do not match.

Official releases currently contain only:

```text
m5stack-basic-dccex
esp32dev-dccex
```

Z21 remains a future-development target and is not included in official releases.

### Web UI development

The frontend is **React + Mantine + TypeScript + Vite**.

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

Main repository areas:

```text
DCCExpressHub/
├── src/                  ESP32 firmware
├── include/              firmware headers / defaults
├── web-ui/               React + Mantine frontend
├── data/                 prepared LittleFS web content
├── tools/firmware/       merged firmware tools
├── platformio.ini        hardware / command-station targets
├── VERSION               release version source
├── release.ps1           release helper
├── build-web.ps1
├── build-merged.ps1
└── build-all-merged.ps1
```

## Project status and links

DCCExpressHub is under active **alpha development**. Interfaces, hardware support and command-station backends may change while the project evolves.

Project website:

https://dccexpress.github.io/DCCExpressHubWeb/

Installer:

https://dccexpress.github.io/DCCExpressHubWeb/installer/

DCC-EX:

https://dcc-ex.com/

Related website / installer repository:

https://github.com/DCCExpress/DCCExpressHubWeb

## License

See the repository license for the current project licensing terms.
