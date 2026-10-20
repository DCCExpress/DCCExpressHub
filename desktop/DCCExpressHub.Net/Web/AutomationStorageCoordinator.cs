namespace DCCExpressHub.Net.Web;

/// <summary>
/// Serializes read-modify-write operations against automations.json.
///
/// The WebUI editor and backend runtimes may both update this document. All
/// backend writers must share this gate so one atomic rename cannot silently
/// overwrite another writer's newer document.
/// </summary>
public sealed class AutomationStorageCoordinator
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
