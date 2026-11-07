DCCExpressHub Alpha10 release setup

Version: 0.1.0-alpha.10
Branch: alpha10

Versioning:
- VERSION is the authoritative release version.
- web-ui/package.json and web-ui/package-lock.json must match VERSION.
- dcc-ex-ui package metadata and Android display version are synchronized for Alpha10.
- build-desktop.ps1 generates web-ui/dist/version.json from VERSION and copies the
  built web UI to desktop/DCCExpressHub.Net/wwwroot.
- For release tags use .\release.ps1 0.1.0-alpha.10 on the alpha10 branch
  after validating a clean working tree and reviewing changes.

Windows desktop:
- .\build-desktop.ps1 -Configuration Release -Publish
- Output: dist/desktop/DCCExpressHub-0.1.0-alpha.10-win-x64.zip

Linux:
- .\run-linux.sh --build (on Linux, with the alpha10 branch checked out)
- No prepackaged Linux release is currently documented.

Android:
- Experimental .NET 10 / MAUI app; network command-station connections only.
- ApplicationVersion = 10; ApplicationDisplayVersion = 0.1.0-alpha.10.

Embedded firmware build targets (Sunton ESP32-S3 8048S043):
- sunton-8048s043-dccex
- sunton-8048s043-z21
- sunton-8048s043-yamorc7010
These three targets are listed in the release-hub.yml workflow.
Other ESP32 boards are not official release targets.

External Devices in Alpha10:
- DCCExpress S88 Adapter, ROCO Z21 WLANMAUS newGen and gamepad support.
