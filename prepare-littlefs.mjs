import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { gzipSync } from "node:zlib";

const projectRoot = process.cwd();
const distDir = resolve(projectRoot, "web-ui", "dist");
const dataDir = resolve(projectRoot, "data");

/*
 * Some mklittlefs builds used by PlatformIO are compiled with:
 *
 *   LFS_NAME_MAX 32
 *
 * The usable filename/directory component length is therefore 31 characters.
 * Validate here so we fail with a useful message before `pio run -t buildfs`
 * prints the much less helpful:
 *
 *   unable to open '/assets/...'
 */
const LITTLEFS_MAX_COMPONENT_LENGTH = 31;

const gzipExtensions = new Set([
  ".html",
  ".js",
  ".css",
  ".json",
  ".svg",
  ".txt",
  ".xml",
  ".map",
]);

async function walk(dir) {
  const files = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

async function ensureDistExists() {
  try {
    const info = await stat(distDir);

    if (!info.isDirectory()) {
      throw new Error();
    }
  } catch {
    throw new Error(
      [
        "web-ui/dist does not exist.",
        "Run the web build first:",
        "",
        "  cd web-ui",
        "  npm run build",
      ].join("\n")
    );
  }
}

function validateLittleFsPath(relativePath) {
  const normalized =
    relativePath.split(sep).join("/");

  const components =
    normalized
      .split("/")
      .filter(Boolean);

  for (const component of components) {
    if (
      component.length >
      LITTLEFS_MAX_COMPONENT_LENGTH
    ) {
      throw new Error(
        [
          "LittleFS filename component is too long.",
          "",
          `Path: ${normalized}`,
          `Component: ${component}`,
          `Length: ${component.length}`,
          `Maximum: ${LITTLEFS_MAX_COMPONENT_LENGTH}`,
          "",
          "Use a shorter Vite asset/worker filename pattern.",
        ].join("\n")
      );
    }
  }
}

await ensureDistExists();

console.log("Preparing LittleFS data...");
console.log(`Source: ${distDir}`);
console.log(`Target: ${dataDir}`);

await rm(dataDir, {
  recursive: true,
  force: true,
});

await mkdir(dataDir, {
  recursive: true,
});

const files = await walk(distDir);

for (const sourcePath of files) {
  const relativePath =
    relative(
      distDir,
      sourcePath
    );

  const extension =
    extname(
      sourcePath
    ).toLowerCase();

  const targetRelativePath =
    gzipExtensions.has(extension)
      ? `${relativePath}.gz`
      : relativePath;

  /*
   * Validate the FINAL filename, not only the Vite filename:
   * `.gz` adds another three characters.
   */
  validateLittleFsPath(
    targetRelativePath
  );

  const targetPath =
    resolve(
      dataDir,
      relativePath
    );

  await mkdir(
    dirname(targetPath),
    {
      recursive: true,
    }
  );

  if (
    gzipExtensions.has(
      extension
    )
  ) {
    const source =
      await readFile(
        sourcePath
      );

    const compressed =
      gzipSync(
        source,
        {
          level: 9,
        }
      );

    await writeFile(
      `${targetPath}.gz`,
      compressed
    );

    console.log(
      `gzip  ${relativePath} -> ${relativePath}.gz ` +
      `(${source.length} -> ${compressed.length} bytes)`
    );

    continue;
  }

  await cp(
    sourcePath,
    targetPath
  );

  console.log(
    `copy  ${relativePath}`
  );
}

console.log("");
console.log("LittleFS data prepared successfully.");
console.log(`Files: ${files.length}`);
console.log(`Output: ${dataDir}`);
