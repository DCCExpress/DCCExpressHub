using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using DCCExpressHub.Net.CommandCenter;
using DCCExpressHub.Net.Web;

[assembly: HostingStartup(typeof(DCCExpressHub.Net.DesktopHostingStartup))]

namespace DCCExpressHub.Net;

/// <summary>
/// Desktop-only host integration that is activated automatically by ASP.NET Core.
/// It adds a private localhost shutdown endpoint without changing the normal Web API.
/// The endpoint is disabled unless the desktop launcher supplies a random token.
/// </summary>
public sealed class DesktopHostingStartup : IHostingStartup
{
    public void Configure(IWebHostBuilder builder)
    {
        builder.ConfigureServices(services =>
        {
            services.AddSingleton<IStartupFilter, DesktopShutdownStartupFilter>();
        });
    }
}

internal sealed class DesktopShutdownStartupFilter : IStartupFilter
{
    private const string ShutdownPath = "/__desktop/shutdown";
    private const string PowerOffPath = "/__desktop/power-off";
    private const string TokenHeader = "X-DCCExpressHub-Shutdown-Token";
    private const string TokenEnvironmentVariable = "DCCEXPRESS_DESKTOP_SHUTDOWN_TOKEN";

    public Action<IApplicationBuilder> Configure(
        Action<IApplicationBuilder> next)
    {
        return app =>
        {
            app.Use(async (context, nextMiddleware) =>
            {
                var isShutdown =
                    context.Request.Path ==
                    new PathString(ShutdownPath);

                var isPowerOff =
                    context.Request.Path ==
                    new PathString(PowerOffPath);

                if (!HttpMethods.IsPost(context.Request.Method) ||
                    (!isShutdown && !isPowerOff))
                {
                    await nextMiddleware();
                    return;
                }

                var expected =
                    Environment.GetEnvironmentVariable(
                        TokenEnvironmentVariable);

                var supplied =
                    context.Request.Headers[TokenHeader]
                        .ToString();

                var remote =
                    context.Connection.RemoteIpAddress;

                if (string.IsNullOrWhiteSpace(expected) ||
                    remote is null ||
                    !IPAddress.IsLoopback(remote) ||
                    !TokensEqual(expected, supplied))
                {
                    // Deliberately hide this desktop-only endpoint from remote callers.
                    context.Response.StatusCode = StatusCodes.Status404NotFound;
                    return;
                }

                if (isPowerOff)
                {
                    var commandCenter =
                        context.RequestServices
                            .GetRequiredService<ICommandCenter>();

                    var commandCenterConfig =
                        context.RequestServices
                            .GetRequiredService<CommandCenterConfigStore>();

                    var ok =
                        await commandCenter.SetTrackPowerAsync(
                            false,
                            commandCenterConfig.Current.PowerIncludesProgramming,
                            context.RequestAborted);

                    context.Response.StatusCode =
                        ok
                            ? StatusCodes.Status200OK
                            : StatusCodes.Status503ServiceUnavailable;

                    await context.Response.WriteAsJsonAsync(
                        new
                        {
                            ok,
                            message =
                                ok
                                    ? "Track power OFF requested"
                                    : "Track power OFF command failed"
                        },
                        context.RequestAborted);

                    return;
                }

                var lifetime =
                    context.RequestServices
                        .GetRequiredService<IHostApplicationLifetime>();

                context.Response.OnCompleted(() =>
                {
                    lifetime.StopApplication();
                    return Task.CompletedTask;
                });

                context.Response.StatusCode = StatusCodes.Status202Accepted;

                await context.Response.WriteAsJsonAsync(
                    new
                    {
                        ok = true,
                        message = "Backend shutdown requested"
                    });
            });

            next(app);
        };
    }

    private static bool TokensEqual(
        string expected,
        string supplied)
    {
        var expectedBytes =
            Encoding.UTF8.GetBytes(expected);

        var suppliedBytes =
            Encoding.UTF8.GetBytes(supplied);

        return expectedBytes.Length == suppliedBytes.Length &&
               CryptographicOperations.FixedTimeEquals(
                   expectedBytes,
                   suppliedBytes);
    }
}
