#pragma once

#include "CommandCenterBuild.h"

#if defined(HUB_CC_DCCEX)

#include "DccExBridge.h"

using CompiledCommandCenter =
    DccExBridge;

#elif defined(HUB_CC_Z21)

#include "Z21CommandCenter.h"

// The Z21 firmware intentionally exposes only operations that have a safe,
// well-defined Z21 equivalent.
//
// In particular, DCCExpressHub's current "programming power" abstraction is
// DCC-EX-specific. It must never be translated into a MAIN-track power-on
// operation merely because a caller sends setProgrammingPower(false).
//
// Keeping these guards in the concrete compile-time wrapper means they also
// protect non-UI callers (WebSocket clients, scripts, future API clients).
class CompiledCommandCenter final
    : public Z21CommandCenter {
public:
  bool setProgrammingPower(
      bool) override {
    return false;
  }

  bool setVPin(
      uint16_t,
      bool) override {
    return false;
  }

  bool supportsRawCommand() const override {
    return false;
  }

  bool sendRawCommand(
      String,
      bool = true) override {
    return false;
  }
};

#else

#error "No command center firmware selected"

#endif
