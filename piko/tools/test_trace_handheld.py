"""Regression tests for ESP32 standalone/full-flash image detection.

Run: python -m unittest discover -s piko/tools -p 'test_*.py'
"""
import struct
import unittest

from trace_handheld import partition_entries, select_application, segments_of


def app_image(marker):
    header = bytearray(24)
    header[0] = 0xE9
    header[1] = 2
    struct.pack_into("<I", header, 4, 0x400D0020)
    header.extend(struct.pack("<II", 0x3F400020, 32))
    header.extend(bytes([marker]) * 32)
    header.extend(struct.pack("<II", 0x400D0020, 64))
    header.extend(bytes([marker]) * 64)
    return bytes(header)


def table_entry(kind, subtype, offset, size, name):
    return struct.pack("<HBBII16sI", 0x50AA, kind, subtype,
                       offset, size, name.encode("ascii").ljust(16, b"\x00"), 0)


def dump():
    data = bytearray(b"\xff" * 0x60000)
    entries = [
        table_entry(1, 2, 0x9000, 0x6000, "nvs"),
        table_entry(0, 0, 0x10000, 0x20000, "factory"),
        table_entry(0, 0x10, 0x30000, 0x20000, "ota_0"),
    ]
    data[0x8000:0x8000 + len(b"".join(entries))] = b"".join(entries)
    data[0x10000:0x10000 + len(app_image(0x11))] = app_image(0x11)
    data[0x30000:0x30000 + len(app_image(0x22))] = app_image(0x22)
    return bytes(data)


class ImageSelectionTests(unittest.TestCase):
    def test_standalone_app(self):
        raw = app_image(0x11)
        image, source = select_application(raw)
        self.assertEqual(image, raw)
        self.assertEqual(len(segments_of(image)), 2)

    def test_full_flash_factory_default(self):
        image, source = select_application(dump())
        self.assertTrue(source.startswith("flash partition factory"))
        self.assertEqual(image[32 + 8], 0x11)

    def test_full_flash_select_ota(self):
        image, source = select_application(dump(), partition="ota_0")
        self.assertTrue(source.startswith("flash partition ota_0"))
        self.assertEqual(image[32 + 8], 0x22)

    def test_full_flash_explicit_offset(self):
        image, source = select_application(dump(), app_offset=0x30000)
        self.assertEqual(image, dump()[0x30000:])
        self.assertTrue(source.startswith("explicit flash offset"))

    def test_missing_app_name(self):
        with self.assertRaisesRegex(ValueError, "No valid app partition"):
            select_application(dump(), partition="ota_1")

    def test_detect_table(self):
        off, entries = partition_entries(dump())
        self.assertEqual(off, 0x8000)
        self.assertEqual([p["name"] for p in entries],
                         ["nvs", "factory", "ota_0"])


if __name__ == "__main__":
    unittest.main()
