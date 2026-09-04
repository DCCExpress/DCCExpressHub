import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_TOTAL_BYTES = 4 * 1024 * 1024;

export class MockLittleFS {
  constructor(rootDir, totalBytes = DEFAULT_TOTAL_BYTES) {
    this.rootDir = path.resolve(rootDir);
    this.totalBytes = totalBytes;
    this.ensureSeed();
  }

  ensureSeed() {
    fs.mkdirSync(this.rootDir, { recursive: true });

    for (const dir of [
      "images",
      "config",
      "scripts",
      "audio",
      "backup",
      "test"
    ]) {
      fs.mkdirSync(path.join(this.rootDir, dir), { recursive: true });
    }

    this.seedJson("config/locos.json", [
      {
        id: "mock-loco-3",
        name: "Mock locomotive 3",
        address: 3,
        maxSpeed: 100,
        invert: false,
        length: 180,
        functions: [
          { id: "f0", number: 0, name: "Light", icon: "lightbulb", momentary: false },
          { id: "f1", number: 1, name: "Sound", icon: "volume", momentary: false }
        ]
      }
    ]);

    this.seedJson("config/layout.json", null);
    this.seedJson("config/app-settings.json", {});
    this.seedJson("config/command-center.json", {
      name: "Local DCC-EX simulator",
      type: "simulator",
      z21: {},
      dccexTcp: { host: "127.0.0.1", port: 2560 },
      dccexSerial: {},
      autoConnect: true
    });

    const readme = path.join(this.rootDir, "README.txt");
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(
        readme,
        "DCCExpressHub Local LittleFS simulator\n\nThis directory emulates ESP32 LittleFS.\n",
        "utf8"
      );
    }
  }

  seedJson(relativePath, value) {
    const full = path.join(this.rootDir, relativePath);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, JSON.stringify(value, null, 2) + "\n", "utf8");
    }
  }

  normalizeVirtualPath(input = "/") {
    let value = String(input || "/").replaceAll("\\", "/").trim();
    if (!value.startsWith("/")) value = "/" + value;
    const parts = value.split("/").filter(Boolean);

    if (parts.some(part => part === ".." || part === ".")) {
      throw new Error("Invalid LittleFS path");
    }

    return "/" + parts.join("/");
  }

  resolveVirtual(input = "/") {
    const virtualPath = this.normalizeVirtualPath(input);
    const relative = virtualPath.replace(/^\/+/, "");
    const fullPath = path.resolve(this.rootDir, relative);

    if (
      fullPath !== this.rootDir &&
      !fullPath.startsWith(this.rootDir + path.sep)
    ) {
      throw new Error("Path escapes mock LittleFS root");
    }

    return { virtualPath, fullPath };
  }

  virtualJoin(parent, child) {
    const base = this.normalizeVirtualPath(parent);
    const leaf = path.basename(String(child || "").replaceAll("\\", "/"));
    return this.normalizeVirtualPath(`${base}/${leaf}`);
  }

  list(input = "/") {
    const { virtualPath, fullPath } = this.resolveVirtual(input);

    if (!fs.existsSync(fullPath)) {
      return { path: virtualPath, entries: [] };
    }

    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) {
      throw new Error("Path is not a directory");
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true })
      .map(entry => {
        const childFull = path.join(fullPath, entry.name);
        const childStat = fs.statSync(childFull);
        const childVirtual = this.virtualJoin(virtualPath, entry.name);

        return {
          name: entry.name,
          path: childVirtual,
          type: entry.isDirectory() ? "directory" : "file",
          size: entry.isDirectory() ? 0 : childStat.size
        };
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return { path: virtualPath, entries };
  }

  mkdir(input) {
    const { virtualPath, fullPath } = this.resolveVirtual(input);
    fs.mkdirSync(fullPath, { recursive: true });
    return virtualPath;
  }

  readBuffer(input) {
    const { fullPath } = this.resolveVirtual(input);
    return fs.readFileSync(fullPath);
  }

  readText(input) {
    return this.readBuffer(input).toString("utf8");
  }

  readJson(input, fallback = undefined) {
    const { fullPath } = this.resolveVirtual(input);
    if (!fs.existsSync(fullPath)) return fallback;
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  }

  writeBuffer(input, buffer) {
    const { virtualPath, fullPath } = this.resolveVirtual(input);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    const existing = fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0;
    const usedWithoutExisting = this.usedBytes() - existing;

    if (usedWithoutExisting + buffer.length > this.totalBytes) {
      const error = new Error("LittleFS is full");
      error.code = "ENOSPC";
      throw error;
    }

    fs.writeFileSync(fullPath, buffer);
    return virtualPath;
  }

  writeText(input, text) {
    return this.writeBuffer(input, Buffer.from(String(text), "utf8"));
  }

  writeJson(input, value) {
    return this.writeText(input, JSON.stringify(value, null, 2) + "\n");
  }

  delete(input) {
    const { virtualPath, fullPath } = this.resolveVirtual(input);

    if (fullPath === this.rootDir) {
      throw new Error("Cannot delete LittleFS root");
    }

    if (!fs.existsSync(fullPath)) return false;

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(fullPath);
      if (entries.length > 0) {
        throw new Error("Directory is not empty");
      }
      fs.rmdirSync(fullPath);
    } else {
      fs.unlinkSync(fullPath);
    }

    return { deleted: true, path: virtualPath };
  }

  exists(input) {
    const { fullPath } = this.resolveVirtual(input);
    return fs.existsSync(fullPath);
  }

  stat(input) {
    const { virtualPath, fullPath } = this.resolveVirtual(input);
    if (!fs.existsSync(fullPath)) return null;
    const stat = fs.statSync(fullPath);
    return {
      path: virtualPath,
      type: stat.isDirectory() ? "directory" : "file",
      size: stat.isDirectory() ? 0 : stat.size
    };
  }

  usedBytes() {
    let total = 0;

    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else total += fs.statSync(full).size;
      }
    };

    walk(this.rootDir);
    return total;
  }

  info() {
    const usedBytes = this.usedBytes();
    return {
      totalBytes: this.totalBytes,
      usedBytes,
      freeBytes: Math.max(0, this.totalBytes - usedBytes)
    };
  }

  reset() {
    fs.rmSync(this.rootDir, { recursive: true, force: true });
    this.ensureSeed();
    return this.info();
  }
}

export function parseMultipartSingleFile(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  const boundary = match?.[1] || match?.[2];

  if (!boundary) {
    throw new Error("Multipart boundary is missing");
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const headerSeparator = Buffer.from("\r\n\r\n");

  let cursor = 0;

  while (cursor < buffer.length) {
    const boundaryIndex = buffer.indexOf(delimiter, cursor);
    if (boundaryIndex < 0) break;

    let partStart = boundaryIndex + delimiter.length;

    if (
      buffer[partStart] === 45 &&
      buffer[partStart + 1] === 45
    ) {
      break;
    }

    if (
      buffer[partStart] === 13 &&
      buffer[partStart + 1] === 10
    ) {
      partStart += 2;
    }

    const headerEnd = buffer.indexOf(headerSeparator, partStart);
    if (headerEnd < 0) break;

    const headers = buffer.subarray(partStart, headerEnd).toString("utf8");
    const nextBoundary = buffer.indexOf(delimiter, headerEnd + 4);
    if (nextBoundary < 0) break;

    let dataEnd = nextBoundary;
    if (
      buffer[dataEnd - 2] === 13 &&
      buffer[dataEnd - 1] === 10
    ) {
      dataEnd -= 2;
    }

    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(headers)?.[1] || "";
    const name = /name="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];

    if (name === "file" && filename) {
      const mime =
        /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ||
        "application/octet-stream";

      return {
        fieldName: name,
        fileName: path.basename(filename.replaceAll("\\", "/")),
        contentType: mime,
        data: buffer.subarray(headerEnd + 4, dataEnd)
      };
    }

    cursor = nextBoundary;
  }

  throw new Error("Multipart upload did not contain a file field");
}

export function contentTypeFor(fileName) {
  const ext = path.extname(fileName).toLowerCase();

  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg"
  })[ext] || "application/octet-stream";
}
