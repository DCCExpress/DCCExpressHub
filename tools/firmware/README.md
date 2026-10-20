# DCCExpressHub merged firmware builder

The supported embedded target is the **Sunton ESP32-8048S043 / ESP32-S3**.

Run from the repository root:

```powershell
.\build-merged.ps1
```

The default and supported PlatformIO environment is:

```text
sunton-8048s043-dccex
```

Explicit form:

```powershell
.\build-merged.ps1 -Environment sunton-8048s043-dccex
```

The script:

1. builds the React Web UI;
2. prepares `data/`;
3. builds the ESP32-S3 firmware;
4. builds `littlefs.bin`;
5. parses the generated partition table;
6. merges the bootloader, partition table, boot_app0, firmware and LittleFS;
7. writes the merged factory image under `dist/firmware`.

Expected output:

```text
dist/firmware/DCCExpressHub-Sunton-ESP32-8048S043-DCCEX-v<version>-merged.bin
dist/firmware/DCCExpressHub-Sunton-ESP32-8048S043-DCCEX-v<version>-merged.json
```

The merged BIN is a **factory / recovery image** and is flashed at:

```text
0x000000
```

Flashing the complete factory image may reset NVS configuration. Reconfigure
the Hub after a factory / recovery flash when necessary.
