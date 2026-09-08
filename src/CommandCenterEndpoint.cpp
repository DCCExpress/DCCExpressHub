#include "CommandCenterEndpoint.h"

#include <ESPmDNS.h>
#include <WiFi.h>
#include <WiFiUdp.h>

namespace {

bool isZeroAddress(
    const IPAddress& address) {
  return address ==
         IPAddress(
             0,
             0,
             0,
             0);
}

uint16_t readLe16(
    const uint8_t* data) {
  return
      static_cast<uint16_t>(
          data[0]) |
      (
          static_cast<uint16_t>(
              data[1]) <<
          8
      );
}

CommandCenterProbeResult probeZ21Endpoint(
    const String& host,
    uint16_t port,
    uint32_t resolveTimeoutMs,
    uint32_t totalTimeoutMs) {
  CommandCenterProbeResult result;

  const unsigned long started =
      millis();

  IPAddress resolved;

  if (
      !resolveCommandCenterHost(
          host,
          resolved,
          resolveTimeoutMs)
  ) {
    result.elapsedMs =
        millis() -
        started;

    return result;
  }

  result.resolved =
      true;

  result.resolvedAddress =
      resolved;

  WiFiUDP udp;

  // Dedicated temporary local probe port so the live Z21CommandCenter can
  // remain bound to its own client port at the same time.
  if (!udp.begin(21107)) {
    result.elapsedMs =
        millis() -
        started;

    return result;
  }

  // LAN_SYSTEMSTATE_GETDATA:
  // DataLen=4, Header=0x0085, no data.
  const uint8_t request[] = {
      0x04,
      0x00,
      0x85,
      0x00};

  if (
      !udp.beginPacket(
          resolved,
          port) ||
      udp.write(
          request,
          sizeof(
              request)) !=
          sizeof(
              request) ||
      udp.endPacket() !=
          1
  ) {
    udp.stop();

    result.elapsedMs =
        millis() -
        started;

    return result;
  }

  while (
      millis() -
          started <
      totalTimeoutMs
  ) {
    const int packetSize =
        udp.parsePacket();

    if (
        packetSize >
        0
    ) {
      uint8_t buffer[64] = {};

      const int read =
          udp.read(
              buffer,
              min(
                  packetSize,
                  static_cast<int>(
                      sizeof(
                          buffer))));

      if (
          read >= 4
      ) {
        size_t offset =
            0;

        while (
            offset +
                4 <=
            static_cast<size_t>(
                read)
        ) {
          const uint16_t dataLen =
              readLe16(
                  buffer +
                  offset);

          if (
              dataLen < 4 ||
              offset +
                  dataLen >
                  static_cast<size_t>(
                      read)
          ) {
            break;
          }

          const uint16_t header =
              readLe16(
                  buffer +
                  offset +
                  2);

          if (
              header ==
              0x0084
          ) {
            result.tcpConnected =
                true;

            result.dccExAlive =
                true;

            result.reply =
                "Z21 LAN system-state reply";

            result.elapsedMs =
                millis() -
                started;

            udp.stop();

            return result;
          }

          offset +=
              dataLen;
        }
      }
    }

    delay(1);
  }

  result.elapsedMs =
      millis() -
      started;

  udp.stop();

  return result;
}

}

bool resolveCommandCenterHost(
    const String& host,
    IPAddress& address,
    uint32_t timeoutMs) {
  String cleanHost =
      host;

  cleanHost.trim();

  if (
      cleanHost.isEmpty()
  ) {
    return false;
  }

  if (
      address.fromString(
          cleanHost)
  ) {
    return true;
  }

  if (
      cleanHost.endsWith(
          ".local")
  ) {
    const String mdnsHost =
        cleanHost.substring(
            0,
            cleanHost.length() -
                6);

    if (
        mdnsHost.isEmpty()
    ) {
      return false;
    }

    address =
        MDNS.queryHost(
            mdnsHost.c_str(),
            timeoutMs);

    return
        !isZeroAddress(
            address);
  }

  return
      WiFi.hostByName(
          cleanHost.c_str(),
          address) ==
          1 &&
      !isZeroAddress(
          address);
}

bool connectCommandCenterClient(
    WiFiClient& client,
    const String& host,
    uint16_t port,
    uint32_t timeoutMs,
    IPAddress* resolvedAddress) {
  IPAddress address;

  if (
      !resolveCommandCenterHost(
          host,
          address,
          timeoutMs)
  ) {
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
  if (
      port == 21105 ||
      port == 21106
  ) {
    return probeZ21Endpoint(
        host,
        port,
        connectTimeoutMs,
        totalTimeoutMs);
  }

  CommandCenterProbeResult result;

  const unsigned long started =
      millis();

  IPAddress resolved;

  if (
      !resolveCommandCenterHost(
          host,
          resolved,
          connectTimeoutMs)
  ) {
    result.elapsedMs =
        millis() -
        started;

    return result;
  }

  result.resolved =
      true;

  result.resolvedAddress =
      resolved;

  WiFiClient probe;

  if (
      !probe.connect(
          resolved,
          port,
          connectTimeoutMs)
  ) {
    result.elapsedMs =
        millis() -
        started;

    return result;
  }

  result.tcpConnected =
      true;

  probe.setNoDelay(
      true);

  probe.print(
      "<#>");

  bool insideFrame =
      false;

  String frame;

  frame.reserve(
      64);

  while (
      millis() -
          started <
      totalTimeoutMs
  ) {
    while (
        probe.available()
    ) {
      const char c =
          static_cast<char>(
              probe.read());

      if (!insideFrame) {
        if (
            c == '<'
        ) {
          insideFrame =
              true;

          frame =
              "<";
        }

        continue;
      }

      if (
          c == '<'
      ) {
        frame =
            "<";

        continue;
      }

      frame +=
          c;

      if (
          c == '>'
      ) {
        insideFrame =
            false;

        result.reply =
            frame;

        if (
            frame.startsWith(
                "<#")
        ) {
          result.dccExAlive =
              true;

          result.elapsedMs =
              millis() -
              started;

          probe.stop();

          return result;
        }

        frame.clear();
      }

      if (
          frame.length() >
          128
      ) {
        insideFrame =
            false;

        frame.clear();
      }
    }

    if (
        !probe.connected() &&
        !probe.available()
    ) {
      break;
    }

    delay(1);
  }

  result.elapsedMs =
      millis() -
      started;

  probe.stop();

  return result;
}
