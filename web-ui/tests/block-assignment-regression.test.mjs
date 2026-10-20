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
  "block picker sends full authoritative assignment payload",
  () => {
    const source =
      read(
        "src/components/track-canvas/TrackCanvasBlockLocoPicker.tsx"
      );

    assert.match(
      source,
      /wsApi\.setBlock\s*\(\s*blockId\s*,\s*loco\.id\s*,\s*loco\.address\s*\)/
    );

    assert.match(
      source,
      /const sent\s*=\s*wsApi\.setBlock/
    );

    assert.match(
      source,
      /if\s*\(\s*!sent\s*\)/
    );
  }
);

test(
  "block picker requests authoritative state after assign and remove",
  () => {
    const source =
      read(
        "src/components/track-canvas/TrackCanvasBlockLocoPicker.tsx"
      );

    const snapshotRequests =
      source.match(
        /wsApi\.getBlocks\s*\(\s*\)/g
      ) ?? [];

    assert.equal(
      snapshotRequests.length,
      2
    );

    assert.match(
      source,
      /setBlockRemove\s*\(\s*blockId\s*,\s*null\s*\)/
    );
  }
);

test(
  "layout consumes blockStateChanged as a top-level block map",
  () => {
    const source =
      read(
        "src/LiteLayoutPage.tsx"
      );

    assert.match(
      source,
      /Object\.entries\s*\(\s*data\s*\?\?\s*\{\}\s*\)/
    );

    assert.doesNotMatch(
      source,
      /Object\.entries\s*\(\s*data\.blocks/
    );
  }
);

test(
  "firmware accepts blockId, locoId and locoAddress",
  () => {
    const source =
      fs.readFileSync(
        path.resolve(
          ROOT,
          "..",
          "src",
          "WsProtocol.cpp"
        ),
        "utf8"
      );

    assert.match(
      source,
      /"setBlock"/
    );

    assert.match(
      source,
      /data\["locoId"\]/
    );

    assert.match(
      source,
      /data\["locoAddress"\]/
    );

    assert.match(
      source,
      /invalid_block_assignment/
    );
  }
);
