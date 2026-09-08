#pragma once

#include <Arduino.h>
#include <WiFiClient.h>

struct CommandCenterProbeResult {
  bool resolved = false;
  IPAddress resolvedAddress;

  // Compatibility names used by the existing API/frontend.
  // For Z21 probes these indicate transport/session reachability even though
  // the transport is UDP rather than TCP.
  bool tcpConnected = false;
  bool dccExAlive = false;

  String reply;
  unsigned long elapsedMs = 0;
};

bool resolveCommandCenterHost(
    const String& host,
    IPAddress& address,
    uint32_t timeoutMs = 1200);

bool connectCommandCenterClient(
    WiFiClient& client,
    const String& host,
    uint16_t port,
    uint32_t timeoutMs = 1200,
    IPAddress* resolvedAddress = nullptr);

// Backward-compatible entry point used by the current API/serial tooling.
// Ports 21105/21106 are probed as Z21 UDP; other ports use DCC-EX TCP.
CommandCenterProbeResult probeDccExEndpoint(
    const String& host,
    uint16_t port,
    uint32_t connectTimeoutMs = 1200,
    uint32_t totalTimeoutMs = 2200);
