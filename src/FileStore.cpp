#include "FileStore.h"

File FileStore::openRead(
    const char* path) const {
  if (
      !path ||
      !*path
  ) {
    return File();
  }

  recover(
      path);

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
      _fs.exists(
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
      _fs.exists(
          finalPath);

  const bool hasBackup =
      _fs.exists(
          backup);

  const bool hasTemp =
      _fs.exists(
          temp);

  // A committed final file is authoritative.
  // Any remaining backup/temp is stale debris from an interrupted cleanup.
  if (hasFinal) {
    if (hasBackup) {
      _fs.remove(
          backup);
    }

    if (hasTemp) {
      _fs.remove(
          temp);
    }

    return true;
  }

  // If final disappeared after final -> backup but before temp -> final,
  // restore the last known-good committed version.
  if (hasBackup) {
    if (
        !_fs.rename(
            backup,
            finalPath)
    ) {
      return false;
    }

    // The interrupted candidate must never replace the restored backup
    // without going through its normal validator/commit path.
    if (hasTemp) {
      _fs.remove(
          temp);
    }

    return true;
  }

  // A lone temp file is an uncommitted candidate. We cannot assume it is
  // complete or valid after power loss, so discard it.
  if (hasTemp) {
    _fs.remove(
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

  _fs.remove(
      temp);

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

  _fs.remove(
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

  const String temp =
      tempPath(
          finalPath);

  const String backup =
      backupPath(
          finalPath);

  if (
      !_fs.exists(
          temp)
  ) {
    return false;
  }

  _fs.remove(
      backup);

  const bool hadFinal =
      _fs.exists(
          finalPath);

  if (
      hadFinal &&
      !_fs.rename(
          finalPath,
          backup)
  ) {
    return false;
  }

  if (
      !_fs.rename(
          temp,
          finalPath)
  ) {
    if (hadFinal) {
      _fs.rename(
          backup,
          finalPath);
    }

    return false;
  }

  _fs.remove(
      backup);

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
      _fs.exists(
          path);
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
      _fs.exists(
          path)
  ) {
    removed =
        _fs.remove(
            path) ||
        removed;
  }

  if (
      _fs.exists(
          temp)
  ) {
    removed =
        _fs.remove(
            temp) ||
        removed;
  }

  if (
      _fs.exists(
          backup)
  ) {
    removed =
        _fs.remove(
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
