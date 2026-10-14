namespace DCCExpressHub.Net.Web;

/// <summary>
/// S88Adapter serial protocol v0.6: "S88:NN:HEXDATA*CCCC\n".
/// NN is the number of S88 bytes; CRC16/CCITT-FALSE is calculated over
/// [NN, bytes...] (poly 0x1021, init 0xFFFF). No spaces or binary framing.
/// Bit zero of the first S88 byte is sensor input 1.
/// </summary>
public static class S88HexProtocol
{
    public static ushort Crc16(ReadOnlySpan<byte> values)
    {
        ushort crc = 0xFFFF;
        foreach (var value in values)
        {
            crc ^= (ushort)(value << 8);
            for (var bit = 0; bit < 8; bit++)
                crc = (ushort)((crc & 0x8000) != 0
                    ? (crc << 1) ^ 0x1021
                    : crc << 1);
        }
        return crc;
    }

    static int Nibble(char value) => value switch
    {
        >= '0' and <= '9' => value - '0',
        >= 'A' and <= 'F' => value - 'A' + 10,
        >= 'a' and <= 'f' => value - 'a' + 10,
        _ => -1
    };

    static bool HexByte(ReadOnlySpan<char> text, out byte result)
    {
        result = 0;
        if (text.Length != 2) return false;
        var hi = Nibble(text[0]);
        var lo = Nibble(text[1]);
        if (hi < 0 || lo < 0) return false;
        result = (byte)((hi << 4) | lo);
        return true;
    }

    public static bool TryParse(string text, out byte[] bytes)
    {
        bytes = [];
        if (!text.StartsWith("S88:", StringComparison.OrdinalIgnoreCase) ||
            text.Length < 14 || text[6] != ':')
            return false;

        if (!HexByte(text.AsSpan(4, 2), out var length) ||
            length is < 1 or > 32 ||
            text.Length != 12 + length * 2 ||
            text[7 + length * 2] != '*')
            return false;

        var raw = new byte[length + 1];
        raw[0] = length;
        for (var i = 0; i < length; i++)
        {
            if (!HexByte(text.AsSpan(7 + i * 2, 2), out raw[i + 1]))
                return false;
        }

        if (!HexByte(text.AsSpan(8 + length * 2, 2), out var crcHigh) ||
            !HexByte(text.AsSpan(10 + length * 2, 2), out var crcLow))
            return false;

        var expected = (ushort)((crcHigh << 8) | crcLow);
        if (Crc16(raw) != expected)
            return false;
        bytes = raw[1..];
        return true;
    }

    public static bool[] UnpackSensors(ReadOnlySpan<byte> bytes)
    {
        var sensors = new bool[bytes.Length * 8];
        for (var i = 0; i < bytes.Length; i++)
            for (var bit = 0; bit < 8; bit++)
                sensors[i * 8 + bit] = (bytes[i] & (1 << bit)) != 0;
        return sensors;
    }
}
