DCCExpressHub release setup

Current policy:
- Windows backend is the primary DCCExpressHub runtime.
- DCC-EX is the official / primary command-station backend.
- ESP32-S3 is the only supported embedded platform.
- The official embedded firmware target is:
    * Sunton ESP32-8048S043 / DCC-EX
- Classic ESP32, ESP32 DevKit and M5Stack Basic are not supported targets.
- Z21 remains future work and no official Z21 firmware is released.

Release version:
  VERSION is authoritative.

Example:
  .\release.ps1 0.1.0-alpha.2

Pushing a matching v* tag starts GitHub Actions.
