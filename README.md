# DCCExpressHub

DCCExpressHub is a control, layout and automation system for model railways using **DCC-EX**, **Roco Z21** or **YaMoRC YD7010** command stations.

It provides one interface for driving locomotives, operating turnouts and signals, editing the layout, following trains, running automatic movements and timetables, and using occupancy sensors for safer operation.

DCCExpressHub runs on:

- **Windows** — packaged desktop application with WPF + WebView2 and the native .NET backend.
- **Linux** — the same .NET 10 backend runs headless and serves the browser UI over HTTP/WebSocket.

The browser interface can be opened from PCs, notebooks, tablets and phones on the local network.

> **DCCExpressHub is not a command station.**
>
> The connected command station still generates the DCC track signal. DCCExpressHub sits above it and provides the control, layout, tracking and automation functions.

![DCCExpressHub screenshot](doc/images/Screenshot_2026-09-23_182817.png)

## How it works

```text
 PC / tablet / phone
         |
      HTTP / WS
         |
         v
   DCCExpressHub
  Windows or Linux
         |
  TCP / USB / UDP
         |
         v
  Command station
 DCC-EX / Z21 / YD7010
         |
         v
 Model railway layout
```

## Features

### Locomotive control

- locomotive speed and direction,
- functions F0-F28,
- locomotive function bindings,
- per-locomotive actions,
- locomotive calibration,
- runtime locomotive statistics,
- optional function activation when the backend connects.

### Layout editor

The browser layout editor supports:

- track elements,
- blocks,
- occupancy sensors,
- turnouts,
- signals,
- track directions,
- route topology,
- decorative layers,
- buildings and scenery,
- copy/clone workflow for repeated elements.

The layout is stored by the backend and is shared by every browser connected to the Hub.

### Movement and Dispatcher

The backend Movement/Dispatcher engine provides:

- automatic route execution,
- target block reservation,
- turnout reservation and release,
- route and sensor safety checks,
- unknown occupancy detection,
- emergency-stop integration,
- cruise speed handling,
- movement events and actions,
- station hold/release handling,
- runtime logging.

### Train tracking

Train tracking follows locomotives through the layout using:

- the generated route graph,
- turnout positions,
- block occupancy,
- active sensor state,
- direction,
- Movement/Dispatcher state.

Tracking can maintain multiple active sensors for longer trains and exposes the current block, target and route state to the UI.

### Routes and block events

DCCExpressHub generates route vectors from the current layout instead of storing a second independent route representation.

Route and block configuration includes:

- generated graph and route network,
- route direction validation,
- segment parts,
- composite block/segment sensor nodes,
- route preview,
- per-direction block event conditions,
- **APPROACH**, **ARRIVED** and **LEAVE** events,
- per-event delays,
- sensor-based route safety.

### Timetable

The backend timetable engine can:

- start Movements and Scripts,
- use the fast clock,
- keep running rows pinned,
- skip disabled rows,
- finish active work cleanly when the timetable is stopped.

### Flows and Scripts

Automation runs in the .NET backend rather than in the browser.

Features include:

- visual Flow automation,
- JavaScript automation using Jint,
- TrainEvent triggers,
- locomotive and turnout actions,
- audio playback actions,
- blocking and non-blocking actions,
- automation logs,
- runtime state exposed to every connected browser.

### Audio

The Hub can store and serve audio files used by automation.

The backend supports:

- file upload,
- browser playback,
- HTTP byte ranges for seeking,
- blocking audio actions that can wait for playback completion.

### Command-center protocols

The cross-platform .NET backend supports:

- **DCC-EX TCP/IP**
- **DCC-EX Serial / USB**
- **Roco Z21 UDP**
- **YaMoRC YD7010**

DCC-EX remains the primary reference command station.

## Command station support

| Command station | Windows source build | Linux source build | Published Windows release |
| --- | --- | --- | --- |
| DCC-EX TCP | Supported | Supported | Yes |
| DCC-EX Serial / USB | Supported | Supported | Yes |
| Roco Z21 | Supported | Supported | Not yet |
| YaMoRC YD7010 | Supported | Supported | Not yet |

### DCC-EX

DCC-EX is supported over TCP/IP and USB/serial.

Sensor feedback is received through normal DCC-EX sensor events such as:

```text
<Q ...>
<q ...>
```

This feeds the same backend runtime used by block occupancy, tracking, Movement and Dispatcher safety.

The default DCC-EX TCP port is:

```text
2560
```

DCC-EX USB/serial uses:

```text
115200 baud
```

Typical Windows serial port:

```text
COM3
```

Typical Linux serial devices:

```text
/dev/ttyACM0
/dev/ttyUSB0
/dev/serial/by-id/...
```

#### S88 / s88-N feedback with DCC-EX

DCCExpressHub can use S88 occupancy feedback with DCC-EX through the companion
**DCCExpress-S88Adapter** project:

https://github.com/DCCExpress/DCCExpress-S88Adapter

In DCC-EX mode the adapter is connected to the **DCC-EX command station over
I2C**. DCCExpressHub does not read the adapter directly. DCC-EX exposes the
adapter inputs as normal sensors and sends the usual `<Q ...>` / `<q ...>`
events to the Hub.

```text
S88 / s88-N detector modules
            |
            v
   DCCExpress-S88Adapter
       Arduino Uno
            |
           I2C
            |
            v
       DCC-EX
   CommandStation-EX
            |
      TCP or USB
            |
            v
    DCCExpressHub
   Windows or Linux
```

The adapter firmware currently supports:

- Arduino Uno / compatible ATmega328P boards,
- up to **32 S88 bytes / 256 feedback inputs**,
- configurable I2C slave address,
- configurable active S88 input count,
- EEPROM-persisted configuration,
- USB serial diagnostics and configuration.

The adapter repository contains the firmware, wiring details and full hardware
documentation.

##### 1. Flash and configure the S88 adapter

Default adapter configuration:

```text
I2C address:       0x30
S88 bytes:         2
S88 inputs:        16
Serial baud rate:  115200
```

One S88 byte represents eight feedback inputs.

Examples:

```text
2 bytes = 16 inputs
4 bytes = 32 inputs
8 bytes = 64 inputs
```

Open the adapter USB serial console using:

```text
115200 baud
Newline / LF
```

Useful commands:

```text
STATUS
READ
SET BYTES 4
SAVE
```

For example, for 32 S88 inputs:

```text
SET BYTES 4
SAVE
```

To change the default I2C address:

```text
SET ADDRESS 0x31
SAVE
REBOOT
```

The configured adapter input count must be at least as large as the number of
inputs requested by the DCC-EX HAL driver.

For example:

```text
DCC-EX requests 32 sensors
        =
adapter must provide at least 4 S88 bytes
```

##### 2. Connect the adapter to DCC-EX

The Arduino Uno I2C pins are:

```text
SDA = A4
SCL = A5
```

Connect SDA, SCL and GND to the I2C bus of the board running CommandStation-EX.
Use the correct voltage/interface requirements for the command-station
hardware and keep a common ground.

The S88 side of the adapter uses:

```text
S88 CLOCK      -> Uno D2
S88 PS / LOAD  -> Uno D3
S88 RESET      -> Uno D4
S88 DATA       -> Uno D5
```

For complete s88-N RJ45 wiring and bus-voltage information, use the adapter
repository documentation. In particular, do not assume every s88-N module can
be powered at the same voltage.

##### 3. Add the DCC-EX HAL driver

DCCExpressHub includes the DCC-EX integration files under:

```text
dcc-ex/
├── IO_DCCExpressS88.h
├── myHal.example.cpp
└── sensors-1001-1032.txt
```

Copy `IO_DCCExpressS88.h` into your CommandStation-EX configuration/source
location so it can be included by `myHal.cpp`.

If you already have a `myHal.cpp`, **do not replace it blindly**. Merge the
relevant lines into your existing HAL configuration.

Example for 32 S88 inputs mapped to sensor IDs / VPINs 1001-1032:

```cpp
#include "IO_DCCExpressS88.h"
#include "Sensors.h"

void halSetup() {
    constexpr int FIRST_VPIN = 1001;
    constexpr int SENSOR_COUNT = 32;

    DCCExpressS88::create(FIRST_VPIN, SENSOR_COUNT, 0x30);

    for (int i = 0; i < SENSOR_COUNT; i++) {
        const int id = FIRST_VPIN + i;
        Sensor::create(id, id, 0);
    }
}
```

This mapping gives:

```text
S88 input 1  -> VPIN / sensor 1001
S88 input 2  -> VPIN / sensor 1002
...
S88 input 32 -> VPIN / sensor 1032
```

The I2C address in `DCCExpressS88::create(...)` must match the address stored
in the adapter.

##### 4. Sensor definitions and DCC-EX feedback

The HAL driver provides VPIN states. DCC-EX Sensor objects turn those VPIN
changes into normal sensor messages.

The supplied example creates the Sensor objects directly in `myHal.cpp`.

Alternatively, equivalent DCC-EX sensor definitions look like:

```text
<S 1001 1001 0>
<S 1002 1002 0>
...
<S 1032 1032 0>
<E>
```

The repository file:

```text
dcc-ex/sensors-1001-1032.txt
```

contains the complete 32-input example.

Once configured, DCC-EX reports transitions normally:

```text
<Q 1001>   sensor 1001 occupied / active
<q 1001>   sensor 1001 free / inactive
```

DCCExpressHub receives these exactly like any other DCC-EX sensor and can use
them for:

- block occupancy,
- route safety,
- Train Tracking,
- Movement / Dispatcher,
- Flow and Script TrainEvents.

##### 5. Verify the complete chain

A useful test order is:

```text
1. Adapter serial console: READ
2. Toggle one physical S88 input
3. Verify the adapter snapshot changes
4. Verify DCC-EX emits <Q ID> / <q ID>
5. Verify the same sensor changes in DCCExpressHub
```

If DCC-EX reports that the requested input count is larger than the adapter
provides, increase the adapter S88 byte count with `SET BYTES ...`, then
`SAVE`.

Full adapter documentation and firmware:

https://github.com/DCCExpress/DCCExpress-S88Adapter

### Roco Z21

The .NET backend contains native Z21 LAN support.

Current implementation includes:

- Z21 UDP connection,
- track power control,
- emergency stop and release,
- locomotive speed and direction,
- locomotive functions,
- turnout/basic accessory control,
- signal aspects,
- Z21 feedback handling.

The default Z21 LAN port is:

```text
21105 / UDP
```

### YaMoRC YD7010

YaMoRC uses separate protocol connections inside DCCExpressHub:

```text
DCCExpressHub.Net
      |
      +---- Z21 UDP 21105 --------> locomotive / turnout / power
      |
      +---- LocoNet LBServer 1234 -> occupancy / S88 feedback
      |
   YaMoRC YD7010
```

The Z21 and LocoNet implementations are intentionally separate protocol components even when they connect to the same physical YD7010.

Recommended YaMoRC settings:

```text
Z21                  ON
Z21 port             21105

LocoNet LBServer     ON
LBServer port        1234

LocoNet -> Expert
Interrogate: Report All Feedbacks = ON
```

For S88 address mapping, configure the YaMoRC **1ter Kontakt im Rückmeldebereich** value so that its generated feedback addresses match the Hub sensor addresses.

Example:

```text
First Hub sensor address:                   1001
YaMoRC "1ter Kontakt im Rückmeldebereich": 1000

S88 input 1  -> Hub sensor 1001
S88 input 6  -> Hub sensor 1006
S88 input 7  -> Hub sensor 1007
S88 input 20 -> Hub sensor 1020
```

## Architecture

The primary runtime is the cross-platform **DCCExpressHub.Net** backend:

```text
                    Browser UI
                        |
                   HTTP + WS
                        |
                        v
                DCCExpressHub.Net
               .NET 10 + Watson 7
                        |
        +---------------+---------------+
        |               |               |
      DCC-EX           Z21           LocoNet
        |               |               |
        +---------------+---------------+
                        |
                 Model railway
```

The backend owns:

- command-center communication,
- layout runtime state,
- Movement/Dispatcher,
- train tracking,
- Flows,
- JavaScript Scripts,
- Timetable,
- fast clock,
- file storage,
- WebSocket runtime synchronization.

The React UI is a client of the backend and does not execute the automation engines.

# Windows

## Windows requirements

For the published Windows package:

- Windows 10 or Windows 11 x64,
- Microsoft Edge WebView2 Runtime,
- LAN/USB access to the selected command station.

The release package contains the required .NET runtime and does not require a separate .NET SDK installation.

## Windows installation

Download the current Windows release from:

https://github.com/DCCExpress/DCCExpressHub/releases

The package is typically named:

```text
DCCExpressHub-<version>-win-x64.zip
```

Extract the complete archive to a writable directory and run:

```text
DCCExpressHub.Desktop.exe
```

Do not run the application directly from inside the ZIP archive.

### Windows SmartScreen

Alpha builds may not be digitally signed.

If Microsoft Defender SmartScreen reports an unknown publisher, verify that the package was downloaded from the official DCCExpressHub GitHub Releases page.

## Windows Local mode

The Desktop application can run the Hub only for the local PC.

Default URL:

```text
http://127.0.0.1:5174
```

## Windows Server mode

Server mode exposes DCCExpressHub to the trusted local network.

Example:

```text
http://192.168.1.100:5174
```

Other PCs, tablets and phones can then open the same layout in a modern browser.

## Windows persistent workspace

The Desktop application keeps runtime data outside the application directory.

Default location:

```text
%LOCALAPPDATA%\DCCExpressHub\workspace
```

This includes layout/configuration/state data and keeps user data separate from the installed binaries.

## Building on Windows from source

Requirements:

- Git,
- Node.js **^20.19.0 or >=22.12.0**,
- npm,
- .NET 10 SDK,
- Microsoft Edge WebView2 Runtime,
- PowerShell,
- Visual Studio 2022/2026 optional.

Clone:

```powershell
git clone https://github.com/DCCExpress/DCCExpressHub.git
cd DCCExpressHub
```

Build the Web UI and Windows Desktop application:

```powershell
.\build-desktop.ps1
```

Release configuration:

```powershell
.\build-desktop.ps1 -Configuration Release
```

Create the self-contained Windows x64 release package:

```powershell
.\build-desktop.ps1 -Clean -Publish
```

The generated ZIP is written under:

```text
dist\desktop
```

The build script performs:

```text
web-ui
   |
npm build
   |
web-ui/dist
   |
sync
   |
desktop/DCCExpressHub.Net/wwwroot
   |
.NET backend + WPF Desktop build
```

# Linux

DCCExpressHub runs natively on Linux as a headless .NET backend.

There is currently no packaged Linux release. Linux installations are built directly from the Git repository.

The UI is served by the backend and is opened in a browser.

## Linux requirements

Required:

- x64 or ARM64 Linux,
- .NET 10 SDK,
- Git,
- Node.js **^20.19.0 or >=22.12.0**,
- npm.

Tested development environment:

```text
Debian GNU/Linux 12 (bookworm)
linux-x64
.NET 10
```

For DCC-EX USB/serial, the Linux user must also have permission to access the serial device.

On Debian-based systems this commonly means membership in the `dialout` group:

```bash
sudo usermod -aG dialout $USER
```

Log out and back in after changing group membership.

## Linux installation from Git

Clone:

```bash
git clone https://github.com/DCCExpress/DCCExpressHub.git
cd DCCExpressHub
```

For the current alpha development branch:

```bash
git fetch origin
git switch alpha3
git pull --ff-only origin alpha3
```

Build everything:

```bash
./run-linux.sh --build
```

Then configure and start:

```bash
./run-linux.sh
```

On the first run the launcher asks which command center to use:

```text
1) YaMoRC YD7010 (Z21 + separate LocoNet)
2) Roco Z21
3) DCC-EX TCP
4) DCC-EX Serial
```

The machine-local settings are stored in:

```text
desktop/DCCExpressHub.Net/.env.linux
```

The file is ignored by Git.

## Linux Web UI build

A source checkout contains the React/Vite UI under:

```text
web-ui/
```

The Linux launcher builds it using:

```bash
npm ci
npm run build
```

Production output:

```text
web-ui/dist/
```

Watson serves this directory directly. No manual copy into the backend is required.

A normal:

```bash
git pull
./run-linux.sh
```

automatically rebuilds the UI if the checked-out `web-ui` source tree changed.

Useful launcher commands:

```bash
./run-linux.sh --build          # build UI and backend
./run-linux.sh --build-ui       # build only React/Vite UI
./run-linux.sh --build-backend  # build only .NET backend
./run-linux.sh --configure      # change command-center settings and start
./run-linux.sh --show           # show saved Linux configuration
./run-linux.sh --help
```

## Linux backend URL

The default listen address is:

```text
http://0.0.0.0:5174
```

Open it from another machine using the Linux host's LAN address, for example:

```text
http://192.168.1.50:5174
```

The listen URL can be overridden with:

```bash
export DCCEXPRESS_HTTP_URL=http://0.0.0.0:5174
```

## Linux manual build

The launcher is recommended, but the components can also be built manually.

Web UI:

```bash
cd web-ui
npm ci
npm run build
cd ..
```

Backend:

```bash
dotnet restore desktop/DCCExpressHub.Net/DCCExpressHub.Net.csproj
dotnet build desktop/DCCExpressHub.Net/DCCExpressHub.Net.csproj
```

Run manually:

```bash
export DCCEXPRESS_CONTENT_ROOT="$PWD/desktop/DCCExpressHub.Net"
export DCCEXPRESS_WEB_ROOT="$PWD/web-ui/dist"
export DCCEXPRESS_HTTP_URL=http://0.0.0.0:5174

dotnet run --project desktop/DCCExpressHub.Net/DCCExpressHub.Net.csproj
```

For normal use, `run-linux.sh` is easier because it also manages command-center configuration.

## Linux publish examples

Framework-dependent x64:

```bash
dotnet publish desktop/DCCExpressHub.Net/DCCExpressHub.Net.csproj \
  -c Release \
  -r linux-x64 \
  --self-contained false
```

Framework-dependent ARM64:

```bash
dotnet publish desktop/DCCExpressHub.Net/DCCExpressHub.Net.csproj \
  -c Release \
  -r linux-arm64 \
  --self-contained false
```

## macOS

The .NET backend is intentionally written using cross-platform APIs, but macOS is **not currently an officially tested or supported DCCExpressHub platform**.

There is no macOS Desktop package or automated macOS build/test process at this time.

# Development

## Web UI development

Start the backend first, then run Vite:

```bash
cd web-ui
npm install
DCCEXPRESS_DEVICE_URL=http://127.0.0.1:5174 npm run dev
```

Vite development server:

```text
http://localhost:5173
```

On PowerShell:

```powershell
cd web-ui
npm install
$env:DCCEXPRESS_DEVICE_URL="http://127.0.0.1:5174"
npm run dev
```

## Repository structure

```text
DCCExpressHub/
├── web-ui/                        React + Vite + Mantine frontend
├── desktop/
│   ├── DCCExpressHub.Net/         cross-platform .NET 10 + Watson backend
│   ├── DCCExpressHub.Desktop/     Windows WPF + WebView2 shell
│   └── DCCExpressHub.Desktop.slnx
├── dcc-ex/                        DCC-EX integrations
├── doc/                           documentation and screenshots
├── run-linux.sh                   Linux build/config/run launcher
├── build-desktop.ps1              Windows build/release script
├── VERSION
└── README.md
```

## Versioning

The repository-root `VERSION` file is the project version source.

Current development version:

```text
0.1.0-alpha.3
```

GitHub Releases:

https://github.com/DCCExpress/DCCExpressHub/releases

Alpha releases are published as pre-releases.

## Project status

DCCExpressHub is under active alpha development.

The **.NET backend is the primary runtime** and runs on Windows and Linux.

The Windows WPF shell provides the packaged desktop application. Linux runs the same backend headlessly and uses the browser UI.

Interfaces, automation behaviour and hardware support may still change while the project evolves.

## Links

Project website:

https://dccexpress.github.io/DCCExpressHubWeb/

GitHub Releases:

https://github.com/DCCExpress/DCCExpressHub/releases

DCC-EX:

https://dcc-ex.com/

S88 adapter:

https://github.com/DCCExpress/DCCExpress-S88Adapter

## License

See the repository license for the current project licensing terms.
