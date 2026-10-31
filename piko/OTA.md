# PIKO handheld — browser OTA updater (alpha9)

The updater is **on the PIKO handheld itself**, not in DCCExpressHub.
Only files under `piko/` are modified.

## Before flashing

- Keep the full original 16 MB PIKO flash backup in a safe place (not in Git).
- The first OTA-enabled install **must be flashed via serial** with a validated flash layout.
- `piko/partitions.csv` reproduces the original PIKO application offsets:
  `factory=0x190000`, `ota_0=0x390000`, `ota_1=0x590000` (2 MiB each).
  This is **not** a guarantee that existing installed partition tables or application
  boot selection match it. Compare the actual device partition table before flashing.
- PlatformIO can write the bootloader, partition table and factory app during initial
  serial upload. This can replace the manufacturer's firmware. Do not use serial
  upload until the backup and restore procedure have been confirmed.
- The web uploader accepts **only an ESP-IDF application image**, usually
  `piko/.pio/build/piko-handheld/firmware.bin`. Never upload the 16 MB flash dump,
  bootloader, partition table, or a ZIP.

## Build configuration

From the repository root:

```powershell
pio run -d piko -t menuconfig
```

In **DCCExpress PIKO handheld**, configure:

- PIKO standalone Wi-Fi SSID (default `PIKO-Update`)
- PIKO standalone Wi-Fi password (**8–63 characters, required**)
- Optional existing-router Wi-Fi SSID and password (blank SSID = access-point-only mode)
- OTA update password (**must not be empty**)
- OTA HTTP port (default `8080`)

Keep secrets in local, untracked `sdkconfig` files; do not commit credentials.

```powershell
pio run -d piko
```

After first flashing, connect your PC/phone to the PIKO standalone WLAN (default SSID `PIKO-Update`) using its configured AP password. Browse to **http://192.168.4.1:8080/**. The device also advertises **http://piko.local:8080/** via mDNS where supported. On Windows, `.local` resolution may depend on network configuration: the numeric IP is the reliable fallback.

If optional router credentials are configured, the PIKO also joins that WLAN (AP+STA mode), and the serial log reports the assigned station IP:

```text
piko_wifi: Connected; open http://192.168.x.x:8080/
```

Visit either the standalone AP address or that station address, enter the OTA password, select the
built `firmware.bin` and click **Upload firmware**. The page shows upload
progress; the handheld verifies the ESP application image and restarts only
after successfully writing the inactive OTA partition and changing the boot
selection.

## Security and recovery

- The web endpoint requires the configured password using the
  `X-OTA-Key` header. Empty OTA password disables uploads.
- **HTTP is not encrypted**. Use only a trusted, isolated local Wi-Fi network.
  Do not expose the port to the internet. Credentials can be observed on an
  untrusted network.
- Losing Wi-Fi, a broken update or an incompatible partition layout can still
  require serial recovery. Preserve the original flash dump.
- This implementation currently runs the existing GPIO diagnostics and heartbeat;
  no Z21 control or LCD has been activated.

## Test status

Implementation committed to alpha9. **Not yet compiled on the target PlatformIO
environment or physically flashed/tested on the PIKO.** Verify the board's
actual flash table and the resulting build configuration before the first upload.

## Web dashboard and key discovery

The new home page is at `http://192.168.4.1:8080/` (or `http://piko.local:8080/` where mDNS works).
- **Home**: navigation to Diag, Console and Firmware update.
- **Diag**: live, raw 3x3 keypad matrix readings. Rows GPIO26, GPIO14, GPIO27 are scanned sequentially as open-drain low outputs; columns GPIO32, GPIO33, GPIO34 remain input-only with the board's existing electrical bias. Labels are NOT yet assigned to physical keys. Enter the actual key number/name into each cell as you test and use **Copy mapping** to share the result. Entries are saved only in browser localStorage.
- **Console**: last 48 diagnostic events, including matrix transitions, rotary movement, rotary push and STOP GPIO observations. This is *not* a mirror of all serial/UART output.
- **Firmware update**: moved from `/` to `/ota`; HTTP API remains `POST /api/update`.

**Hardware caution:** matrix row/column assignments are inferred from the vendor firmware and remain to be verified physically. This diagnostic intentionally drives only the three candidate row pins, as open-drain with nonselected rows released; it does not configure internal pull-ups or manipulate bootstrapping pins as outputs. If readings are unstable or unrelated peripherals react, stop the experiment and review the pin mapping. Test one key at a time.

Changes are committed but the device build/hardware behavior are not verified in this environment.
