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
  dirname,
  extname,
  join,
  relative,
  resolve,
} from "node:path";
import { gzipSync } from "node:zlib";

const projectRoot = process.cwd();
const distDir = resolve(projectRoot, "web-ui", "dist");
const dataDir = resolve(projectRoot, "data");

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
  const relativePath = relative(distDir, sourcePath);
  const targetPath = resolve(dataDir, relativePath);

  await mkdir(dirname(targetPath), {
    recursive: true,
  });

  const extension = extname(sourcePath).toLowerCase();

  if (gzipExtensions.has(extension)) {
    const source = await readFile(sourcePath);
    const compressed = gzipSync(source, { level: 9 });

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

  await cp(sourcePath, targetPath);
  console.log(`copy  ${relativePath}`);
}

console.log("");
console.log("LittleFS data prepared successfully.");
console.log(`Files: ${files.length}`);
console.log(`Output: ${dataDir}`);
