#pragma once

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <SD.h>

#include "FileStore.h"
#include "StorageManager.h"

class FileManagementEndpoint {
public:
  explicit FileManagementEndpoint(
      AsyncWebServer& server);

private:
  static constexpr size_t MAX_FLASH_UPLOAD_BYTES =
      2UL * 1024UL * 1024UL;

  AsyncWebServer& _server;
  StorageManager& _storage;

  FileStore _flashFiles{
      LittleFS};

  FileStore _sdFiles{
      SD};

  File _uploadFile;
  FileStore* _uploadStore = nullptr;
  fs::FS* _uploadFs = nullptr;
  StorageMedium _uploadMedium = StorageMedium::InternalFlash;

  String _uploadFinalPath;
  String _uploadVirtualPath;

  size_t _uploadBytes = 0;

  bool _uploadBusy = false;
  bool _uploadFailed = false;
  bool _uploadTooLarge = false;
  bool _uploadCommitted = false;

  AsyncWebServerRequest* _uploadOwner = nullptr;

  void setupRoutes();
  void setupStorageStaticFiles();

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

  void listPath(
      AsyncWebServerRequest* request);

  void sendTextFile(
      AsyncWebServerRequest* request);

  void sendStoredFile(
      AsyncWebServerRequest* request);

  void sendStorageInfo(
      AsyncWebServerRequest* request);

  bool resolvePath(
      const String& virtualPath,
      StorageMedium& medium,
      fs::FS*& fs,
      FileStore*& store,
      String& realPath);

  static bool safePath(
      const String& path);

  static bool safeFilename(
      const String& filename);

  static bool protectedPath(
      StorageMedium medium,
      const String& realPath);

  static String joinPath(
      const String& directory,
      const String& filename);

  static void sendJson(
      AsyncWebServerRequest* request,
      int code,
      bool ok,
      const String& message);
};
