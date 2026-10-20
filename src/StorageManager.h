#pragma once

#include <Arduino.h>
#include <FS.h>
#include <LittleFS.h>
#include <SD.h>
#include <SPI.h>

enum class StorageMedium : uint8_t {
  InternalFlash = 0,
  SdCard = 1
};

class StorageManager {
public:
  static StorageManager& instance();

  bool begin();

  bool sdAvailable() const {
    return _sdMounted;
  }

  fs::FS& fs(StorageMedium medium);

  bool resolveVirtualPath(
      const String& virtualPath,
      StorageMedium& medium,
      String& realPath) const;

  String virtualPath(
      StorageMedium medium,
      const String& realPath) const;

  const char* mediumName(
      StorageMedium medium) const;

  const char* sdCardTypeName() const;

  uint64_t totalBytes(StorageMedium medium) const;
  uint64_t usedBytes(StorageMedium medium) const;
  uint64_t freeBytes(StorageMedium medium) const;
  uint64_t sdCardSizeBytes() const;

private:
  StorageManager() = default;

  bool _initialized = false;
  bool _sdMounted = false;

  static constexpr uint8_t M5STACK_SD_CS = 4;
  static constexpr uint32_t SD_SPI_HZ = 10000000UL;
};
