using System.Text.Json;

namespace DCCExpressHub.Net.Web;

public sealed class CalibrationApi
{
    static readonly JsonSerializerOptions Json =
        new(
            JsonSerializerDefaults.Web);

    readonly CalibrationRuntime _calibration;

    public CalibrationApi(
        CalibrationRuntime calibration)
    {
        _calibration =
            calibration;
    }

    public HubApiResponse Get() =>
        HubApiResponse.Ok(
            _calibration.Snapshot());

    public async Task<HubApiResponse> StartAsync(
        Stream input,
        CancellationToken cancellationToken)
    {
        CalibrationStartRequest? request;

        try
        {
            request =
                await JsonSerializer
                    .DeserializeAsync<CalibrationStartRequest>(
                        input,
                        Json,
                        cancellationToken);
        }
        catch
        {
            return InvalidRequest();
        }

        if (request is null)
            return InvalidRequest();

        var result =
            _calibration.Start(
                request);

        return result.Ok
            ? HubApiResponse.Ok(
                new
                {
                    ok = true,
                    state =
                        _calibration.Snapshot()
                })
            : HubApiResponse.Error(
                409,
                new
                {
                    ok = false,
                    message =
                        result.Error,
                    state =
                        _calibration.Snapshot()
                });
    }

    public HubApiResponse Stop() =>
        HubApiResponse.Ok(
            new
            {
                ok =
                    _calibration.Stop(),
                state =
                    _calibration.Snapshot()
            });

    public HubApiResponse Abort() =>
        HubApiResponse.Ok(
            new
            {
                ok =
                    _calibration.Abort(
                        false),
                state =
                    _calibration.Snapshot()
            });

    public HubApiResponse EmergencyStop() =>
        HubApiResponse.Ok(
            new
            {
                ok =
                    _calibration.Abort(
                        true),
                state =
                    _calibration.Snapshot()
            });

    static HubApiResponse InvalidRequest() =>
        HubApiResponse.Error(
            400,
            new
            {
                ok = false,
                message =
                    "invalid_calibration_request"
            });
}
