#pragma once

#include <Arduino.h>

#if defined(HUB_CC_DCCEX) && defined(HUB_CC_Z21)
#error "Define only one command center build: HUB_CC_DCCEX or HUB_CC_Z21"
#endif

#if !defined(HUB_CC_DCCEX) && !defined(HUB_CC_Z21)
#error "Define one command center build: HUB_CC_DCCEX or HUB_CC_Z21"
#endif

namespace CommandCenterBuild {

inline const char* type() {
#if defined(HUB_CC_DCCEX)
  return "dcc-ex";
#else
  return "z21";
#endif
}

inline const char* name() {
#if defined(HUB_CC_DCCEX)
  return "DCC-EX";
#else
  return "Roco Z21";
#endif
}

inline uint16_t defaultPort() {
#if defined(HUB_CC_DCCEX)
  return 2560;
#else
  return 21105;
#endif
}

inline bool isDccEx() {
#if defined(HUB_CC_DCCEX)
  return true;
#else
  return false;
#endif
}

inline bool isZ21() {
#if defined(HUB_CC_Z21)
  return true;
#else
  return false;
#endif
}

}
