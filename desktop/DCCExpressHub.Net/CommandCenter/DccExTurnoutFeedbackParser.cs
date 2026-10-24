using System.Globalization;
using System.Text.RegularExpressions;

namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Parses only *native DCC-EX turnout* feedback. This must not interpret
/// accessory feedback or the <jT id1 id2 ...> ID-list as a position.
/// </summary>
public static class DccExTurnoutFeedbackParser
{
    // <H id 0|1> is the turnout position broadcast from CommandStation-EX.
    // <jT id C|T "description"> is the response to <JT id>.
    static readonly Regex Broadcast = new(
        @"^<H\s+(\d+)\s+([01])>$", RegexOptions.CultureInvariant);
    static readonly Regex Detail = new(
        @"^<jT\s+(\d+)\s+([CT])(?:\s+[^>]*)?>$",
        RegexOptions.CultureInvariant);

    public static bool TryParse(string frame, out ushort id, out bool thrown)
    {
        id = 0;
        thrown = false;
        var match = Broadcast.Match(frame);
        if (match.Success)
        {
            if (!ushort.TryParse(match.Groups[1].Value, NumberStyles.None,
                    CultureInfo.InvariantCulture, out id) || id is < 1 or > 32767)
                return false;
            thrown = match.Groups[2].Value == "1";
            return true;
        }

        match = Detail.Match(frame);
        if (!match.Success ||
            !ushort.TryParse(match.Groups[1].Value, NumberStyles.None,
                CultureInfo.InvariantCulture, out id) || id is < 1 or > 32767)
            return false;
        thrown = match.Groups[2].Value == "T";
        return true;
    }
}
