# Final DCC-EX firmware parity sweep

Added in this pass:
- command-center reconnect bootstrap: track configuration + trip telemetry
- configured locomotive state sync from locos.json (max 32, unique, 25 ms pacing)
- 1 s current telemetry polling while WS clients exist
- 1 s dccExStatus broadcast while WS clients exist
- exact setBlock / setBlockRemove numeric validation before ushort conversion

Platform-specific ESP features intentionally remain native-neutral (Wi-Fi/heap/hardware telemetry and physical S88).
Future firmware-only command-center variants such as Z21 are outside the current DCC-EX native parity target.
