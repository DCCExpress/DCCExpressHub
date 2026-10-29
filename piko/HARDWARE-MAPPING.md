# PIKO SmartControl WLAN – hardware mapping log

Known: ESP32-WROOM-32E (ESP32-D0WD-V3), 16 MB SPI flash,
ESP-IDF 4.4.1 factory application; USB UART diagnostics work.
**No verified GPIO-to-peripheral assignment yet.**

## Evidence first (no flashing)
1. Inspect both PCB sides and photograph silk labels, display flex,
   button matrix traces, encoder A/B/switch and any I/O expanders.
2. Record all visible IC markings (display controller, IO expander,
   power management) and connector pins.
3. Trace board signals with an unpowered device using a multimeter
   continuity setting. Disconnect USB and battery before continuity tests.
4. Read the factory firmware image offline to locate GPIO initializers,
   I2C addresses, SPI pins and display driver references.
5. Only after recording a verified pin map, create real display/input
   drivers in source. Never indiscriminately toggle unknown GPIOs.

## GPIO probe (optional, custom-firmware only)
The read-only candidate monitor is controlled by
`CONFIG_PIKO_HW_INPUT_PROBE` (default **off**).
It samples GPIO 32, 33, 34, 35, 36 and 39, prints only changes
to the ESP-IDF serial console. It applies no internal pull resistors,
but input-enable still alters pad configuration; it is not a substitute
for schematics or a GPIO map. Floating pins may change spontaneously.

**Do not flash the experimental firmware to the factory handheld
just to use this probe.** First preserve and verify the full factory
flash backup, security configuration and restore process.

| Device part | Chip or connector | ESP32 pins | Verified? |
|---|---|---|---|
| LCD and backlight | Unknown | Unknown | No |
| Rotary A/B/button | Unknown | Unknown | No |
| Keypad | Unknown (direct or expander) | Unknown | No |
| Battery / charging | Unknown | Unknown | No |
| USB console | UART0 likely (verify) | Unknown | No |
