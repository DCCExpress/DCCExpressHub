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


## Factory handheld firmware inspection (2025-12-11 release)

Source analyzed offline: `2025-12-11_Update_PSCW_1_3_0_0.zip`,
`Firmware-Handheld.bin` (1,354,752 bytes).
ESP32 application image metadata: project `Firmware-Handheld`,
version `1.3.0.0`, compiled Dec 11 2025, ESP-IDF `v5.4.2-dirty`.
This is distinct from the older 1.0.3.0 application boot log observed on
the device. **Do not flash this vendor image based solely on this analysis.**

Firmware string references (file offsets, hexadecimal):
| Offset | Firmware string | Implication |
|---|---|---|
| 0x601c | `./main/src/keypad.c` | Dedicated keypad module |
| 0x6060 | `INTERRUPT KEYPAD` | Keypad interrupt path |
| 0x6074 | `TIMEOUT KEYPAD` | Keypad timeout path |
| 0x62d4 | `RotaryTask` | Rotary FreeRTOS task |
| 0x63dc | `RotaryKnob` | Rotary-related code |
| 0x643c | `RotaryEncoder` | Rotary encoder-related code |
| 0x7260 | `LCD-Task` | LCD task |
| 0x7271 | `LCD first DAh respond is %x` | LCD response / identification path |
| 0x72a5 | `after reset LCD first DAh respond is %x` | LCD reset/retry check |
| 0xde09 | `Failed to spi_bus_initialize` | SPI peripheral initialization path |
| 0x1cf90 | `INTERRUPT_KEYPAD` | Keypad-related identifier |
| 0x1cfa4 | `keypad_BackLight_init` | Keypad backlight init identifier |

**Not yet established:** which GPIOs connect to 74HC595 SER/SRCLK/RCLK,
keyboard return lines, rotary A/B or LCD SPI/control lines; also no
confirmed LCD controller ID. Strings are evidence of module existence,
**not a pin map**. In particular, the 0xDA LCD read command is used by
multiple display controllers and does not identify one uniquely.

### Next reverse-engineering steps
- Load the extracted ESP32 application image into Ghidra with an Xtensa
  processor extension / appropriate ESP32 loader.
- Find references to `./main/src/keypad.c`,
  `INTERRUPT KEYPAD`, `RotaryEncoder`, `LCD-Task`.
- Identify callers of `gpio_config`/`gpio_set_direction`,
  `gpio_set_level`, `gpio_isr_handler_add` and
  `spi_bus_initialize`; extract actual pin constants at call sites.
- Cross-check all recovered GPIOs against board routing before allowing
  any output drive.
- Keep the firmware's SPIFFS dependency in mind; the current minimal
  experimental partition table has no SPIFFS partition.


### ESP32 image segment and literal-reference mapping

Parsed original `Firmware-Handheld.bin` as an ESP32 image (magic `0xE9`,
7 loadable segments), without modifying it. Two relevant segments:

- DROM `0x3F400020`, file offset `0x20`, size `0x4BED8`
- IROM `0x400D0020`, file offset `0x50020`, size `0xDE998`

The following four-byte little-endian string-address literals occur in
the program's IROM region (verified by direct byte search):

| Identifier | String virtual address | Pointer literal IROM address |
|---|---|---|
| `keypad_BackLight_init` | `0x3F41CFA4` | `0x400D101C` |
| `ReadKeysTask` | `0x3F406050` | `0x400D1028` |
| `INTERRUPT KEYPAD` | `0x3F406060` | `0x400D1030` |
| `TIMEOUT KEYPAD` | `0x3F406074` | `0x400D1038` |
| `INTERRUPT STOPKEY` | `0x3F406084` | `0x400D1044` |
| `RotaryTask` | `0x3F4062D4` | `0x400D1150` |
| `RotaryKnob` | `0x3F4063DC` | `0x400D1240` |
| `RotaryEncoder` | `0x3F40643C` | `0x400D1258` |
| `LCD-Task` | `0x3F407260` | `0x400D1F5C` |

These are **addresses of pointer literals**, not necessarily function
entry points or GPIO register references. Follow Xtensa `L32R` references
to these locations when disassembling. This supports locating the
hardware-initialization code but does not by itself expose pin constants.
