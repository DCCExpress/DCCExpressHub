#pragma once

#include <Arduino.h>
#include <WiFiClient.h>

struct CommandCenterProbeResult {
  bool resolved = false;
  IPAddress resolvedAddress;

  // Legacy frontend/API field names retained for compatibility.
  // In a Z21 firmware these mean transport/session reachability.
  bool tcpConnected = false;
  bool dccExAlive = false;

  String reply;
  unsigned long elapsedMs = 0;
};

bool resolveCommandCenterHost(
    const String& host,
    IPAddress& address,
    uint32_t timeoutMs = 1200);

#if defined(HUB_CC_DCCEX)
bool connectCommandCenterClient(
    WiFiClient& client,
    const String& host,
    uint16_t port,
    uint32_t timeoutMs = 1200,
    IPAddress* resolvedAddress = nullptr);
#endif

// Compatibility entry point used by ApiServer and SerialConfigurator.
// Its implementation is selected at compile time:
//   HUB_CC_DCCEX -> TCP / <#>
//   HUB_CC_Z21   -> UDP / LAN_SYSTEMSTATE_GETDATA
CommandCenterProbeResult probeDccExEndpoint(
    const String& host,
    uint16_t port,
    uint32_t connectTimeoutMs = 1200,
    uint32_t totalTimeoutMs = 2200);
