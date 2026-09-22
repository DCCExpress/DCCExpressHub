namespace DCCExpressHub.Net.CommandCenter
{

    public sealed record StationInfo(string Version = "", string Processor = "", string Hardware = "", string Build = "", int MaxLocos = 0);
    public sealed record TrackInfo(int Index, string Mode);
    public sealed record PowerFeedback(bool On, string Target, int TrackIndex = -1);
    public sealed record LocoFeedback(int Address, int Speed, bool Forward, uint FunctionsMask);
}