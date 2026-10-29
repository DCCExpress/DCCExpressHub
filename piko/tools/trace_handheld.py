#!/usr/bin/env python3
"""Prepare a targeted Xtensa disassembly report for a PIKO ESP32 app image.

Read-only offline tool. Needs Python and the objdump already included in the
PlatformIO Xtensa toolchain. Does not connect to or flash the handheld.

Example:
    python piko/tools/trace_handheld.py C:\\path\\Firmware-Handheld.bin
"""
import argparse
import io
from pathlib import Path
import re
import shutil
import struct
import tarfile
import zipfile
import subprocess
import sys
import tempfile

TARGETS = (
    b"./main/src/keypad.c", b"ReadKeysTask", b"INTERRUPT KEYPAD",
    b"TIMEOUT KEYPAD", b"INTERRUPT STOPKEY",
    b"RotaryTask", b"RotaryKnob", b"RotaryEncoder",
    b"LCD-Task", b"LCD first DAh respond",
    b"keypad_BackLight_init", b"Failed to spi_bus_initialize",
)

def read_factory_image(path):
    """Accept extracted .bin, Firmware.tar, or the original PSCW update .zip."""
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            tar_names = [n for n in zf.namelist() if n.endswith("/Firmware.tar") or n == "Firmware.tar"]
            if not tar_names:
                raise ValueError("Update ZIP does not include Firmware.tar")
            archive = zf.read(tar_names[0])
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:*") as tf:
            entry = tf.extractfile("Firmware-Handheld.bin")
            if entry is None:
                raise ValueError("Firmware.tar lacks Firmware-Handheld.bin")
            return entry.read()
    if tarfile.is_tarfile(path):
        with tarfile.open(path, "r:*") as tf:
            entry = tf.extractfile("Firmware-Handheld.bin")
            if entry is None:
                raise ValueError("Archive lacks Firmware-Handheld.bin")
            return entry.read()
    return path.read_bytes()

def segments_of(image):
    if len(image) < 24 or image[0] != 0xE9:
        raise ValueError("Expected ESP32 app image with 0xE9 magic")
    offset, segments = 24, []
    for number in range(image[1]):
        if offset + 8 > len(image):
            raise ValueError("Truncated ESP32 segment header")
        vaddr, length = struct.unpack_from("<II", image, offset)
        fileoff = offset + 8
        if fileoff + length > len(image):
            raise ValueError("Truncated ESP32 segment")
        segments.append(dict(number=number, addr=vaddr, off=fileoff,
                             length=length, data=image[fileoff:fileoff+length]))
        offset = fileoff + length
    return segments

def virtual_address(fileoff, segs):
    for seg in segs:
        if seg["off"] <= fileoff < seg["off"] + seg["length"]:
            return seg["addr"] + fileoff - seg["off"]
    return None

def find_objdump(explicit):
    if explicit:
        path = Path(explicit).expanduser()
        if not path.is_file():
            raise FileNotFoundError("objdump does not exist: " + str(path))
        return str(path)
    variants = ("xtensa-esp-elf-objdump", "xtensa-esp32-elf-objdump")
    for name in variants:
        found = shutil.which(name)
        if found:
            return found
    root = Path.home() / ".platformio" / "packages"
    for package in ("toolchain-xtensa-esp-elf", "toolchain-xtensa32"):
        for name in variants:
            for suffix in (".exe", ""):
                file = root / package / "bin" / (name + suffix)
                if file.is_file():
                    return str(file)
    raise FileNotFoundError(
        "No Xtensa objdump found. Check the PlatformIO installation or use "
        "--objdump C:\\Users\\...\\.platformio\\packages\\toolchain-xtensa-esp-elf"
        "\\bin\\xtensa-esp-elf-objdump.exe")

def find_literals(image, segs):
    result = []
    for name in TARGETS:
        offset = image.find(name)
        if offset < 0:
            continue
        addr = virtual_address(offset, segs)
        if addr is None:
            continue
        needle = struct.pack("<I", addr)
        for seg in segs:
            if not (0x40080000 <= seg["addr"] < 0x40400000):
                continue
            pos = 0
            while True:
                at = seg["data"].find(needle, pos)
                if at < 0:
                    break
                result.append((name.decode("utf-8", "replace"),
                               addr, seg["addr"] + at))
                pos = at + 1
    return result

LINE = re.compile(r"^\s*([0-9a-fA-F]+):\s+[0-9a-fA-F]+\s+(.+)$")
L32R = re.compile(r"\bl32r\s+\w+\s*,\s*(?:0x)?([0-9a-fA-F]+)\b")

def disassemble(objdump, seg, folder):
    infile = folder / ("segment_%d.bin" % seg["number"])
    infile.write_bytes(seg["data"])
    cmd = [objdump, "-D", "-b", "binary", "-m", "xtensa",
           "--adjust-vma=0x%X" % seg["addr"], str(infile)]
    proc = subprocess.run(cmd, capture_output=True, text=True, errors="replace",
                          timeout=180, check=False)
    if proc.returncode:
        raise RuntimeError("objdump failed: " + proc.stderr[-1500:])
    return proc.stdout.splitlines()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("firmware", type=Path, help="Firmware-Handheld.bin or official PSCW update ZIP")
    p.add_argument("--objdump", help="Path to Xtensa objdump.exe (auto-detected by default)")
    p.add_argument("--out", type=Path,
                   default=Path("piko/analysis/handheld_xrefs.txt"))
    args = p.parse_args()
    data = read_factory_image(args.firmware)
    segments = segments_of(data)
    objdump = find_objdump(args.objdump)
    literals = find_literals(data, segments)
    refs = {}
    for name, str_addr, ptr_addr in literals:
        refs.setdefault(ptr_addr, []).append((name, str_addr))
    output = [
        "PIKO factory handheld - targeted Xtensa literal xrefs",
        "Source: %s (%d bytes)" % (args.firmware, len(data)),
        "Disassembler: %s" % objdump,
        "NOTE: raw literal pointers and disassembler guesses are not confirmed GPIO mappings.",
        "",
        "SEGMENTS:",
    ]
    for s in segments:
        output.append("  %d: file 0x%X, memory 0x%08X, size 0x%X" %
                      (s["number"], s["off"], s["addr"], s["length"]))
    output.append("\nLITERAL POOLS (string -> string address -> pointer location):")
    for name, str_addr, ptr_addr in literals:
        output.append("  %-34s 0x%08X -> 0x%08X" %
                      (name, str_addr, ptr_addr))
    output.append("\nL32R REFERENCES (instruction context):")
    hits = 0
    with tempfile.TemporaryDirectory(prefix="piko-disasm-") as tmp:
        for seg in segments:
            if not (0x40080000 <= seg["addr"] < 0x40400000):
                continue
            lines = disassemble(objdump, seg, Path(tmp))
            for i, line in enumerate(lines):
                m = LINE.match(line)
                if not m:
                    continue
                ins = L32R.search(m.group(2))
                if not ins:
                    continue
                pointer_addr = int(ins.group(1), 16)
                if pointer_addr not in refs:
                    continue
                hits += 1
                output.append("\n  TARGET: " + ", ".join(n for n, _ in refs[pointer_addr]))
                output.append("  l32r @ 0x%08X reads literal @ 0x%08X" %
                              (int(m.group(1), 16), pointer_addr))
                output.extend(lines[max(0, i-10):i+21])
    output.append("\nMatched L32R instructions: %d" % hits)
    if not hits:
        output.append("No matching instructions found. This may reflect raw "
                      "disassembly alignment or compiler optimizations; use Ghidra.")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(output) + "\n", encoding="utf-8")
    print("Wrote", args.out)
    print("Literal pointers:", len(literals), "; matched L32R instructions:", hits)
    print("Copy the TARGET sections into the chat; do NOT commit vendor firmware.")

if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
        sys.exit("ERROR: " + str(exc))
