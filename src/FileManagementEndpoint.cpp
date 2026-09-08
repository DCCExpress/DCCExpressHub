#include "FileManagementEndpoint.h"

#include <ArduinoJson.h>

#include "Logger.h"

FileManagementEndpoint::FileManagementEndpoint(
    AsyncWebServer& server)
    : _server(server) {
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
    const String& path) {
  return
      path == "/" ||
      path == "/config/layout.json" ||
      path == "/config/locos.json" ||
      path == "/config/signal-logic.ndjson" ||
      path == "/config/automations.json" ||
      path == "/config/device-config.json" ||
      path == "/state/runtime-state.json";
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

void FileManagementEndpoint::resetUpload() {
  if (_uploadFile) {
    _uploadFile.close();
  }

  if (
      !_uploadFinalPath.isEmpty() &&
      !_uploadCommitted
  ) {
    _files.abort(
        _uploadFinalPath.c_str());
  }

  _uploadFinalPath =
      "";

  _uploadBytes =
      0;

  _uploadBusy =
      false;

  _uploadFailed =
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

      return;
    }

    String directory =
        request
            ->getParam(
                "path")
            ->value();

    directory.trim();

    if (
        !safePath(
            directory) ||
        !safeFilename(
            filename)
    ) {
      _uploadFailed =
          true;

      return;
    }

    _uploadFinalPath =
        joinPath(
            directory,
            filename);

    if (
        !safePath(
            _uploadFinalPath) ||
        protectedPath(
            _uploadFinalPath)
    ) {
      _uploadFailed =
          true;

      return;
    }

    _uploadFile =
        _files.beginWrite(
            _uploadFinalPath.c_str());

    if (!_uploadFile) {
      _uploadFailed =
          true;

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

  if (
      _uploadBytes +
          len >
      MAX_UPLOAD_BYTES
  ) {
    _uploadFailed =
        true;

    _uploadFile.close();

    _files.abort(
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

    _uploadFile.close();

    _files.abort(
        _uploadFinalPath.c_str());

    return;
  }

  if (!final) {
    return;
  }

  _uploadFile.flush();
  _uploadFile.close();

  if (
      !_files.commit(
          _uploadFinalPath.c_str())
  ) {
    _uploadFailed =
        true;

    _files.abort(
        _uploadFinalPath.c_str());

    return;
  }

  _uploadCommitted =
      true;

  Logger::info(
      "File upload saved: " +
      _uploadFinalPath +
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
        _uploadBytes >
                MAX_UPLOAD_BYTES
            ? "Upload exceeds 2 MB"
            : "File upload failed";

    sendJson(
        request,
        _uploadBytes >
                MAX_UPLOAD_BYTES
            ? 413
            : 500,
        false,
        message);

    resetUpload();

    return;
  }

  const String savedPath =
      _uploadFinalPath;

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

  String path =
      request
          ->getParam(
              "path")
          ->value();

  path.trim();

  if (
      !safePath(
          path) ||
      protectedPath(
          path)
  ) {
    sendJson(
        request,
        403,
        false,
        "Path is protected or invalid");

    return;
  }

  File target =
      LittleFS.open(
          path);

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
          ? LittleFS.rmdir(
                path.c_str())
          : _files.remove(
                path.c_str());

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
      path);

  sendJson(
      request,
      200,
      true,
      "Deleted");
}

void FileManagementEndpoint::setupRoutes() {
  // Compatibility with the current Files page, which uses GET /delete.
  _server.on(
      "/delete",
      HTTP_GET,
      [this](
          AsyncWebServerRequest* request) {
        deletePath(
            request);
      });

  // The current Files page uploads multipart/form-data to
  // POST /upload?path=<current directory>.
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
