# DCCExpressHub

[![Release](https://img.shields.io/github/v/release/DCCExpress/DCCExpressHub?include_prereleases&label=Release)](https://github.com/DCCExpress/DCCExpressHub/releases)
[![Last Commit](https://img.shields.io/github/last-commit/DCCExpress/DCCExpressHub/main)](https://github.com/DCCExpress/DCCExpressHub/commits/main)

![Windows](https://img.shields.io/badge/Platform-Windows-0078D4?logo=windows)
![Linux](https://img.shields.io/badge/Platform-Linux-FCC624?logo=linux&logoColor=black)
![Android](https://img.shields.io/badge/Platform-Android-3DDC84?logo=android&logoColor=white)
![.NET 10](https://img.shields.io/badge/.NET-10-512BD4?logo=dotnet&logoColor=white)
![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-blue?logo=typescript&logoColor=white)

![DCC-EX](https://img.shields.io/badge/DCC--EX-Supported-E67E22)
![YaMoRC](https://img.shields.io/badge/YaMoRC-Supported-1B8B58)
![Z21](https://img.shields.io/badge/Z21-Supported-0077B6)
![LocoNet](https://img.shields.io/badge/LocoNet-Supported-7952B3)

**Version: 0.1.0-alpha.9**

**DCCExpressHub** is a model railway control and automation application supporting the **DCC-EX**, **Z21 + R-BUS**, and **LocoNet** protocols.

Drive locomotives, operate turnouts and signals, design your track layout, monitor occupancy sensors, and run automatic movements and timetables—all from one interface.

Available for:

- **Windows** — desktop application and server powered by .NET 10.
- **Linux** — runs as a server, with the interface available in a web browser.
- **Android** — standalone app with its own .NET 10 Hub and tablet-optimized interface; it can also serve other devices over the local network. **Tablet recommended.**

On Android, enable **Allow other devices on LAN** to access the Hub from browsers on the same network. Android support is experimental; network command-station connections are available, but USB/serial connections are not yet supported.

You can also control your railway from a computer, tablet, or phone on the same local network.

> **DCCExpressHub is not a command station.** Your connected command station generates the track signal; DCCExpressHub provides control, layout, and automation on top of it.

![DCCExpressHub screenshot](doc/images/DccExpressHub-2026-10-07%20170732.png)

## Features

- **Locomotive control** — speed, direction, and functions.
- **Turnouts and signals** — operate accessories from the control panel or track layout.
- **Visual layout editor** — create and manage your model railway track plan.
- **Occupancy and train tracking** — view sensor feedback and locomotive positions.
- **Routes and automatic movements** — plan train movements across your layout.
- **Timetables** — schedule automatic operations.
- **Flows and scripts** — set up event-driven automation.
- **Sound** — use audio announcements and other event-driven actions.
- **Decoder programming** — read and write supported CVs.
- **Gamepad control** — use compatible Bluetooth or USB controllers.
- **Multiple devices** — access the same railway from PCs, tablets, and phones.

### Gamepad control

Use a compatible Bluetooth or USB gamepad with the mobile control interface to drive locomotives, activate functions, stop trains, and operate available layout controls.

![DCCExpressHub Gamepad](doc/images/20261007_165630.jpg)

Configure button assignments on the **Gamepad** page. Settings are saved for the browser/device you use. Gamepad availability depends on your browser and controller.

### ROCO Z21 WLANMAUS newGen

![Roco Z21 wlanMAUS](doc/images/20261030_165356.jpg)

DCCExpressHub can act as a **Z21-compatible UDP server** for the **ROCO WLANMAUS newGen** handheld controller. Connect the WLANMAUS to the same Wi-Fi network as the Hub and configure its Z21 IP address to the computer running DCCExpressHub. Enable the **Z21 WLANMAUS** external device in the Hub (default UDP port **21105**).

The handheld can control locomotive speed, direction and functions, operate turnouts, and send track power and emergency-stop commands. Locomotive speed, direction, function states and turnout states are synchronized between the handheld and DCCExpressHub, so changes made from either interface can be reflected on the other.

The rotary knob increases speed when turned right, decreases it when turned left, and can change direction when pressed. The STOP button supports the WLANMAUS's configured **track power off** or **emergency stop** mode. This integration has been tested with a physical WLANMAUS newGen and DCC-EX command station; behavior with other hardware may vary.

### DCCExpress S88 Adapter

![DCCExpressHub Gamepad](doc/images/20261030_182549.jpg)

The [DCCExpress S88 Adapter](https://github.com/DCCExpress/DCCExpress-S88Adapter) adds **S88 / s88-N occupancy feedback** to a DCC-EX CommandStation-EX setup. An Arduino Uno-based adapter reads S88 feedback modules and makes their states available to DCC-EX through an I2C HAL driver. The command station then reports ordinary DCC-EX sensor events (`<Q>` / `<q>`), which DCCExpressHub can use for occupancy monitoring and automation. Direct USB serial feedback is also supported.

The adapter supports **up to 256 feedback inputs** (32 S88 bytes), with configurable I2C address and input count. It has been tested with **YaMoRC YD6016ES-CS** modules, including two chained 16-input modules.

**Important — 3.3 V ↔ 5 V level conversion:** The Arduino Uno adapter uses **5 V logic**, while many modern DCC-EX controllers use **3.3 V I2C logic**. Use a suitable **bidirectional I2C level shifter** between SDA/SCL (with a shared ground) unless the controller is explicitly 5 V tolerant. **Do not connect 5 V I2C signals directly to a non-5 V-tolerant 3.3 V controller.** Also check the s88-N bus supply: the tested YD6016ES-CS must not receive more than **5 V**, even though other s88-N devices may support different voltages.

For wiring, firmware and DCC-EX HAL installation, see the [S88 Adapter repository](https://github.com/DCCExpress/DCCExpress-S88Adapter). A hardware photo can be added here later.

## Supported protocols

DCCExpressHub supports DCC-EX, Z21, and LocoNet communication protocols on **Windows**, **Linux**, and **Android** (network connections only on Android), with transport-specific connection options. Select the protocol supported by your command station and connect the corresponding interface.

| Protocol / connection | Tested on (command stations) | Feedback | CV programming |
| --- | --- | --- | --- |
| **DCC-EX** — TCP/IP or USB/serial | DCC-EX (including EX-CSB1) | DCC-EX sensor reporting; optional S88 adapter | Service-track CV programming and supported operations-mode programming |
| **Z21 + R-BUS** — LAN/UDP | Roco z21 / Z21; YaMoRC YD7010 in Z21-compatible mode | R-BUS occupancy sensors, with configurable offset | Supported Z21 programming operations (subject to command station capabilities) |
| **LocoNet** — TCP (LBServer) | YaMoRC YD7010 with LocoNet server enabled | LocoNet occupancy feedback (including supported S88 modules), with configurable offset | Native LocoNet service-track CV reading/writing, locomotive POM, and accessory POM writing |
| **LocoNet** — USB/Serial (COM) | LocoNet-compatible serial interface (YaMoRC YD7010 USB configuration under evaluation) | Native LocoNet sensor feedback; serial interface and feedback compatibility depend on hardware | Native LocoNet service-track CV read/write, locomotive POM and accessory POM commands implemented; hardware validation pending |

### DCC-EX

Connect to a DCC-EX command station over **TCP/IP** or **USB/serial**. The HUB uses the DCC-EX command protocol for locomotive control, functions, turnouts, sensors, and supported CV programming.

For S88 / s88-N occupancy feedback, see the separate [DCCExpress S88 Adapter](https://github.com/DCCExpress/DCCExpress-S88Adapter) project.

### Z21 + R-BUS

Connect over the **Z21 LAN protocol (UDP)**. This profile supports Roco z21 / Z21 and the **YaMoRC YD7010** in Z21-compatible mode. Locomotive control, functions, turnouts, and accessories use the Z21 interface. Configure **R-BUS feedback** and its sensor offset in the connection settings.

The white z21 supports R-BUS; hardware variants and their available feedback interfaces differ. Do not assume that black Z21 CAN, S88, or LocoNet feedback is exposed through this R-BUS profile.

### Native LocoNet — TCP and USB/Serial

Connect to the **YaMoRC YD7010 LocoNet LBServer** over TCP (typically port **1234**, depending on configuration), or select **LocoNet Serial** with the relevant COM port and baud rate (for example, **COM16 @ 115200 baud** in the current test setup). Both transports carry LocoNet messages using separate transport drivers, not the Z21 UDP protocol. Opening the COM port alone does not confirm the interface's protocol compatibility.

The HUB supports locomotive control and functions, turnouts, basic accessories, extended signal aspects, LocoNet sensor feedback, and native LocoNet CV programming. The Programming page includes the **Decoder Profile** reader. Service-mode programming requires the decoder to be connected to the command station's **isolated programming-track output**. Reading many CVs can take several minutes.

**YaMoRC YD7010:** Choose **Z21 + R-BUS**, **native LocoNet TCP**, or **LocoNet Serial** according to the available interface and feedback bus. The LocoNet Serial implementation still requires end-to-end hardware verification. Their connection settings and sensor offsets are independent; do not enable both profiles for one connection unless you intentionally configured a supported arrangement.


## Installation

### Windows

**Requirements:** Windows 10 or 11 (64-bit), Microsoft Edge WebView2 Runtime, and network or USB access to your command station.

1. Open [GitHub Releases](https://github.com/DCCExpress/DCCExpressHub/releases).
2. Download the Windows package: `DCCExpressHub-<version>-win-x64.zip`.
3. Extract the ZIP into a writable folder.
4. Start `DCCExpressHub.Desktop.exe`.
5. Follow the initial setup to choose your command station and connection settings.

The Windows package includes the required .NET runtime. You do **not** need to install the .NET SDK.

Do not launch the application from inside the ZIP file. Alpha releases may be unsigned; if Windows SmartScreen displays a warning, verify the download came from the official Releases page.

Your application data is stored separately from the program files:

```text
%LOCALAPPDATA%\DCCExpressHub\workspace
```

The application can also be made available to other devices on your trusted local network.

### Linux

DCCExpressHub runs on Linux as a server. Open its interface from a browser on the computer or another device on your local network.

**Requirements:** Linux (x64 or ARM64), Git, .NET 10 SDK, Node.js 20.19+ or 22.12+, and npm. Debian 12 (x64) is a tested environment.

There is no prepackaged Linux release yet. Install the prerequisites if needed (instructions below), then use this quick start:

#### Quick Start

```bash
git clone https://github.com/DCCExpress/DCCExpressHub.git
cd DCCExpressHub
./run-linux.sh --build
./run-linux.sh
```

On first launch, choose your command station and enter its connection details when prompted.

To change the saved Linux configuration later (command station, connection settings, HTTP port, or workspace), run:

```bash
./run-linux.sh --configure
```

This opens the interactive configuration menu and starts the backend after saving. To open **only the configuration menu**, without launching the backend, use:

```bash
./run-linux-config.sh
```

The configuration is saved locally in `desktop/DCCExpressHub.Net/.env.linux`. To display the current configuration without starting the backend:

```bash
./run-linux.sh --show
```

The interactive menu uses the `dialog` utility and requires a terminal.

To update:

```bash
git pull
./run-linux.sh
```

### Installing prerequisites on Debian / Ubuntu

If Git, .NET 10, Node.js and npm are not installed yet, follow the instructions for your distribution below. Then return to the Quick Start commands above.

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

For DCC-EX USB/serial connections on Debian-based systems, you may need to grant serial-port access:

```bash
sudo usermod -aG dialout $USER
```

Log out and back in for the group change to take effect.

## Notes

- Use the **emergency stop** controls whenever immediate intervention is needed.
- Automatic operation depends on correct layout configuration, sensor feedback, and turnout settings. Always test routes on your own railway before leaving movements unattended.
- This is **alpha software**. Features and supported hardware behavior may change, and issues may still occur.

## Links

- [Download releases](https://github.com/DCCExpress/DCCExpressHub/releases)
- [Project website](https://dccexpress.github.io/DCCExpressHubWeb/)
- [DCC-EX](https://dcc-ex.com/)
- [DCCExpress S88 Adapter](https://github.com/DCCExpress/DCCExpress-S88Adapter)

## Trademarks

**LocoNet®** is a registered trademark of Digitrax, Inc. **Z21**, **z21**, **ROCO**, **FLEISCHMANN**, **DCC-EX**, and **YaMoRC** are trademarks or names of their respective owners. DCCExpressHub is an independent project and is not affiliated with or endorsed by these owners.

## License

See [LICENSE](LICENSE) for license information.
