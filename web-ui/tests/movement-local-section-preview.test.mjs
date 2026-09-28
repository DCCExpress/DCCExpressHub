import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here =
  path.dirname(
    fileURLToPath(
      import.meta.url
    )
  );

const root =
  path.resolve(
    here,
    ".."
  );

function read(relativePath) {
  return fs.readFileSync(
    path.join(
      root,
      relativePath
    ),
    "utf8"
  );
}

test("Movement local preview is wired to the selected route vector item", () => {
  const dialog =
    read(
      "src/components/movement/MovementEditorDialog.tsx"
    );

  const vector =
    read(
      "src/components/movement/MovementRouteVectorPreview.tsx"
    );

  assert.ok(
    dialog.includes(
      "MovementLocalSectionPreview"
    )
  );

  assert.ok(
    dialog.includes(
      "routeVectorItems"
    )
  );

  assert.ok(
    dialog.includes(
      "selectedRouteVectorKey"
    )
  );

  assert.ok(
    dialog.includes(
      "onItemsChange"
    )
  );

  assert.ok(
    vector.includes(
      "onItemsChange?:"
    )
  );

  assert.ok(
    vector.includes(
      "onItemsChange?.("
    )
  );
});

test("Movement local preview groups the physical route into previous current next sections", () => {
  const preview =
    read(
      "src/components/movement/MovementLocalSectionPreview.tsx"
    );

  assert.ok(
    preview.includes(
      "buildSections"
    )
  );

  assert.ok(
    preview.includes(
      "item.nodeIndex"
    )
  );

  assert.ok(
    preview.includes(
      "currentIndex - 1"
    )
  );

  assert.ok(
    preview.includes(
      "currentIndex + 1"
    )
  );

  assert.ok(
    preview.includes(
      "Previous, selected and next graph section"
    )
  );

  assert.ok(
    preview.includes(
      "movement-local-preview-current-bg"
    )
  );
});

test("Movement local preview renders section sensors and block metadata", () => {
  const preview =
    read(
      "src/components/movement/MovementLocalSectionPreview.tsx"
    );

  const vector =
    read(
      "src/services/movementRouteVector.ts"
    );

  assert.ok(
    preview.includes(
      "movement-local-preview-sensor"
    )
  );

  assert.ok(
    preview.includes(
      "NO SECTION SENSOR"
    )
  );

  assert.ok(
    preview.includes(
      "Sensors "
    )
  );

  assert.ok(
    preview.includes(
      "block.blockId"
    )
  );

  assert.ok(
    preview.includes(
      "block.name"
    )
  );

  assert.ok(
    vector.includes(
      "sensors?: number[]"
    )
  );

  assert.ok(
    vector.includes(
      "resource.detectors"
    )
  );
});

test("Movement local preview has no escaped template-string artifacts", () => {
  const preview =
    read(
      "src/components/movement/MovementLocalSectionPreview.tsx"
    );

  assert.equal(
    preview.includes(
      "\\`"
    ),
    false
  );

  assert.equal(
    preview.includes(
      "\\${"
    ),
    false
  );

  assert.equal(
    preview.includes(
      "sensor ==="
    ),
    false
  );
});
