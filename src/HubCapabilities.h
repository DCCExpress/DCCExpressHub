#pragma once

#include "CommandCenterCapabilities.h"

#ifndef HUB_JS_SANDBOX
#define HUB_JS_SANDBOX 0
#endif

class HubCapabilities {
public:
  static constexpr bool javascriptAutomation() {
#if HUB_JS_SANDBOX
    return true;
#else
    return false;
#endif
  }

  static constexpr bool fileManager() {
    return true;
  }

  static constexpr bool deviceConfiguration() {
    return true;
  }

  static constexpr bool gamepad() {
    return true;
  }

  static bool programmingTrack() {
    // This capability controls whether the decoder Programming UI is
    // available. Z21 service-mode CV programming is supported even though
    // Z21 does not expose DCC-EX's separate PROG power toggle abstraction.
    return
        CommandCenterCapabilities::
            serviceModeProgramming();
  }
};
