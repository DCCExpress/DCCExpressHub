#!/usr/bin/env python3
"""Offline-only model of OEM PIKO keypad queue, row freeze and logical code.

This does NOT access GPIO, send DCC commands or claim to decode physical keys.
The semantics of 0x4008DAD0/0x4008DA78 are inferred from their original
call-sites and the FreeRTOS event_groups.h API. Run: python <this file>.
"""
from collections import deque
from dataclasses import dataclass, field
import unittest

DIGIT_CODES = {
    0: 0x33, 1: 0x41, 2: 0x42, 3: 0x43, 4: 0x51,
    5: 0x52, 6: 0x53, 7: 0x61, 8: 0x62, 9: 0x63,
}
GPIO_COLUMNS = {32: 1, 33: 2, 34: 3}


def keycode(selector, gpio):
    if selector not in range(6) or gpio not in GPIO_COLUMNS:
        raise ValueError("invalid OEM selector or keypad GPIO")
    return ((selector + 1) << 4) | GPIO_COLUMNS[gpio]


@dataclass
class OemKeypadModel:
    selector: int = 0
    serial_mask: int = 0x41
    event_bits: int = 0
    queue: deque = field(default_factory=deque)
    enabled_gpio: set = field(default_factory=lambda: set(GPIO_COLUMNS))
    processing_gpio: int | None = None
    decoded: list = field(default_factory=list)

    def tick(self):
        """Model OEM timer's xEventGroupGetBits() check before selector update."""
        if self.event_bits & 1:
            return False
        old = self.selector
        self.selector = (self.selector + 1) % 6
        self.serial_mask &= ~(1 << old)
        self.serial_mask |= 1 << self.selector
        return True

    def gpio_event(self, gpio):
        """Queue only GPIO number, not a presumed selector snapshot."""
        if gpio not in self.enabled_gpio:
            return False
        self.queue.append(gpio)
        return True

    def worker_begin(self):
        """Receive GPIO, set event bit 0, disable GPIO and decode OEM code."""
        if self.processing_gpio is not None or not self.queue:
            return None
        gpio = self.queue.popleft()
        self.event_bits |= 1
        self.enabled_gpio.discard(gpio)
        self.processing_gpio = gpio
        code = keycode(self.selector, gpio)
        self.decoded.append(code)
        return code

    def worker_end(self):
        """Restore GPIO callback before clearing event bit to resume rows."""
        if self.processing_gpio is None:
            raise RuntimeError("no active OEM keypad event")
        self.enabled_gpio.add(self.processing_gpio)
        self.processing_gpio = None
        self.event_bits &= ~1


class ModelTests(unittest.TestCase):
    def test_number_dispatch(self):
        for digit, code in DIGIT_CODES.items():
            column_to_gpio = {1: 32, 2: 33, 3: 34}
            gpio = column_to_gpio[code & 15]
            self.assertEqual(keycode((code >> 4) - 1, gpio), code, digit)

    def test_freeze_rearm_and_resume(self):
        pad = OemKeypadModel()
        pad.tick()
        pad.tick()
        self.assertTrue(pad.gpio_event(34))
        self.assertEqual(pad.worker_begin(), 0x33)
        for _ in range(100):
            self.assertFalse(pad.tick())
        self.assertEqual(pad.selector, 2)
        self.assertFalse(pad.gpio_event(34))  # GPIO temporarily disabled
        pad.worker_end()
        self.assertTrue(pad.tick())
        self.assertTrue(pad.gpio_event(34))
        self.assertEqual(pad.worker_begin(), 0x43)
        pad.worker_end()

    def test_serial_one_hot_state(self):
        pad = OemKeypadModel()
        for _ in range(36):
            self.assertEqual(pad.serial_mask & 0x40, 0x40)
            self.assertEqual(pad.serial_mask & 0x3f, 1 << pad.selector)
            pad.tick()
        self.assertEqual(pad.selector, 0)

    def test_enqueue_before_row_freeze_is_a_race(self):
        pad = OemKeypadModel()
        self.assertTrue(pad.gpio_event(34))
        pad.tick()  # row changes BEFORE worker sets event bit
        self.assertEqual(pad.worker_begin(), 0x23)
        pad.worker_end()


if __name__ == "__main__":
    unittest.main(verbosity=2)
