#include "FileManagementEndpoint.h"

#include <ArduinoJson.h>
#include <algorithm>
#include <cstring>
#include <memory>

#include "Logger.h"

namespace {

const char* storageMimeFor(
    const String& path) {
  String lower = path;
  lower.toLowerCase();

  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".txt") || lower.endsWith(".log") || lower.endsWith(".md")) {
    return "text/plain; charset=utf-8";
  }
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";

  return "application/octet-stream";
}

struct DirectoryJsonStreamState {
  File directory;
  StorageMedium medium = StorageMedium::InternalFlash;
  String virtualPath;
  String realPath;
  String pending;
  size_t pendingOffset = 0;
  bool headerSent = false;
  bool firstEntry = true;
  bool closingSent = false;
  bool finished = false;
};

String jsonString(
    const String& value) {
  JsonDocument document;
  document.set(value);

  String result;
  serializeJson(document, result);
  return result;
}

}

FileManagementEndpoint::FileManagementEndpoint(
    AsyncWebServer& server)
    : _server(server),
      _storage(
          StorageManager::instance()) {
  // Mount/detect the M5Stack microSD once during Hub API startup. The display
  // may already have triggered this earlier; StorageManager::begin() is idempotent.
  _storage.begin();

  setupStorageStaticFiles();
  setupRoutes();
}

bool FileManagementEndpoint::safePath(
    const String& path) {
  return
      path.startsWith("/") &&
      path.indexOf("..") < 0 &&
      path.indexOf('\\') < 0;
}

bool FileManagementEndpoint::safeFilename(
    const String& filename) {
  return
      !filename.isEmpty() &&
      filename != "." &&
      filename != ".." &&
      filename.indexOf('/') < 0 &&
      filename.indexOf('\\') < 0 &&
      filename.indexOf("..") < 0;
}

bool FileManagementEndpoint::protectedPath(
    StorageMedium medium,
    const String& realPath) {
  if (
      medium !=
      StorageMedium::InternalFlash
  ) {
    return realPath == "/";
  }

  return
      realPath == "/" ||
      realPath == "/config/layout.json" ||
      realPath == "/config/locos.json" ||
      realPath == "/config/signal-logic.ndjson" ||
      realPath == "/config/automations.json" ||
      realPath == "/config/device-config.json" ||
      realPath == "/state/runtime-state.json";
}

String FileManagementEndpoint::joinPath(
    const String& directory,
    const String& filename) {
  if (
      directory == "/"
  ) {
    return
        "/" +
        filename;
  }

  String result =
      directory;

  while (
      result.endsWith("/")
  ) {
    result.remove(
        result.length() -
        1);
  }

  return
      result +
      "/" +
      filename;
}

void FileManagementEndpoint::sendJson(
    AsyncWebServerRequest* request,
    int code,
    bool ok,
    const String& message) {
  JsonDocument document;

  document["ok"] =
      ok;

  document["message"] =
      message;

  String body;

  serializeJson(
      document,
      body);

  auto* response =
      request->beginResponse(
          code,
          "application/json",
          body);

  response->addHeader(
      "Cache-Control",
      "no-store");

  request->send(
      response);
}

bool FileManagementEndpoint::resolvePath(
    const String& virtualPath,
    StorageMedium& medium,
    fs::FS*& fs,
    FileStore*& store,
    String& realPath) {
  if (
      !safePath(
          virtualPath) ||
      !_storage.resolveVirtualPath(
          virtualPath,
          medium,
          realPath) ||
      !safePath(
          realPath)
  ) {
    return false;
  }

  if (
      medium == StorageMedium::SdCard &&
      !_storage.sdAvailable()
  ) {
    return false;
  }

  if (
      medium == StorageMedium::SdCard
  ) {
    fs =
        &static_cast<fs::FS&>(SD);

    store =
        &_sdFiles;
  } else {
    fs =
        &static_cast<fs::FS&>(LittleFS);

    store =
        &_flashFiles;
  }

  return true;
}

void FileManagementEndpoint::setupStorageStaticFiles() {
  // Virtual prefixes keep normal Hub assets on their existing URLs while the
  // file manager can expose both filesystems without path collisions.
  _server
      .serveStatic(
          "/flash/",
          LittleFS,
          "/")
      .setCacheControl(
          "no-cache");

  if (_storage.sdAvailable()) {
    _server
        .serveStatic(
            "/sd/",
            SD,
            "/")
        .setCacheControl(
            "no-cache");
  }
}

void FileManagementEndpoint::resetUpload() {
  if (_uploadFile) {
    _uploadFile.close();
  }

  if (
      _uploadStore &&
      !_uploadFinalPath.isEmpty() &&
      !_uploadCommitted
  ) {
    _uploadStore->abort(
        _uploadFinalPath.c_str());
  }

  _uploadStore =
      nullptr;

  _uploadFs =
      nullptr;

  _uploadFinalPath =
      "";

  _uploadVirtualPath =
      "";

  _uploadError =
      "";

  _uploadBytes =
      0;

  _uploadBusy =
      false;

  _uploadFailed =
      false;

  _uploadTooLarge =
      false;

  _uploadCommitted =
      false;

  _uploadOwner =
      nullptr;
}

void FileManagementEndpoint::handleUploadChunk(
    AsyncWebServerRequest* request,
    const String& filename,
    size_t index,
    uint8_t* data,
    size_t len,
    bool final) {
  if (
      index == 0
  ) {
    if (
        _uploadBusy &&
        _uploadOwner !=
            request
    ) {
      return;
    }

    resetUpload();

    _uploadBusy =
        true;

    _uploadOwner =
        request;

    if (
        !request->hasParam(
            "path")
    ) {
      _uploadFailed =
          true;
      _uploadError =
          "Missing upload target path";
      Logger::warn("Upload failed: " + _uploadError);

      return;
    }

    String directory =
        request
            ->getParam(
                "path")
            ->value();

    directory.trim();

    // The virtual root only contains the two storage devices. Uploading there
    // is ambiguous, so the user must enter Internal Flash or SD Card first.
    if (
        directory == "/" ||
        !safeFilename(
            filename)
    ) {
      _uploadFailed =
          true;
      _uploadError =
          directory == "/"
              ? "Choose Internal Flash or SD Card before uploading"
              : "Invalid upload filename";
      Logger::warn(
          "Upload failed: " +
          _uploadError +
          " file=" +
          filename +
          " path=" +
          directory);

      return;
    }

    StorageMedium medium =
        StorageMedium::InternalFlash;
    fs::FS* targetFs =
        nullptr;
    FileStore* targetStore =
        nullptr;
    String realDirectory;

    if (
        !resolvePath(
            directory,
            medium,
            targetFs,
            targetStore,
            realDirectory)
    ) {
      _uploadFailed =
          true;
      _uploadError =
          "Upload target storage/path is unavailable";
      Logger::warn(
          "Upload failed: " +
          _uploadError +
          " path=" +
          directory);

      return;
    }

    _uploadMedium =
        medium;

    _uploadFs =
        targetFs;

    _uploadStore =
        targetStore;

    _uploadFinalPath =
        joinPath(
            realDirectory,
            filename);

    _uploadVirtualPath =
        _storage.virtualPath(
            medium,
            _uploadFinalPath);

    if (
        !safePath(
            _uploadFinalPath) ||
        protectedPath(
            medium,
            _uploadFinalPath)
    ) {
      _uploadFailed =
          true;
      _uploadError =
          "Upload destination is protected or invalid";
      Logger::warn(
          "Upload failed: " +
          _uploadError +
          " target=" +
          _uploadVirtualPath);

      return;
    }

    _uploadFile =
        _uploadStore->beginWrite(
            _uploadFinalPath.c_str());

    if (!_uploadFile) {
      _uploadFailed =
          true;
      _uploadError =
          "Could not open temporary file for writing";
      Logger::warn(
          "Upload failed: " +
          _uploadError +
          " target=" +
          _uploadVirtualPath +
          " temp=" +
          _uploadStore->tempPath(
              _uploadFinalPath.c_str()));

      return;
    }
  }

  if (
      !_uploadBusy ||
      _uploadFailed ||
      !_uploadFile
  ) {
    return;
  }

  // Keep the small internal flash protected from accidental giant uploads.
  // SD files (including MP3) are streamed chunk-by-chunk and are limited only
  // by the card/filesystem itself, not by heap size.
  if (
      _uploadMedium ==
          StorageMedium::InternalFlash &&
      _uploadBytes +
          len >
      MAX_FLASH_UPLOAD_BYTES
  ) {
    _uploadTooLarge =
        true;

    _uploadFailed =
        true;
    _uploadError =
        "Internal Flash upload exceeds 2 MB";

    _uploadFile.close();

    _uploadStore->abort(
        _uploadFinalPath.c_str());

    return;
  }

  const size_t written =
      _uploadFile.write(
          data,
          len);

  _uploadBytes +=
      written;

  if (
      written !=
      len
  ) {
    _uploadFailed =
        true;
    _uploadError =
        "Storage write failed after " +
        String(_uploadBytes) +
        " bytes (requested chunk " +
        String(len) +
        ", wrote " +
        String(written) +
        ")";
    Logger::warn(
        "Upload failed: " +
        _uploadError +
        " target=" +
        _uploadVirtualPath);

    _uploadFile.close();

    _uploadStore->abort(
        _uploadFinalPath.c_str());

    return;
  }

  if (!final) {
    return;
  }

  _uploadFile.flush();
  _uploadFile.close();

  if (
      !_uploadStore->commit(
          _uploadFinalPath.c_str())
  ) {
    _uploadFailed =
        true;
    _uploadError =
        "Upload data was written, but final rename/commit failed";
    Logger::warn(
        "Upload failed: " +
        _uploadError +
        " target=" +
        _uploadVirtualPath);

    _uploadStore->abort(
        _uploadFinalPath.c_str());

    return;
  }

  _uploadCommitted =
      true;

  Logger::info(
      "File upload saved: " +
      _uploadVirtualPath +
      " (" +
      String(
          _uploadBytes) +
      " bytes)");
}

void FileManagementEndpoint::finishUploadRequest(
    AsyncWebServerRequest* request) {
  if (
      _uploadBusy &&
      _uploadOwner !=
          request
  ) {
    sendJson(
        request,
        409,
        false,
        "Another upload is already in progress");

    return;
  }

  if (
      !_uploadBusy
  ) {
    sendJson(
        request,
        400,
        false,
        "No uploaded file received");

    resetUpload();

    return;
  }

  if (
      _uploadFailed ||
      !_uploadCommitted
  ) {
    const String message =
        !_uploadError.isEmpty()
            ? _uploadError
            : (_uploadTooLarge
                   ? "Internal Flash upload exceeds 2 MB"
                   : "File upload failed");

    sendJson(
        request,
        _uploadTooLarge
            ? 413
            : 500,
        false,
        message);

    resetUpload();

    return;
  }

  const String savedPath =
      _uploadVirtualPath;

  resetUpload();

  sendJson(
      request,
      200,
      true,
      "File uploaded: " +
          savedPath);
}

void FileManagementEndpoint::deletePath(
    AsyncWebServerRequest* request) {
  if (
      !request->hasParam(
          "path")
  ) {
    sendJson(
        request,
        400,
        false,
        "Missing path");

    return;
  }

  String virtualPath =
      request
          ->getParam(
              "path")
          ->value();

  virtualPath.trim();

  if (
      virtualPath == "/" ||
      virtualPath == "/flash" ||
      virtualPath == "/sd"
  ) {
    sendJson(
        request,
        403,
        false,
        "Storage root cannot be deleted");

    return;
  }

  StorageMedium medium =
      StorageMedium::InternalFlash;
  fs::FS* targetFs =
      nullptr;
  FileStore* targetStore =
      nullptr;
  String realPath;

  if (
      !resolvePath(
          virtualPath,
          medium,
          targetFs,
          targetStore,
          realPath) ||
      protectedPath(
          medium,
          realPath)
  ) {
    sendJson(
        request,
        403,
        false,
        "Path is protected, unavailable or invalid");

    return;
  }

  File target =
      targetFs->open(
          realPath);

  if (!target) {
    sendJson(
        request,
        404,
        false,
        "Path not found");

    return;
  }

  const bool isDirectory =
      target.isDirectory();

  target.close();

  const bool ok =
      isDirectory
          ? targetFs->rmdir(
                realPath.c_str())
          : targetStore->remove(
                realPath.c_str());

  if (!ok) {
    sendJson(
        request,
        isDirectory
            ? 409
            : 500,
        false,
        isDirectory
            ? "Directory is not empty or could not be removed"
            : "File could not be removed");

    return;
  }

  Logger::info(
      String(
          isDirectory
              ? "Directory deleted: "
              : "File deleted: ") +
      virtualPath);

  sendJson(
      request,
      200,
      true,
      "Deleted");
}

void FileManagementEndpoint::listPath(
    AsyncWebServerRequest* request) {
  String virtualPath =
      "/";

  if (
      request->hasParam(
          "path")
  ) {
    virtualPath =
        request
            ->getParam(
                "path")
            ->value();
  }

  virtualPath.trim();

  if (
      !safePath(
          virtualPath)
  ) {
    request->send(
        400,
        "application/json",
        "{}");

    return;
  }

  // The virtual root is tiny and fixed-size, so a normal JSON response is
  // cheaper than maintaining a chunked directory iterator for it.
  if (virtualPath == "/") {
    JsonDocument doc;
    doc["path"] =
        "/";

    JsonArray entries =
        doc["entries"]
            .to<JsonArray>();

    JsonObject flash =
        entries.add<JsonObject>();

    flash["name"] =
        "Internal Flash";
    flash["path"] =
        "/flash";
    flash["type"] =
        "directory";
    flash["size"] =
        0;

    JsonObject sd =
        entries.add<JsonObject>();

    sd["name"] =
        _storage.sdAvailable()
            ? "SD Card"
            : "SD Card (not present)";
    sd["path"] =
        "/sd";
    sd["type"] =
        "directory";
    sd["size"] =
        0;

    String body;
    serializeJson(doc, body);

    auto* response =
        request->beginResponse(
            200,
            "application/json",
            body);

    response->addHeader(
        "Cache-Control",
        "no-store");

    request->send(
        response);

    return;
  }

  StorageMedium medium =
      StorageMedium::InternalFlash;
  fs::FS* targetFs =
      nullptr;
  FileStore* targetStore =
      nullptr;
  String realPath;

  if (
      !resolvePath(
          virtualPath,
          medium,
          targetFs,
          targetStore,
          realPath)
  ) {
    if (
        virtualPath == "/sd" ||
        virtualPath.startsWith("/sd/")
    ) {
      JsonDocument doc;
      doc["path"] =
          virtualPath;
      doc["available"] =
          false;
      doc["message"] =
          "SD card is not available";
      doc["entries"]
          .to<JsonArray>();

      String body;
      serializeJson(doc, body);

      auto* response =
          request->beginResponse(
              200,
              "application/json",
              body);

      response->addHeader(
          "Cache-Control",
          "no-store");

      request->send(
          response);

      return;
    }

    sendJson(
        request,
        400,
        false,
        "Invalid path");

    return;
  }

  File dir =
      targetFs->open(
          realPath.c_str());

  if (
      !dir ||
      !dir.isDirectory()
  ) {
    if (dir) {
      dir.close();
    }

    sendJson(
        request,
        404,
        false,
        "Directory not found");

    return;
  }

  auto state =
      std::make_shared<DirectoryJsonStreamState>();

  state->directory =
      dir;
  state->medium =
      medium;
  state->virtualPath =
      virtualPath;
  state->realPath =
      realPath;

  auto* response =
      request->beginChunkedResponse(
          "application/json",
          [state, this](
              uint8_t* buffer,
              size_t maxLen,
              size_t) -> size_t {
            size_t produced =
                0;

            while (
                produced < maxLen
            ) {
              if (
                  state->pendingOffset <
                  state->pending.length()
              ) {
                const size_t available =
                    state->pending.length() -
                    state->pendingOffset;

                const size_t copyLength =
                    std::min(
                        available,
                        maxLen -
                            produced);

                memcpy(
                    buffer +
                        produced,
                    state->pending.c_str() +
                        state->pendingOffset,
                    copyLength);

                produced +=
                    copyLength;

                state->pendingOffset +=
                    copyLength;

                if (
                    state->pendingOffset <
                    state->pending.length()
                ) {
                  break;
                }

                state->pending =
                    "";
                state->pendingOffset =
                    0;

                continue;
              }

              if (state->finished) {
                break;
              }

              if (!state->headerSent) {
                state->headerSent =
                    true;

                state->pending =
                    String("{\"path\":") +
                    jsonString(
                        state->virtualPath) +
                    ",\"entries\":[";

                continue;
              }

              if (!state->closingSent) {
                File item =
                    state->directory
                        .openNextFile();

                if (item) {
                  String realItemPath =
                      String(
                          item.name());

                  const bool isDirectory =
                      item.isDirectory();

                  const size_t fileSize =
                      isDirectory
                          ? 0
                          : item.size();

                  item.close();

                  if (!realItemPath.startsWith("/")) {
                    realItemPath =
                        state->realPath == "/"
                            ? "/" + realItemPath
                            : state->realPath +
                                  "/" +
                                  realItemPath;
                  }

                  String name =
                      realItemPath;

                  const int slash =
                      name.lastIndexOf('/');

                  if (slash >= 0) {
                    name =
                        name.substring(
                            slash + 1);
                  }

                  JsonDocument entry;

                  entry["name"] =
                      name;
                  entry["path"] =
                      _storage.virtualPath(
                          state->medium,
                          realItemPath);
                  entry["type"] =
                      isDirectory
                          ? "directory"
                          : "file";
                  entry["size"] =
                      fileSize;

                  String encoded;
                  serializeJson(
                      entry,
                      encoded);

                  state->pending =
                      state->firstEntry
                          ? encoded
                          : String(",") + encoded;

                  state->firstEntry =
                      false;

                  continue;
                }

                state->directory.close();

                state->closingSent =
                    true;

                state->pending =
                    "]}";

                continue;
              }

              state->finished =
                  true;
            }

            return produced;
          });

  response->addHeader(
      "Cache-Control",
      "no-store");

  request->send(
      response);
}

void FileManagementEndpoint::sendTextFile(
    AsyncWebServerRequest* request) {
  if (
      !request->hasParam(
          "path")
  ) {
    request->send(
        400,
        "text/plain",
        "Missing path");

    return;
  }

  const String virtualPath =
      request
          ->getParam(
              "path")
          ->value();

  StorageMedium medium =
      StorageMedium::InternalFlash;
  fs::FS* targetFs =
      nullptr;
  FileStore* targetStore =
      nullptr;
  String realPath;

  if (
      !resolvePath(
          virtualPath,
          medium,
          targetFs,
          targetStore,
          realPath)
  ) {
    request->send(
        404,
        "text/plain",
        "Storage or path unavailable");

    return;
  }

  if (
      !targetFs->exists(
          realPath.c_str())
  ) {
    request->send(
        404,
        "text/plain",
        "Not found");

    return;
  }

  auto* response =
      request->beginResponse(
          *targetFs,
          realPath,
          "text/plain; charset=utf-8",
          false);

  response->addHeader(
      "Cache-Control",
      "no-store");

  request->send(
      response);
}

void FileManagementEndpoint::sendStoredFile(
    AsyncWebServerRequest* request) {
  if (
      !request->hasParam(
          "path")
  ) {
    request->send(
        400,
        "text/plain",
        "Missing path");

    return;
  }

  const String virtualPath =
      request
          ->getParam(
              "path")
          ->value();

  StorageMedium medium =
      StorageMedium::InternalFlash;
  fs::FS* targetFs =
      nullptr;
  FileStore* targetStore =
      nullptr;
  String realPath;

  if (
      !resolvePath(
          virtualPath,
          medium,
          targetFs,
          targetStore,
          realPath) ||
      !targetFs->exists(
          realPath.c_str())
  ) {
    request->send(
        404,
        "text/plain",
        "Not found");

    return;
  }

  auto* response =
      request->beginResponse(
          *targetFs,
          realPath,
          storageMimeFor(
              realPath),
          false);

  response->addHeader(
      "Cache-Control",
      "no-cache");

  // Range requests are handled by ESPAsyncWebServer's file response. Keeping
  // the file on FS/SD means MP3 playback remains streamed and never loads the
  // whole asset into ESP32 heap.
  request->send(
      response);
}

void FileManagementEndpoint::sendStorageInfo(
    AsyncWebServerRequest* request) {
  JsonDocument doc;

  // Legacy top-level LittleFS fields are retained for compatibility.
  doc["totalBytes"] =
      _storage.totalBytes(
          StorageMedium::InternalFlash);

  doc["usedBytes"] =
      _storage.usedBytes(
          StorageMedium::InternalFlash);

  doc["freeBytes"] =
      _storage.freeBytes(
          StorageMedium::InternalFlash);

  JsonObject flash =
      doc["flash"]
          .to<JsonObject>();

  flash["available"] =
      true;
  flash["name"] =
      "Internal Flash";
  flash["totalBytes"] =
      _storage.totalBytes(
          StorageMedium::InternalFlash);
  flash["usedBytes"] =
      _storage.usedBytes(
          StorageMedium::InternalFlash);
  flash["freeBytes"] =
      _storage.freeBytes(
          StorageMedium::InternalFlash);

  JsonObject sd =
      doc["sd"]
          .to<JsonObject>();

  sd["available"] =
      _storage.sdAvailable();
  sd["name"] =
      "SD Card";
  sd["type"] =
      _storage.sdCardTypeName();
  sd["cardSizeBytes"] =
      _storage.sdCardSizeBytes();
  sd["totalBytes"] =
      _storage.totalBytes(
          StorageMedium::SdCard);
  sd["usedBytes"] =
      _storage.usedBytes(
          StorageMedium::SdCard);
  sd["freeBytes"] =
      _storage.freeBytes(
          StorageMedium::SdCard);

  String body;
  serializeJson(doc, body);

  auto* response =
      request->beginResponse(
          200,
          "application/json",
          body);

  response->addHeader(
      "Cache-Control",
      "no-store");

  request->send(
      response);
}

void FileManagementEndpoint::setupRoutes() {
  // These routes intentionally use the existing URLs before ApiServer installs
  // its old LittleFS-only compatibility handlers. FileManagementEndpoint is a
  // member constructed before ApiServer::begin(), so these handlers win while
  // old clients remain source-compatible.
  _server.on(
      "/list",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        listPath(
            request);
      });

  _server.on(
      "/fsinfo",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        sendStorageInfo(
            request);
      });

  _server.on(
      "/api/storage/info",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        sendStorageInfo(
            request);
      });

  _server.on(
      "/api/files/text",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        sendTextFile(
            request);
      });

  _server.on(
      "/api/storage/file",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        sendStoredFile(
            request);
      });

  _server.on(
      "/delete",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        deletePath(
            request);
      });

  _server.on(
      "/delete",
      HTTP_DELETE,
      [this](
          AsyncWebServerRequest* request) {
        deletePath(
            request);
      });

  _server.on(
      "/upload",
      HTTP_POST,
      [this](
          AsyncWebServerRequest* request) {
        finishUploadRequest(
            request);
      },
      [this](
          AsyncWebServerRequest* request,
          String filename,
          size_t index,
          uint8_t* data,
          size_t len,
          bool final) {
        handleUploadChunk(
            request,
            filename,
            index,
            data,
            len,
            final);
      });
}
