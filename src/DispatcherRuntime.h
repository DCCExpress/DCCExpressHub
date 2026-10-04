#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>

#include "LayoutRuntime.h"

struct DispatcherLegRequest {
  String ownerId;
  String ownerName;
  uint16_t locoAddress = 0;
  uint16_t fromBlockId = 0;
  uint16_t toBlockId = 0;
  std::vector<uint16_t> safetySensors;
  std::vector<String> resourceKeys;
};

struct DispatcherLegLease {
  String ownerId;
  String ownerName;
  uint16_t locoAddress = 0;
  uint16_t fromBlockId = 0;
  uint16_t toBlockId = 0;
  std::vector<uint16_t> safetySensors;
  std::vector<String> resourceKeys;
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
  explicit DispatcherRuntime(LayoutRuntime& runtime)
      : _runtime(runtime) {}

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

private:
  LayoutRuntime& _runtime;
  std::vector<DispatcherLegLease> _leases;

  RuntimeBlock* findBlock(uint16_t id) const;
  const DispatcherLegLease* findLease(
      const String& ownerId) const;

  bool resourceOwnedByOther(
      const String& resourceKey,
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

  static void normalizeResources(
      uint16_t fromBlockId,
      uint16_t toBlockId,
      std::vector<String>& resources);
};
