import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(
  import.meta.dirname,
  ".."
);

function read(relativePath) {
  return fs.readFileSync(
    path.join(
      ROOT,
      relativePath
    ),
    "utf8"
  );
}

test(
  "loco image upload targets the images directory",
  () => {
    const source =
      read(
        "src/api/imageApi.ts"
      );

    assert.match(
      source,
      /const LOCO_IMAGE_DIRECTORY = "\/images"/
    );

    assert.match(
      source,
      /\/upload\?path=\$\{encodeURIComponent\([\s\S]*?LOCO_IMAGE_DIRECTORY/
    );

    assert.doesNotMatch(
      source,
      /fetch\(\s*"\/upload"\s*,/
    );
  }
);

test(
  "loco image listing uses the same directory constant",
  () => {
    const source =
      read(
        "src/api/imageApi.ts"
      );

    assert.match(
      source,
      /\/list\?path=\$\{encodeURIComponent\([\s\S]*?LOCO_IMAGE_DIRECTORY/
    );
  }
);
