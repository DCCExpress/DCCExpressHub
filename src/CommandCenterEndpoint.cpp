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
