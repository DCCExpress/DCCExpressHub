#include "DispatcherRuntime.h"

#include <algorithm>

RuntimeBlock* DispatcherRuntime::findBlock(
    uint16_t id) const {
  return const_cast<LayoutRuntime&>(_runtime)
      .findBlockById(id);
}

const DispatcherLegLease* DispatcherRuntime::findLease(
    const String& ownerId) const {
  for (const auto& lease : _leases) {
    if (lease.ownerId == ownerId) return &lease;
  }
  return nullptr;
}

bool DispatcherRuntime::resourceOwnedByOther(
    uint32_t resourceToken,
    const String& ownerId) const {
  for (const auto& lease : _leases) {
    if (lease.ownerId == ownerId) continue;

    if (std::find(
            lease.resourceTokens.begin(),
            lease.resourceTokens.end(),
            resourceToken) !=
        lease.resourceTokens.end())
      return true;
  }

  return false;
}

bool DispatcherRuntime::destinationOwnedByOther(
    uint16_t blockId,
    const String& ownerId) const {
  for (const auto& lease : _leases) {
    if (lease.ownerId != ownerId &&
        lease.toBlockId == blockId) {
      return true;
    }
  }
  return false;
}

String DispatcherRuntime::validateSource(
    uint16_t blockId,
    uint16_t locoAddress) const {
  RuntimeBlock* source = findBlock(blockId);
  if (!source) return "source_block_not_found";
  if (!source->occupied()) return "source_block_empty";
  if (source->locoAddress == 0) return "source_loco_unknown";
  if (source->locoAddress != locoAddress) return "source_loco_mismatch";
  return "";
}

String DispatcherRuntime::validateDestination(
    uint16_t blockId,
    const String& ownerId) const {
  RuntimeBlock* destination = findBlock(blockId);
  if (!destination) return "destination_block_not_found";
  if (destinationOwnedByOther(blockId, ownerId))
    return "destination_block_busy";
  if (destination->hasRuntimeState())
    return "destination_block_busy";
  return "";
}

bool DispatcherRuntime::sensorsFree(
    const std::vector<uint16_t>& sensors,
    uint16_t& blockingSensor) const {
  blockingSensor = 0;

  for (uint16_t address : sensors) {
    bool on = false;

    // UNKNOWN is unsafe, exactly like the Windows backend.
    if (!_runtime.getSensorState(address, on) || on) {
      blockingSensor = address;
      return false;
    }
  }

  return true;
}

String DispatcherRuntime::targetMarker(
    uint16_t locoAddress,
    const String& ownerId) {
  String marker(RuntimeBlock::TARGET_LOCO_PREFIX);
  marker += String(locoAddress);
  marker += ":";
  marker += ownerId;
  return marker;
}

void DispatcherRuntime::normalizeResources(
    uint16_t fromBlockId,
    uint16_t toBlockId,
    std::vector<String>& resources) {
  resources.push_back("block:" + String(fromBlockId));
  resources.push_back("block:" + String(toBlockId));

  resources.erase(
      std::remove_if(
          resources.begin(),
          resources.end(),
          [](const String& value) {
            return value.isEmpty() || value.length() > 240;
          }),
      resources.end());

  std::sort(
      resources.begin(),
      resources.end(),
      [](const String& a, const String& b) {
        return a.compareTo(b) < 0;
      });

  resources.erase(
      std::unique(
          resources.begin(),
          resources.end(),
          [](const String& a, const String& b) {
            return a == b;
          }),
      resources.end());
}

DispatcherAcquireResult DispatcherRuntime::acquireLeg(
    const DispatcherLegRequest& raw) {
  DispatcherAcquireResult result;

  if (raw.ownerId.isEmpty() ||
      raw.ownerId.length() > 240) {
    result.error = "invalid_owner";
    return result;
  }

  if (raw.locoAddress < 1 ||
      raw.locoAddress > 10239) {
    result.error = "invalid_loco_address";
    return result;
  }

  if (raw.fromBlockId == 0 ||
      raw.toBlockId == 0 ||
      raw.fromBlockId == raw.toBlockId) {
    result.error = "invalid_block_leg";
    return result;
  }

  if (findLease(raw.ownerId)) {
    result.error = "owner_already_has_leg";
    return result;
  }

  String sourceError =
      validateSource(
          raw.fromBlockId,
          raw.locoAddress);

  if (!sourceError.isEmpty()) {
    result.error = sourceError;
    result.blockingBlock = raw.fromBlockId;
    return result;
  }

  String destinationError =
      validateDestination(
          raw.toBlockId,
          raw.ownerId);

  if (!destinationError.isEmpty()) {
    result.error = destinationError;
    result.blockingBlock = raw.toBlockId;
    return result;
  }

  std::vector<String> resources =
      raw.resourceKeys;

  normalizeResources(
      raw.fromBlockId,
      raw.toBlockId,
      resources);

  for (const auto& key : resources) {
    if (resourceOwnedByOther(
            key,
            raw.ownerId)) {
      result.error =
          "dispatcher_resource_locked:" +
          key;

      if (key ==
          "block:" +
              String(raw.toBlockId)) {
        result.blockingBlock =
            raw.toBlockId;
      }

      return result;
    }
  }

  uint16_t blockingSensor = 0;

  if (!sensorsFree(
          raw.safetySensors,
          blockingSensor)) {
    result.error = "safety_sensor_not_free";
    result.blockingSensor = blockingSensor;
    return result;
  }

  // Re-check after all in-memory authority checks. The turnout authority
  // layer will perform another safety check before physical movement.
  sourceError =
      validateSource(
          raw.fromBlockId,
          raw.locoAddress);

  if (!sourceError.isEmpty()) {
    result.error = sourceError;
    result.blockingBlock = raw.fromBlockId;
    return result;
  }

  destinationError =
      validateDestination(
          raw.toBlockId,
          raw.ownerId);

  if (!destinationError.isEmpty()) {
    result.error = destinationError;
    result.blockingBlock = raw.toBlockId;
    return result;
  }

  if (!sensorsFree(
          raw.safetySensors,
          blockingSensor)) {
    result.error = "safety_sensor_not_free";
    result.blockingSensor = blockingSensor;
    return result;
  }

  bool turnoutAuthority = false;

  if (!raw.turnoutAddresses.empty()) {
    if (!_turnoutAcquire ||
        !_turnoutAcquire(
            raw.turnoutAddresses,
            raw.ownerId,
            raw.ownerName.isEmpty()
                ? raw.ownerId
                : raw.ownerName)) {
      result.error = "turnout_lock_failed";
      return result;
    }

    turnoutAuthority = true;

    if (!raw.turnouts.empty()) {
      if (!_turnoutSet) {
        if (_turnoutRelease) {
          _turnoutRelease(
              raw.turnoutAddresses,
              raw.ownerId);
        }
        result.error = "turnout_set_unavailable";
        return result;
      }

      for (const auto& requirement :
           raw.turnouts) {
        if (
            requirement.address == 0 ||
            std::find(
                raw.turnoutAddresses.begin(),
                raw.turnoutAddresses.end(),
                requirement.address) ==
                raw.turnoutAddresses.end() ||
            !_turnoutSet(
                requirement.address,
                requirement.closed,
                raw.ownerId)) {
          if (_turnoutRelease) {
            _turnoutRelease(
                raw.turnoutAddresses,
                raw.ownerId);
          }
          result.error = "turnout_command_failed";
          return result;
        }
      }
    }

    // Safety must be checked again after turnout commands and authority.
    sourceError =
        validateSource(
            raw.fromBlockId,
            raw.locoAddress);

    destinationError =
        validateDestination(
            raw.toBlockId,
            raw.ownerId);

    if (!sourceError.isEmpty() ||
        !destinationError.isEmpty() ||
        !sensorsFree(
            raw.safetySensors,
            blockingSensor)) {
      if (_turnoutRelease) {
        _turnoutRelease(
            raw.turnoutAddresses,
            raw.ownerId);
      }

      if (!sourceError.isEmpty()) {
        result.error = sourceError;
        result.blockingBlock = raw.fromBlockId;
      } else if (!destinationError.isEmpty()) {
        result.error = destinationError;
        result.blockingBlock = raw.toBlockId;
      } else {
        result.error = "safety_sensor_not_free";
        result.blockingSensor = blockingSensor;
      }

      return result;
    }
  }

  const String marker =
      targetMarker(
          raw.locoAddress,
          raw.ownerId);

  if (!_runtime.setBlock(
          raw.toBlockId,
          marker,
          0)) {
    if (turnoutAuthority &&
        _turnoutRelease) {
      _turnoutRelease(
          raw.turnoutAddresses,
          raw.ownerId);
    }

    result.error = "target_block_marker_failed";
    result.blockingBlock = raw.toBlockId;
    return result;
  }

  DispatcherLegLease lease;
  lease.ownerId = raw.ownerId;
  lease.ownerName =
      raw.ownerName.isEmpty()
          ? raw.ownerId
          : raw.ownerName;
  lease.locoAddress = raw.locoAddress;
  lease.fromBlockId = raw.fromBlockId;
  lease.toBlockId = raw.toBlockId;
  lease.safetySensors = raw.safetySensors;
  lease.resourceKeys = resources;
  lease.turnoutAddresses = raw.turnoutAddresses;
  lease.targetMarker = marker;
  lease.acquiredAtMs = millis();

  _leases.push_back(lease);

  result.ok = true;
  return result;
}

bool DispatcherRuntime::releaseLeg(
    const String& ownerId) {
  for (auto it = _leases.begin();
       it != _leases.end();
       ++it) {
    if (it->ownerId != ownerId) continue;

    RuntimeBlock* destination =
        findBlock(it->toBlockId);

    if (destination &&
        destination->targetOnly() &&
        destination->locoId ==
            it->targetMarker) {
      _runtime.removeBlock(
          it->toBlockId,
          it->targetMarker);
    }

    if (!it->turnoutAddresses.empty() &&
        _turnoutRelease) {
      _turnoutRelease(
          it->turnoutAddresses,
          it->ownerId);
    }

    _leases.erase(it);
    return true;
  }

  return false;
}

size_t DispatcherRuntime::releaseAll() {
  size_t released = 0;

  while (!_leases.empty()) {
    const String ownerId =
        _leases.back().ownerId;

    if (releaseLeg(ownerId)) {
      ++released;
    } else {
      break;
    }
  }

  return released;
}

bool DispatcherRuntime::ownsDestination(
    uint16_t blockId,
    const String& ownerId) const {
  for (const auto& lease : _leases) {
    if (lease.toBlockId == blockId &&
        lease.ownerId == ownerId) {
      return true;
    }
  }
  return false;
}

void DispatcherRuntime::appendSnapshot(
    JsonArray array) const {
  for (const auto& lease : _leases) {
    JsonObject item =
        array.add<JsonObject>();

    item["ownerId"] = lease.ownerId;
    item["ownerName"] = lease.ownerName;
    item["locoAddress"] = lease.locoAddress;
    item["fromBlockId"] = lease.fromBlockId;
    item["toBlockId"] = lease.toBlockId;
    item["targetMarker"] = lease.targetMarker;
    item["acquiredAtMs"] = lease.acquiredAtMs;

    JsonArray sensors =
        item["safetySensors"]
            .to<JsonArray>();

    for (uint16_t address :
         lease.safetySensors) {
      sensors.add(address);
    }

    JsonArray resources =
        item["resourceKeys"]
            .to<JsonArray>();

    for (const auto& key :
         lease.resourceKeys) {
      resources.add(key);
    }
  }
}
