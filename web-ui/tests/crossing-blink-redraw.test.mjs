import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webUiRoot = path.resolve(here, "..");

const source = fs.readFileSync(
  path.join(webUiRoot, "src/components/TrackCanvas.tsx"),
  "utf8"
);

test("TrackCanvas owns level-crossing blink redraw", () => {
  assert.match(
    source,
    /TrackLevelCrossingElement/
  );

  assert.match(
    source,
    /window\.setInterval\(\(\) => \{[\s\S]*?element instanceof TrackLevelCrossingElement[\s\S]*?requestDraw\(\)[\s\S]*?\}, 225\)/
  );
});
