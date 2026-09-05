#pragma once

#include <Arduino.h>
#include <WiFiClient.h>

struct CommandCenterProbeResult {
  bool resolved = false;
  IPAddress resolvedAddress;

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

CommandCenterProbeResult probeDccExEndpoint(
    const String& host,
    uint16_t port,
    uint32_t connectTimeoutMs = 1200,
    uint32_t totalTimeoutMs = 2200);
