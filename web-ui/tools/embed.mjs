import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const data = resolve(root, "..", "data");

await mkdir(resolve(data, "assets"), { recursive: true });
const assetFiles = ["app-v2.js", "index-v2.css"];
const assets = new Map();

for (const file of assetFiles) {
  const source = await readFile(resolve(dist, "assets", file));
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  assets.set(file, { source, hash });
  await writeFile(resolve(data, "assets", `${file}.gz`), gzipSync(source, { level: 9 }));
}

let indexHtml = await readFile(resolve(dist, "index.html"), "utf8");
for (const [file, asset] of assets) {
  indexHtml = indexHtml.replace(`/assets/${file}`, `/assets/${file}?v=${asset.hash}`);
}
await writeFile(resolve(data, "index.html"), indexHtml, "utf8");

console.log("Embedded Lite UI updated in data/index.html and data/assets/.");
