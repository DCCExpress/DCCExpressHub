#pragma once

#include <stdint.h>

struct FastClockSnapshot
{
    uint32_t timeMs = 0;
    bool running = true;
    double speed = 1.0;
    uint64_t serverNowMs = 0;
};

class FastClockRuntime
{
public:
    FastClockRuntime();

    FastClockSnapshot snapshot();
    FastClockSnapshot run();
    FastClockSnapshot pause();
    FastClockSnapshot reset();
    FastClockSnapshot setSpeed(
        double speed);

private:
    double _timeMs = 0.0;
    double _speed = 1.0;
    bool _running = true;
    uint32_t _lastRealTimestampMs = 0;

    void syncFromRealTime();

    FastClockSnapshot createSnapshot() const;

    static double normalizeDayTime(
        double value);

    static uint32_t currentSystemDayTimeMs();

    static uint64_t currentServerTimeMs();
};
