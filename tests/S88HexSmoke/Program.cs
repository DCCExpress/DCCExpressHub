using DCCExpressHub.Net.Web;

static void Equal<T>(T actual, T expected, string message)
{
    if (!EqualityComparer<T>.Default.Equals(actual, expected))
        throw new Exception($"{message}: expected {expected}, got {actual}");
}

static void Good(string line, params byte[] expected)
{
    if (!S88HexProtocol.TryParse(line, out var actual))
        throw new Exception("Valid HEX frame rejected: " + line);
    if (!actual.SequenceEqual(expected))
        throw new Exception("Incorrect payload decoding: " + line);
}

static void Bad(string line)
{
    if (S88HexProtocol.TryParse(line, out _))
        throw new Exception("Malformed frame accepted: " + line);
}

Equal(S88HexProtocol.Crc16(new byte[] { 0x04, 0x02, 0x00, 0xFF, 0x01 }),
      (ushort)0x66BC, "CRC16 golden vector");
Good("S88:04:0200FF01*66BC", 0x02, 0x00, 0xFF, 0x01);
Good("S88:02:0100*91CD", 0x01, 0x00);
Good("S88:02:0000*A2FC", 0x00, 0x00);
Good("s88:04:0200ff01*66bc", 0x02, 0x00, 0xFF, 0x01);
Bad("S88:04:0200FF01*0000"); // corrupted CRC
Bad("S88:05:0200FF01*66BC"); // corrupted declared length
Bad("S88:04:0200FZ01*66BC"); // non-HEX content
Bad("S88:00:*FFFF");         // zero byte count forbidden
Bad("S88:04:0200FF01*66BC00"); // trailing injection
Bad("S88:04:0200FF01");     // no CRC
Bad("S88: _00000010 _00000000"); // legacy view not accepted by live HEX worker

var sensors = S88HexProtocol.UnpackSensors(new byte[] { 0x02, 0x00, 0xFF, 0x01 });
Equal(sensors.Length, 32, "sensor count");
Equal(sensors[0], false, "input 1");
Equal(sensors[1], true, "input 2");
Equal(sensors[16], true, "input 17");
Equal(sensors[23], true, "input 24");
Equal(sensors[24], true, "input 25");

var max = Enumerable.Repeat((byte)0x00, 32).ToArray();
var maxRaw = new byte[] { 32 }.Concat(max).ToArray();
var maxFrame = $"S88:20:{Convert.ToHexString(max)}*{S88HexProtocol.Crc16(maxRaw):X4}";
Good(maxFrame, max);
Console.WriteLine("S88 HEX/CRC16 parser smoke tests: PASS");
