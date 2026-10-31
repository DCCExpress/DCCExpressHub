#!/usr/bin/env python3
"""Offline reconstruction of the PIKO 1.3.0.0 keyboard controller.

Unlike the experimental HOT/COLD scans this tool **never drives GPIOs**.
It reads only the original 16MiB flash backup and traces known OEM
function-entry points, literal pointers and the keyboard state variables.
Usage: python piko/tools/recover_oem_keypad.py piko/PIKO-Handheld-Original-16MB.bin
"""
import argparse
from pathlib import Path
import struct
import sys

APP_OFFSET = 0x590000
SITES = {
    "keypad_boot_and_pin_init": 0x400E3924,
    "six_pin_setup": 0x400E3780,
    "serial_write_7_bits": 0x400E3664,
    "serial_mask_modify": 0x400E36AC,
    "serial_bit6_set": 0x400E36DC,
    "serial_bit6_clear": 0x400E36F0,
    "row_advance_task": 0x400E3704,
    "column_event_worker": 0x400E2DA0,
    "shared_gpio_callback": 0x400839D8,
    "read_key_events_task": 0x400E3004,
}
LITERALS = {
    "selected_row_index": 0x400D0FC8,
    "serial_output_mask": 0x400D1010,
    "key_column_code": 0x400D0FBC,
    "keypad_scan_semaphore": 0x400D0FB8,
    "keypad_gpio_event_queue": 0x400D0FB4,
    "column_event_worker_entry": 0x400D1034,
    "shared_gpio_callback_entry": 0x400D0FD4,
    "row_advance_task_entry": 0x400D103C,
}

def segments(image):
    if len(image)<24 or image[0]!=0xe9:
        raise ValueError("No ESP-IDF app header at OTA1 flash offset")
    offset=24
    result=[]
    for _ in range(image[1]):
        if offset+8>len(image):
            raise ValueError("Truncated segment header")
        addr,length=struct.unpack_from("<II",image,offset)
        data_start=offset+8
        if data_start+length>len(image):
            raise ValueError("Truncated segment")
        result.append((addr,image[data_start:data_start+length]))
        offset=data_start+length
    return result

def at(segs,virtual,n):
    for base,data in segs:
        idx=virtual-base
        if idx>=0 and idx+n<=len(data):
            return data[idx:idx+n]
    raise ValueError("Address 0x%08X is outside firmware segments"%virtual)

# These bytes come from the original OTA_1 Xtensa disassembly, not from
# naming guesses. If any signature differs we refuse to call the inferred
# event-group protocol verified for the selected firmware image.
OEM_EVENT_SIGNATURES = {
    "worker_set_bit1": (0x400E2DB9, "0c1b 817fb8 a808 e5d0aa"),
    "worker_disable_gpio_irq": (0x400E2DC3, "a801 652d3f"),
    "worker_reinstall_callback": (0x400E2FAB, "a801 a0ca20 b109b8 65003f"),
    "worker_clear_bit1": (0x400E2FB6, "0c1b 8100b8 a808 a5abaa"),
    "timer_read_group_bits": (0x400E3709, "0c0b 812bb6 a808 6536aa 261a35"),
    "timer_write_serial": (0x400E3749, "a5f1ff"),
}

def audit_event_protocol(segs):
    print("\\nOEM queue / synchronization call-site signatures:")
    failures=[]
    for name,(address,hex_bytes) in OEM_EVENT_SIGNATURES.items():
        expected=bytes.fromhex(hex_bytes)
        observed=at(segs,address,len(expected))
        match=expected==observed
        print("  %-28s @0x%08X %s" %
              (name,address,"MATCH" if match else "MISMATCH"))
        if not match:
            failures.append(name)
    if failures:
        raise ValueError("OEM event protocol signatures failed: " + ", ".join(failures))
    print("""
Verified OEM call ordering:
  column worker receives GPIO identifier from queue
  -> invokes 0x4008DAD0(handle, 1)
  -> invokes 0x4012209C(gpio) (probable disable interrupt)
  -> decodes current selector and column to a key code
  -> invokes 0x40121FB8(gpio, callback, gpio) to re-install handler
  -> invokes 0x4008DA78(handle, 1)
  row task invokes 0x4008DA78(handle, 0);
  when return value == 1 it skips selector update.
High-confidence API interpretation, not a recovered ELF symbol table:
  0x4008DAD0 ~= xEventGroupSetBits(group, 1)
  0x4008DA78 ~= xEventGroupClearBits(group, bits)
  a bits argument of ZERO reads the old event bits without changing them,
  consistent with the timer's return-value comparison to 1.
This supports temporarily FREEZING row stepping while a key event is handled,
not continuously decoding the pressed key from sampled GPIO levels.
""")
    return True


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("flash",type=Path)
    args=parser.parse_args()
    raw=args.flash.read_bytes()
    if len(raw)!=16*1024*1024:
        parser.error("Expected the original 16MiB flash backup; never use a new OTA image")
    image=raw[APP_OFFSET:]
    # Standard ESP-IDF app_desc_t: app version is at offset 0x30.
    version=image[0x30:0x50].split(b"\0",1)[0].decode("ascii","replace")
    if version!="1.3.0.0":
        parser.error("These symbol addresses apply only to OTA1 v1.3.0.0; found "+version)
    segs=segments(image)
    audit_event_protocol(segs)
    print("PIKO original flash / OTA1 / firmware",version)
    print("OEM keyboard code anchors (entry bytes; disassemble these, not guessed LCD functions):")
    for name,address in SITES.items():
        prefix=at(segs,address,6)
        print("  %-26s 0x%08X  %s"%(name,address,prefix.hex(" ")))
        if prefix[:3]!=b"\x36\x41\x00" and name in ("six_pin_setup","serial_write_7_bits","serial_mask_modify","serial_bit6_set","serial_bit6_clear","row_advance_task"):
            print("    WARNING: different Xtensa prologue; verify exact function entry")
    print("\nLiteral references resolved from ORIGINAL flash (not runtime values):")
    for name,location in LITERALS.items():
        value=struct.unpack("<I",at(segs,location,4))[0]
        print("  %-26s literal 0x%08X -> 0x%08X"%(name,location,value))
    worker=struct.unpack("<I",at(segs,LITERALS["column_event_worker_entry"],4))[0]
    callback=struct.unpack("<I",at(segs,LITERALS["shared_gpio_callback_entry"],4))[0]
    tick=struct.unpack("<I",at(segs,LITERALS["row_advance_task_entry"],4))[0]
    if worker!=SITES["column_event_worker"] or callback!=SITES["shared_gpio_callback"] or tick!=SITES["row_advance_task"]:
        print("WARNING: OEM event worker/callback/timer literal targets do not match recovered symbols.")
    print("""
OEM logic confirmed by the disassembled functions above:
  GPIO26 -> serial DATA; GPIO27 -> CLOCK; GPIO14 -> LATCH.
  The serializer clocks seven bits from bit 6 down through bit 0.
  Initial mask 0x40, then set bit0 -> mask 0x41, then serialize.
  Timer rotates one selected bit among 0..5; separate code sets/clears bit6.
  GPIO32/33/34 use a shared GPIO callback at 0x400839D8.\n  A separate queue-consuming worker at 0x400E2DA0 maps the GPIO sources\n  to column code 1/2/3.
  The worker combines column code with selected row 0..5 in the high nibble,
  yielding row/column code (row+1)*16 + column.
  A separate ReadKeysTask receives and interprets key events.

  IMPORTANT: The physical IC type, serial bit6 function, actual row wiring,
  scan/electrical timing, and physical button-to-keycode mapping remain UNKNOWN.
  The current experimental firmware did NOT electrically isolate any row:
  physical 0,1,2,3 raised their column for all 12 HOT/COLD patterns.
  This does not justify more blind GPIO scanning or assigning key names.

Next engineering investigation:
  1) Reconstruct GPIO callback 0x400839D8 and the event queue semantics.
  2) Trace queue delay, selector state and the physical role of bit6.
  3) Only then produce an OEM-compatible event-driven implementation.
No GPIO outputs, serial ports or Wi-Fi are accessed by this script.
""")
if __name__=="__main__":
    try: main()
    except (OSError,ValueError,struct.error) as exc: sys.exit("ERROR: "+str(exc))
