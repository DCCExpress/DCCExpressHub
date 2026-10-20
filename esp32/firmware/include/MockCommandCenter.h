#pragma once
#include "ICommandCenter.h"

class MockCommandCenter final : public ICommandCenter {
public:
  const char* name() const override { return "Mock"; }
  bool begin() override { return true; }
  void loop() override {}
  bool connected() override { return true; }
  bool sendAccessory(uint16_t address, bool rawValue) override {
    // In the mock, the physical device instantly reports its value.
    if (feedback_) feedback_(context_, address, rawValue);
    return true;
  }
  void onAccessoryFeedback(FeedbackCallback cb, void* ctx) override {
    feedback_ = cb; context_ = ctx;
  }
private:
  FeedbackCallback feedback_ = nullptr;
  void* context_ = nullptr;
};
