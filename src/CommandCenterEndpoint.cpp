#include "CommandCenterEndpoint.h"

#include <ESPmDNS.h>
#include <WiFi.h>

namespace {
bool isZeroAddress(
    const IPAddress& address) {
  return address ==
         IPAddress(0, 0, 0, 0);
}
}

bool resolveCommandCenterHost(
    const String& host,
    IPAddress& address,
    uint32_t timeoutMs) {
  String cleanHost = host;
  cleanHost.trim();

  if (cleanHost.isEmpty()) {
    return false;
  }

  if (address.fromString(cleanHost)) {
    return true;
  }

  if (cleanHost.endsWith(".local")) {
    const String mdnsHost =
        cleanHost.substring(
            0,
            cleanHost.length() - 6);

    if (mdnsHost.isEmpty()) {
      return false;
    }

    address =
        MDNS.queryHost(
            mdnsHost.c_str(),
            timeoutMs);

    return !isZeroAddress(address);
  }

  return WiFi.hostByName(
             cleanHost.c_str(),
             address) == 1 &&
         !isZeroAddress(address);
}

bool connectCommandCenterClient(
    WiFiClient& client,
    const String& host,
    uint16_t port,
    uint32_t timeoutMs,
    IPAddress* resolvedAddress) {
  IPAddress address;

  if (!resolveCommandCenterHost(
          host,
          address,
          timeoutMs)) {
    return false;
  }

  if (resolvedAddress) {
    *resolvedAddress =
        address;
  }

  return client.connect(
      address,
      port,
      timeoutMs);
}

CommandCenterProbeResult probeDccExEndpoint(
    const String& host,
    uint16_t port,
    uint32_t connectTimeoutMs,
    uint32_t totalTimeoutMs) {
  CommandCenterProbeResult result;

  const unsigned long started =
      millis();

  IPAddress resolved;

  if (!resolveCommandCenterHost(
          host,
          resolved,
          connectTimeoutMs)) {
    result.elapsedMs =
        millis() - started;
    return result;
  }

  result.resolved = true;
  result.resolvedAddress =
      resolved;

  WiFiClient probe;

  if (!probe.connect(
          resolved,
          port,
          connectTimeoutMs)) {
    result.elapsedMs =
        millis() - started;
    return result;
  }

  result.tcpConnected = true;

  probe.setNoDelay(true);
  probe.print("<#>");

  bool insideFrame = false;
  String frame;
  frame.reserve(64);

  while (
      millis() - started <
      totalTimeoutMs) {
    while (probe.available()) {
      const char c =
          static_cast<char>(
              probe.read());

      if (!insideFrame) {
        if (c == '<') {
          insideFrame = true;
          frame = "<";
        }

        continue;
      }

      if (c == '<') {
        frame = "<";
        continue;
      }

      frame += c;

      if (c == '>') {
        insideFrame = false;
        result.reply = frame;

        if (frame.startsWith("<#")) {
          result.dccExAlive = true;
          result.elapsedMs =
              millis() - started;

          probe.stop();
          return result;
        }

        frame.clear();
      }

      if (frame.length() > 128) {
        insideFrame = false;
        frame.clear();
      }
    }

    if (!probe.connected() &&
        !probe.available()) {
      break;
    }

    delay(1);
  }

  result.elapsedMs =
      millis() - started;

  probe.stop();
  return result;
}
