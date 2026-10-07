# DCCExpressHub

DCCExpressHub is a control, layout and automation system for model railways using **DCC-EX**, **Roco Z21** or **YaMoRC YD7010** command stations.

It provides one interface for driving locomotives, programming decoder CVs, operating turnouts and signals, editing the layout, following trains, running automatic movements and timetables, and using occupancy sensors for safer operation.

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

DCCExpressHub provides a browser-based interface for:

- locomotive, function, turnout and signal control,
- decoder CV programming,
- visual layout editing,
- occupancy sensing and train tracking,
- route planning and automatic train movements,
- timetable operation,
- visual Flows and JavaScript automation,
- audio and event-driven actions,
- Bluetooth / USB gamepad control with configurable button assignments,
- multi-client operation from PCs, tablets and phones.

Automation runs in the .NET backend, so connected browsers share the same
layout and runtime state.

### Gamepad control

DCCExpressHub can use **Bluetooth and USB game controllers** through the
browser Gamepad API to drive the locomotive currently selected in the
locomotive panel.

The configurable gamepad actions currently include:

- speed up / speed down,
- forward / reverse,
- stop,
- emergency stop,
- locomotive functions **F0-F3**.

Button assignments can be changed from the **Gamepad** page and are stored
locally for that browser/device. The page also provides live controller
diagnostics for buttons and axes.

When more than one controller is connected, one controller is explicitly
selected as active. DCCExpressHub remembers that selection and does not
silently hand locomotive control to another gamepad if the selected controller
disconnects.

Gamepad support depends on the Gamepad API provided by the browser or embedded
WebView.

## Command station support

| Command station | Windows | Linux |
| --- | --- | --- |
| DCC-EX TCP | Supported | Supported |
| DCC-EX Serial / USB | Supported | Supported |
| Roco Z21 | Supported | Supported |
| YaMoRC YD7010 | Supported | Supported |

### DCC-EX

DCC-EX is supported over TCP/IP and USB/serial.

S88 / s88-N feedback can be added to a DCC-EX command station with the
**DCCExpress-S88Adapter**:

https://github.com/DCCExpress/DCCExpress-S88Adapter

The adapter repository contains the complete Arduino and DCC-EX integration
instructions.

### Roco Z21

Roco Z21 is supported through the native Z21 LAN protocol. The current
DCCExpressHub implementation covers the feature set available on the white
**z21 / z21start**, including **R-BUS feedback**.

Black Z21-specific external buses such as native **CAN** and **LocoNet** are
not currently handled directly by the Z21 profile.

### YaMoRC YD7010

YaMoRC YD7010 is supported with separate protocol paths for control and
feedback:

```text
Z21      -> locomotive / turnout / signal / power + R-BUS feedback
LocoNet  -> occupancy / feedback
```

# Installation

## Windows

The recommended Windows installation is the published release package.

### Requirements

- Windows 10 or Windows 11 x64
- Microsoft Edge WebView2 Runtime
- LAN or USB access to the selected command station

The release package contains the required .NET runtime, so a separate .NET SDK
installation is not required.

### Install

Download the current Windows release from:

https://github.com/DCCExpress/DCCExpressHub/releases

Extract:

```text
DCCExpressHub-<version>-win-x64.zip
```

to a writable directory and run:

```text
DCCExpressHub.Desktop.exe
```

Do not run the application directly from inside the ZIP archive.

Alpha builds may not be digitally signed. If Microsoft Defender SmartScreen
reports an unknown publisher, verify that the package came from the official
DCCExpressHub GitHub Releases page.

The Desktop application can run locally or expose the Hub to other devices on
the trusted local network.

User data is stored separately from the application files under:

```text
%LOCALAPPDATA%\DCCExpressHub\workspace
```

## Linux

DCCExpressHub runs on Linux as a headless server with the UI opened in a web
browser.

There is currently no packaged Linux release, so Linux installation is built
directly from the Git repository.

### Requirements

- x64 or ARM64 Linux
- .NET 10 SDK
- Git
- Node.js **^20.19.0 or >=22.12.0**
- npm

Tested environment:

```text
Debian GNU/Linux 12 (bookworm)
linux-x64
.NET 10
```

### Install prerequisites on Debian / Ubuntu

#### Debian 12 / 13

Install the basic tools and Microsoft package repository:

```bash
sudo apt update
sudo apt install -y curl wget git ca-certificates

source /etc/os-release
wget https://packages.microsoft.com/config/debian/$VERSION_ID/packages-microsoft-prod.deb -O packages-microsoft-prod.deb
sudo dpkg -i packages-microsoft-prod.deb
rm packages-microsoft-prod.deb
```

Install the .NET 10 SDK:

```bash
sudo apt update
sudo apt install -y dotnet-sdk-10.0
```

Install Node.js 22 LTS and npm:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

#### Ubuntu 24.04 or newer

Install Git, curl, .NET 10, then Node.js 22 LTS:

```bash
sudo apt update
sudo apt install -y curl git ca-certificates dotnet-sdk-10.0

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

For Ubuntu 22.04, enable the Ubuntu .NET backports repository first:

```bash
sudo apt update
sudo apt install -y curl git ca-certificates software-properties-common
sudo add-apt-repository -y ppa:dotnet/backports
sudo apt update
sudo apt install -y dotnet-sdk-10.0

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify the required tools:

```bash
dotnet --version
node --version
npm --version
git --version
```

### Install DCCExpressHub

Clone the repository:

```bash
git clone https://github.com/DCCExpress/DCCExpressHub.git
cd DCCExpressHub
```

Build the Web UI and backend:

```bash
./run-linux.sh --build
```

Then start DCCExpressHub:

```bash
./run-linux.sh
```

On first start the launcher asks for the command-center type and connection
settings. The saved machine-local configuration is stored in:

```text
desktop/DCCExpressHub.Net/.env.linux
```

A normal update is:

```bash
git pull
./run-linux.sh
```

The launcher automatically rebuilds the Web UI when the checked-out UI source
has changed.

For DCC-EX USB/serial connections, the Linux user must have permission to
access the serial device. On Debian-based systems this commonly means:

```bash
sudo usermod -aG dialout $USER
```

Log out and back in after changing group membership.

# Development

## Development requirements

For source builds:

- Git
- Node.js **^20.19.0 or >=22.12.0**
- npm
- .NET 10 SDK

Windows development additionally requires:

- PowerShell
- Microsoft Edge WebView2 Runtime
- Visual Studio optional

Clone:

```bash
git clone https://github.com/DCCExpress/DCCExpressHub.git
cd DCCExpressHub
```

## Windows source build

Build the Web UI, backend and Windows Desktop application:

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

The generated package is written under:

```text
dist\desktop
```

## Linux source build

The root launcher handles both the React/Vite UI and the .NET backend:

```bash
./run-linux.sh --build
```

Useful development commands:

```bash
./run-linux.sh --build-ui
./run-linux.sh --build-backend
./run-linux.sh --configure
./run-linux.sh --show
./run-linux.sh --help
```

The production Web UI is built to:

```text
web-ui/dist
```

and is served directly by the Linux backend.

Manual backend build:

```bash
dotnet restore desktop/DCCExpressHub.Net/DCCExpressHub.Net.csproj
dotnet build desktop/DCCExpressHub.Net/DCCExpressHub.Net.csproj
```

Example Linux publish targets:

```bash
dotnet publish desktop/DCCExpressHub.Net/DCCExpressHub.Net.csproj \
  -c Release -r linux-x64 --self-contained false

dotnet publish desktop/DCCExpressHub.Net/DCCExpressHub.Net.csproj \
  -c Release -r linux-arm64 --self-contained false
```

## Web UI development

Start the backend first, then run Vite.

Linux/macOS shell:

```bash
cd web-ui
npm install
DCCEXPRESS_DEVICE_URL=http://127.0.0.1:5174 npm run dev
```

PowerShell:

```powershell
cd web-ui
npm install
$env:DCCEXPRESS_DEVICE_URL="http://127.0.0.1:5174"
npm run dev
```

The Vite development server runs on:

```text
http://localhost:5173
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
