#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>
#include <functional>

#include "LayoutRuntime.h"

struct DispatcherTurnoutRequirement {
  uint16_t address = 0;
  bool closed = true;
};

struct DispatcherLegRequest {
  String ownerId;
  String ownerName;
  uint16_t locoAddress = 0;
  uint16_t fromBlockId = 0;
  uint16_t toBlockId = 0;
  std::vector<uint16_t> safetySensors;
  std::vector<uint32_t> resourceTokens;
  std::vector<uint16_t> turnoutAddresses;
  std::vector<DispatcherTurnoutRequirement> turnouts;
};

struct DispatcherLegLease {
  String ownerId;
  String ownerName;
  uint16_t locoAddress = 0;
  uint16_t fromBlockId = 0;
  uint16_t toBlockId = 0;
  std::vector<uint16_t> safetySensors;
  std::vector<uint32_t> resourceTokens;
  std::vector<uint16_t> turnoutAddresses;
  String targetMarker;
  unsigned long acquiredAtMs = 0;
};

struct DispatcherAcquireResult {
  bool ok = false;
  String error;
  uint16_t blockingSensor = 0;
  uint16_t blockingBlock = 0;
};

class DispatcherRuntime {
public:
  using TurnoutAcquireCallback = std::function<bool(
      const std::vector<uint16_t>&,
      const String&,
      const String&)>;

  using TurnoutSetCallback = std::function<bool(
      uint16_t,
      bool,
      const String&)>;

  using TurnoutReleaseCallback = std::function<void(
      const std::vector<uint16_t>&,
      const String&)>;

  explicit DispatcherRuntime(LayoutRuntime& runtime)
      : _runtime(runtime) {}

  void setTurnoutAuthority(
      TurnoutAcquireCallback acquire,
      TurnoutSetCallback set,
      TurnoutReleaseCallback release) {
    _turnoutAcquire = std::move(acquire);
    _turnoutSet = std::move(set);
    _turnoutRelease = std::move(release);
  }

  DispatcherAcquireResult acquireLeg(
      const DispatcherLegRequest& request);

  bool releaseLeg(const String& ownerId);
  size_t releaseAll();

  bool ownsDestination(
      uint16_t blockId,
      const String& ownerId) const;

  const std::vector<DispatcherLegLease>& leases() const {
    return _leases;
  }

  void appendSnapshot(JsonArray array) const;

  static uint32_t resourceToken(
      const String& resourceKey);

private:
  LayoutRuntime& _runtime;
  std::vector<DispatcherLegLease> _leases;
  TurnoutAcquireCallback _turnoutAcquire;
  TurnoutSetCallback _turnoutSet;
  TurnoutReleaseCallback _turnoutRelease;

  RuntimeBlock* findBlock(uint16_t id) const;
  const DispatcherLegLease* findLease(
      const String& ownerId) const;

  bool resourceOwnedByOther(
      uint32_t resourceToken,
      const String& ownerId) const;

  bool destinationOwnedByOther(
      uint16_t blockId,
      const String& ownerId) const;

  String validateSource(
      uint16_t blockId,
      uint16_t locoAddress) const;

  String validateDestination(
      uint16_t blockId,
      const String& ownerId) const;

  bool sensorsFree(
      const std::vector<uint16_t>& sensors,
      uint16_t& blockingSensor) const;

  static String targetMarker(
      uint16_t locoAddress,
      const String& ownerId);

  static uint32_t blockResourceToken(
      uint16_t blockId);

  static void normalizeResources(
      uint16_t fromBlockId,
      uint16_t toBlockId,
      std::vector<uint32_t>& resources);
};
