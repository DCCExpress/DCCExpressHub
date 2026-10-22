namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Decodes LocoNet RailCom identification, independent of physical occupancy.
/// D0 direction needs the configured wire encoding. E0 carries its own
/// direction bit (byte 6, bit 6), regardless of the configured D0 mode.
/// </summary>
public static class RailComFrameDecoder
{
    public readonly record struct Detection(
        int SensorAddress, int LocomotiveAddress, bool Present,
        bool? OrientationForward, string OrientationSource);

    public static bool TryDecode(
        ReadOnlySpan<byte> frame,
        out Detection detection,
        RailComSenseMode mode)
    {
        detection = default;
        int sensor, high, low, kind;
        bool? orientation = null;
        string source = "none";

        if (frame.Length == 9 && frame[0] == 0xE0 && frame[1] == 0x09)
        {
            kind = frame[2] & 0x60;
            sensor = ((frame[2] & 0x1F) << 7) | (frame[3] & 0x7F);
            high = frame[4] & 0x7F;
            low = frame[5] & 0x7F;
            orientation = (frame[6] & 0x40) != 0;
            source = "long";
        }
        else if (frame.Length == 6 && frame[0] == 0xD0)
        {
            kind = frame[1] & 0x60;
            // Block mode encodes the orientation in address bit 11 (+2048).
            // The other modes preserve the full block address range.
            sensor = ((frame[1] & (mode == RailComSenseMode.Block ? 0x0F : 0x1F)) << 7)
                | (frame[2] & 0x7F);
            high = frame[3] & 0x7F;
            low = frame[4] & 0x7F;

            if (mode == RailComSenseMode.Block)
            {
                orientation = (frame[1] & 0x10) != 0;
                source = "block";
            }
        }
        else return false;

        // 0x40 is a dynamic RailCom message, not a new entry/exit.
        if (kind != 0x00 && kind != 0x20) return false;

        // 0x7D marks a 7-bit address; otherwise the two 7-bit bytes
        // carry a 14-bit transponder address.
        int address = high == 0x7D ? low : (high << 7) | low;

        if (frame[0] == 0xD0 && mode == RailComSenseMode.Loco &&
            high != 0x7D)
        {
            // Loco mode encodes the orientation in address bit 12 (+4096).
            orientation = (address & 0x1000) != 0;
            address &= 0x0FFF;
            source = "loco";
        }

        if (sensor > 4095 || address < 1 || address > 10239) return false;
        detection = new Detection(sensor + 1, address, kind == 0x20,
            orientation, source);
        return true;
    }
}
