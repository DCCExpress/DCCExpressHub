#include "YaMoRcZ21CommandCenter.h"

#include "Logger.h"

void YaMoRcZ21CommandCenter::begin(const String& host, uint16_t port) {
  _locoNet.configure(host);
  _locoNetStarted = false;
  Z21CommandCenter::begin(host, port);
}

void YaMoRcZ21CommandCenter::setEndpoint(const String& host, uint16_t port) {
  stopLocoNet();
  _locoNet.configure(host);
  Z21CommandCenter::setEndpoint(host, port);
}

void YaMoRcZ21CommandCenter::stopLocoNet() {
  if (!_locoNetStarted) {
    return;
  }
  _locoNet.stop();
  _locoNetStarted = false;
  Logger::info("YaMoRC LocoNet STOP");
}

void YaMoRcZ21CommandCenter::loop() {
  // Z21 is always authoritative and always runs first.
  Z21CommandCenter::loop();
  if (!Z21CommandCenter::connected() || !z21SystemStateSeen()) {
    stopLocoNet();
    return;
  }
  const unsigned long readyAt = z21SystemStateSeenAt();
  if (!_locoNetStarted && readyAt != 0 && millis() - readyAt >= LOCONET_START_DELAY_MS) {
    Logger::info("YaMoRC Z21 bootstrap complete; starting LocoNet");
    _locoNet.start();
    _locoNetStarted = true;
  }
  if (_locoNetStarted) {
    _locoNet.loop();
  }
}

void YaMoRcZ21CommandCenter::onStationInfo(StationInfoCallback callback) {
  Z21CommandCenter::onStationInfo(
      [callback = std::move(callback)](const CommandCenterStationInfo& baseInfo) {
        if (!callback) {
          return;
        }
        CommandCenterStationInfo info = baseInfo;
        info.hardware = "YD7010";
        info.processor = "Z21 LAN + LocoNet";
        callback(info);
      });
}

void YaMoRcZ21CommandCenter::onSensorFeedback(SensorFeedbackCallback callback) {
  // R-BUS feedback coming through Z21 UDP and LocoNet feedback both feed the
  // same authoritative runtime callback. LayoutRuntime de-duplicates state.
  Z21CommandCenter::onSensorFeedback(callback);
  _locoNet.onSensorFeedback(std::move(callback));
}

void YaMoRcZ21CommandCenter::onSensorSnapshotComplete(SensorSnapshotCompleteCallback callback) {
  // Z21/R-BUS and LocoNet each finish their own initial sensor batch. Both
  // completion events publish the same consolidated runtime snapshot.
  Z21CommandCenter::onSensorSnapshotComplete(callback);
  _locoNet.onSensorSnapshotComplete(std::move(callback));
}

bool YaMoRcZ21CommandCenter::requestSensorSnapshot(bool logCommand) {
  const bool rbusRequested = requestRBusSnapshot(logCommand);
  const bool locoNetRequested = _locoNetStarted && _locoNet.requestSensorSnapshot(true);
  return rbusRequested || locoNetRequested;
}
