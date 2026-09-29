#include "WsProtocol.h"

#include "Logger.h"
#include "CommandCenterBuild.h"
#include "FileStore.h"
#include "config.h"

#include <LittleFS.h>
#include <WiFi.h>
#include <esp_freertos_hooks.h>
#include <esp_system.h>
#include <stdlib.h>
#include <algorithm>

namespace
{
    void appendFastClockSnapshot(
        JsonObject out,
        const FastClockSnapshot &snapshot)
    {
        out["timeMs"] =
            snapshot.timeMs;

        out["running"] =
            snapshot.running;

        out["speed"] =
            snapshot.speed;

        out["serverNowMs"] =
            snapshot.serverNowMs;
    }

    enum class ProgrammingTrackTransition : uint8_t
    {
        None,
        Programming,
        Joined
    };

    ProgrammingTrackTransition programmingTrackTransition =
        ProgrammingTrackTransition::None;

    unsigned long programmingTrackTransitionExpiresAt =
        0;

    constexpr unsigned long
        PROGRAMMING_TRACK_TRANSITION_GUARD_MS =
            1000;

    void beginProgrammingTrackTransition(
        bool joined)
    {
        programmingTrackTransition =
            joined
                ? ProgrammingTrackTransition::Joined
                : ProgrammingTrackTransition::Programming;

        programmingTrackTransitionExpiresAt =
            millis() +
            PROGRAMMING_TRACK_TRANSITION_GUARD_MS;
    }

    bool programmingTrackTransitionIsActive()
    {
        if (
            programmingTrackTransition ==
            ProgrammingTrackTransition::None)
        {
            return false;
        }

        if (
            static_cast<long>(
                millis() -
                programmingTrackTransitionExpiresAt) >= 0)
        {
            programmingTrackTransition =
                ProgrammingTrackTransition::None;

            return false;
        }

        return true;
    }

    bool shouldIgnoreProgrammingTrackFeedback(
        const CommandCenterPowerFeedback &info)
    {
        if (
            !programmingTrackTransitionIsActive())
        {
            return false;
        }

        if (
            info.target !=
                CommandCenterPowerTarget::Programming &&
            info.target !=
                CommandCenterPowerTarget::Joined)
        {
            return false;
        }

        const bool expectsJoined =
            programmingTrackTransition ==
            ProgrammingTrackTransition::Joined;

        const bool confirmsExpectedMode =
            info.on &&
            ((expectsJoined &&
              info.target ==
                  CommandCenterPowerTarget::Joined) ||
             (!expectsJoined &&
              info.target ==
                  CommandCenterPowerTarget::Programming));

        if (
            confirmsExpectedMode)
        {
            programmingTrackTransition =
                ProgrammingTrackTransition::None;

            return false;
        }

        return true;
    }

    volatile uint32_t cpuIdleCounters[2] = {0, 0};
    uint32_t cpuIdleBaseline[2] = {1, 1};
    uint32_t cpuIdlePrevious[2] = {0, 0};
    uint8_t cpuUsagePercent[2] = {0, 0};
    unsigned long lastCpuSampleAtMs = 0;
    esp_reset_reason_t bootResetReason =
        ESP_RST_UNKNOWN;

    bool cpuIdleHook0()
    {
        ++cpuIdleCounters[0];
        return false;
    }

    bool cpuIdleHook1()
    {
        ++cpuIdleCounters[1];
        return false;
    }

    void updateCpuUsage()
    {
        const unsigned long now =
            millis();

        if (
            now -
                lastCpuSampleAtMs <
            1000)
        {
            return;
        }

        lastCpuSampleAtMs =
            now;

        for (
            uint8_t core = 0;
            core < 2;
            ++core)
        {
            const uint32_t current =
                cpuIdleCounters[core];

            const uint32_t idleDelta =
                current -
                cpuIdlePrevious[core];

            cpuIdlePrevious[core] =
                current;

            if (
                idleDelta >
                cpuIdleBaseline[core])
            {
                cpuIdleBaseline[core] =
                    idleDelta;
            }

            const uint32_t baseline =
                cpuIdleBaseline[core] > 0
                    ? cpuIdleBaseline[core]
                    : 1;

            const uint32_t measuredIdlePercent =
                (idleDelta * 100ULL) /
                baseline;

            const uint32_t idlePercent =
                measuredIdlePercent > 100
                    ? 100
                    : measuredIdlePercent;

            cpuUsagePercent[core] =
                static_cast<uint8_t>(
                    100 -
                    idlePercent);
        }
    }

    const char *resetReasonName(
        esp_reset_reason_t reason)
    {
        switch (reason)
        {
        case ESP_RST_POWERON:
            return "power-on";

        case ESP_RST_EXT:
            return "external";

        case ESP_RST_SW:
            return "software";

        case ESP_RST_PANIC:
            return "panic";

        case ESP_RST_INT_WDT:
            return "interrupt-watchdog";

        case ESP_RST_TASK_WDT:
            return "task-watchdog";

        case ESP_RST_WDT:
            return "watchdog";

        case ESP_RST_DEEPSLEEP:
            return "deep-sleep";

        case ESP_RST_BROWNOUT:
            return "brownout";

        case ESP_RST_SDIO:
            return "sdio";

        default:
            return "unknown";
        }
    }

    uint16_t parseBlockId(
        JsonVariantConst value)
    {
        if (
            value.is<const char *>())
        {
            const char *text =
                value.as<const char *>();

            if (
                !text ||
                !*text)
            {
                return 0;
            }

            const long parsed =
                strtol(
                    text,
                    nullptr,
                    10);

            return parsed > 0 &&
                           parsed <= 0xffff
                       ? static_cast<uint16_t>(
                             parsed)
                       : 0;
        }

        const long parsed =
            value |
            0L;

        return parsed > 0 &&
                       parsed <= 0xffff
                   ? static_cast<uint16_t>(
                         parsed)
                   : 0;
    }

}

WsProtocol::WsProtocol(
    AsyncWebSocket &ws,
    ICommandCenter &commandCenter,
    LayoutRuntime &runtime,
    RuntimeStateStore &stateStore,
    LocoCounterRuntime &locoCounters)
    : _ws(ws),
      _commandCenter(commandCenter),
      _runtime(runtime),
      _stateStore(stateStore),
      _locoCounters(locoCounters) {}

void WsProtocol::begin()
{
    _ws.onEvent(
        [this](
            AsyncWebSocket *server,
            AsyncWebSocketClient *client,
            AwsEventType type,
            void *arg,
            uint8_t *data,
            size_t len)
        {
            handleEvent(
                server,
                client,
                type,
                arg,
                data,
                len);
        });

    _commandCenter.onRawInfo(
        [this](
            const String &raw)
        {
            broadcastRawInfo(
                raw);
        });

    _commandCenter.onStationInfo(
        [this](
            const CommandCenterStationInfo &info)
        {
            handleStationInfo(
                info);
        });

    _commandCenter.onTrackConfiguration(
        [this](
            const CommandCenterTrackConfiguration &info)
        {
            handleTrackConfiguration(
                info);
        });

    _commandCenter.onCurrentTelemetry(
        [this](
            const CommandCenterCurrentTelemetry &info)
        {
            handleCurrentTelemetry(
                info);
        });

    _commandCenter.onTripTelemetry(
        [this](
            const CommandCenterTripTelemetry &info)
        {
            handleTripTelemetry(
                info);
        });

    _commandCenter.onPowerFeedback(
        [this](
            const CommandCenterPowerFeedback &info)
        {
            handlePowerFeedback(
                info);
        });

    _commandCenter.onLocoFeedback(
        [this](
            const CommandCenterLocoFeedback &info)
        {
            handleLocoFeedback(
                info);
        });

    _runtime.onChange(
        [this](
            RuntimeChangeKind kind,
            uint16_t,
            uint8_t)
        {
            if (
                kind ==
                RuntimeChangeKind::Block)
            {
                broadcastBlockStateSnapshot();
            }
        });

    bootResetReason =
        esp_reset_reason();

    esp_register_freertos_idle_hook_for_cpu(
        cpuIdleHook0,
        0);

    esp_register_freertos_idle_hook_for_cpu(
        cpuIdleHook1,
        1);

    delay(250);

    for (
        uint8_t core = 0;
        core < 2;
        ++core)
    {
        cpuIdleBaseline[core] =
            cpuIdleCounters[core]
                ? cpuIdleCounters[core] *
                      4
                : 1;

        cpuIdlePrevious[core] =
            cpuIdleCounters[core];
    }

    lastCpuSampleAtMs =
        millis();

    _lastCommandCenterConnected =
        _commandCenter.connected();

    if (
        _lastCommandCenterConnected)
    {
        _commandCenterConnectedSinceAt =
            millis();
    }
}

void WsProtocol::loop()
{
    const unsigned long now =
        millis();

    updateCpuUsage();

    _locoCounters.loop();

    if (
        _locoCounters.consumeChanged() &&
        _wsClientCount > 0)
    {
        broadcastLocoCounterSnapshot();
    }

    handleCommandCenterConnectionState(
        now);

    pollLocoStateSync(
        now);

    pollDccExTelemetry(
        now);

    if (
        _pendingProgramming.active &&
        static_cast<long>(
            now -
            _pendingProgramming.deadlineAt) >= 0)
    {
        sendProgrammingResponse(
            _pendingProgramming.requestId,
            _pendingProgramming.action,
            false,
            "Programming request timed out.");

        clearPendingProgramming();
    }

    if (
        _nextHubStatusAt == 0 ||
        static_cast<long>(
            now -
            _nextHubStatusAt) >= 0)
    {
        if (
            _wsClientCount > 0)
        {
            broadcastDccExStatus();
        }

        _nextHubStatusAt =
            now +
            HUB_STATUS_INTERVAL_MS;
    }
}

void WsProtocol::cleanupClients()
{
    _ws.cleanupClients();
}

void WsProtocol::send(
    AsyncWebSocketClient *client,
    const char *type,
    JsonVariantConst data)
{
    JsonDocument out;

    out["type"] =
        type;

    out["data"].set(
        data);

    String body;

    serializeJson(
        out,
        body);

    client->text(
        body);
}

void WsProtocol::broadcast(
    const char *type,
    JsonDocument &data)
{
    JsonDocument out;

    out["type"] =
        type;

    out["data"].set(
        data.as<JsonVariantConst>());

    String body;

    serializeJson(
        out,
        body);

    _ws.textAll(
        body);
}

void WsProtocol::sendCommandCenterInfo(
    AsyncWebSocketClient *client)
{
    JsonDocument data;

    data["alive"] =
        _commandCenter.connected();

    data["power"] =
        _trackPower;

    data["type"] =
        _commandCenter.type();

    data["name"] =
        _commandCenter.name();

    data["transport"] =
        CommandCenterBuild::isDccEx()
            ? "tcp"
            : "udp";

    data["serialPort"] =
        "";

    data["baudRate"] =
        0;

    data["ip"] =
        _commandCenter.host();

    data["port"] =
        _commandCenter.port();

    data["connectionString"] =
        _commandCenter.host() +
        ":" +
        String(
            _commandCenter.port());

    send(
        client,
        "commandCenterInfo",
        data.as<JsonVariantConst>());
}

void WsProtocol::sendPowerInfo(
    AsyncWebSocketClient *client)
{
    JsonDocument data;

    data["emergencyStop"] =
        _emergencyStop;

    data["trackVoltageOn"] =
        _trackPower;

    data["trackVoltageOff"] =
        !_trackPower;

    data["shortCircuit"] =
        false;

    data["programmingModeActive"] =
        _programmingPower;

    data["programmingJoined"] =
        _programmingJoined;

    send(
        client,
        "powerInfo",
        data.as<JsonVariantConst>());
}

void WsProtocol::sendControlStationStatus(
    AsyncWebSocketClient *client)
{
    JsonDocument data;

    data["active"] =
        _controlStationOwnerConnectionId != 0;

    if (
        _controlStationOwnerConnectionId != 0)
    {
        data["ownerClientId"] =
            _controlStationOwnerClientId;

        data["ownerName"] =
            _controlStationOwnerName;
    }
    else
    {
        data["ownerClientId"] =
            nullptr;

        data["ownerName"] =
            nullptr;
    }

    send(
        client,
        "controlStationStatus",
        data.as<JsonVariantConst>());
}

void WsProtocol::broadcastControlStationStatus()
{
    JsonDocument data;

    data["active"] =
        _controlStationOwnerConnectionId != 0;

    if (
        _controlStationOwnerConnectionId != 0)
    {
        data["ownerClientId"] =
            _controlStationOwnerClientId;

        data["ownerName"] =
            _controlStationOwnerName;
    }
    else
    {
        data["ownerClientId"] =
            nullptr;

        data["ownerName"] =
            nullptr;
    }

    broadcast(
        "controlStationStatus",
        data);
}

void WsProtocol::broadcastPowerInfo()
{
    JsonDocument data;

    data["emergencyStop"] =
        _emergencyStop;

    data["trackVoltageOn"] =
        _trackPower;

    data["trackVoltageOff"] =
        !_trackPower;

    data["shortCircuit"] =
        false;

    data["programmingModeActive"] =
        _programmingPower;

    data["programmingJoined"] =
        _programmingJoined;

    broadcast(
        "powerInfo",
        data);
}

void WsProtocol::sendBlockStateSnapshot(
    AsyncWebSocketClient *client)
{
    JsonDocument data;

    for (
        const auto &block :
        _runtime.blocks())
    {
        JsonObject state =
            data[String(
                     block.id)]
                .to<JsonObject>();

        state["blockId"] =
            String(
                block.id);

        if (
            block.locoId
                .isEmpty())
        {
            state["locoId"] =
                nullptr;
        }
        else
        {
            state["locoId"] =
                block.locoId;
        }

        if (
            block.locoAddress >
            0)
        {
            state["locoAddress"] =
                block.locoAddress;
        }
    }

    send(
        client,
        "blockStateChanged",
        data.as<JsonVariantConst>());
}

void WsProtocol::broadcastBlockStateSnapshot()
{
    JsonDocument data;

    for (
        const auto &block :
        _runtime.blocks())
    {
        JsonObject state =
            data[String(
                     block.id)]
                .to<JsonObject>();

        state["blockId"] =
            String(
                block.id);

        if (
            block.locoId
                .isEmpty())
        {
            state["locoId"] =
                nullptr;
        }
        else
        {
            state["locoId"] =
                block.locoId;
        }

        if (
            block.locoAddress >
            0)
        {
            state["locoAddress"] =
                block.locoAddress;
        }
    }

    broadcast(
        "blockStateChanged",
        data);
}

void WsProtocol::recomputePowerStateFromTrackTelemetry()
{
    bool mainSeen =
        false;

    bool mainKnown =
        true;

    bool mainOn =
        true;

    bool progSeen =
        false;

    bool progKnown =
        true;

    bool progOn =
        true;

    for (
        uint8_t index = 0;
        index < MAX_DCC_TRACKS;
        ++index)
    {
        const DccTrackState &track =
            _dccTracks[index];

        if (
            !track.configured)
        {
            continue;
        }

        if (
            track.mode
                .startsWith(
                    "MAIN"))
        {
            mainSeen =
                true;

            if (
                !track.powerKnown)
            {
                mainKnown =
                    false;
            }
            else if (
                !track.powerOn)
            {
                mainOn =
                    false;
            }
        }

        if (
            track.mode
                .startsWith(
                    "PROG"))
        {
            progSeen =
                true;

            if (
                !track.powerKnown)
            {
                progKnown =
                    false;
            }
            else if (
                !track.powerOn)
            {
                progOn =
                    false;
            }
        }
    }

    if (
        mainSeen &&
        mainKnown)
    {
        _trackPower =
            mainOn;
    }

    if (
        progSeen &&
        progKnown)
    {
        _programmingPower =
            progOn;
    }
}

void WsProtocol::appendHubStatus(
    JsonObject hub)
{
    hub["uptimeMs"] =
        millis();

    hub["chipModel"] =
        ESP.getChipModel();

    hub["chipRevision"] =
        ESP.getChipRevision();

    hub["cpuCores"] =
        2;

    hub["cpuFrequencyMhz"] =
        ESP.getCpuFreqMHz();

    hub["cpuCore0Percent"] =
        cpuUsagePercent[0];

    hub["cpuCore1Percent"] =
        cpuUsagePercent[1];

    hub["chipTemperatureC"] =
        temperatureRead();

    hub["heapSizeBytes"] =
        ESP.getHeapSize();

    hub["freeHeapBytes"] =
        ESP.getFreeHeap();

    hub["minimumFreeHeapBytes"] =
        ESP.getMinFreeHeap();

    hub["largestFreeHeapBlockBytes"] =
        ESP.getMaxAllocHeap();

    hub["psramSizeBytes"] =
        ESP.getPsramSize();

    hub["freePsramBytes"] =
        ESP.getFreePsram();

    const char *wifiHostname =
        WiFi.getHostname();

    hub["hostname"] =
        wifiHostname
            ? wifiHostname
            : "";
    hub["wifiIp"] =
        WiFi.localIP()
            .toString();

    hub["wifiRssiDbm"] =
        WiFi.RSSI();

    hub["wifiSsid"] =
        WiFi.SSID();

    hub["wifiMac"] =
        WiFi.macAddress();

    hub["wifiChannel"] =
        WiFi.channel();

    hub["wsClients"] =
        _wsClientCount;

    hub["runtimeAccessories"] =
        _runtime.accessoryCount();

    hub["runtimeSensors"] =
        _runtime.sensorCount();

    hub["runtimeBlocks"] =
        _runtime.blockCount();

    hub["flashChipBytes"] =
        ESP.getFlashChipSize();

    hub["sketchBytes"] =
        ESP.getSketchSize();

    hub["freeSketchBytes"] =
        ESP.getFreeSketchSpace();

    hub["sdkVersion"] =
        ESP.getSdkVersion();

    hub["resetReason"] =
        resetReasonName(
            bootResetReason);
}

void WsProtocol::appendDccExStatus(
    JsonDocument &data)
{
    const bool alive =
        _commandCenter.connected();

    int32_t mainCurrentMa =
        -1;

    int32_t progCurrentMa =
        -1;

    for (
        uint8_t index = 0;
        index < MAX_DCC_TRACKS;
        ++index)
    {
        const DccTrackState &track =
            _dccTracks[index];

        if (
            !track.configured)
        {
            continue;
        }

        if (
            track.mode
                .startsWith(
                    "MAIN") &&
            mainCurrentMa < 0)
        {
            mainCurrentMa =
                track.currentMa;
        }

        if (
            track.mode
                .startsWith(
                    "PROG") &&
            progCurrentMa < 0)
        {
            progCurrentMa =
                track.currentMa;
        }
    }

    data["version"] =
        _dccVersion;

    data["processor"] =
        _dccProcessor;

    data["hardware"] =
        _dccHardware;

    data["build"] =
        _dccBuild;

    data["host"] =
        _commandCenter.host();

    data["port"] =
        _commandCenter.port();

    data["alive"] =
        alive;

    data["maxLocos"] =
        _dccMaxLocos;

    data["trackVoltageOn"] =
        _trackPower;

    data["voltageMeasured"] =
        false;

    data["trackVoltageV"] =
        nullptr;

    data["mainCurrentMa"] =
        mainCurrentMa >= 0
            ? mainCurrentMa
            : 0;

    data["progCurrentMa"] =
        progCurrentMa >= 0
            ? progCurrentMa
            : 0;

    data["currentUpdatedAtMs"] =
        _dccCurrentUpdatedAt;

    data["linkUptimeMs"] =
        alive &&
                _commandCenterConnectedSinceAt
            ? millis() -
                  _commandCenterConnectedSinceAt
            : 0;

    JsonArray tracks =
        data["tracks"]
            .to<JsonArray>();

    for (
        uint8_t index = 0;
        index < MAX_DCC_TRACKS;
        ++index)
    {
        const DccTrackState &track =
            _dccTracks[index];

        if (
            !track.configured)
        {
            continue;
        }

        JsonObject out =
            tracks
                .add<JsonObject>();

        char letter[2] = {
            static_cast<char>(
                'A' +
                index),
            '\0'};

        out["letter"] =
            letter;

        out["mode"] =
            track.mode;

        if (
            track.currentMa >=
            0)
        {
            out["currentMa"] =
                track.currentMa;
        }
        else
        {
            out["currentMa"] =
                nullptr;
        }

        out["overload"] =
            track.overload;

        if (
            track.tripMa >=
            0)
        {
            out["tripMa"] =
                track.tripMa;
        }
        else
        {
            out["tripMa"] =
                nullptr;
        }
    }

    JsonObject hub =
        data["hub"]
            .to<JsonObject>();

    appendHubStatus(
        hub);

    data["uptimeMs"] =
        millis();

    data["freeHeapBytes"] =
        ESP.getFreeHeap();

    data["cpuCores"] =
        2;

    data["cpuFrequencyMhz"] =
        ESP.getCpuFreqMHz();

    data["cpuCore0Percent"] =
        cpuUsagePercent[0];

    data["cpuCore1Percent"] =
        cpuUsagePercent[1];

    data["chipTemperatureC"] =
        temperatureRead();

    data["wsClients"] =
        _wsClientCount;

    data["minimumFreeHeapBytes"] =
        ESP.getMinFreeHeap();

    data["largestFreeHeapBlockBytes"] =
        ESP.getMaxAllocHeap();

    data["resetReason"] =
        resetReasonName(
            bootResetReason);
}

void WsProtocol::sendDccExStatus(
    AsyncWebSocketClient *client)
{
    JsonDocument data;

    appendDccExStatus(
        data);

    send(
        client,
        "dccExStatus",
        data.as<JsonVariantConst>());
}

void WsProtocol::broadcastDccExStatus()
{
    JsonDocument data;

    appendDccExStatus(
        data);

    broadcast(
        "dccExStatus",
        data);
}

bool WsProtocol::requestLocoState(
    uint16_t address,
    bool logCommand)
{
    if (
        address == 0 ||
        address > 10239 ||
        !_commandCenter.connected())
    {
        return false;
    }

    return _commandCenter
        .requestLocoState(
            address,
            logCommand);
}

void WsProtocol::beginConfiguredLocoStateSync(
    unsigned long now)
{
    _locoSyncCount =
        0;

    _locoSyncIndex =
        0;

    _nextLocoSyncAt =
        0;

    static constexpr const char *LOCOS_PATH =
        "/config/locos.json";

    FileStore files(
        LittleFS);

    if (
        !files.exists(
            LOCOS_PATH))
    {
        Logger::info(
            "Loco state sync: no saved locomotive list");

        return;
    }

    File file =
        files.openRead(
            LOCOS_PATH);

    if (!file)
    {
        Logger::warn(
            "Loco state sync: cannot open locos.json");

        return;
    }

    JsonDocument filter;

    filter[0]["address"] =
        true;

    JsonDocument document;

    const DeserializationError error =
        deserializeJson(
            document,
            file,
            DeserializationOption::Filter(
                filter));

    file.close();

    if (
        error ||
        !document.is<JsonArray>())
    {
        Logger::warn(
            "Loco state sync: invalid locos.json");

        return;
    }

    for (
        JsonObjectConst item :
        document.as<JsonArrayConst>())
    {
        const int addressValue =
            item["address"] |
            0;

        if (
            addressValue <= 0 ||
            addressValue > 10239)
        {
            continue;
        }

        const uint16_t address =
            static_cast<uint16_t>(
                addressValue);

        bool duplicate =
            false;

        for (
            size_t index = 0;
            index < _locoSyncCount;
            ++index)
        {
            if (
                _locoSyncAddresses[index] ==
                address)
            {
                duplicate =
                    true;

                break;
            }
        }

        if (duplicate)
        {
            continue;
        }

        if (
            _locoSyncCount >=
            MAX_LOCOS)
        {
            Logger::warn(
                "Loco state sync: locomotive limit reached");

            break;
        }

        _locoSyncAddresses[_locoSyncCount++] =
            address;
    }

    if (
        _locoSyncCount == 0)
    {
        Logger::info(
            "Loco state sync: no valid DCC addresses");

        return;
    }

    _nextLocoSyncAt =
        now;

    Logger::info(
        "Loco state sync queued: " +
        String(
            _locoSyncCount) +
        " locomotive(s)");
}

void WsProtocol::pollLocoStateSync(
    unsigned long now)
{
    if (
        !_commandCenter.connected() ||
        _locoSyncIndex >=
            _locoSyncCount)
    {
        return;
    }

    if (
        _nextLocoSyncAt != 0 &&
        static_cast<long>(
            now -
            _nextLocoSyncAt) < 0)
    {
        return;
    }

    const uint16_t address =
        _locoSyncAddresses[_locoSyncIndex];

    if (
        !requestLocoState(
            address,
            false))
    {
        _nextLocoSyncAt =
            now +
            LOCO_STATE_SYNC_INTERVAL_MS;

        return;
    }

    ++_locoSyncIndex;
    if (
        _locoSyncIndex >=
        _locoSyncCount)
    {
        _nextLocoSyncAt =
            0;

        Logger::info(
            "Loco state sync requests completed");

        return;
    }

    _nextLocoSyncAt =
        now +
        LOCO_STATE_SYNC_INTERVAL_MS;
}

void WsProtocol::handleCommandCenterConnectionState(
    unsigned long now)
{
    const bool connected =
        _commandCenter.connected();

    if (
        connected ==
        _lastCommandCenterConnected)
    {
        return;
    }

    _lastCommandCenterConnected =
        connected;

    if (!connected)
    {
        _locoCounters.setTrackPower(
            false);

        _commandCenterConnectedSinceAt =
            0;

        _nextDccCurrentPollAt =
            0;

        _locoSyncCount =
            0;

        _locoSyncIndex =
            0;

        _nextLocoSyncAt =
            0;

        for (
            uint8_t index = 0;
            index < MAX_DCC_TRACKS;
            ++index)
        {
            _dccTracks[index].configured =
                false;

            _dccTracks[index].mode =
                "";

            _dccTracks[index].powerKnown =
                false;

            _dccTracks[index].powerOn =
                false;

            _dccTracks[index].currentMa =
                -1;

            _dccTracks[index].tripMa =
                -1;

            _dccTracks[index].overload =
                false;
        }

        return;
    }

    _commandCenterConnectedSinceAt =
        now;

    _nextDccCurrentPollAt =
        0;

    _commandCenter
        .requestTrackConfiguration(
            false);

    _commandCenter
        .requestTripTelemetry(
            false);

    beginConfiguredLocoStateSync(
        now);
}

void WsProtocol::pollDccExTelemetry(
    unsigned long now)
{
    if (
        !_commandCenter.connected() ||
        _wsClientCount == 0)
    {
        return;
    }

    if (
        _nextDccCurrentPollAt == 0 ||
        static_cast<long>(
            now -
            _nextDccCurrentPollAt) >= 0)
    {
        _commandCenter
            .requestCurrentTelemetry(
                false);

        _nextDccCurrentPollAt =
            now +
            DCC_CURRENT_POLL_MS;
    }
}

void WsProtocol::sendRuntimeSnapshot(
    AsyncWebSocketClient *client)
{
    sendCommandCenterInfo(
        client);

    sendPowerInfo(
        client);

    sendDccExStatus(
        client);

    {
        const FastClockSnapshot snapshot =
            _fastClock.snapshot();

        JsonDocument data;

        appendFastClockSnapshot(
            data.to<JsonObject>(),
            snapshot);

        send(
            client,
            "fastClockChanged",
            data.as<JsonVariantConst>());
    }

    {
        JsonDocument physical;

        appendRuntimePhysicalSnapshot(
            physical);

        send(
            client,
            "runtimePhysicalSnapshot",
            physical.as<JsonVariantConst>());
    }

    for (
        const auto &item :
        _runtime.accessories())
    {
        JsonDocument data;

        switch (
            item.kind)
        {
        case RuntimeAccessoryKind::Turnout:
        {
            bool logicalClosed =
                false;

            const bool logicalKnown =
                _runtime.getTurnoutClosed(
                    item.address,
                    logicalClosed);

            data["address"] =
                item.address;

            data["closed"] =
                item.closed;

            if (logicalKnown)
            {
                data["logicalClosed"] =
                    logicalClosed;
            }
            else
            {
                data["logicalClosed"] =
                    nullptr;
            }

            data["outputMode"] =
                item.turnoutExtended
                    ? "extended"
                    : (
                          item.turnoutVPin
                              ? "vpin"
                              : "accessory");

            if (
                item.turnoutExtended &&
                item.aspect >=
                    0)
            {
                data["aspect"] =
                    item.aspect;
            }
            else
            {
                data["aspect"] =
                    nullptr;
            }

            data["closedAspect"] =
                item.turnoutClosedAspect;

            data["openedAspect"] =
                item.turnoutOpenedAspect;

            send(
                client,
                "turnoutChanged",
                data.as<JsonVariantConst>());

            break;
        }

        case RuntimeAccessoryKind::Signal:
            if (
                item.aspect >=
                0)
            {
                data["address"] =
                    item.address;

                data["aspect"] =
                    item.aspect;

                send(
                    client,
                    "signalAspectChanged",
                    data.as<JsonVariantConst>());
            }

            break;

        case RuntimeAccessoryKind::Accessory:
            data["address"] =
                item.address;

            data["active"] =
                item.active;

            send(
                client,
                "accessoryChanged",
                data.as<JsonVariantConst>());

            break;

        case RuntimeAccessoryKind::VPin:
            data["vpin"] =
                item.address;

            data["active"] =
                item.active;

            send(
                client,
                "vpinChanged",
                data.as<JsonVariantConst>());

            break;
        }
    }

    for (
        const auto &sensor :
        _runtime.sensors())
    {
        bool on =
            false;

        if (
            !_runtime.getSensorState(
                sensor.address,
                on))
        {
            continue;
        }

        JsonDocument data;

        data["address"] =
            sensor.address;

        data["on"] =
            on;

        send(
            client,
            "sensorChanged",
            data.as<JsonVariantConst>());
    }

    for (
        size_t index = 0;
        index <
            _locoCount;
        ++index)
    {
        const LocoState &loco =
            _locos[index];

        JsonDocument data;
        JsonObject out =
            data["loco"]
                .to<JsonObject>();

        out["address"] =
            loco.address;
        out["speed"] =
            loco.speed;
        out["direction"] =
            loco.forward
                ? "forward"
                : "reverse";
        out["functionsMask"] =
            loco.functionsMask;

        send(
            client,
            "locoState",
            data.as<JsonVariantConst>());
    }

    sendSensorSnapshot(
        client);

    sendBlockStateSnapshot(
        client);

    sendLocoCounterSnapshot(
        client);
}

void WsProtocol::broadcastRuntimeSnapshot()
{
    JsonDocument cc;

    cc["alive"] =
        _commandCenter.connected();

    cc["power"] =
        _trackPower;

    cc["type"] =
        _commandCenter.type();

    cc["name"] =
        _commandCenter.name();

    cc["transport"] =
        CommandCenterBuild::isDccEx()
            ? "tcp"
            : "udp";

    cc["serialPort"] =
        "";

    cc["baudRate"] =
        0;

    cc["ip"] =
        _commandCenter.host();

    cc["port"] =
        _commandCenter.port();

    broadcast(
        "commandCenterInfo",
        cc);

    broadcastPowerInfo();
    broadcastDccExStatus();

    {
        const FastClockSnapshot snapshot =
            _fastClock.snapshot();

        JsonDocument data;

        appendFastClockSnapshot(
            data.to<JsonObject>(),
            snapshot);

        broadcast(
            "fastClockChanged",
            data);
    }

    {
        JsonDocument physical;

        appendRuntimePhysicalSnapshot(
            physical);

        broadcast(
            "runtimePhysicalSnapshot",
            physical);
    }

    for (
        const auto &item :
        _runtime.accessories())
    {
        JsonDocument data;

        switch (
            item.kind)
        {
        case RuntimeAccessoryKind::Turnout:
            broadcastTurnoutState(
                item.address);

            break;

        case RuntimeAccessoryKind::Signal:
            if (
                item.aspect >=
                0)
            {
                data["address"] =
                    item.address;

                data["aspect"] =
                    item.aspect;

                broadcast(
                    "signalAspectChanged",
                    data);
            }

            break;

        case RuntimeAccessoryKind::Accessory:
            data["address"] =
                item.address;

            data["active"] =
                item.active;

            broadcast(
                "accessoryChanged",
                data);

            break;

        case RuntimeAccessoryKind::VPin:
            data["vpin"] =
                item.address;

            data["active"] =
                item.active;

            broadcast(
                "vpinChanged",
                data);

            break;
        }
    }

    for (
        const auto &sensor :
        _runtime.sensors())
    {
        bool on =
            false;

        if (
            !_runtime.getSensorState(
                sensor.address,
                on))
        {
            continue;
        }

        JsonDocument data;

        data["address"] =
            sensor.address;

        data["on"] =
            on;

        broadcast(
            "sensorChanged",
            data);
    }

    broadcastSensorSnapshot();
    broadcastBlockStateSnapshot();
    broadcastLocoCounterSnapshot();
}

void WsProtocol::sendProgrammingResponse(
    const String& requestId,
    const String& action,
    bool ok,
    const String& message,
    int value,
    const String& raw)
{
    JsonDocument data;

    data["requestId"] = requestId;
    data["action"] = action;
    data["ok"] = ok;
    data["message"] = message;

    if (value >= 0)
    {
        data["value"] = value;
    }

    if (!raw.isEmpty())
    {
        data["raw"] = raw;
    }

    broadcast(
        "programmingResponse",
        data);
}

void WsProtocol::clearPendingProgramming()
{
    _pendingProgramming = PendingProgrammingRequest{};
}

void WsProtocol::handleProgrammingRawResponse(
    const String& raw)
{
    if (
        !_pendingProgramming.active ||
        !raw.endsWith(">") ||
        raw.length() < 4)
    {
        return;
    }

    const bool isAddressOrWriteReply =
        raw.startsWith("<r ");

    const bool isCvReadReply =
        raw.startsWith("<v ");

    if (
        !isAddressOrWriteReply &&
        !isCvReadReply)
    {
        return;
    }

    if (
        _pendingProgramming.action == "readCv" &&
        !isCvReadReply)
    {
        return;
    }

    if (
        (_pendingProgramming.action == "readAddress" ||
         _pendingProgramming.action == "writeAddress" ||
         _pendingProgramming.action == "writeCv") &&
        !isAddressOrWriteReply)
    {
        return;
    }

    String body = raw.substring(3, raw.length() - 1);
    body.trim();

    char* end = nullptr;
    const long first = strtol(body.c_str(), &end, 10);

    if (end == body.c_str())
    {
        return;
    }

    while (*end == ' ' || *end == '\t')
    {
        ++end;
    }

    const bool hasSecond = *end != '\0';
    long second = -1;

    if (hasSecond)
    {
        char* secondEnd = nullptr;
        second = strtol(end, &secondEnd, 10);

        if (secondEnd == end)
        {
            return;
        }
    }

    if (
        _pendingProgramming.action == "readAddress" ||
        _pendingProgramming.action == "writeAddress")
    {
        const bool ok = first >= 0;

        sendProgrammingResponse(
            _pendingProgramming.requestId,
            _pendingProgramming.action,
            ok,
            ok
                ? "Decoder address operation completed."
                : "Decoder address operation failed.",
            ok ? static_cast<int>(first) : -1,
            raw);

        clearPendingProgramming();
        return;
    }

    if (
        _pendingProgramming.action == "readCv" ||
        _pendingProgramming.action == "writeCv")
    {
        if (!hasSecond)
        {
            return;
        }

        if (
            _pendingProgramming.expectedCv > 0 &&
            first != _pendingProgramming.expectedCv)
        {
            return;
        }

        const bool ok = second >= 0;

        sendProgrammingResponse(
            _pendingProgramming.requestId,
            _pendingProgramming.action,
            ok,
            ok
                ? "CV operation completed."
                : "CV operation failed.",
            ok ? static_cast<int>(second) : -1,
            raw);

        clearPendingProgramming();
    }
}

void WsProtocol::broadcastRawInfo(
    const String &raw)
{
    handleProgrammingRawResponse(raw);

    JsonDocument data;

    data["raw"] =
        raw;

    broadcast(
        "rawInfo",
        data);
}

WsProtocol::LocoState *
WsProtocol::getLoco(
    uint16_t address,
    bool create)
{
    for (
        size_t index = 0;
        index < _locoCount;
        ++index)
    {
        if (
            _locos[index].address ==
            address)
        {
            return &_locos[index];
        }
    }

    if (
        !create ||
        _locoCount >=
            MAX_LOCOS)
    {
        return nullptr;
    }

    auto &loco =
        _locos[_locoCount++];

    loco.address =
        address;

    loco.speed =
        0;

    loco.forward =
        true;

    loco.functionsMask =
        0;

    return &loco;
}

void WsProtocol::sendLocoCounterSnapshot(
    AsyncWebSocketClient *client)
{
    JsonDocument data;

    JsonArray items =
        data["items"]
            .to<JsonArray>();

    _locoCounters.appendSnapshot(
        items);

    send(
        client,
        "locoCounterSnapshot",
        data.as<JsonVariantConst>());
}

void WsProtocol::broadcastLocoCounterSnapshot()
{
    JsonDocument data;

    JsonArray items =
        data["items"]
            .to<JsonArray>();

    _locoCounters.appendSnapshot(
        items);

    broadcast(
        "locoCounterSnapshot",
        data);
}

void WsProtocol::appendSensorSnapshot(
    JsonDocument &data)
{
    JsonArray groups =
        data["groups"].to<JsonArray>();

    struct GroupState
    {
        uint16_t baseAddress = 0;
        uint16_t activeBits = 0;
        uint16_t knownBits = 0;
    };

    std::vector<GroupState> grouped;

    for (
        const auto &sensor :
        _runtime.sensorStates())
    {
        const uint16_t baseAddress =
            static_cast<uint16_t>(
                (sensor.address / 16) *
                16);

        auto found =
            std::find_if(
                grouped.begin(),
                grouped.end(),
                [baseAddress](
                    const GroupState &group)
                {
                    return
                        group.baseAddress ==
                        baseAddress;
                });

        if (
            found ==
            grouped.end())
        {
            GroupState group;
            group.baseAddress =
                baseAddress;

            grouped.push_back(
                group);

            found =
                grouped.end() -
                1;
        }

        const uint8_t bit =
            static_cast<uint8_t>(
                sensor.address -
                baseAddress);

        if (
            bit >=
            16)
        {
            continue;
        }

        found->knownBits |=
            static_cast<uint16_t>(
                1U <<
                bit);

        if (sensor.on)
        {
            found->activeBits |=
                static_cast<uint16_t>(
                    1U <<
                    bit);
        }
    }

    std::sort(
        grouped.begin(),
        grouped.end(),
        [](
            const GroupState &left,
            const GroupState &right)
        {
            return
                left.baseAddress <
                right.baseAddress;
        });

    for (
        const auto &group :
        grouped)
    {
        JsonArray row =
            groups.add<JsonArray>();

        row.add(
            group.baseAddress);
        row.add(
            group.activeBits);
        row.add(
            group.knownBits);
    }
}

void WsProtocol::sendSensorSnapshot(
    AsyncWebSocketClient *client)
{
    JsonDocument data;

    appendSensorSnapshot(
        data);

    send(
        client,
        "sensorSnapshot",
        data.as<JsonVariantConst>());
}

void WsProtocol::broadcastSensorSnapshot()
{
    JsonDocument data;

    appendSensorSnapshot(
        data);

    broadcast(
        "sensorSnapshot",
        data);
}

void WsProtocol::appendRuntimePhysicalSnapshot(
    JsonDocument &data)
{
    JsonArray basic =
        data["basicAccessories"]
            .to<JsonArray>();

    for (
        const auto &state :
        _runtime.basicAccessories())
    {
        JsonObject item =
            basic.add<JsonObject>();

        item["address"] =
            state.address;
        item["active"] =
            state.active;
    }

    JsonArray extended =
        data["extendedAccessories"]
            .to<JsonArray>();

    for (
        const auto &state :
        _runtime.extendedAccessories())
    {
        JsonObject item =
            extended.add<JsonObject>();

        item["address"] =
            state.address;
        item["aspect"] =
            state.aspect;
    }
}

void WsProtocol::broadcastTurnoutState(
    uint16_t address)
{
    const RuntimeAccessory *turnout =
        _runtime.findAccessory(
            RuntimeAccessoryKind::Turnout,
            address);

    if (!turnout)
    {
        return;
    }

    bool logicalClosed =
        false;

    const bool logicalKnown =
        _runtime.getTurnoutClosed(
            address,
            logicalClosed);

    const bool physicalValue =
        logicalKnown
            ? (
                  logicalClosed
                      ? turnout->closedValue
                      : !turnout->closedValue)
            : false;

    JsonDocument data;

    data["address"] =
        address;

    data["closed"] =
        physicalValue;

    if (logicalKnown)
    {
        data["logicalClosed"] =
            logicalClosed;
    }
    else
    {
        data["logicalClosed"] =
            nullptr;
    }

    data["outputMode"] =
        turnout->turnoutExtended
            ? "extended"
            : (
                  turnout->turnoutVPin
                      ? "vpin"
                      : "accessory");

    if (turnout->turnoutExtended)
    {
        int16_t aspect =
            0;

        if (
            _runtime.getSignalValue(
                address,
                aspect))
        {
            data["aspect"] =
                aspect;
        }
        else
        {
            data["aspect"] =
                nullptr;
        }
    }
    else
    {
        data["aspect"] =
            nullptr;
    }

    data["closedAspect"] =
        turnout->turnoutClosedAspect;

    data["openedAspect"] =
        turnout->turnoutOpenedAspect;

    broadcast(
        "turnoutChanged",
        data);
}

void WsProtocol::broadcastLoco(
    const LocoState &loco)
{
    JsonDocument data;

    JsonObject out =
        data["loco"]
            .to<JsonObject>();

    out["address"] =
        loco.address;

    out["speed"] =
        loco.speed;

    out["direction"] =
        loco.forward
            ? "forward"
            : "reverse";

    out["functionsMask"] =
        loco.functionsMask;

    broadcast(
        "locoState",
        data);
}

void WsProtocol::handleStationInfo(
    const CommandCenterStationInfo &info)
{
    _dccVersion =
        info.version;

    _dccProcessor =
        info.processor;

    _dccHardware =
        info.hardware;

    _dccBuild =
        info.build;

    _dccMaxLocos =
        info.maxLocos;
}

void WsProtocol::handleTrackConfiguration(
    const CommandCenterTrackConfiguration &info)
{
    if (
        info.index >=
        MAX_DCC_TRACKS)
    {
        return;
    }

    _dccTracks[info.index]
        .configured =
        true;

    _dccTracks[info.index]
        .mode =
        info.mode;
}

void WsProtocol::handleCurrentTelemetry(
    const CommandCenterCurrentTelemetry &info)
{
    for (
        uint8_t index = 0;
        index < MAX_DCC_TRACKS;
        ++index)
    {
        _dccTracks[index].currentMa =
            -1;

        _dccTracks[index].overload =
            false;
    }

    const size_t count =
        min(
            info.count,
            static_cast<size_t>(
                MAX_DCC_TRACKS));

    for (
        size_t index = 0;
        index < count;
        ++index)
    {
        _dccTracks[index].overload =
            info.values[index] <
            0;

        _dccTracks[index].currentMa =
            info.values[index] <
                    0
                ? 0
                : info.values[index];

        if (
            !_dccTracks[index]
                 .configured)
        {
            _dccTracks[index].configured =
                true;

            _dccTracks[index].mode =
                "TRACK";
        }
    }

    _dccCurrentUpdatedAt =
        millis();
}

void WsProtocol::handleTripTelemetry(
    const CommandCenterTripTelemetry &info)
{
    for (
        uint8_t index = 0;
        index < MAX_DCC_TRACKS;
        ++index)
    {
        _dccTracks[index].tripMa =
            -1;
    }

    const size_t count =
        min(
            info.count,
            static_cast<size_t>(
                MAX_DCC_TRACKS));

    for (
        size_t index = 0;
        index < count;
        ++index)
    {
        _dccTracks[index].tripMa =
            info.values[index] <
                    0
                ? 0
                : info.values[index];

        if (
            !_dccTracks[index]
                 .configured)
        {
            _dccTracks[index].configured =
                true;

            _dccTracks[index].mode =
                "TRACK";
        }
    }
}

void WsProtocol::handlePowerFeedback(
    const CommandCenterPowerFeedback &info)
{
    if (
        shouldIgnoreProgrammingTrackFeedback(
            info))
    {
        Logger::info(
            "Ignoring stale programming-track power feedback during mode transition");

        return;
    }

    const bool wasMainOn =
        _trackPower;

    const bool wasProgOn =
        _programmingPower;

    const bool wasJoined =
        _programmingJoined;

    switch (
        info.target)
    {
    case CommandCenterPowerTarget::All:
        _trackPower =
            info.on;

        _programmingPower =
            info.on;

        // Generic ALL power feedback only describes track power.
        // It must not change JOIN/PROG routing mode. DCC-EX sends
        // explicit JOIN or PROG feedback when that mode changes.
        for (
            uint8_t index = 0;
            index < MAX_DCC_TRACKS;
            ++index)
        {
            if (
                !_dccTracks[index]
                     .configured)
            {
                continue;
            }

            _dccTracks[index].powerKnown =
                true;

            _dccTracks[index].powerOn =
                info.on;
        }

        break;

    case CommandCenterPowerTarget::Main:
        _trackPower =
            info.on;

        break;

    case CommandCenterPowerTarget::Programming:
        _programmingPower =
            info.on;

        _programmingJoined =
            false;

        break;

    case CommandCenterPowerTarget::Joined:
        _trackPower =
            info.on;

        _programmingPower =
            info.on;

        _programmingJoined =
            info.on;

        break;

    case CommandCenterPowerTarget::Track:
        if (
            info.trackIndex >=
            MAX_DCC_TRACKS)
        {
            return;
        }

        _dccTracks[info.trackIndex]
            .powerKnown =
            true;

        _dccTracks[info.trackIndex]
            .powerOn =
            info.on;

        recomputePowerStateFromTrackTelemetry();

        break;
    }

    _emergencyStop =
        false;

    _locoCounters.setTrackPower(
        _trackPower);

    if (
        wasMainOn &&
        !_trackPower)
    {
        _stateStore.save();
        _locoCounters.requestSave();
    }

    if (
        wasMainOn !=
            _trackPower ||
        wasProgOn !=
            _programmingPower ||
        wasJoined !=
            _programmingJoined)
    {
        broadcastPowerInfo();
    }
}

void WsProtocol::handleLocoFeedback(
    const CommandCenterLocoFeedback &info)
{
    if (
        info.address == 0 ||
        info.address > 10239 ||
        info.speed > 126)
    {
        Logger::warn(
            "Ignoring malformed command-center loco feedback");

        return;
    }

    auto *loco =
        getLoco(
            info.address,
            true);

    if (!loco)
    {
        Logger::warn(
            "Cannot allocate loco state for DCC address " +
            String(
                info.address));

        return;
    }

    loco->forward =
        info.forward;

    loco->speed =
        info.speed;

    loco->functionsMask =
        info.functionsMask;

    _locoCounters.updateLoco(
        info.address,
        info.speed);

    if (
        _emergencyStop &&
        loco->speed > 0)
    {
        _emergencyStop =
            false;

        broadcastPowerInfo();

        Logger::info(
            "ESTOP cleared by loco feedback");
    }

    broadcastLoco(
        *loco);

    Logger::info(
        "Loco feedback: " +
        String(
            loco->address) +
        " speed=" +
        String(
            loco->speed) +
        " direction=" +
        String(
            loco->forward
                ? "forward"
                : "reverse") +
        " functionsMask=" +
        String(
            loco->functionsMask));
}


const WsProtocol::SwitchManLock* WsProtocol::switchManFind(
    uint16_t address) const
{
    for (const auto& item : _switchManLocks)
    {
        if (item.address == address)
        {
            return &item;
        }
    }

    return nullptr;
}

bool WsProtocol::switchManOwnerRevoked(
    const String& ownerId) const
{
    if (ownerId.isEmpty())
    {
        return false;
    }

    for (const auto& revoked : _switchManRevokedOwners)
    {
        if (revoked == ownerId)
        {
            return true;
        }
    }

    return false;
}

bool WsProtocol::switchManOwns(
    uint16_t address,
    const String& ownerId) const
{
    if (ownerId.isEmpty())
    {
        return false;
    }

    const SwitchManLock* item =
        switchManFind(address);

    return
        item != nullptr &&
        item->ownerId == ownerId;
}

void WsProtocol::appendSwitchManLocks(
    JsonArray array,
    const std::vector<SwitchManLock>& locks) const
{
    for (const auto& item : locks)
    {
        JsonObject out =
            array.add<JsonObject>();

        out["address"] =
            item.address;

        out["ownerId"] =
            item.ownerId;

        out["ownerName"] =
            item.ownerName;

        out["acquiredAtMs"] =
            item.acquiredAtMs;
    }
}

void WsProtocol::sendSwitchManSnapshot(
    AsyncWebSocketClient* client)
{
    JsonDocument data;

    appendSwitchManLocks(
        data["locks"].to<JsonArray>(),
        _switchManLocks);

    send(
        client,
        "switchManChanged",
        data.as<JsonVariantConst>());
}

void WsProtocol::broadcastSwitchManSnapshot()
{
    JsonDocument data;

    appendSwitchManLocks(
        data["locks"].to<JsonArray>(),
        _switchManLocks);

    broadcast(
        "switchManChanged",
        data);
}

bool WsProtocol::switchManAcquire(
    const std::vector<uint16_t>& addresses,
    const String& ownerId,
    const String& ownerName,
    std::vector<SwitchManLock>* conflicts)
{
    if (
        addresses.empty() ||
        ownerId.isEmpty() ||
        ownerId.length() > 240 ||
        switchManOwnerRevoked(ownerId))
    {
        return false;
    }

    if (conflicts)
    {
        conflicts->clear();
    }

    bool blocked =
        false;

    for (uint16_t address : addresses)
    {
        const SwitchManLock* existing =
            switchManFind(address);

        if (
            existing != nullptr &&
            existing->ownerId != ownerId)
        {
            blocked =
                true;

            if (conflicts)
            {
                conflicts->push_back(
                    *existing);
            }
        }
    }

    if (blocked)
    {
        return false;
    }

    const unsigned long now =
        millis();

    for (uint16_t address : addresses)
    {
        if (
            switchManFind(address) !=
            nullptr)
        {
            continue;
        }

        SwitchManLock item;

        item.address =
            address;

        item.ownerId =
            ownerId;

        item.ownerName =
            ownerName.isEmpty()
                ? ownerId
                : ownerName;

        item.acquiredAtMs =
            now;

        _switchManLocks.push_back(
            std::move(item));
    }

    std::sort(
        _switchManLocks.begin(),
        _switchManLocks.end(),
        [](
            const SwitchManLock& a,
            const SwitchManLock& b)
        {
            return
                a.address <
                b.address;
        });

    return true;
}

size_t WsProtocol::switchManRelease(
    const String& ownerId,
    const std::vector<uint16_t>* addresses)
{
    if (ownerId.isEmpty())
    {
        return 0;
    }

    size_t released =
        0;

    for (
        auto it =
            _switchManLocks.begin();
        it !=
            _switchManLocks.end();)
    {
        bool matchesAddress =
            addresses ==
                nullptr;

        if (!matchesAddress)
        {
            matchesAddress =
                std::find(
                    addresses->begin(),
                    addresses->end(),
                    it->address) !=
                addresses->end();
        }

        if (
            it->ownerId ==
                ownerId &&
            matchesAddress)
        {
            it =
                _switchManLocks.erase(
                    it);

            ++released;
        }
        else
        {
            ++it;
        }
    }

    if (
        released >
        0)
    {
        broadcastSwitchManSnapshot();
    }

    return released;
}

bool WsProtocol::acquireManualTurnoutOperation(
    AsyncWebSocketClient* client,
    uint16_t address,
    String& ownerId)
{
    ownerId =
        "manual:" +
        String(
            client
                ? client->id()
                : 0) +
        ":" +
        String(
            ++_switchManManualSequence);

    std::vector<uint16_t>
        addresses{
            address
        };

    std::vector<SwitchManLock>
        conflicts;

    if (
        switchManAcquire(
            addresses,
            ownerId,
            "Manual/UI",
            &conflicts))
    {
        broadcastSwitchManSnapshot();

        return true;
    }

    JsonDocument error;

    error["message"] =
        "turnout_locked";

    error["address"] =
        address;

    if (
        !conflicts.empty())
    {
        error["ownerId"] =
            conflicts[0].ownerId;

        error["ownerName"] =
            conflicts[0].ownerName;
    }

    send(
        client,
        "error",
        error.as<JsonVariantConst>());

    ownerId =
        "";

    return false;
}

void WsProtocol::handleSwitchManCommand(
    AsyncWebSocketClient* client,
    JsonVariantConst data)
{
    const String requestId =
        data["requestId"] |
        "";

    const String action =
        data["action"] |
        "";

    const String ownerId =
        data["ownerId"] |
        "";

    const String ownerName =
        data["ownerName"] |
        "";

    auto reply =
        [this,
         client,
         &requestId,
         &action](
            bool ok,
            const String& message,
            const std::vector<SwitchManLock>* locks,
            const std::vector<SwitchManLock>* conflicts,
            int released,
            int address,
            bool hasClosed,
            bool closed)
        {
            JsonDocument response;

            response["requestId"] =
                requestId;

            response["action"] =
                action;

            response["ok"] =
                ok;

            if (
                !message.isEmpty())
            {
                response["message"] =
                    message;
            }

            JsonObject extra =
                response["extra"]
                    .to<JsonObject>();

            if (locks)
            {
                appendSwitchManLocks(
                    extra["locks"]
                        .to<JsonArray>(),
                    *locks);
            }

            if (conflicts)
            {
                appendSwitchManLocks(
                    extra["conflicts"]
                        .to<JsonArray>(),
                    *conflicts);
            }

            if (
                released >=
                0)
            {
                extra["released"] =
                    released;
            }

            if (
                address >
                0)
            {
                extra["address"] =
                    address;
            }

            if (hasClosed)
            {
                extra["closed"] =
                    closed;
            }

            send(
                client,
                "switchManResponse",
                response.as<JsonVariantConst>());
        };

    auto readAddresses =
        [&data]()
        {
            std::vector<uint16_t>
                result;

            JsonArrayConst raw =
                data["addresses"]
                    .as<JsonArrayConst>();

            for (
                JsonVariantConst value :
                raw)
            {
                const int address =
                    value |
                    0;

                if (
                    address <
                        1 ||
                    address >
                        2048)
                {
                    continue;
                }

                const uint16_t normalized =
                    static_cast<uint16_t>(
                        address);

                if (
                    std::find(
                        result.begin(),
                        result.end(),
                        normalized) ==
                    result.end())
                {
                    result.push_back(
                        normalized);
                }
            }

            std::sort(
                result.begin(),
                result.end());

            return result;
        };

    if (
        action ==
        "snapshot")
    {
        reply(
            true,
            "",
            &_switchManLocks,
            nullptr,
            -1,
            0,
            false,
            false);

        return;
    }

    if (
        action ==
        "acquire")
    {
        std::vector<uint16_t>
            addresses =
                readAddresses();

        bool valid =
            !addresses.empty();

        if (valid)
        {
            for (
                uint16_t address :
                addresses)
            {
                if (
                    !_runtime
                         .findAccessory(
                             RuntimeAccessoryKind::
                                 Turnout,
                             address))
                {
                    valid =
                        false;

                    break;
                }
            }
        }

        if (!valid)
        {
            reply(
                false,
                "invalid_turnout_addresses",
                nullptr,
                nullptr,
                -1,
                0,
                false,
                false);

            return;
        }

        if (
            ownerId.isEmpty() ||
            ownerId.length() >
                240)
        {
            reply(
                false,
                "invalid_owner",
                nullptr,
                nullptr,
                -1,
                0,
                false,
                false);

            return;
        }

        if (
            switchManOwnerRevoked(
                ownerId))
        {
            reply(
                false,
                "switchman_owner_revoked",
                nullptr,
                nullptr,
                -1,
                0,
                false,
                false);

            return;
        }

        std::vector<SwitchManLock>
            conflicts;

        const bool ok =
            switchManAcquire(
                addresses,
                ownerId,
                ownerName,
                &conflicts);

        if (!ok)
        {
            reply(
                false,
                "turnout_locked",
                nullptr,
                &conflicts,
                -1,
                0,
                false,
                false);

            return;
        }

        std::vector<SwitchManLock>
            acquired;

        for (
            uint16_t address :
                addresses)
        {
            const SwitchManLock* item =
                switchManFind(
                    address);

            if (item)
            {
                acquired.push_back(
                    *item);
            }
        }

        broadcastSwitchManSnapshot();

        reply(
            true,
            "",
            &acquired,
            nullptr,
            -1,
            0,
            false,
            false);

        return;
    }

    if (
        action ==
        "release")
    {
        if (
            ownerId.isEmpty())
        {
            reply(
                false,
                "invalid_owner",
                nullptr,
                nullptr,
                -1,
                0,
                false,
                false);

            return;
        }

        std::vector<uint16_t>
            addresses =
                readAddresses();

        const size_t released =
            switchManRelease(
                ownerId,
                addresses.empty()
                    ? nullptr
                    : &addresses);

        reply(
            true,
            "",
            &_switchManLocks,
            nullptr,
            static_cast<int>(
                released),
            0,
            false,
            false);

        return;
    }

    if (
        action ==
        "forceReleaseAll")
    {
        _switchManRevokedOwners.clear();

        for (
            const auto& item :
                _switchManLocks)
        {
            if (
                std::find(
                    _switchManRevokedOwners.begin(),
                    _switchManRevokedOwners.end(),
                    item.ownerId) ==
                _switchManRevokedOwners.end())
            {
                _switchManRevokedOwners.push_back(
                    item.ownerId);
            }
        }

        const int released =
            static_cast<int>(
                _switchManLocks.size());

        _switchManLocks.clear();

        broadcastSwitchManSnapshot();

        reply(
            true,
            "",
            &_switchManLocks,
            nullptr,
            released,
            0,
            false,
            false);

        return;
    }

    if (
        action ==
        "set")
    {
        const int rawAddress =
            data["address"] |
            0;

        if (
            rawAddress <
                1 ||
            rawAddress >
                2048)
        {
            reply(
                false,
                "invalid_turnout_address",
                nullptr,
                nullptr,
                -1,
                0,
                false,
                false);

            return;
        }

        const uint16_t address =
            static_cast<uint16_t>(
                rawAddress);

        RuntimeAccessory* turnout =
            _runtime.findAccessory(
                RuntimeAccessoryKind::
                    Turnout,
                address);

        if (!turnout)
        {
            reply(
                false,
                "turnout_not_found",
                nullptr,
                nullptr,
                -1,
                0,
                false,
                false);

            return;
        }

        if (
            ownerId.isEmpty())
        {
            reply(
                false,
                "invalid_owner",
                nullptr,
                nullptr,
                -1,
                address,
                false,
                false);

            return;
        }

        if (
            !switchManOwns(
                address,
                ownerId))
        {
            std::vector<SwitchManLock>
                conflicts;

            const SwitchManLock* blocking =
                switchManFind(
                    address);

            if (blocking)
            {
                conflicts.push_back(
                    *blocking);
            }

            reply(
                false,
                "turnout_lock_required",
                nullptr,
                &conflicts,
                -1,
                address,
                false,
                false);

            return;
        }

        const bool logicalClosed =
            data["closed"] |
            false;

        const bool physicalValue =
            logicalClosed
                ? turnout->closedValue
                : !turnout->closedValue;

        bool ok =
            false;

        if (
            turnout->turnoutExtended)
        {
            const uint8_t aspect =
                logicalClosed
                    ? turnout
                          ->turnoutClosedAspect
                    : turnout
                          ->turnoutOpenedAspect;

            ok =
                _commandCenter
                    .setSignalAspect(
                        address,
                        aspect);

            if (ok)
            {
                _runtime.setSignal(
                    address,
                    aspect);
            }
        }
        else if (
            turnout->turnoutVPin)
        {
            ok =
                _commandCenter
                    .setVPin(
                        address,
                        physicalValue);

            if (ok)
            {
                _runtime.setVPin(
                    address,
                    physicalValue);
            }
        }
        else
        {
            ok =
                _commandCenter
                    .setTurnout(
                        address,
                        physicalValue);

            if (ok)
            {
                _runtime.setTurnout(
                    address,
                    physicalValue);
            }
        }

        reply(
            ok,
            ok
                ? ""
                : "turnout_command_failed",
            nullptr,
            nullptr,
            -1,
            address,
            true,
            logicalClosed);

        return;
    }

    reply(
        false,
        "unknown_switchman_action",
        nullptr,
        nullptr,
        -1,
        0,
        false,
        false);
}

void WsProtocol::handleEvent(
    AsyncWebSocket *,
    AsyncWebSocketClient *client,
    AwsEventType type,
    void *arg,
    uint8_t *data,
    size_t len)
{
    if (
        type ==
        WS_EVT_CONNECT)
    {
        if (
            _wsClientCount <
            255)
        {
            ++_wsClientCount;
        }

        _nextDccCurrentPollAt =
            0;

        Logger::info(
            "WS client connected #" +
            String(
                client->id()));

        JsonDocument welcome;

        welcome["message"] =
            "DCCExpressHub";

        send(
            client,
            "ws:welcome",
            welcome.as<JsonVariantConst>());

        sendControlStationStatus(
            client);

        sendRuntimeSnapshot(
            client);

        sendSwitchManSnapshot(
            client);

        return;
    }

    if (
        type ==
        WS_EVT_DISCONNECT)
    {
        if (
            _wsClientCount >
            0)
        {
            --_wsClientCount;
        }

        Logger::info(
            "WS client disconnected #" +
            String(
                client->id()));

        if (
            _controlStationOwnerConnectionId ==
            client->id())
        {
            _controlStationOwnerConnectionId =
                0;

            _controlStationOwnerClientId =
                "";

            _controlStationOwnerName =
                "";

            broadcastControlStationStatus();

            Logger::info(
                "Control Station released because owner disconnected");
        }

        return;
    }
    if (
        type !=
        WS_EVT_DATA)
    {
        return;
    }

    AwsFrameInfo *info =
        static_cast<AwsFrameInfo *>(
            arg);

    if (
        !info->final ||
        info->index != 0 ||
        info->len != len ||
        info->opcode !=
            WS_TEXT)
    {
        Logger::warn(
            "Ignoring fragmented/non-text WS message");

        return;
    }

    String payload;

    payload.reserve(
        len +
        1);

    for (
        size_t index = 0;
        index < len;
        ++index)
    {
        payload +=
            static_cast<char>(
                data[index]);
    }

    handleMessage(
        client,
        payload);
}

void WsProtocol::handleMessage(
    AsyncWebSocketClient *client,
    const String &payload)
{
    JsonDocument message;

    const DeserializationError error =
        deserializeJson(
            message,
            payload);

    if (error)
    {
        JsonDocument data;

        data["message"] =
            error.c_str();

        send(
            client,
            "error",
            data.as<JsonVariantConst>());

        return;
    }

    const char *type =
        message["type"] |
        "";

    JsonObjectConst data =
        message["data"];

    auto sendCommandFailure =
        [this, client](
            const char *operation)
    {
        JsonDocument out;

        out["message"] =
            "command_center_send_failed";

        out["operation"] =
            operation;

        send(
            client,
            "error",
            out.as<JsonVariantConst>());
    };

    if (
        strcmp(
            type,
            "controlStationClaim") ==
        0)
    {
        const String requestedClientId =
            data["clientId"] |
            "";

        const String requestedName =
            data["clientName"] |
            "";

        const bool granted =
            _controlStationOwnerConnectionId ==
                0 ||
            _controlStationOwnerConnectionId ==
                client->id();

        if (
            granted)
        {
            _controlStationOwnerConnectionId =
                client->id();

            _controlStationOwnerClientId =
                requestedClientId;

            _controlStationOwnerName =
                requestedName;

            broadcastControlStationStatus();
        }

        JsonDocument response;

        response["granted"] =
            granted;

        response["active"] =
            _controlStationOwnerConnectionId != 0;

        if (
            _controlStationOwnerConnectionId != 0)
        {
            response["ownerClientId"] =
                _controlStationOwnerClientId;

            response["ownerName"] =
                _controlStationOwnerName;
        }
        else
        {
            response["ownerClientId"] =
                nullptr;

            response["ownerName"] =
                nullptr;
        }

        if (
            !granted)
        {
            response["message"] =
                "Another Control Station is already connected.";
        }

        send(
            client,
            "controlStationClaimResult",
            response.as<JsonVariantConst>());

        return;
    }

    if (
        strcmp(
            type,
            "controlStationRelease") ==
        0)
    {
        if (
            _controlStationOwnerConnectionId ==
            client->id())
        {
            _controlStationOwnerConnectionId =
                0;

            _controlStationOwnerClientId =
                "";

            _controlStationOwnerName =
                "";

            broadcastControlStationStatus();
        }
        else
        {
            sendControlStationStatus(
                client);
        }

        return;
    }

    if (
        strcmp(
            type,
            "getControlStationStatus") ==
        0)
    {
        sendControlStationStatus(
            client);

        return;
    }

    if (
        strcmp(
            type,
            "broadcastPlayAudio") ==
        0)
    {
        if (
            _controlStationOwnerConnectionId !=
            client->id())
        {
            JsonDocument denied;

            denied["message"] =
                "control_station_required";

            send(
                client,
                "error",
                denied.as<JsonVariantConst>());

            return;
        }

        const String requestId =
            data["requestId"] |
            "";

        const String fileName =
            data["fileName"] |
            "";

        if (
            requestId.length() ==
                0 ||
            fileName.length() ==
                0 ||
            fileName.length() >
                240)
        {
            JsonDocument invalid;

            invalid["message"] =
                "invalid_audio_broadcast";

            send(
                client,
                "error",
                invalid.as<JsonVariantConst>());

            return;
        }

        JsonDocument out;

        out["requestId"] =
            requestId;

        out["fileName"] =
            fileName;

        broadcast(
            "playAudio",
            out);

        return;
    }

    if (
        strcmp(
            type,
            "broadcastStopAudio") ==
        0)
    {
        if (
            _controlStationOwnerConnectionId !=
            client->id())
        {
            return;
        }

        const String fileName =
            data["fileName"] |
            "";

        if (
            fileName.length() ==
                0 ||
            fileName.length() >
                240)
        {
            return;
        }

        JsonDocument out;

        out["fileName"] =
            fileName;

        broadcast(
            "stopAudio",
            out);

        return;
    }

    if (
        strcmp(
            type,
            "heartbeat") ==
        0)
    {
        JsonDocument empty;

        send(
            client,
            "heartbeatAck",
            empty.as<JsonVariantConst>());

        sendCommandCenterInfo(
            client);

        sendPowerInfo(
            client);

        return;
    }

    if (
        strcmp(
            type,
            "switchManCommand") ==
        0)
    {
        handleSwitchManCommand(
            client,
            data);

        return;
    }

    if (
        strcmp(
            type,
            "fastClockCommand") ==
        0)
    {
        const String requestId =
            data["requestId"] |
            "";

        const String action =
            data["action"] |
            "";

        FastClockSnapshot snapshot;
        bool hasSnapshot =
            true;
        bool changed =
            false;
        bool ok =
            true;

        if (
            action ==
            "snapshot")
        {
            snapshot =
                _fastClock.snapshot();
        }
        else if (
            action ==
            "run")
        {
            snapshot =
                _fastClock.run();

            changed =
                true;
        }
        else if (
            action ==
            "pause")
        {
            snapshot =
                _fastClock.pause();

            changed =
                true;
        }
        else if (
            action ==
            "reset")
        {
            snapshot =
                _fastClock.reset();

            changed =
                true;
        }
        else if (
            action ==
            "setSpeed")
        {
            const double speed =
                data["speed"] |
                1.0;

            snapshot =
                _fastClock.setSpeed(
                    speed);

            changed =
                true;
        }
        else if (
            action ==
            "setTime")
        {
            const double timeMs =
                data["timeMs"] |
                0.0;

            snapshot =
                _fastClock.setTime(
                    timeMs);

            changed =
                true;
        }
        else
        {
            hasSnapshot =
                false;

            ok =
                false;
        }

        if (
            changed)
        {
            JsonDocument changedData;

            appendFastClockSnapshot(
                changedData.to<JsonObject>(),
                snapshot);

            broadcast(
                "fastClockChanged",
                changedData);
        }

        JsonDocument response;

        response["requestId"] =
            requestId;

        response["action"] =
            action;

        response["ok"] =
            ok;

        if (
            hasSnapshot)
        {
            appendFastClockSnapshot(
                response["snapshot"]
                    .to<JsonObject>(),
                snapshot);
        }
        else
        {
            response["message"] =
                "Unknown fast clock command action.";
        }

        send(
            client,
            "fastClockResponse",
            response.as<JsonVariantConst>());

        return;
    }

    if (
        strcmp(
            type,
            "setTrackPower") ==
        0)
    {
        const bool on =
            data["on"] |
            false;

        if (
            !_commandCenter
                 .setTrackPower(
                     on,
                     _powerIncludesProgramming))
        {
            sendCommandFailure(
                "setTrackPower");
        }

        return;
    }

    if (
        strcmp(
            type,
            "setProgrammingPower") ==
        0)
    {
        const bool on =
            data["on"] |
            false;

        if (
            !_commandCenter
                 .setProgrammingPower(
                     on))
        {
            sendCommandFailure(
                "setProgrammingPower");
        }

        return;
    }

    if (
        strcmp(
            type,
            "emergencyStop") ==
        0)
    {
        if (!triggerEmergencyStop())
        {
            sendCommandFailure(
                "emergencyStop");
        }

        return;
    }

    if (
        strcmp(
            type,
            "writeDccExDirectCommand") ==
        0)
    {
        const String command =
            data["command"] |
            "";

        const bool ok =
            _commandCenter
                .supportsRawCommand() &&
            _commandCenter
                .sendRawCommand(
                    command);

        if (ok)
        {
            String normalizedCommand =
                command;

            normalizedCommand.trim();
            normalizedCommand.toUpperCase();

            if (normalizedCommand == "<1 JOIN>")
            {
                beginProgrammingTrackTransition(
                    true);

                _programmingJoined =
                    true;

                _trackPower =
                    true;

                _programmingPower =
                    true;

                broadcastPowerInfo();

                Logger::info(
                    "Programming track joined to MAIN");
            }
            else if (normalizedCommand == "<1 PROG>")
            {
                beginProgrammingTrackTransition(
                    false);

                _programmingJoined =
                    false;

                _programmingPower =
                    true;

                broadcastPowerInfo();

                Logger::info(
                    "Programming track returned to PROG mode");
            }
        }

        JsonDocument out;

        out["response"] =
            ok
                ? "sent"
                : "send failed";

        send(
            client,
            "dccExDirectCommandResponse",
            out.as<JsonVariantConst>());

        return;
    }

    if (
        strcmp(
            type,
            "programmingCommand") ==
        0)
    {
        const String requestId = data["requestId"] | "";
        const String action = data["action"] | "";

        auto failProgramming =
            [this, &requestId, &action](const String& message)
        {
            sendProgrammingResponse(
                requestId,
                action,
                false,
                message);
        };

        if (requestId.isEmpty() || action.isEmpty())
        {
            failProgramming("Invalid programming request.");
            return;
        }

        if (!_commandCenter.connected())
        {
            failProgramming("Command center is not connected.");
            return;
        }

        if (!_commandCenter.supportsRawCommand())
        {
            failProgramming("Decoder programming requires a DCC-EX command center.");
            return;
        }

        if (_pendingProgramming.active)
        {
            failProgramming("Another decoder programming request is already running.");
            return;
        }

        String command;
        int expectedCv = -1;
        bool waitForResponse = true;

        if (action == "readAddress")
        {
            command = "<R>";
        }
        else if (action == "writeAddress")
        {
            const int address = data["address"] | 0;

            if (address <= 0 || address > 10239)
            {
                failProgramming("Invalid locomotive address.");
                return;
            }

            command = "<W " + String(address) + ">";
        }
        else if (action == "readCv")
        {
            const int cv = data["cv"] | 0;

            if (cv <= 0 || cv > 1024)
            {
                failProgramming("Invalid CV number.");
                return;
            }

            expectedCv = cv;
            command = "<R " + String(cv) + ">";
        }
        else if (action == "writeCv")
        {
            const int cv = data["cv"] | 0;
            const int value = data["value"] | -1;

            if (cv <= 0 || cv > 1024 || value < 0 || value > 255)
            {
                failProgramming("Invalid CV number or value.");
                return;
            }

            expectedCv = cv;
            command = "<W " + String(cv) + " " + String(value) + ">";
        }
        else if (action == "pomWriteCv")
        {
            const int address = data["address"] | 0;
            const int cv = data["cv"] | 0;
            const int value = data["value"] | -1;

            if (
                address <= 0 || address > 10239 ||
                cv <= 0 || cv > 1024 ||
                value < 0 || value > 255)
            {
                failProgramming("Invalid POM address, CV or value.");
                return;
            }

            command =
                "<w " +
                String(address) +
                " " +
                String(cv) +
                " " +
                String(value) +
                ">";

            waitForResponse = false;
        }
        else if (action == "accessoryLearn")
        {
            const int address = data["address"] | 0;
            const bool active = data["active"] | false;

            if (address <= 0 || address > 2044)
            {
                failProgramming("Invalid accessory address.");
                return;
            }

            const bool sent =
                _commandCenter.setAccessory(
                    static_cast<uint16_t>(address),
                    active);

            sendProgrammingResponse(
                requestId,
                action,
                sent,
                sent
                    ? "Accessory programming command sent."
                    : "Accessory programming command could not be sent.",
                address);

            return;
        }
        else
        {
            failProgramming("Unsupported programming action.");
            return;
        }

        if (waitForResponse)
        {
            if (_programmingJoined)
            {
                beginProgrammingTrackTransition(
                    false);

                _programmingJoined = false;
                broadcastPowerInfo();
            }

            _pendingProgramming.active = true;
            _pendingProgramming.requestId = requestId;
            _pendingProgramming.action = action;
            _pendingProgramming.expectedCv = expectedCv;
            _pendingProgramming.deadlineAt = millis() + PROGRAMMING_TIMEOUT_MS;
        }

        const bool sent = _commandCenter.sendRawCommand(command);

        if (!sent)
        {
            if (waitForResponse)
            {
                clearPendingProgramming();
            }

            failProgramming("Programming command could not be sent.");
            return;
        }

        Logger::info(
            "Programming command sent: " +
            action +
            " " +
            command);

        if (!waitForResponse)
        {
            sendProgrammingResponse(
                requestId,
                action,
                true,
                "Programming command sent.",
                data["value"] | -1,
                command);
        }

        return;
    }

    if (
        strcmp(
            type,
            "setLoco") ==
        0)
    {
        const uint16_t address =
            data["locoAddress"] |
            0;

        const uint8_t speed =
            min(
                126,
                max(
                    0,
                    data["speed"]
                        .as<int>()));

        const bool forward =
            strcmp(
                data["direction"] |
                    "forward",
                "reverse") != 0;

        auto *loco =
            getLoco(
                address,
                true);

        if (!loco)
        {
            return;
        }

        if (
            !_commandCenter
                 .setLoco(
                     address,
                     speed,
                     forward))
        {
            sendCommandFailure(
                "setLoco");

            return;
        }

        loco->speed =
            speed;

        loco->forward =
            forward;

        broadcastLoco(
            *loco);

        return;
    }

    if (
        strcmp(
            type,
            "getLoco") ==
        0)
    {
        const uint16_t address =
            data["locoAddress"] |
            0;

        if (
            !requestLocoState(
                address,
                false))
        {
            sendCommandFailure(
                "getLoco");
        }

        return;
    }

    if (
        strcmp(
            type,
            "setLocoFunction") ==
        0)
    {
        const uint16_t address =
            data["locoAddress"] |
            0;

        const uint8_t fn =
            data["functionNumber"] |
            0;

        const bool active =
            data["active"] |
            false;

        if (
            fn >
            MAX_LOCO_FUNCTION)
        {
            Logger::warn(
                "Ignoring unsupported loco function F" +
                String(
                    fn));

            return;
        }

        auto *loco =
            getLoco(
                address,
                true);

        if (!loco)
        {
            return;
        }

        if (
            !_commandCenter
                 .setLocoFunction(
                     address,
                     fn,
                     active))
        {
            sendCommandFailure(
                "setLocoFunction");

            return;
        }

        const uint32_t bit =
            1UL << fn;

        if (active)
        {
            loco->functionsMask |=
                bit;
        }
        else
        {
            loco->functionsMask &=
                ~bit;
        }

        broadcastLoco(
            *loco);

        return;
    }

    if (
        strcmp(
            type,
            "setTurnout") ==
        0)
    {
        const uint16_t address =
            data["address"] |
            0;

        const bool physicalValue =
            data["closed"] |
            false;

        RuntimeAccessory* turnout =
            _runtime.findAccessory(
                RuntimeAccessoryKind::Turnout,
                address);

        String manualOwner;

        if (
            turnout &&
            !turnout->turnoutExtended &&
            !turnout->turnoutVPin &&
            !acquireManualTurnoutOperation(
                client,
                address,
                manualOwner))
        {
            return;
        }

        const bool commandOk =
            _commandCenter
                .setTurnout(
                    address,
                    physicalValue);

        if (
            !manualOwner.isEmpty())
        {
            std::vector<uint16_t>
                addresses{
                    address
                };

            switchManRelease(
                manualOwner,
                &addresses);
        }

        if (!commandOk)
        {
            sendCommandFailure(
                "setTurnout");

            return;
        }

        // Runtime and UI follow the command only after the command center
        // accepted the operation.
        _runtime.setTurnout(
            address,
            physicalValue);

        JsonDocument out;

        out["address"] =
            address;

        out["closed"] =
            physicalValue;

        broadcast(
            "turnoutChanged",
            out);

        // A normal turnout command is physically a Basic Accessory command.
        // Mirror the physical endpoint as accessoryChanged as well so generic
        // Basic Accessory consumers (including Flow inputs) receive the same
        // accepted state change.
        JsonDocument accessory;

        accessory["address"] =
            address;

        accessory["active"] =
            physicalValue;

        broadcast(
            "accessoryChanged",
            accessory);

        return;
    }

    if (
        strcmp(
            type,
            "setSignalAspect") ==
        0)
    {
        const uint16_t address =
            data["address"] |
            0;

        const int aspect =
            data["aspect"] |
            0;

        RuntimeAccessory* turnout =
            _runtime.findAccessory(
                RuntimeAccessoryKind::Turnout,
                address);

        String manualOwner;

        if (
            turnout &&
            turnout->turnoutExtended &&
            !acquireManualTurnoutOperation(
                client,
                address,
                manualOwner))
        {
            return;
        }

        const bool commandOk =
            _commandCenter
                .setSignalAspect(
                    address,
                    aspect);

        if (
            !manualOwner.isEmpty())
        {
            std::vector<uint16_t>
                addresses{
                    address
                };

            switchManRelease(
                manualOwner,
                &addresses);
        }

        if (!commandOk)
        {
            sendCommandFailure(
                "setSignalAspect");

            return;
        }

        _runtime.setSignal(
            address,
            aspect);

        JsonDocument out;

        out["address"] =
            address;

        out["aspect"] =
            aspect;

        broadcast(
            "signalAspectChanged",
            out);

        if (
            !data["turnoutPhysicalValue"]
                 .isNull())
        {
            const bool physicalValue =
                data["turnoutPhysicalValue"]
                    .as<bool>();

            _runtime.setTurnout(
                address,
                physicalValue);

            JsonDocument turnout;

            turnout["address"] =
                address;

            turnout["closed"] =
                physicalValue;

            broadcast(
                "turnoutChanged",
                turnout);
        }

        return;
    }

    if (
        strcmp(
            type,
            "setBasicAccessory") ==
        0)
    {
        const uint16_t address =
            data["address"] |
            0;

        const bool active =
            data["active"] |
            false;

        RuntimeAccessory* turnout =
            _runtime.findAccessory(
                RuntimeAccessoryKind::Turnout,
                address);

        String manualOwner;

        if (
            turnout &&
            !turnout->turnoutExtended &&
            !turnout->turnoutVPin &&
            !acquireManualTurnoutOperation(
                client,
                address,
                manualOwner))
        {
            return;
        }

        const bool commandOk =
            _commandCenter
                .setAccessory(
                    address,
                    active);

        if (
            !manualOwner.isEmpty())
        {
            std::vector<uint16_t>
                addresses{
                    address
                };

            switchManRelease(
                manualOwner,
                &addresses);
        }

        if (!commandOk)
        {
            sendCommandFailure(
                "setBasicAccessory");

            return;
        }

        _runtime.setAccessory(
            address,
            active);

        JsonDocument out;

        out["address"] =
            address;

        out["active"] =
            active;

        broadcast(
            "accessoryChanged",
            out);

        return;
    }

    if (
        strcmp(
            type,
            "setVpin") ==
        0)
    {
        const uint16_t vpin =
            data["vpin"] |
            0;

        const bool active =
            data["active"] |
            false;

        RuntimeAccessory* turnout =
            _runtime.findAccessory(
                RuntimeAccessoryKind::Turnout,
                vpin);

        String manualOwner;

        if (
            turnout &&
            turnout->turnoutVPin &&
            !acquireManualTurnoutOperation(
                client,
                vpin,
                manualOwner))
        {
            return;
        }

        const bool commandOk =
            _commandCenter
                .setVPin(
                    vpin,
                    active);

        if (
            !manualOwner.isEmpty())
        {
            std::vector<uint16_t>
                addresses{
                    vpin
                };

            switchManRelease(
                manualOwner,
                &addresses);
        }

        if (!commandOk)
        {
            sendCommandFailure(
                "setVpin");

            return;
        }

        _runtime.setVPin(
            vpin,
            active);

        JsonDocument out;

        out["vpin"] =
            vpin;

        out["active"] =
            active;

        broadcast(
            "vpinChanged",
            out);

        return;
    }

    if (
        strcmp(
            type,
            "setSensor") ==
        0)
    {
        const uint16_t address =
            data["address"] |
            0;

        const bool on =
            data["on"] |
            false;

        _runtime.setSensor(
            address,
            on);

        JsonDocument out;

        out["address"] =
            address;

        out["on"] =
            on;

        broadcast(
            "sensorChanged",
            out);

        return;
    }

    if (
        strcmp(
            type,
            "setBlock") ==
        0)
    {
        const uint16_t blockId =
            parseBlockId(
                data["blockId"]);

        const String locoId =
            data["locoId"]
                    .isNull()
                ? String()
                : String(
                      data["locoId"]
                          .as<const char *>());

        const long addressValue =
            data["locoAddress"] |
            0L;

        const uint16_t locoAddress =
            addressValue > 0 &&
                    addressValue <= 10239
                ? static_cast<uint16_t>(
                      addressValue)
                : 0;

        if (
            !blockId ||
            (locoId.isEmpty() &&
             locoAddress == 0) ||
            !_runtime.setBlock(
                blockId,
                locoId,
                locoAddress))
        {
            JsonDocument out;

            out["message"] =
                "invalid_block_assignment";

            send(
                client,
                "error",
                out.as<JsonVariantConst>());
        }

        return;
    }

    if (
        strcmp(
            type,
            "setBlockRemove") ==
        0)
    {
        const uint16_t blockId =
            parseBlockId(
                data["blockId"]);

        const String locoId =
            data["locoId"]
                    .isNull()
                ? String()
                : String(
                      data["locoId"]
                          .as<const char *>());

        if (
            !blockId ||
            !_runtime.removeBlock(
                blockId,
                locoId))
        {
            JsonDocument out;

            out["message"] =
                "invalid_block_remove";

            send(
                client,
                "error",
                out.as<JsonVariantConst>());
        }

        return;
    }

    if (
        strcmp(
            type,
            "setBlocksReset") ==
        0)
    {
        _runtime.clearBlocks();
        return;
    }

    if (
        strcmp(
            type,
            "getBlocks") ==
        0)
    {
        sendBlockStateSnapshot(
            client);

        return;
    }

    if (
        strcmp(
            type,
            "getLayoutRuntimeSnapshot") ==
        0)
    {
        sendRuntimeSnapshot(
            client);

        return;
    }

    JsonDocument ack;

    ack["ok"] =
        true;

    ack["message"] =
        String(
            "Not implemented yet: ") +
        type;

    send(
        client,
        "ack",
        ack.as<JsonVariantConst>());
}
