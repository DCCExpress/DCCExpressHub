namespace DCCExpressHub.Net.Web;

/// <summary>
/// Serializes read-modify-write operations against locos.json.
///
/// CalibrationRuntime persists measured profiles while the Loco Editor can
/// save the locomotive document at the same time. Both writers must share
/// this gate so neither can overwrite newer data from the other.
/// </summary>
public sealed class LocoStorageCoordinator
{
    readonly SemaphoreSlim _gate =
        new(1, 1);

    public async Task<T> ExecuteAsync<T>(
        Func<Task<T>> work,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(
            cancellationToken);

        try
        {
            return await work();
        }
        finally
        {
            _gate.Release();
        }
    }
}
