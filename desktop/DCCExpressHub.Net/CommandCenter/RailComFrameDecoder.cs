namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Decodes LocoNet RailCom address presence packets without modifying occupancy.
/// Standard MultiSense (D0) and 9-byte MultiSense Long (E0).
/// Dynamic RailCom telemetry is intentionally excluded: it is not an entry/exit.
/// </summary>
public static class RailComFrameDecoder
{
    public readonly record struct Detection(int SensorAddress, int LocomotiveAddress, bool Present);

    public static bool TryDecode(ReadOnlySpan<byte> frame, out Detection detection, bool directionInBlockAddress = true)
    {
        detection = default;
        int sensor, high, low, kind;
        if (frame.Length == 9 && frame[0] == 0xE0 && frame[1] == 0x09)
        {
            kind = frame[2] & 0x60;
            sensor = ((frame[2] & 0x1F) << 7) | (frame[3] & 0x7F);
            high = frame[4] & 0x7F;
            low = frame[5] & 0x7F;
        }
        else if (frame.Length == 6 && frame[0] == 0xD0)
        {
            kind = frame[1] & 0x60;
            // Standard MultiSense can encode the locomotive's placement
            // direction in bit 4 of this byte. In that mode this bit must
            // not add 2048 to the RailCom detector's physical block address.
            // For modules using the entire 12-bit block range (2049..4096),
            // disable LocoNet:RailComDirectionInBlockAddress.
            int blockHighMask = directionInBlockAddress ? 0x0F : 0x1F;
            sensor = ((frame[1] & blockHighMask) << 7) | (frame[2] & 0x7F);
            // D0 layout: D0, flags, block-low, address-high, address-low, checksum.
            // Unlike the previous implementation the address bytes must NOT
            // be swapped; 0x7D in address-high marks a short DCC address.
            high = frame[3] & 0x7F;
            low = frame[4] & 0x7F;
        }
        else return false;

        if (kind != 0x00 && kind != 0x20) return false;
        int address = high == 0x7D ? low : (high << 7) | low;
        if (sensor > 4095 || address < 1 || address > 10239) return false;
        detection = new Detection(sensor + 1, address, kind == 0x20);
        return true;
    }
}
