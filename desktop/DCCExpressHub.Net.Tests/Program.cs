using DCCExpressHub.Net.CommandCenter;

static void Expect(string frame, ushort expectedId, bool expectedThrown)
{
    if (!DccExTurnoutFeedbackParser.TryParse(frame, out var id, out var thrown) ||
        id != expectedId || thrown != expectedThrown)
        throw new Exception($"Expected turnout {expectedId} {(expectedThrown ? "T" : "C")} for: {frame}");
}

static void Ignore(string frame)
{
    if (DccExTurnoutFeedbackParser.TryParse(frame, out _, out _))
        throw new Exception($"Must not interpret as turnout state: {frame}");
}

Expect("<H 1 1>", 1, true);
Expect("<H 1 0>", 1, false);
Expect("<H 32767 1>", 32767, true);
Expect("<jT 1 T \"Siding\">", 1, true);
Expect("<jT 1 C \"Siding\">", 1, false);
Expect("<jT 32767 C \"\">", 32767, false);
Ignore("<jT>");                      // empty ID list
Ignore("<jT 1 2 3>");               // ID list is NOT position feedback
Ignore("<jT 1 X>");                 // unknown/missing turnout
Ignore("<H 1 2>");                  // invalid state
Ignore("<H 0 1>");                  // invalid configured ID
Ignore("<H 32768 0>");              // out of range
Ignore("<a 1 1>");                  // DCC accessory command
Ignore("<l 1 2 3 4>");              // locomotive feedback
Console.WriteLine("DCC-EX native turnout parser regression: PASS");
