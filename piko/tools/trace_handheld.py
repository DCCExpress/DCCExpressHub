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

def partition_entries(flash):
    """Read candidate ESP-IDF partition tables from the start of a full dump."""
    best = []
    best_offset = None
    # The common location is 0x8000; vendor layouts may move the table.
    for base in range(0x7000, min(len(flash), 0x20000), 0x1000):
        entries = []
        for pos in range(base, min(base + 0xC00, len(flash)), 32):
            if pos + 32 > len(flash):
                break
            magic = struct.unpack_from("<H", flash, pos)[0]
            if magic in (0xFFFF, 0xEBEB):
                break  # end or ESP-IDF MD5 record
            if magic != 0x50AA:
                entries = []
                break
            _, kind, subtype, offset, size, label, flags = struct.unpack_from(
                "<HBBII16sI", flash, pos)
            if not size or offset + size > len(flash):
                entries = []
                break
            entries.append(dict(
                name=label.split(b"\\x00", 1)[0].decode("ascii", "replace"),
                kind=kind, subtype=subtype, off=offset, size=size))
        if len(entries) > len(best) and any(e["kind"] == 0 for e in entries):
            best, best_offset = entries, base
    return best_offset, best

def plausible_app(image):
    if len(image) < 32 or image[0] != 0xE9 or not 1 <= image[1] <= 16:
        return False
    try:
        segs = segments_of(image)
    except ValueError:
        return False
    return len(segs) >= 2 and any(
        0x40000000 <= seg["addr"] < 0x40400000 for seg in segs)

def select_application(data, partition="auto", app_offset=None):
    """Select an application from either a standalone image or full flash."""
    if app_offset is not None:
        if app_offset < 0 or app_offset >= len(data):
            raise ValueError("Application offset outside input file")
        image = data[app_offset:]
        if not plausible_app(image):
            raise ValueError("No valid ESP32 app image at offset 0x%X" % app_offset)
        return image, "explicit flash offset 0x%X" % app_offset
    if plausible_app(data):
        if partition != "auto":
            raise ValueError("--partition requires a full flash dump")
        return data, "standalone ESP32 application"
    if len(data) < 0x20000:
        raise ValueError("Not a standalone ESP32 app, and too small for a flash dump")

    table_offset, entries = partition_entries(data)
    candidates = []
    if entries:
        print("Partition table at flash offset 0x%X:" % table_offset)
        for e in entries:
            print("  %-16s type=0x%02X subtype=0x%02X offset=0x%06X size=0x%X" %
                  (e["name"], e["kind"], e["subtype"], e["off"], e["size"]))
            if e["kind"] == 0 and plausible_app(data[e["off"]:e["off"]+e["size"]]):
                candidates.append(e)
        if not candidates:
            raise ValueError("Partition table found but no valid ESP32 app partitions")
        if partition == "auto":
            # Default to factory if present; OTA may be booted instead.
            chosen = next((e for e in candidates if e["name"] == "factory"),
                          candidates[0])
        else:
            chosen = next((e for e in candidates if e["name"] == partition), None)
            if chosen is None:
                raise ValueError("No valid app partition called %r; available: %s" %
                                 (partition, ", ".join(e["name"] for e in candidates)))
        print("Selected %s (0x%X). If this is an OTA device, rerun with "
              "--partition ota_0 or ota_1 as appropriate." %
              (chosen["name"], chosen["off"]))
        return (data[chosen["off"]:chosen["off"]+chosen["size"]],
                "flash partition %s @ 0x%X" % (chosen["name"], chosen["off"]))

    if partition != "auto":
        raise ValueError("No partition table found; use --app-offset instead")
    # Fallback for damaged/nonstandard partition tables. ESP32 application
    # partitions normally begin at 64 KiB boundaries.
    offsets = [off for off in range(0x10000, len(data), 0x10000)
               if plausible_app(data[off:])]
    if not offsets:
        raise ValueError("No ESP32 application found in flash. "
                         "Use --app-offset 0x... if you know the app address.")
    if len(offsets) != 1:
        raise ValueError("Multiple candidate app offsets: %s. "
                         "Use --app-offset to choose." %
                         ", ".join("0x%X" % off for off in offsets))
    print("No partition table found; detected app at 0x%X" % offsets[0])
    return data[offsets[0]:], "flash scan @ 0x%X" % offsets[0]

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
    p.add_argument("firmware", type=Path, help="Complete 16MB flash, standalone app .bin or PIKO update ZIP")
    p.add_argument("--partition", default="auto", help="App partition name: factory, ota_0, ota_1, ... (default: auto)")
    p.add_argument("--app-offset", type=lambda value: int(value, 0), help="Override app offset in full flash (e.g. 0x10000)")
    p.add_argument("--objdump", help="Path to Xtensa objdump.exe (auto-detected by default)")
    p.add_argument("--out", type=Path,
                   default=Path("piko/analysis/handheld_xrefs.txt"))
    args = p.parse_args()
    raw = read_factory_image(args.firmware)
    data, source = select_application(raw, args.partition, args.app_offset)
    print("Analyzing:", source, "(%d bytes)" % len(data))
    segments = segments_of(data)
    objdump = find_objdump(args.objdump)
    literals = find_literals(data, segments)
    refs = {}
    for name, str_addr, ptr_addr in literals:
        refs.setdefault(ptr_addr, []).append((name, str_addr))
    output = [
        "PIKO factory handheld - targeted Xtensa literal xrefs",
        "Source: %s (%d input bytes)" % (args.firmware, len(raw)),
        "Selected: %s (%d app/partition bytes)" % (source, len(data)),
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
