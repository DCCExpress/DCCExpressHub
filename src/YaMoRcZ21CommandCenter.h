#pragma once

#include "LocoNetClient.h"
#include "Z21CommandCenter.h"

class YaMoRcZ21CommandCenter
    : public Z21CommandCenter {
public:
  void begin(
      const String& host,
      uint16_t port) override;

  void loop() override;

  void setEndpoint(
      const String& host,
      uint16_t port) override;

  const char* name() const override {
    return "YD7010";
  }

  const char* feedbackLinkName() const override {
    return "LocoNet";
  }

  bool feedbackLinkConnected() const override {
    return _locoNet.connected();
  }

  void onStationInfo(
      StationInfoCallback callback) override;

  void onSensorFeedback(
      SensorFeedbackCallback callback) override;

  void onSensorSnapshotComplete(
      SensorSnapshotCompleteCallback callback) override;

  bool requestSensorSnapshot(
      bool logCommand = false) override;

protected:
  uint32_t broadcastFlags() const override {
    // Driving/switching + R-BUS + system state + changed locomotives.
    // LocoNet feedback is owned exclusively by LocoNetClient.
    return 0x00010103UL;
  }

private:
  static constexpr unsigned long
      LOCONET_START_DELAY_MS = 3000;

  LocoNetClient _locoNet;
  bool _locoNetStarted = false;

  void stopLocoNet();
};
