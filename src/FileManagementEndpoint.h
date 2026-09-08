#pragma once

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>

#include "FileStore.h"

class FileManagementEndpoint {
public:
  explicit FileManagementEndpoint(
      AsyncWebServer& server);

private:
  static constexpr size_t MAX_UPLOAD_BYTES =
      2UL * 1024UL * 1024UL;

  AsyncWebServer& _server;

  FileStore _files{
      LittleFS};

  File _uploadFile;
  String _uploadFinalPath;

  size_t _uploadBytes = 0;

  bool _uploadBusy = false;
  bool _uploadFailed = false;
  bool _uploadCommitted = false;

  AsyncWebServerRequest* _uploadOwner = nullptr;

  void setupRoutes();

  void resetUpload();

  void handleUploadChunk(
      AsyncWebServerRequest* request,
      const String& filename,
      size_t index,
      uint8_t* data,
      size_t len,
      bool final);

  void finishUploadRequest(
      AsyncWebServerRequest* request);

  void deletePath(
      AsyncWebServerRequest* request);

  static bool safePath(
      const String& path);

  static bool safeFilename(
      const String& filename);

  static bool protectedPath(
      const String& path);

  static String joinPath(
      const String& directory,
      const String& filename);

  static void sendJson(
      AsyncWebServerRequest* request,
      int code,
      bool ok,
      const String& message);
};
