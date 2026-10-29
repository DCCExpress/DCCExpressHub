#!/usr/bin/env python3
"""Disassemble verified PIKO keypad, rotary, and LCD code regions offline.

Usage:
  python piko/tools/trace_peripherals.py piko/PIKO-Handheld-Original-16MB.bin --partition ota_1

Uses the Xtensa objdump supplied with PlatformIO. Never flashes the handheld
or writes to the input firmware. Addresses below came from the factory image
L32R reports, NOT a guessed pin map.
"""
import argparse
from bisect import bisect_left
from pathlib import Path
import re
import sys
import tempfile

from trace_handheld import (
    read_factory_image, select_application, segments_of, find_objdump,
    disassemble, app_description,
)

# Function entries recovered from the literal pool next to task names,
# and keypad GPIO initializer target from the six-argument call.
ENTRIES = {
    "1.0.3.0": [
        ("keypad_setup_six_gpio_args", 0x400D97B0),
        ("ReadKeysTask", 0x400D9070),
        ("KeypadInterrupt", 0x400D8E28),
        ("KeypadTimeout", 0x400D9734),
        ("StopKeyInterrupt", 0x400D9544),
        ("RotaryTask", 0x400DA354),
        ("LCD_Task", 0x400F7810),
    ],
    "1.0.4.0": [
        ("keypad_setup_six_gpio_args", 0x400D97B0),
        ("ReadKeysTask", 0x400D9070),
        ("KeypadInterrupt", 0x400D8E28),
        ("KeypadTimeout", 0x400D9734),
        ("StopKeyInterrupt", 0x400D9544),
        ("RotaryTask", 0x400DA354),
        ("LCD_Task", 0x400F7810),
    ],
    "1.3.0.0": [
        ("keypad_setup_six_gpio_args", 0x400E3780),
        ("ReadKeysTask", 0x400E3004),
        ("KeypadInterrupt", 0x400E2DA0),
        ("KeypadTimeout", 0x400E3704),
        ("StopKeyInterrupt", 0x400E351C),
        ("RotaryTask", 0x400E4D60),
        ("LCD_Task", 0x40105B60),
    ],
}

ADDRESS = re.compile(r"^\s*([0-9a-fA-F]+):")
CALL = re.compile(r"\bcall(?:0|4|8|12)\s+0x([0-9a-fA-F]+)")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("firmware", type=Path)
    parser.add_argument("--partition", default="ota_1",
                        help="factory / ota_0 / ota_1 (default: ota_1)")
    parser.add_argument("--objdump", help="Explicit path to Xtensa objdump.exe")
    parser.add_argument("--out", type=Path,
                        default=Path("piko/analysis/peripheral_calls.txt"))
    parser.add_argument("--lines", type=int, default=330,
                        help="Instructions/lines per function (default: 330)")
    args = parser.parse_args()
    if not 30 <= args.lines <= 2000:
        parser.error("--lines must be between 30 and 2000")
    raw = read_factory_image(args.firmware)
    image, source = select_application(raw, args.partition)
    metadata = app_description(image)
    version = next((v for v in ENTRIES if ("version=" + v) in metadata), None)
    if version is None:
        parser.error("Unrecognized PIKO application version. Metadata: " + metadata)
    print("Chosen firmware:", metadata)
    report = [
        "PIKO peripherals: offline Xtensa disassembly",
        "Input: " + str(args.firmware),
        "Partition: " + source,
        "Metadata: " + metadata,
        "CAUTION: firmware disassembly, not verified wiring.",
        "Known keypad setup args: GPIO 26,14,27,32,33,34 (roles unknown).",
        "",
    ]
    targets = ENTRIES[version]
    objdump = find_objdump(args.objdump)
    with tempfile.TemporaryDirectory(prefix="piko-peripherals-") as tmp:
        segments = segments_of(image)
        for seg in segments:
            selected = [(name, addr) for name, addr in targets
                        if seg["addr"] <= addr < seg["addr"] + seg["length"]]
            if not selected:
                continue
            listing = disassemble(objdump, seg, Path(tmp))
            index = []
            positions = []
            for i, line in enumerate(listing):
                matched = ADDRESS.match(line)
                if matched:
                    positions.append(int(matched.group(1), 16))
                    index.append(i)
            for name, addr in selected:
                pos = bisect_left(positions, addr)
                if pos >= len(positions) or positions[pos] != addr:
                    report.append("UNRESOLVED %s @ 0x%08X (disassembler alignment)" % (name, addr))
                    continue
                lines = listing[index[pos]:index[pos] + args.lines]
                report.append("\n===== %s @ 0x%08X =====" % (name, addr))
                report.extend(lines)
                calls = sorted(set(int(x, 16)
                    for line in lines for x in CALL.findall(line)))
                report.append("CALL TARGETS (verify call sites): " +
                              ", ".join("0x%08X" % c for c in calls))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(report) + "\n", encoding="utf-8")
    print("Written:", args.out)
    print("Open/attach this text report for GPIO, shift-register and SPI tracing.")

if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError) as exc:
        sys.exit("ERROR: " + str(exc))
