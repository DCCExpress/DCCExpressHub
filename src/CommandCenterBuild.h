#pragma once

#include <Arduino.h>

#if (defined(HUB_CC_DCCEX) ? 1 : 0) + (defined(HUB_CC_Z21) ? 1 : 0) + (defined(HUB_CC_YAMORC7010) ? 1 : 0) != 1
#error "Define exactly one command center build: HUB_CC_DCCEX, HUB_CC_Z21 or HUB_CC_YAMORC7010"
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
#elif defined(HUB_CC_YAMORC7010)
  return "YD7010";
#else
  return "Z21";
#endif
}

inline const char* profile() {
#if defined(HUB_CC_YAMORC7010)
  return "yamorc7010";
#elif defined(HUB_CC_Z21)
  return "z21";
#else
  return "dcc-ex";
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
#if defined(HUB_CC_Z21) || defined(HUB_CC_YAMORC7010)
  return true;
#else
  return false;
#endif
}

inline bool isYaMoRc7010() {
#if defined(HUB_CC_YAMORC7010)
  return true;
#else
  return false;
#endif
}

}
