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

#if defined(HUB_TARGET_M5STACK_BASIC) && HUB_TARGET_M5STACK_BASIC
  // The M5Stack Basic shares VSPI between the ILI9342 display and microSD.
  // TFT CS is GPIO14, SD CS is GPIO4. SPI transactions keep the devices
  // isolated, so the default SPI bus can safely be shared.
  pinMode(
      M5STACK_SD_CS,
      OUTPUT);
  digitalWrite(
      M5STACK_SD_CS,
      HIGH);

  _sdMounted =
      SD.begin(
          M5STACK_SD_CS,
          SPI,
          SD_SPI_HZ);

  if (
      _sdMounted &&
      SD.cardType() == CARD_NONE
  ) {
    SD.end();
    _sdMounted = false;
  }

  if (_sdMounted) {
    // Keep one well-known audio directory available for the layout audio picker.
    if (!SD.exists("/audio")) {
      if (SD.mkdir("/audio")) {
        Logger::info("SD audio directory created: /audio");
      } else {
        Logger::warn("Could not create SD audio directory: /audio");
      }
    } else {
      Logger::info("SD audio directory ready: /audio");
    }

    // Small boot-time write/delete self-test. This isolates SD write problems
    // from the HTTP upload path and immediately tells us whether the mounted
    // card is actually writable on the shared SPI bus.
    static constexpr const char* WRITE_TEST_PATH = "/.dcchub_write_test.tmp";

    SD.remove(WRITE_TEST_PATH);

    File writeTest = SD.open(WRITE_TEST_PATH, FILE_WRITE);

    if (!writeTest) {
      Logger::warn("SD write test: FAILED (open)");
    } else {
      static constexpr char WRITE_TEST_TEXT[] = "DCCExpressHub";
      const size_t expected = sizeof(WRITE_TEST_TEXT) - 1;
      const size_t written = writeTest.write(
          reinterpret_cast<const uint8_t*>(WRITE_TEST_TEXT),
          expected);

      writeTest.flush();
      writeTest.close();

      if (written != expected) {
        Logger::warn(
            "SD write test: FAILED (write " +
            String(static_cast<unsigned long>(written)) +
            "/" +
            String(static_cast<unsigned long>(expected)) +
            " bytes)");
      } else if (!SD.remove(WRITE_TEST_PATH)) {
        Logger::warn("SD write test: WRITE OK, DELETE FAILED");
      } else {
        Logger::info("SD write test: OK");
      }
    }

    Logger::info(
        "SD card mounted: type=" +
        String(sdCardTypeName()) +
        " card=" +
        String(
            static_cast<unsigned long>(
                sdCardSizeBytes() /
                (1024ULL * 1024ULL))) +
        " MB volume=" +
        String(
            static_cast<unsigned long>(
                totalBytes(StorageMedium::SdCard) /
                (1024ULL * 1024ULL))) +
        " MB");
  } else {
    Logger::warn(
        "SD card not present or mount failed");
  }
#else
  _sdMounted = false;
#endif

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
