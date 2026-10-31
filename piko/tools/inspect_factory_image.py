#!/usr/bin/env python3
"""Inspect a vendor ESP32 image without executing/flashing it.

Usage: python piko/tools/inspect_factory_image.py path/to/Firmware-Handheld.bin
Prints image segments and references to keypad/rotary/display strings.
This is a literal-address search, NOT Xtensa disassembly or a GPIO pin map.
"""
import argparse
import struct
from pathlib import Path

NEEDLES = (b"keypad.c", b"ReadKeysTask", b"INTERRUPT KEYPAD",
           b"TIMEOUT KEYPAD", b"INTERRUPT STOPKEY", b"RotaryTask",
           b"RotaryKnob", b"RotaryEncoder", b"LCD-Task",
           b"LCD first DAh respond", b"keypad_BackLight_init",
           b"spi_bus_initialize")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    args = parser.parse_args()
    data = args.image.read_bytes()
    if len(data) < 24 or data[0] != 0xE9:
        parser.error("not an ESP32 image (magic byte != E9)")
    cursor = 24
    segments = []
    for i in range(data[1]):
        if cursor + 8 > len(data):
            parser.error("truncated segment header")
        addr, size = struct.unpack_from("<II", data, cursor)
        offset = cursor + 8
        if offset + size > len(data):
            parser.error("truncated segment")
        segments.append((addr, offset, size))
        print(f"segment {i}: file=0x{offset:06X} vaddr=0x{addr:08X} size=0x{size:X}")
        cursor = offset + size

    def virtual(file_offset):
        for addr, offset, size in segments:
            if offset <= file_offset < offset + size:
                return addr + file_offset - offset
        return None

    print("\nString address -> raw pointer literal locations (not function entries):")
    for needle in NEEDLES:
        index = data.find(needle)
        if index < 0:
            print(f"{needle.decode(errors='replace')}: not found")
            continue
        addr = virtual(index)
        if addr is None:
            continue
        pointer = struct.pack("<I", addr)
        locations = []
        offset = 0
        while True:
            offset = data.find(pointer, offset)
            if offset < 0:
                break
            location = virtual(offset)
            if location is not None:
                locations.append(f"0x{location:08X}")
            offset += 1
        print(f"{needle.decode(errors='replace'):30} str=0x{addr:08X} literals={', '.join(locations[:16]) or '(none)'}")

if __name__ == "__main__":
    main()
