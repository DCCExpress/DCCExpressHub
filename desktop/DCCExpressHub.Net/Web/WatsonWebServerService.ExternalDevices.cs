using System.IO.Ports;
using WatsonWebserver;
using WatsonWebserver.Core;
using WatsonHttpMethod = WatsonWebserver.Core.HttpMethod;

namespace DCCExpressHub.Net.Web;

public sealed partial class WatsonWebServerService
{
    private void RegisterExternalDeviceRoutes(Webserver server)
    {
        Add(server, WatsonHttpMethod.GET, "/api/external-devices", async ctx =>
        {
            var store = Service<ExternalDeviceStore>();
            var runtime = Service<ExternalDevicesRuntime>();
            await SendAsync(ctx, HubApiResponse.Ok(new
            {
                ok = true,
                devices = store.List(),
                status = runtime.Status()
            }));
        });

        Add(server, WatsonHttpMethod.GET, "/api/external-devices/ports", async ctx =>
        {
            var ports = SerialPort.GetPortNames()
                .OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToArray();
            await SendAsync(ctx, HubApiResponse.Ok(new { ok = true, ports }));
        });

        Add(server, WatsonHttpMethod.POST, "/api/external-devices/save", async ctx =>
        {
            if (!IsUrlEncodedForm(ctx))
            {
                await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Form data required." }));
                return;
            }
            var form = await ReadUrlEncodedFormAsync(ctx);
            if (!int.TryParse(Get(form, "sensorOffset"), out var offset) ||
                !int.TryParse(Get(form, "sensorCount"), out var count))
            {
                await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Invalid S88 address range." }));
                return;
            }
            var proposed = new ExternalDeviceConfig
            {
                Id = Get(form, "id"),
                Name = Get(form, "name"),
                Type = Get(form, "type"),
                Enabled = string.Equals(Get(form, "enabled"), "true", StringComparison.OrdinalIgnoreCase),
                SerialPort = Get(form, "serialPort"),
                SensorOffset = offset,
                SensorCount = count
            };
            // Reject known main command-station/feedback collisions before persisting.
            if (proposed.Enabled)
            {
                var cc = Service<CommandCenterConfigStore>().Current;
                var locoNetSerial = DCCExpressHub.Net.CommandCenter.YaMoRcLocoNetSerialSettings.Load();
                if ((cc.IsSerial && string.Equals(cc.SerialPort, proposed.SerialPort, StringComparison.OrdinalIgnoreCase)) ||
                    (locoNetSerial.Enabled && string.Equals(locoNetSerial.Port, proposed.SerialPort, StringComparison.OrdinalIgnoreCase)))
                {
                    await SendAsync(ctx, HubApiResponse.Error(409, new { ok = false, message = "Serial port already belongs to a command center or LocoNet transport." }));
                    return;
                }
                var first = proposed.SensorOffset + 1;
                var last = proposed.SensorOffset + proposed.SensorCount;
                var protocol = (_configuration["CommandCenter:Protocol"] ?? "").Trim().ToLowerInvariant();
                bool Overlaps(int from, int to) => first <= to && last >= from;
                if (proposed.SensorCount is >= 8 and <= 256 && proposed.SensorOffset >= 0)
                {
                    if ((protocol is "z21" or "yamorc7010") &&
                        Overlaps(cc.RBusOffset + 1, cc.RBusOffset + 160))
                    {
                        await SendAsync(ctx, HubApiResponse.Error(409, new { ok = false, message = "External sensors overlap the command center R-BUS range." }));
                        return;
                    }
                    if (protocol is "yamorc7010" or "loconet" or "loconet-serial")
                    {
                        var locoOffset = Math.Clamp(_configuration.GetValue<int>("LocoNet:SensorOffset"), 0, 65535 - 4096);
                        if (Overlaps(locoOffset + 1, locoOffset + 4096))
                        {
                            await SendAsync(ctx, HubApiResponse.Error(409, new { ok = false, message = "External sensors overlap the LocoNet range." }));
                            return;
                        }
                    }
                }
            }
            try
            {
                var id = await Service<ExternalDeviceStore>().UpsertAsync(proposed, ctx.Token);
                await SendAsync(ctx, HubApiResponse.Ok(new { ok = true, id }));
            }
            catch (ArgumentException ex)
            {
                await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = ex.Message }));
            }
            catch (IOException ex)
            {
                await SendAsync(ctx, HubApiResponse.Error(500, new { ok = false, message = ex.Message }));
            }
        });

        Add(server, WatsonHttpMethod.POST, "/api/external-devices/remove", async ctx =>
        {
            if (!IsUrlEncodedForm(ctx))
            {
                await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Form data required." }));
                return;
            }
            var form = await ReadUrlEncodedFormAsync(ctx);
            var removed = await Service<ExternalDeviceStore>().RemoveAsync(Get(form, "id"), ctx.Token);
            await SendAsync(ctx, removed
                ? HubApiResponse.Ok(new { ok = true })
                : HubApiResponse.Error(404, new { ok = false, message = "Device not found." }));
        });

        Add(server, WatsonHttpMethod.POST, "/api/external-devices/test", async ctx =>
        {
            if (!IsUrlEncodedForm(ctx))
            {
                await SendAsync(ctx, HubApiResponse.Error(400, new { ok = false, message = "Form data required." }));
                return;
            }
            var form = await ReadUrlEncodedFormAsync(ctx);
            var id = Get(form, "id");
            var state = Service<ExternalDevicesRuntime>().Status().FirstOrDefault(x => x.Id == id);
            await SendAsync(ctx, state is { Connected: true }
                ? HubApiResponse.Ok(new { ok = true, message = "Valid S88 snapshots received.", status = state })
                : HubApiResponse.Error(503, new { ok = false, message = state?.Message ?? "Device is not enabled or not connected." }));
        });
    }
}
