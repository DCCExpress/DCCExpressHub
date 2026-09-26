#include "FastClockRuntime.h"

#include <Arduino.h>
#include <math.h>
#include <time.h>

namespace
{
    constexpr double DAY_MS =
        24.0 * 60.0 * 60.0 * 1000.0;

    // If the ESP32 system clock has not been synchronized yet, time()
    // normally still points near the Unix epoch. In that case the fast
    // clock starts/resets at 00:00 instead of pretending that the time
    // source is valid.
    constexpr time_t MIN_VALID_SYSTEM_TIME =
        1577836800; // 2020-01-01T00:00:00Z
}

FastClockRuntime::FastClockRuntime()
    : _timeMs(
          currentSystemDayTimeMs()),
      _lastRealTimestampMs(
          millis())
{
}

FastClockSnapshot FastClockRuntime::snapshot()
{
    syncFromRealTime();
    return createSnapshot();
}

FastClockSnapshot FastClockRuntime::run()
{
    syncFromRealTime();

    _running =
        true;

    _lastRealTimestampMs =
        millis();

    return createSnapshot();
}

FastClockSnapshot FastClockRuntime::pause()
{
    syncFromRealTime();

    _running =
        false;

    _lastRealTimestampMs =
        millis();

    return createSnapshot();
}

FastClockSnapshot FastClockRuntime::reset()
{
    _timeMs =
        currentSystemDayTimeMs();

    _running =
        true;

    _lastRealTimestampMs =
        millis();

    return createSnapshot();
}

FastClockSnapshot FastClockRuntime::setSpeed(
    double speed)
{
    syncFromRealTime();

    _speed =
        isfinite(speed)
            ? max(
                  1.0,
                  speed)
            : 1.0;

    _lastRealTimestampMs =
        millis();

    return createSnapshot();
}

FastClockSnapshot FastClockRuntime::setTime(
    double timeMs)
{
    syncFromRealTime();

    _timeMs =
        normalizeDayTime(
            isfinite(timeMs)
                ? timeMs
                : 0.0);

    _lastRealTimestampMs =
        millis();

    return createSnapshot();
}

void FastClockRuntime::syncFromRealTime()
{
    const uint32_t now =
        millis();

    if (_running)
    {
        // Unsigned subtraction intentionally keeps elapsed time correct
        // across the normal millis() rollover.
        const uint32_t elapsedRealMs =
            now -
            _lastRealTimestampMs;

        _timeMs =
            normalizeDayTime(
                _timeMs +
                static_cast<double>(
                    elapsedRealMs) *
                    _speed);
    }

    _lastRealTimestampMs =
        now;
}

FastClockSnapshot FastClockRuntime::createSnapshot() const
{
    FastClockSnapshot result;

    result.timeMs =
        static_cast<uint32_t>(
            floor(
                normalizeDayTime(
                    _timeMs)));

    result.running =
        _running;

    result.speed =
        _speed;

    result.serverNowMs =
        currentServerTimeMs();

    return result;
}

double FastClockRuntime::normalizeDayTime(
    double value)
{
    const double normalized =
        fmod(
            value,
            DAY_MS);

    return normalized < 0.0
        ? normalized + DAY_MS
        : normalized;
}

uint32_t FastClockRuntime::currentSystemDayTimeMs()
{
    const time_t now =
        time(
            nullptr);

    if (
        now <
        MIN_VALID_SYSTEM_TIME)
    {
        return 0;
    }

    struct tm localTime;

    if (
        localtime_r(
            &now,
            &localTime) ==
        nullptr)
    {
        return 0;
    }

    return
        static_cast<uint32_t>(
            localTime.tm_hour) *
            60UL *
            60UL *
            1000UL +
        static_cast<uint32_t>(
            localTime.tm_min) *
            60UL *
            1000UL +
        static_cast<uint32_t>(
            localTime.tm_sec) *
            1000UL;
}

uint64_t FastClockRuntime::currentServerTimeMs()
{
    const time_t now =
        time(
            nullptr);

    if (
        now >=
        MIN_VALID_SYSTEM_TIME)
    {
        return
            static_cast<uint64_t>(
                now) *
            1000ULL;
    }

    return
        static_cast<uint64_t>(
            millis());
}
