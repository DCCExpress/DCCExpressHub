# PIKO SmartControl WLAN handheld firmware (experimental)

This is an **independent PlatformIO project** for the ESP32-WROOM-32E
in the PIKO handheld. It does not use the repository-root `src/` directory
or the existing ESP32-S3 environments.

## Build only (does not touch the device)

```powershell
pio run -d piko
```

Or open the `piko/` folder as a separate PlatformIO project.

The source is currently a **non-functional boot skeleton**, not yet a Z21
handheld. The display, controls, battery hardware and pin assignments
are not mapped.

**Do not upload this firmware** until a full 16 MB factory-flash backup has
been made and verified, ESP32 security/eFuse configuration has been checked,
and a dependable restoration procedure has been established. Flashing this
skeleton would replace the working factory application.
