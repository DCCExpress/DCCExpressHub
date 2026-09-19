#include "FileStore.h"

#include "Logger.h"

namespace {

constexpr uint8_t FILE_OPERATION_RETRIES =
    5;

constexpr uint32_t FILE_OPERATION_RETRY_DELAY_MS =
    5;

bool isTransactionSidecarPath(
    const String& path) {
  return
      path.endsWith(".tmp") ||
      path.endsWith(".bak");
}

// Arduino-ESP32 FS::exists() internally tries to open the file and logs an
// ERROR when a missing path is perfectly normal. Atomic save routinely probes
// optional .tmp/.bak files, so use a directory scan instead and keep the serial
// log clean.
bool existsQuiet(
    fs::FS& fs,
    const String& path) {
  if (
      path.isEmpty() ||
      !path.startsWith("/")
  ) {
    return false;
  }

  const int slash =
      path.lastIndexOf('/');

  const String parent =
      slash <= 0
          ? "/"
          : path.substring(
                0,
                slash);

  const String wanted =
      path.substring(
          slash + 1);

  File dir =
      fs.open(
          parent,
          "r");

  if (
      !dir ||
      !dir.isDirectory()
  ) {
    if (dir) {
      dir.close();
    }

    return false;
  }

  File item =
      dir.openNextFile();

  while (item) {
    String name =
        String(
            item.name());

    const int itemSlash =
        name.lastIndexOf('/');

    if (itemSlash >= 0) {
      name =
          name.substring(
              itemSlash + 1);
    }

    const bool match =
        name == wanted;

    item.close();

    if (match) {
      dir.close();
      return true;
    }

    item =
        dir.openNextFile();
  }

  dir.close();

  return false;
}

bool removeIfExists(
    fs::FS& fs,
    const String& path) {
  if (
      path.isEmpty() ||
      !existsQuiet(
          fs,
          path)
  ) {
    return true;
  }

  for (
      uint8_t attempt = 0;
      attempt <
          FILE_OPERATION_RETRIES;
      ++attempt
  ) {
    if (
        fs.remove(
            path)
    ) {
      return true;
    }

    delay(
        FILE_OPERATION_RETRY_DELAY_MS);
  }

  return
      !existsQuiet(
          fs,
          path);
}

bool renameWithRetry(
    fs::FS& fs,
    const String& from,
    const String& to) {
  for (
      uint8_t attempt = 0;
      attempt <
          FILE_OPERATION_RETRIES;
      ++attempt
  ) {
    if (
        fs.rename(
            from,
            to)
    ) {
      return true;
    }

    delay(
        FILE_OPERATION_RETRY_DELAY_MS);
  }

  return false;
}

bool copyFile(
    fs::FS& fs,
    const String& sourcePath,
    const String& targetPath) {
  File source =
      fs.open(
          sourcePath,
          "r");

  if (!source) {
    return false;
  }

  File target =
      fs.open(
          targetPath,
          "w");

  if (!target) {
    source.close();
    return false;
  }

  uint8_t buffer[512];

  bool ok =
      true;

  while (
      source.available()
  ) {
    const size_t read =
        source.read(
            buffer,
            sizeof(buffer));

    if (
        read == 0
    ) {
      break;
    }

    const size_t written =
        target.write(
            buffer,
            read);

    if (
        written != read
    ) {
      ok =
          false;

      break;
    }
  }

  target.flush();

  source.close();
  target.close();

  if (!ok) {
    removeIfExists(
        fs,
        targetPath);

    return false;
  }

  return true;
}

bool restoreBackup(
    fs::FS& fs,
    const String& backup,
    const String& finalPath) {
  if (
      !existsQuiet(
          fs,
          backup)
  ) {
    return false;
  }

  removeIfExists(
      fs,
      finalPath);

  if (
      renameWithRetry(
          fs,
          backup,
          finalPath)
  ) {
    return true;
  }

  // Fallback for filesystems where rename is temporarily unavailable:
  // copy the already closed backup back to the final path.
  if (
      copyFile(
          fs,
          backup,
          finalPath)
  ) {
    removeIfExists(
        fs,
        backup);

    return true;
  }

  return false;
}

}

File FileStore::openRead(
    const char* path) const {
  if (
      !path ||
      !*path
  ) {
    return File();
  }

  const String value =
      path;

  // Transaction sidecars must never recursively spawn recovery sidecars such
  // as ".tmp.tmp" or ".tmp.bak" when opened for validation.
  if (
      !isTransactionSidecarPath(
          value)
  ) {
    recover(
        path);
  }

  return
      _fs.open(
          path,
          "r");
}

String FileStore::tempPath(
    const char* finalPath) const {
  return
      String(finalPath) +
      ".tmp";
}

String FileStore::backupPath(
    const char* finalPath) const {
  return
      String(finalPath) +
      ".bak";
}

bool FileStore::ensureParent(
    const char* path) {
  if (!path) {
    return false;
  }

  String value =
      path;

  const int slash =
      value.lastIndexOf('/');

  if (slash <= 0) {
    return true;
  }

  const String parent =
      value.substring(
          0,
          slash);

  if (
      existsQuiet(
          _fs,
          parent)
  ) {
    return true;
  }

  return
      _fs.mkdir(
          parent);
}

bool FileStore::recover(
    const char* finalPath) const {
  if (
      !finalPath ||
      !*finalPath
  ) {
    return false;
  }

  const String temp =
      tempPath(
          finalPath);

  const String backup =
      backupPath(
          finalPath);

  const bool hasFinal =
      existsQuiet(
          _fs,
          String(finalPath));

  const bool hasBackup =
      existsQuiet(
          _fs,
          backup);

  const bool hasTemp =
      existsQuiet(
          _fs,
          temp);

  // A committed final file is authoritative.
  // Any remaining backup/temp is stale debris from an interrupted cleanup.
  if (hasFinal) {
    if (hasBackup) {
      removeIfExists(
          _fs,
          backup);
    }

    if (hasTemp) {
      removeIfExists(
          _fs,
          temp);
    }

    return true;
  }

  // If final disappeared after backup creation but before temp -> final,
  // restore the last known-good committed version.
  if (hasBackup) {
    if (
        !restoreBackup(
            _fs,
            backup,
            finalPath)
    ) {
      Logger::error(
          "FileStore recovery failed for " +
          String(finalPath));

      return false;
    }

    // The interrupted candidate must never replace the restored backup
    // without going through its normal validator/commit path.
    if (hasTemp) {
      removeIfExists(
          _fs,
          temp);
    }

    return true;
  }

  // A lone temp file is an uncommitted candidate. We cannot assume it is
  // complete or valid after power loss, so discard it.
  if (hasTemp) {
    removeIfExists(
        _fs,
        temp);
  }

  return false;
}

File FileStore::beginWrite(
    const char* finalPath) {
  if (
      !finalPath ||
      !*finalPath ||
      !ensureParent(
          finalPath)
  ) {
    return File();
  }

  // Clean up or restore an interrupted previous transaction before a new one.
  recover(
      finalPath);

  const String temp =
      tempPath(
          finalPath);

  if (
      !removeIfExists(
          _fs,
          temp)
  ) {
    Logger::error(
        "FileStore: could not remove stale temp file " +
        temp);

    return File();
  }

  return
      _fs.open(
          temp,
          "w");
}

void FileStore::abort(
    const char* finalPath) {
  if (
      !finalPath ||
      !*finalPath
  ) {
    return;
  }

  removeIfExists(
      _fs,
      tempPath(
          finalPath));
}

bool FileStore::commit(
    const char* finalPath) {
  if (
      !finalPath ||
      !*finalPath
  ) {
    return false;
  }

  const String final =
      finalPath;

  const String temp =
      tempPath(
          finalPath);

  const String backup =
      backupPath(
          finalPath);

  if (
      !existsQuiet(
          _fs,
          temp)
  ) {
    Logger::error(
        "FileStore commit failed: temp file missing: " +
        temp);

    return false;
  }

  // Never rename the live final file to create the backup.
  // A pending HTTP file response may still have that file open on LittleFS.
  // Copying it first lets us explicitly close both handles before replacement.
  if (
      !removeIfExists(
          _fs,
          backup)
  ) {
    Logger::error(
        "FileStore commit failed: stale backup could not be removed: " +
        backup);

    return false;
  }

  const bool hadFinal =
      existsQuiet(
          _fs,
          final);

  if (hadFinal) {
    if (
        !copyFile(
            _fs,
            final,
            backup)
    ) {
      Logger::error(
          "FileStore commit failed: backup copy failed: " +
          final +
          " -> " +
          backup);

      return false;
    }

    // copyFile() has closed both source and destination handles here.
    // Retry removal briefly because ESPAsyncWebServer/LittleFS may release
    // a response file handle a few milliseconds after the request completes.
    if (
        !removeIfExists(
            _fs,
            final)
    ) {
      Logger::error(
          "FileStore commit failed: final file is still busy: " +
          final);

      removeIfExists(
          _fs,
          backup);

      return false;
    }
  }

  if (
      !renameWithRetry(
          _fs,
          temp,
          final)
  ) {
    Logger::error(
        "FileStore commit failed: temp rename failed: " +
        temp +
        " -> " +
        final);

    if (hadFinal) {
      if (
          !restoreBackup(
              _fs,
              backup,
              final)
      ) {
        Logger::error(
            "FileStore CRITICAL: rollback failed for " +
            final);
      }
    }

    return false;
  }

  if (
      !removeIfExists(
          _fs,
          backup)
  ) {
    // The new final is already valid and committed. A leftover backup is
    // harmless; recover() will remove it on the next access/restart.
    Logger::warn(
        "FileStore: committed " +
        final +
        " but stale backup remains: " +
        backup);
  }

  Logger::info(
      "FileStore committed: " +
      final);

  return true;
}

bool FileStore::exists(
    const char* path) const {
  if (
      !path ||
      !*path
  ) {
    return false;
  }

  recover(
      path);

  return
      existsQuiet(
          _fs,
          String(path));
}

bool FileStore::remove(
    const char* path) {
  if (
      !path ||
      !*path
  ) {
    return false;
  }

  const String temp =
      tempPath(
          path);

  const String backup =
      backupPath(
          path);

  bool removed =
      false;

  if (
      existsQuiet(
          _fs,
          String(path))
  ) {
    removed =
        removeIfExists(
            _fs,
            path) ||
        removed;
  }

  if (
      existsQuiet(
          _fs,
          temp)
  ) {
    removed =
        removeIfExists(
            _fs,
            temp) ||
        removed;
  }

  if (
      existsQuiet(
          _fs,
          backup)
  ) {
    removed =
        removeIfExists(
            _fs,
            backup) ||
        removed;
  }

  return removed;
}

bool FileStore::saveJson(
    const char* finalPath,
    JsonDocument& document) {
  File file =
      beginWrite(
          finalPath);

  if (!file) {
    return false;
  }

  const size_t written =
      serializeJson(
          document,
          file);

  file.flush();
  file.close();

  if (
      written == 0
  ) {
    abort(
        finalPath);

    return false;
  }

  if (
      !commit(
          finalPath)
  ) {
    abort(
        finalPath);

    return false;
  }

  return true;
}

bool AtomicFileUpload::begin(
    FileStore& store,
    const char* finalPath,
    size_t expectedBytes,
    size_t maxBytes) {
  abort();

  _store =
      &store;

  _finalPath =
      finalPath
          ? finalPath
          : "";

  _expectedBytes =
      expectedBytes;

  _writtenBytes =
      0;

  _tooLarge =
      maxBytes > 0 &&
      expectedBytes >
          maxBytes;

  _failed =
      _finalPath.isEmpty();

  _finished =
      false;

  if (
      _tooLarge ||
      _failed
  ) {
    return false;
  }

  _file =
      _store->beginWrite(
          _finalPath.c_str());

  if (!_file) {
    _failed =
        true;

    return false;
  }

  return true;
}

bool AtomicFileUpload::write(
    const uint8_t* data,
    size_t length) {
  if (
      _tooLarge ||
      _failed ||
      _finished ||
      !_file
  ) {
    return false;
  }

  const size_t written =
      _file.write(
          data,
          length);

  _writtenBytes +=
      written;

  if (
      written !=
      length
  ) {
    _failed =
        true;

    return false;
  }

  return true;
}

bool AtomicFileUpload::finish() {
  if (_finished) {
    return
        !_tooLarge &&
        !_failed &&
        _writtenBytes ==
            _expectedBytes;
  }

  _finished =
      true;

  if (_file) {
    _file.flush();
    _file.close();

    // Explicitly clear the File wrapper after close so no stale filesystem
    // handle can remain owned by AtomicFileUpload during commit().
    _file =
        File();
  }

  if (
      _tooLarge ||
      _failed ||
      _writtenBytes !=
          _expectedBytes
  ) {
    _failed =
        !_tooLarge;

    if (_store) {
      _store->abort(
          _finalPath.c_str());
    }

    return false;
  }

  return true;
}

bool AtomicFileUpload::commit() {
  if (
      !finish() ||
      !_store
  ) {
    return false;
  }

  const bool ok =
      _store->commit(
          _finalPath.c_str());

  if (!ok) {
    _store->abort(
        _finalPath.c_str());

    _failed =
        true;
  }

  return ok;
}

void AtomicFileUpload::abort() {
  if (_file) {
    _file.close();

    _file =
        File();
  }

  if (
      _store &&
      !_finalPath.isEmpty()
  ) {
    _store->abort(
        _finalPath.c_str());
  }

  _store =
      nullptr;

  _finalPath =
      "";

  _expectedBytes =
      0;

  _writtenBytes =
      0;

  _tooLarge =
      false;

  _failed =
      false;

  _finished =
      false;
}

String AtomicFileUpload::tempPath() const {
  return
      _store
          ? _store->tempPath(
                _finalPath.c_str())
          : String();
}
