#pragma once

#include "CommandCenterBuild.h"

namespace CommandCenterCapabilities {

inline bool programmingTrackPower() {
#if defined(HUB_CC_DCCEX)
  return true;
#else
  return false;
#endif
}

inline bool rawCommand() {
#if defined(HUB_CC_DCCEX)
  return true;
#else
  return false;
#endif
}

inline bool vPin() {
#if defined(HUB_CC_DCCEX)
  return true;
#else
  return false;
#endif
}

inline bool extendedAccessory() {
  return true;
}

inline bool currentTelemetry() {
  return true;
}

inline bool trackConfiguration() {
  return true;
}

inline bool locomotiveControl() {
  return true;
}

inline bool locomotiveFunctions() {
  return true;
}

inline bool turnoutControl() {
  return true;
}

inline bool basicAccessory() {
  return true;
}

inline bool signalAspect() {
  return true;
}

}
