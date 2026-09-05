# DCCExpressHub merged firmware builder

Run from the repository root:

```powershell
.\build-merged.ps1
```

Default environment:

```text
m5stack-basic
```

Another PlatformIO environment:

```powershell
.\build-merged.ps1 -Environment esp32dev
```

The script:

1. builds the React web UI;
2. prepares `data/`;
3. builds the selected PlatformIO firmware;
4. builds `littlefs.bin`;
5. parses the generated `partitions.bin`;
6. finds the real first APP partition offset;
7. finds the real LittleFS/SPIFFS partition offset;
8. merges:
   - bootloader
   - partition table
   - boot_app0
   - firmware
   - LittleFS
9. writes:

```text
dist/firmware/DCCExpressHub-<environment>-merged.bin
dist/firmware/DCCExpressHub-<environment>-merged.json
```

The merged BIN is a **factory/recovery image** and is intended to be flashed at:

```text
0x000000
```

Because the merged binary spans the flash gaps with `0xFF`, flashing the whole
file from address zero resets the NVS configuration area too. This is deliberate
for a factory/recovery image. Configure the Hub again with
`tools/serial-configurator` afterwards.
