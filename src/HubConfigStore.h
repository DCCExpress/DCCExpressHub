#pragma once

#include <Arduino.h>
#include <Preferences.h>

struct HubNetworkSettings {
  String wifiSsid;
  String wifiPassword;
  String hostname;

  bool dhcp = true;

  String ip;
  String gateway;
  String subnet;
  String dns1;
  String dns2;

  uint16_t httpPort = 80;
};

struct CommandCenterSettings {
  String host;
  uint16_t port = 2560;
  bool powerIncludesProgramming = true;
};

class HubConfigStore {
public:
  void begin();

  const HubNetworkSettings& network() const {
    return _network;
  }

  const CommandCenterSettings& commandCenter() const {
    return _commandCenter;
  }

  bool saveNetwork(
      const HubNetworkSettings& settings);

  bool saveCommandCenter(
      const CommandCenterSettings& settings);

  bool wifiPasswordStored() const {
    return !_network.wifiPassword.isEmpty();
  }

private:
  Preferences _prefs;

  HubNetworkSettings _network;
  CommandCenterSettings _commandCenter;

  void loadNetwork();
  void loadCommandCenter();
};
