# DCCExpress-S88Adapter -> DCC-EX HAL integration

Files:
- `IO_DCCExpressS88.h` - DCC-EX HAL driver.
- `myHal.example.cpp` - minimal integration example.
- `sensors-1001-1032.txt` - example DCC-EX Sensor definitions.

## Configuration

For a 32-input adapter at I2C `0x30`:

```cpp
#include "IO_DCCExpressS88.h"

void halSetup() {
    DCCExpressS88::create(1001, 32, 0x30);
}
```

Mapping:

- S88 input 1 -> VPIN 1001
- S88 input 2 -> VPIN 1002
- ...
- S88 input 32 -> VPIN 1032

The driver reads the adapter's v1 INFO packet at startup and verifies that the
configured adapter contains at least the requested number of inputs. It then
takes an initial snapshot and polls the raw snapshot every 20 ms using the
DCC-EX asynchronous I2C manager.

## Why nPins is explicit

DCC-EX registers an IODevice's VPIN range when `create()` runs, before `_begin()`.
The adapter's INFO packet can only be read later in `_begin()`. Therefore the
VPIN count cannot safely be discovered from INFO and retroactively change the
registered IODevice range.

The adapter still remains the authority for its actual byte count; INFO is used
to validate the DCC-EX configuration.

## Sensor messages

The HAL device itself exposes VPIN input states. To obtain ordinary DCC-EX
sensor messages, define DCC-EX Sensor objects whose PIN is the corresponding
VPIN. For example:

```
<S 1001 1001 0>
```

DCC-EX then emits normal sensor transitions:

```
<Q 1001>
<q 1001>
```

No S88-specific protocol is needed by DCCExpressHub.

## Startup / Hub snapshot

The driver performs an initial blocking snapshot in `_begin()`. DCC-EX Sensor
polling reads that cached state. Once Sensor objects are active, their changes
are emitted through the standard DCC-EX sensor mechanism. The Hub therefore
continues to use its existing runtime sensor state and WebSocket snapshot logic.

## Multiple adapters

```cpp
DCCExpressS88::create(1001, 32, 0x30);
DCCExpressS88::create(1101, 16, 0x31);
```

Keep VPIN ranges non-overlapping and use unique I2C addresses.

## Adapter side

No adapter firmware modification is required for protocol v1. The current
DCCExpress-S88Adapter v0.5.0 already supplies:
- one-shot INFO selection `A5 02 A7`
- 10-byte INFO response
- raw snapshot reads
- up to 32 bytes / 256 inputs
