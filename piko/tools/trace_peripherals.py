#!/usr/bin/env python3
"""Disassemble verified PIKO keypad, rotary, and LCD code regions offline.

Usage:
  python piko/tools/trace_peripherals.py piko/PIKO-Handheld-Original-16MB.bin --partition ota_1

Uses the Xtensa objdump supplied with PlatformIO. Never flashes the handheld
or writes to the input firmware. Addresses below came from the factory image
L32R reports, NOT a guessed pin map.
"""
import argparse
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
        ("RotaryInputISR", 0x400E4C60),
        ("RotaryWorkTask", 0x400E5220),
        ("KeypadHelper1", 0x400E3664),
        ("KeypadHelper2", 0x400E36AC),
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
        "Recovered keypad: GPIO26/14/27 outputs; GPIO32/33/34 inputs.",
        "",
    ]
    targets = ENTRIES[version]
    objdump = find_objdump(args.objdump)
    with tempfile.TemporaryDirectory(prefix="piko-peripherals-") as tmp:
        segments = segments_of(image)
        for name, addr in targets:
            seg = next((s for s in segments
                        if s["addr"] <= addr < s["addr"] + s["length"]), None)
            if seg is None:
                report.append("UNRESOLVED %s @ 0x%08X (no image segment)" % (name, addr))
                continue
            # Important: raw objdump may lose Xtensa instruction alignment
            # when decoding the entire IROM from its literal pool. Rebase
            # at the KNOWN function entry and disassemble from that byte.
            relative = addr - seg["addr"]
            tail = seg["data"][relative:relative + 0x3000]
            rebased = dict(seg)
            rebased["number"] = addr
            rebased["addr"] = addr
            rebased["data"] = tail
            listing = disassemble(objdump, rebased, Path(tmp))
            matching = [i for i, line in enumerate(listing)
                        if ADDRESS.match(line) and
                        int(ADDRESS.match(line).group(1), 16) == addr]
            if not matching:
                report.append("UNRESOLVED %s @ 0x%08X (objdump did not decode entry)" %
                              (name, addr))
                continue
            lines = listing[matching[0]:matching[0] + args.lines]
            report.append("\\n===== %s @ 0x%08X =====" % (name, addr))
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
