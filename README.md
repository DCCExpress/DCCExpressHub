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
 ESP32 / M5Stack / CYD
        |
        +-- DCC-EX native TCP protocol   <- primary / recommended
        +-- Z21 LAN / UDP                <- experimental / in development
        |
        v
 Command station
        |
        | DCC
        v
 Model railway layout
```

## Features and command-station support

Current functionality includes:

- locomotive control, locomotive editor and function control,
- responsive PC, tablet and mobile UI,
- browser-based layout editor and runtime layout operation,
- turnouts, accessories, signals and signal logic,
- occupancy / sensor integration,
- decoder programming,
- automation scripts,
- track power and emergency control,
- EX-CSB1 / command-station connection configuration,
- raw command console and diagnostics,
- gamepad support,
- external device configuration,
- LittleFS file browser,
- SD-card storage on M5Stack Basic,
- audio files and layout Audio Button elements,
- complete Export / Import backup,
- browser-based firmware installation,
- USB serial configuration and recovery.

The Hub is designed first and foremost for **DCC-EX / EX-CSB1**. DCC-EX is the current priority, reference implementation and most tested command-station backend.

**Roco/Fleischmann Z21 LAN support is also planned and under active development.** Z21-specific firmware targets and an experimental Z21 backend already exist in the source tree, but DCC-EX support currently has priority and should be considered the recommended configuration.

No cloud connection is required for normal operation.

## Supported Hub hardware and client devices

| Hub hardware | PlatformIO target | Display | Status |
|---|---|---|---|
| **M5Stack Basic** | `m5stack-basic-dccex` | Built-in display | Primary tested target |
| **Generic ESP32 DevKit** | `esp32dev-dccex` | None | Supported |
| **ESP32-2432S028 / CYD (Cheap Yellow Display)** | `cyd-2432s028-dccex` | 2.8" ILI9341 + XPT2046 touch | Supported in source / PlatformIO |

The CYD board is the inexpensive ESP32 display module often sold as **ESP32-2432S028**, **2.8" ESP32 HMI**, or **Cheap Yellow Display (CYD)**. The firmware contains display and touch support for this target.

Z21 variants also exist in `platformio.ini`:

```text
m5stack-basic-z21
esp32dev-z21
cyd-2432s028-z21
```

During alpha development the release workflow and browser installer may lag behind source-level hardware targets. Check the current release assets before assuming every PlatformIO target has a ready-made merged firmware image.

### M5Stack SD card and audio files

The **M5Stack Basic** can use its built-in microSD slot as external storage. SD storage is intended primarily for larger user files such as locomotive sounds, announcements and other audio files that should not consume the ESP32 LittleFS partition.

#### SD card format

Use a good-quality **microSD / microSDHC / microSDXC** card formatted as **FAT32**.

Recommended setup:

```text
File system:          FAT32
Allocation unit size: 32 KB (32768 bytes)
Volume label:         DCCEXPRESS (optional)
```

**Do not use NTFS.** For the current M5Stack SD implementation, **FAT32 is the recommended format instead of exFAT**.

Large cards such as 64 GB SDXC cards are normally supplied as exFAT. Windows also usually offers only exFAT or NTFS for cards larger than 32 GB. The card can still be used by creating a FAT32 partition.

One Windows-only method that does not require an additional formatter is to create a partition of approximately 30 GB with DiskPart:

```text
diskpart
list disk
select disk N
clean
create partition primary size=30000
format fs=fat32 quick label=DCCEXPRESS
assign
exit
```

> **WARNING:** `clean` erases the selected disk. Double-check the disk number before running it. Selecting the wrong disk can erase another drive in the computer.

Alternatively, a FAT32 formatter such as **guiformat / FAT32 Format** or another trusted partitioning tool can format larger media as FAT32 while retaining a larger partition.

FAT32 has a maximum individual file size of approximately 4 GB. This is normally irrelevant for locomotive and layout audio files.

#### `/audio` directory

After a successful SD mount, DCCExpressHub automatically ensures that this directory exists:

```text
/audio
```

The recommended SD-card layout is therefore:

```text
SD Card
└── audio
    ├── horn.mp3
    ├── station.mp3
    ├── crossing.mp3
    └── mav_szignal.mp3
```

MP3 is the recommended format for normal use. The browser performs the audio decoding; the ESP32 only serves/streams the file from the SD card.

#### Uploading audio files

Audio files can be uploaded from the DCCExpressHub web interface:

1. Open **Files / File Manager**.
2. Select **SD Card**.
3. Open the **audio** directory.
4. Upload the desired MP3 file.

Files stored there use virtual Hub paths such as:

```text
/sd/audio/mav_szignal.mp3
```

The SD-card upload path is separate from the internal LittleFS storage. Large audio files should therefore be stored on the SD card rather than in LittleFS.

#### Adding an Audio Button to the layout

To play a sound from the layout:

1. Open the **Layout editor**.
2. Press the element **+ / picker** button.
3. Select **Audio Button**.
4. Place the button on the layout.
5. Select the button and open its properties.
6. Set the **Label** shown on the layout.
7. Use the **Audio file** picker to browse the SD card and select a file from `/audio`.
8. Use **Play / Test** in the property panel to verify the selected sound.
9. Save the layout.

A typical Audio Button can therefore reference:

```text
/sd/audio/mav_szignal.mp3
```

At runtime, pressing the Audio Button asks the browser to play the selected file. The file is streamed from the Hub through the storage API, so the ESP32 does not need to load the complete MP3 into RAM or decode it itself.

For best reliability, keep audio files under `/audio` and use short, simple filenames. Spaces are supported, but names such as `mav_szignal.mp3` are easier to manage and diagnose.

### PC, tablet and mobile use

The same Hub UI can be used from a desktop PC, notebook, tablet or phone. A modern browser is sufficient for normal operation.

For a permanently mounted Android tablet, a fullscreen / kiosk browser is recommended:

- **Fully Kiosk Browser & Lockdown** - recommended, mature and highly configurable  
  https://play.google.com/store/apps/details?id=de.ozerov.fully
- **FreeKiosk** - free and open-source alternative  
  https://play.google.com/store/apps/details?id=com.freekiosk
- **Webview Kiosk** - lightweight kiosk-browser alternative  
  https://play.google.com/store/apps/details?id=com.nktnet.webview_kiosk

On iPhone/iPad, Safari can be used normally; Guided Access is useful when the device is dedicated to layout control.

## Install, configure and recover

The recommended installation method is the DCCExpressHub Web Installer:

https://dccexpress.github.io/DCCExpressHubWeb/installer/

The installer uses ESP Web Tools and Web Serial. For flashing and serial configuration, use a desktop Chromium-based browser with Web Serial support, such as **Google Chrome** or **Microsoft Edge**.

Connect the Hub by USB and verify that the operating system sees a serial / COM port. Depending on the board, a **CH340/CH341** or **CP210x** USB-UART driver may be required.

After flashing, the installer can configure the Hub over USB serial at:

```text
115200 baud
```

This recovery path works even if the saved Wi-Fi or command-station configuration is wrong.

Typical configuration:

```text
Hub hostname:     dccexpresshub
Browser URL:      http://dccexpresshub.local

DCC-EX host:      dccex.local
DCC-EX TCP port:  2560
```

An IPv4 address can also be used instead of an mDNS hostname.

### Serial commands

The firmware accepts both the installer JSON protocol and a compact set of human-readable serial commands:

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

`<WIFI ...>` requires a restart before the new Wi-Fi settings take effect. DCC-EX endpoint changes are applied immediately.

Because `<WIFI?>` and `<STATUS?>` are intended for **physical USB recovery**, they can expose the stored Wi-Fi password. Treat physical serial access to the Hub as trusted access.

Once configured, open:

```text
http://dccexpresshub.local
```

On a fresh installation, use **Locomotive editor** and **Layout editor**, or restore a previous installation through **Export / Import**.

A backup can contain the layout, locomotives, locomotive images, signal logic and external-device configuration. Creating a backup before factory flashing or major configuration changes is strongly recommended.

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

Build the web UI and prepare LittleFS content:

```powershell
.\build-web.ps1
```

Build the primary DCC-EX firmware targets:

```powershell
.\build-merged.ps1 -Environment m5stack-basic-dccex
.\build-merged.ps1 -Environment esp32dev-dccex
```

Build all targets currently included by the helper script:

```powershell
.\build-all-merged.ps1
```

Merged firmware is written to:

```text
dist/firmware/
```

The CYD PlatformIO target can currently be built directly with PlatformIO:

```powershell
pio run -e cyd-2432s028-dccex
```

The source-level CYD target may appear in `platformio.ini` before it is included in the merged-image helper scripts and automated release workflow.

### Web UI development

The frontend is React + Mantine + TypeScript with Vite.

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

Vite proxies the Hub API, file and WebSocket endpoints to the configured device.

Development without hardware is also supported:

```powershell
# Terminal 1
cd web-ui
npm run mock

# Terminal 2
cd web-ui
npm run dev:mock
```

The mock backend runs locally and is useful for UI, editor, API and WebSocket development without repeatedly flashing an ESP32.

Main repository areas:

```text
DCCExpressHub/
├── src/                  ESP32 firmware
├── include/              firmware headers / defaults
├── web-ui/               React + Mantine frontend
├── data/                 prepared LittleFS web content
├── tools/firmware/       merged firmware tools
├── platformio.ini        hardware / command-station targets
├── build-web.ps1
├── build-merged.ps1
└── build-all-merged.ps1
```

DCCExpressHub is under active alpha development. Interfaces, hardware support and command-station backends may change while the project evolves.

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
