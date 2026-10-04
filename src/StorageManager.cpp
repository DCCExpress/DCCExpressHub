#include "StorageManager.h"

#include "Logger.h"

StorageManager& StorageManager::instance() {
  static StorageManager manager;
  return manager;
}

bool StorageManager::begin() {
  if (_initialized) {
    return _sdMounted;
  }

  _initialized = true;

_sdMounted = false;


  return _sdMounted;
}

fs::FS& StorageManager::fs(
    StorageMedium medium) {
  return
      medium == StorageMedium::SdCard
          ? static_cast<fs::FS&>(SD)
          : static_cast<fs::FS&>(LittleFS);
}

bool StorageManager::resolveVirtualPath(
    const String& virtualPath,
    StorageMedium& medium,
    String& realPath) const {
  if (
      virtualPath == "/flash" ||
      virtualPath.startsWith("/flash/")
  ) {
    medium = StorageMedium::InternalFlash;
    realPath = virtualPath.substring(6);

    if (realPath.isEmpty()) {
      realPath = "/";
    }

    return true;
  }

  if (
      virtualPath == "/sd" ||
      virtualPath.startsWith("/sd/")
  ) {
    medium = StorageMedium::SdCard;
    realPath = virtualPath.substring(3);

    if (realPath.isEmpty()) {
      realPath = "/";
    }

    return true;
  }

  // Backwards compatibility for existing callers/bookmarks: paths without a
  // storage prefix continue to address the internal LittleFS filesystem.
  if (
      virtualPath.startsWith("/") &&
      virtualPath != "/"
  ) {
    medium = StorageMedium::InternalFlash;
    realPath = virtualPath;
    return true;
  }

  return false;
}

String StorageManager::virtualPath(
    StorageMedium medium,
    const String& realPath) const {
  const String prefix =
      medium == StorageMedium::SdCard
          ? "/sd"
          : "/flash";

  if (
      realPath.isEmpty() ||
      realPath == "/"
  ) {
    return prefix;
  }

  return
      prefix +
      (realPath.startsWith("/")
           ? realPath
           : "/" + realPath);
}

const char* StorageManager::mediumName(
    StorageMedium medium) const {
  return
      medium == StorageMedium::SdCard
          ? "SD Card"
          : "Internal Flash";
}

const char* StorageManager::sdCardTypeName() const {
  if (!_sdMounted) {
    return "NONE";
  }

  switch (SD.cardType()) {
    case CARD_MMC:
      return "MMC";
    case CARD_SD:
      return "SDSC";
    case CARD_SDHC:
      return "SDHC";
    case CARD_NONE:
      return "NONE";
    default:
      return "UNKNOWN";
  }
}

uint64_t StorageManager::totalBytes(
    StorageMedium medium) const {
  if (medium == StorageMedium::SdCard) {
    return
        _sdMounted
            ? SD.totalBytes()
            : 0;
  }

  return LittleFS.totalBytes();
}

uint64_t StorageManager::usedBytes(
    StorageMedium medium) const {
  if (medium == StorageMedium::SdCard) {
    return
        _sdMounted
            ? SD.usedBytes()
            : 0;
  }

  return LittleFS.usedBytes();
}

uint64_t StorageManager::freeBytes(
    StorageMedium medium) const {
  const uint64_t total =
      totalBytes(medium);
  const uint64_t used =
      usedBytes(medium);

  return
      total >= used
          ? total - used
          : 0;
}

uint64_t StorageManager::sdCardSizeBytes() const {
  return
      _sdMounted
          ? SD.cardSize()
          : 0;
}
