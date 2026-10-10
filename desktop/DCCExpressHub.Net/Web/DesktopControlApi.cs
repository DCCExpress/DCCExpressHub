using System.Net;
using System.Security.Cryptography;
using System.Text;
using DCCExpressHub.Net.CommandCenter;

namespace DCCExpressHub.Net.Web;

public sealed class DesktopControlApi
{
    public const string ShutdownPath =
        "/__desktop/shutdown";

    public const string PowerOffPath =
        "/__desktop/power-off";

    public const string TokenHeader =
        "X-DCCExpressHub-Shutdown-Token";

    const string TokenEnvironmentVariable =
        "DCCEXPRESS_DESKTOP_SHUTDOWN_TOKEN";

    readonly ICommandCenter _commandCenter;
    readonly RuntimeStateStore _stateStore;
    readonly CommandCenterConfigStore _commandCenterConfig;
    readonly IHostApplicationLifetime _lifetime;

    public DesktopControlApi(
        ICommandCenter commandCenter,
        RuntimeStateStore stateStore,
        CommandCenterConfigStore commandCenterConfig,
        IHostApplicationLifetime lifetime)
    {
        _commandCenter =
            commandCenter;
        _stateStore = stateStore;

        _commandCenterConfig =
            commandCenterConfig;

        _lifetime =
            lifetime;
    }

    public bool IsAuthorized(
        string? remoteIp,
        string? suppliedToken)
    {
        var expected =
            Environment.GetEnvironmentVariable(
                TokenEnvironmentVariable);

        if (
            string.IsNullOrWhiteSpace(
                expected) ||
            string.IsNullOrWhiteSpace(
                suppliedToken) ||
            string.IsNullOrWhiteSpace(
                remoteIp) ||
            !IPAddress.TryParse(
                remoteIp,
                out var address)
        )
        {
            return false;
        }

        if (address.IsIPv4MappedToIPv6)
        {
            address =
                address.MapToIPv4();
        }

        if (
            !IPAddress.IsLoopback(
                address)
        )
        {
            return false;
        }

        var expectedBytes =
            Encoding.UTF8.GetBytes(
                expected);

        var suppliedBytes =
            Encoding.UTF8.GetBytes(
                suppliedToken);

        return
            expectedBytes.Length ==
                suppliedBytes.Length &&
            CryptographicOperations
                .FixedTimeEquals(
                    expectedBytes,
                    suppliedBytes);
    }

    public async Task<HubApiResponse> PowerOffAsync(
        CancellationToken cancellationToken)
    {
        var ok =
            await _commandCenter
                .SetTrackPowerAsync(
                    false,
                    _commandCenterConfig
                        .Current
                        .PowerIncludesProgramming,
                    cancellationToken);

        // The desktop shell may terminate the backend immediately after this
        // response; finish the physical runtime snapshot first.
        var saved = await _stateStore.SaveAsync();
        if (!saved)
            return HubApiResponse.Error(503, new { ok = false, message = "Runtime state save failed" });

        return ok
            ? HubApiResponse.Ok(
                new
                {
                    ok = true,
                    message =
                        "Track power OFF requested"
                })
            : HubApiResponse.Error(
                503,
                new
                {
                    ok = false,
                    message =
                        "Track power OFF command failed"
                });
    }

    public HubApiResponse ShutdownResponse() =>
        new(
            202,
            new
            {
                ok = true,
                message =
                    "Backend shutdown requested"
            });

    public async Task<bool> SaveBeforeShutdownAsync() =>
        await _stateStore.SaveAsync();

    public void RequestShutdown() =>
        _lifetime.StopApplication();
}
