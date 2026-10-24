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



// Real backend layout/runtime integration (not a mock). A native <T id>
// must NEVER read/write the Basic accessory map with the same numeric ID.
using var temp = new TempLayout();
var runtime = new DCCExpressHub.Net.Web.LayoutRuntime(new DCCExpressHub.Net.Web.AppPaths(temp.Root));
Check(runtime.DccExTurnoutIds().SequenceEqual(new ushort[] { 7, 3001 }),
    "Native turnout IDs are discovered from saved topology");
Check(!runtime.TryGetTurnoutClosed(7, out _), "Native state starts UNKNOWN");
Check(runtime.SetAccessory(7, true), "Basic DCC feedback on shared numeric address");
Check(!runtime.TryGetTurnoutClosed(7, out _),
    "Basic feedback must not make native turnout known");
Check(runtime.SetDccExTurnoutState(7, true), "Native turnout feedback accepted");
Check(runtime.TryGetTurnoutClosed(7, out var nativeClosed) && !nativeClosed,
    "T=thrown uses native state, not Basic accessory state");
Check(runtime.SetDccExTurnoutState(3001, false), "High native turnout ID accepted");
Check(runtime.TryGetTurnoutClosed(3001, out var highClosed) && highClosed,
    "High native turnout state resolves correctly");
Check(runtime.SetSignal(9, 2), "Extended accessory remains operational");
Check(runtime.SetVPin(10, true), "Legacy Vpin remains operational");
Check(runtime.TryGetBasicAccessoryState(7, out var basicActive) && basicActive,
    "Native turnout command does not override same-numbered Basic output");
var rows = runtime.RuntimeSnapshot()
    .Where(row => row.Type == "turnoutChanged")
    .Select(row => System.Text.Json.JsonDocument.Parse(
        System.Text.Json.JsonSerializer.Serialize(row.Data)).RootElement.Clone())
    .Where(row => row.GetProperty("address").GetInt32() == 7)
    .ToArray();
var nativeRow = rows.Single(row => row.GetProperty("outputMode").GetString() == "dccex-turnout");
var basicRow = rows.Single(row => row.GetProperty("outputMode").GetString() == "accessory");
Check(nativeRow.GetProperty("logicalClosed").GetBoolean() == false, "Native canvas state derived independently");
Check(basicRow.GetProperty("logicalClosed").GetBoolean() == true, "Basic canvas state derived independently");
Check(runtime.Rebuild(), "Layout can rebuild without losing known native state");
Check(runtime.TryGetTurnoutClosed(7, out nativeClosed) && !nativeClosed,
    "Native state survives an edit of unchanged bindings");
runtime.InvalidateDccExTurnoutStates();
Check(!runtime.TryGetTurnoutClosed(7, out _), "Reconnect invalidates stale native state");
Check(runtime.TryGetBasicAccessoryState(7, out basicActive) && basicActive,
    "Reconnect does not clear legacy Basic accessory state");
Check(runtime.TryGetExtendedAccessoryState(9, out var aspect) && aspect == 2,
    "Reconnect does not clear Extended accessory state");
Check(runtime.TryGetVPinState(10, out var vpinActive) && vpinActive,
    "Reconnect does not clear Vpin output state");
Console.WriteLine("DCC-EX native turnout runtime isolation: PASS");

static void Check(bool actual, string message)
{
    if (!actual) throw new Exception(message);
}

sealed class TempLayout : IDisposable
{
    public string Root { get; } = Path.Combine(Path.GetTempPath(), "dcc-ex-turnout-" + Guid.NewGuid().ToString("N"));
    public TempLayout()
    {
        var config = Path.Combine(Root, "data", "config");
        Directory.CreateDirectory(config);
        File.WriteAllText(Path.Combine(config, "layout.json"), """
        {
          "layers": [{
            "elements": [
              {"id":1,"type":"trackturnoutleft","turnoutAddress":7,"outputMode":"dccex-turnout","turnoutClosedValue":false},
              {"id":2,"type":"trackturnoutleft","turnoutAddress":7,"outputMode":"accessory","turnoutClosedValue":true},
              {"id":3,"type":"trackturnoutleft","turnoutAddress":3001,"outputMode":"dccex-turnout","turnoutClosedValue":false},
              {"id":4,"type":"trackturnoutleft","turnoutAddress":9,"outputMode":"extended","turnoutClosedValue":false},
              {"id":5,"type":"trackturnoutleft","turnoutAddress":10,"outputMode":"vpin","turnoutClosedValue":false}
            ]
          }]
        }
        """);
    }
    public void Dispose()
    {
        try { Directory.Delete(Root, recursive: true); } catch { /* best effort */ }
    }
}
