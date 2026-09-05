#pragma once

#include <Arduino.h>
#include <WiFiClient.h>

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
