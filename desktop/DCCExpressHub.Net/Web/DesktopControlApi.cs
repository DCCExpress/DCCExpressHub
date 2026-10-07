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
    readonly CommandCenterConfigStore _commandCenterConfig;
    readonly IHostApplicationLifetime _lifetime;

    public DesktopControlApi(
        ICommandCenter commandCenter,
        CommandCenterConfigStore commandCenterConfig,
        IHostApplicationLifetime lifetime)
    {
        _commandCenter =
            commandCenter;

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
                out var address) ||
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

    public void RequestShutdown() =>
        _lifetime.StopApplication();
}
