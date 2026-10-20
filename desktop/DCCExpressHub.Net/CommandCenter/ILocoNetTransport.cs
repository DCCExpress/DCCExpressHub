namespace DCCExpressHub.Net.CommandCenter;

/// <summary>
/// Transport-only boundary. LocoNet opcode and checksum handling belong to
/// LocoNetCommandCenter; transports merely move complete frames.
/// </summary>
public interface ILocoNetTransport
{
    string Kind { get; }
    string Endpoint { get; }
    bool Connected { get; }
    event Action<bool>? ConnectionChanged;
    event Action<string>? Information;
    Task RunSessionAsync(Action<byte[]> received, CancellationToken ct);
    Task<bool> SendFrameAsync(ReadOnlyMemory<byte> frame, CancellationToken ct);
}
