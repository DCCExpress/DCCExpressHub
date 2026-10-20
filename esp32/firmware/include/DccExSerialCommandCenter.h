#pragma once
#include "ICommandCenter.h"

// Uses a dedicated 3.3 V UART. Do NOT connect RS232 voltage directly.
// For DCC-EX USB-serial devices, a USB-host transport is a separate task.
class DccExSerialCommandCenter final : public ICommandCenter {
public:
  DccExSerialCommandCenter(HardwareSerial& serial, int rxPin, int txPin,
                           uint32_t baud=115200)
    : serial_(serial), rxPin_(rxPin), txPin_(txPin), baud_(baud) {}

  const char* name() const override { return "DCC-EX Serial"; }

  bool begin() override {
    serial_.begin(baud_, SERIAL_8N1, rxPin_, txPin_);
    // UART availability does not guarantee that a command station responds.
    started_ = true;
    lastStatusRequest_ = millis();
    serial_.print("<s>\n");
    return true;
  }

  bool connected() const override {
    return started_ && seenStatus_ && (uint32_t)(millis()-lastStatusReply_)<10000;
  }

  void loop() override {
    while (serial_.available() > 0) {
      char ch = (char)serial_.read();
      if (ch == '<') { receiving_ = true; len_ = 0; }
      else if (ch == '>' && receiving_) {
        frame_[len_] = 0;
        parseFrame(frame_);
        receiving_ = false;
        len_ = 0;
      } else if (receiving_) {
        if (len_+1 < sizeof(frame_)) frame_[len_++] = ch;
        else { receiving_ = false; len_ = 0; }
      }
    }
    // Status probe every 3s. A reply demonstrates that the remote exists.
    if ((uint32_t)(millis()-lastStatusRequest_) >= 3000) {
      serial_.print("<s>\n");
      lastStatusRequest_ = millis();
    }
  }

  bool sendAccessory(uint16_t address, bool rawValue) override {
    if (!connected() || address == 0 || address > 2044) return false;
    // DCC-EX linear-address accessory command.
    // <a LINEAR_ADDRESS ACTIVATE>. This is NOT a retained turnout state.
    char output[26];
    const int n = snprintf(output, sizeof(output), "<a %u %u>\n",
      (unsigned)address, rawValue ? 1u : 0u);
    if (n <= 0 || (size_t)n >= sizeof(output)) return false;
    if (serial_.availableForWrite() < n) return false;
    return serial_.write((const uint8_t*)output, (size_t)n) == (size_t)n;
  }

  void onAccessoryFeedback(FeedbackCallback cb, void* ctx) override {
    callback_ = cb;
    context_ = ctx;
  }

private:
  HardwareSerial& serial_;
  int rxPin_, txPin_;
  uint32_t baud_;
  bool started_ = false;
  bool seenStatus_ = false;
  bool receiving_ = false;
  uint32_t lastStatusRequest_ = 0;
  uint32_t lastStatusReply_ = 0;
  size_t len_ = 0;
  char frame_[160]{};
  FeedbackCallback callback_ = nullptr;
  void* context_ = nullptr;

  void parseFrame(const char* frame) {
    // <s> gives <i ...> info, <p...> power, and possibly <l...>/<H...>.
    // A power/info frame counts as proof the station responded.
    if (frame[0]=='i' || frame[0]=='p') {
      seenStatus_ = true;
      lastStatusReply_ = millis();
    }
    // Deliberately do not turn <O>, <H> or <X> into accessory raw
    // feedback. Those are acknowledgements/turnout state records, not
    // proof of the physical accessory output.
    Serial.printf("[DCC-EX RX] <%s>\n", frame);
  }
};
