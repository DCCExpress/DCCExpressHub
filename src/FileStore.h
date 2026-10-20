#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <FS.h>

class FileStore {
public:
  explicit FileStore(
      fs::FS& fs)
      : _fs(fs) {}

  File openRead(
      const char* path) const;

  File beginWrite(
      const char* finalPath);

  bool commit(
      const char* finalPath);

  void abort(
      const char* finalPath);

  bool recover(
      const char* finalPath) const;

  bool exists(
      const char* path) const;

  bool remove(
      const char* path);

  bool ensureParent(
      const char* path);

  String tempPath(
      const char* finalPath) const;

  String backupPath(
      const char* finalPath) const;

  bool saveJson(
      const char* finalPath,
      JsonDocument& document);

private:
  fs::FS& _fs;
};

class AtomicFileUpload {
public:
  bool begin(
      FileStore& store,
      const char* finalPath,
      size_t expectedBytes,
      size_t maxBytes = 0);

  bool write(
      const uint8_t* data,
      size_t length);

  bool finish();

  bool commit();

  void abort();

  bool tooLarge() const {
    return _tooLarge;
  }

  bool failed() const {
    return _failed;
  }

  size_t expectedBytes() const {
    return _expectedBytes;
  }

  size_t writtenBytes() const {
    return _writtenBytes;
  }

  String tempPath() const;

private:
  FileStore* _store = nullptr;
  String _finalPath;
  File _file;

  size_t _expectedBytes = 0;
  size_t _writtenBytes = 0;

  bool _tooLarge = false;
  bool _failed = false;
  bool _finished = false;
};
