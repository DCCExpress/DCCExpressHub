#include "HubConfigStore.h"

#include "config.h"

#ifndef DEFAULT_HUB_HTTP_PORT
#define DEFAULT_HUB_HTTP_PORT 80
#endif

namespace {

String defaultWifiSsid() {
#ifdef WIFI_SSID
  return String(WIFI_SSID);
#else
  return String();
#endif
}

String defaultWifiPassword() {
#ifdef WIFI_PASSWORD
  return String(WIFI_PASSWORD);
#else
  return String();
#endif
}

String defaultHubHostname() {
#ifdef DEVICE_HOSTNAME
  return String(DEVICE_HOSTNAME);
#else
  return String("dcc-express-hub");
#endif
}

}

void HubConfigStore::begin() {
  _prefs.begin(
      "dcchub",
      false);

  loadNetwork();
  loadCommandCenter();
}

void HubConfigStore::loadNetwork() {
  _network.wifiSsid =
      _prefs.getString(
          "wifiSsid",
          defaultWifiSsid());

  _network.wifiPassword =
      _prefs.getString(
          "wifiPass",
          defaultWifiPassword());

  _network.hostname =
      _prefs.getString(
          "hubHost",
          defaultHubHostname());

  _network.dhcp =
      _prefs.getBool(
          "netDhcp",
          true);

  _network.ip =
      _prefs.getString(
          "netIp",
          "");

  _network.gateway =
      _prefs.getString(
          "netGw",
          "");

  _network.subnet =
      _prefs.getString(
          "netMask",
          "255.255.255.0");

  _network.dns1 =
      _prefs.getString(
          "netDns1",
          "");

  _network.dns2 =
      _prefs.getString(
          "netDns2",
          "");

  _network.httpPort =
      _prefs.getUShort(
          "httpPort",
          DEFAULT_HUB_HTTP_PORT);

  if (_network.httpPort == 0) {
    _network.httpPort =
        DEFAULT_HUB_HTTP_PORT;
  }
}

void HubConfigStore::loadCommandCenter() {
  _commandCenter.type =
      _prefs.getString(
          "csbType",
          "dcc-ex");

  _commandCenter.type.trim();
  _commandCenter.type.toLowerCase();

  if (_commandCenter.type.isEmpty()) {
    _commandCenter.type =
        "dcc-ex";
  }

  _commandCenter.host =
      _prefs.getString(
          "csbHost",
          DEFAULT_CSB1_HOST);

  _commandCenter.port =
      _prefs.getUShort(
          "csbPort",
          DEFAULT_CSB1_PORT);

  if (_commandCenter.port == 0) {
    _commandCenter.port =
        DEFAULT_CSB1_PORT;
  }

  // Backward-compatible protocol selection for the existing config UI.
  // Official Z21 LAN ports are 21105/21106; DCC-EX defaults to 2560.
  if (
      _commandCenter.port == 21105 ||
      _commandCenter.port == 21106
  ) {
    _commandCenter.type =
        "z21";
  } else if (
      _commandCenter.port == 2560
  ) {
    _commandCenter.type =
        "dcc-ex";
  }

  _commandCenter.powerIncludesProgramming =
      _prefs.getBool(
          "powerProg",
          true);
}

bool HubConfigStore::saveNetwork(
    const HubNetworkSettings& settings) {
  _network = settings;

  bool ok = true;

  ok &=
      _prefs.putString(
          "wifiSsid",
          _network.wifiSsid) > 0 ||
      _network.wifiSsid.isEmpty();

  _prefs.putString(
      "wifiPass",
      _network.wifiPassword);

  ok &=
      _prefs.putString(
          "hubHost",
          _network.hostname) > 0;

  ok &=
      _prefs.putBool(
          "netDhcp",
          _network.dhcp) == 1;

  _prefs.putString(
      "netIp",
      _network.ip);

  _prefs.putString(
      "netGw",
      _network.gateway);

  _prefs.putString(
      "netMask",
      _network.subnet);

  _prefs.putString(
      "netDns1",
      _network.dns1);

  _prefs.putString(
      "netDns2",
      _network.dns2);

  ok &=
      _prefs.putUShort(
          "httpPort",
          _network.httpPort) == 2;

  return ok;
}

bool HubConfigStore::saveCommandCenter(
    const CommandCenterSettings& settings) {
  _commandCenter =
      settings;

  _commandCenter.type.trim();
  _commandCenter.type.toLowerCase();

  if (_commandCenter.type.isEmpty()) {
    _commandCenter.type =
        "dcc-ex";
  }

  // Keep the legacy host/port-only configuration screen useful until the
  // frontend gains an explicit command-center type selector.
  if (
      _commandCenter.port == 21105 ||
      _commandCenter.port == 21106
  ) {
    _commandCenter.type =
        "z21";
  } else if (
      _commandCenter.port == 2560
  ) {
    _commandCenter.type =
        "dcc-ex";
  }

  bool ok = true;

  ok &=
      _prefs.putString(
          "csbType",
          _commandCenter.type) > 0;

  ok &=
      _prefs.putString(
          "csbHost",
          _commandCenter.host) > 0;

  ok &=
      _prefs.putUShort(
          "csbPort",
          _commandCenter.port) == 2;

  ok &=
      _prefs.putBool(
          "powerProg",
          _commandCenter.powerIncludesProgramming) == 1;

  return ok;
}
