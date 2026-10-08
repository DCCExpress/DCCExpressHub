# DCCExpressHub

**DCCExpressHub** is a model railway control and automation application for **DCC-EX**, **Roco Z21**, and **YaMoRC YD7010** command stations.

Drive locomotives, operate turnouts and signals, design your track layout, monitor occupancy sensors, and run automatic movements and timetables—all from one interface.

Available for:

- **Windows** — desktop application powered by .NET 10.
- **Linux** — runs as a server, with the interface available in a web browser.

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

## Supported command stations

| Command station | Windows | Linux |
| --- | --- | --- |
| DCC-EX (network) | Supported | Supported |
| DCC-EX (USB/serial) | Supported | Supported |
| Roco Z21 | Supported | Supported |
| YaMoRC YD7010 | Supported | Supported |

**DCC-EX:** Connect by network or USB. S88 / s88-N feedback can be added using the [DCCExpress S88 Adapter](https://github.com/DCCExpress/DCCExpress-S88Adapter).

**Roco Z21:** Supports LAN control and R-BUS feedback, including the white z21/z21start feature set. Direct support for black Z21-specific CAN and LocoNet buses is not included in this profile.

**YaMoRC YD7010:** Uses Z21 connectivity for locomotive and accessory control, with supported feedback through R-BUS and a separate LocoNet connection.

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

There is no prepackaged Linux release yet. Install the prerequisites using your distribution's package manager, then run:

```bash
git clone https://github.com/DCCExpress/DCCExpressHub.git
cd DCCExpressHub
./run-linux.sh --build
./run-linux.sh
```

On first launch, choose your command station and enter its connection details when prompted.

To update:

```bash
git pull
./run-linux.sh
```

For a USB/serial-connected command station, ensure your Linux user can access the serial device. On Debian-based systems this commonly requires membership in the `dialout` group.

## Notes

- Use the **emergency stop** controls whenever immediate intervention is needed.
- Automatic operation depends on correct layout configuration, sensor feedback, and turnout settings. Always test routes on your own railway before leaving movements unattended.
- This is **alpha software**. Features and supported hardware behavior may change, and issues may still occur.

## Links

- [Download releases](https://github.com/DCCExpress/DCCExpressHub/releases)
- [Project website](https://dccexpress.github.io/DCCExpressHubWeb/)
- [DCC-EX](https://dcc-ex.com/)
- [DCCExpress S88 Adapter](https://github.com/DCCExpress/DCCExpress-S88Adapter)

## License

See [LICENSE](LICENSE) for license information.
