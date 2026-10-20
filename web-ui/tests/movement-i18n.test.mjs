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

const webUiRoot =
  path.resolve(
    here,
    ".."
  );

function read(relativePath) {
  return fs.readFileSync(
    path.join(
      webUiRoot,
      relativePath
    ),
    "utf8"
  );
}

function readJson(relativePath) {
  return JSON.parse(
    read(
      relativePath
    )
  );
}

test("Movement UI translation keys stay in sync for English Hungarian and German", () => {
  const en =
    readJson(
      "src/i18n/ui.en.json"
    );

  const hu =
    readJson(
      "src/i18n/ui.hu.json"
    );

  const de =
    readJson(
      "src/i18n/ui.de.json"
    );

  const keys =
    locale =>
      Object.keys(
        locale
      )
        .filter(
          key =>
            key.startsWith(
              "movement"
            )
        )
        .sort();

  assert.deepEqual(
    keys(hu),
    keys(en)
  );

  assert.deepEqual(
    keys(de),
    keys(en)
  );

  for (
    const key of
    keys(en)
  ) {
    assert.equal(
      typeof en[key],
      "string",
      `English Movement translation must be a string: ${key}`
    );

    assert.equal(
      typeof hu[key],
      "string",
      `Hungarian Movement translation must be a string: ${key}`
    );

    assert.equal(
      typeof de[key],
      "string",
      `German Movement translation must be a string: ${key}`
    );

    assert.ok(
      en[key].trim().length >
        0,
      `English Movement translation must not be empty: ${key}`
    );

    assert.ok(
      hu[key].trim().length >
        0,
      `Hungarian Movement translation must not be empty: ${key}`
    );

    assert.ok(
      de[key].trim().length >
        0,
      `German Movement translation must not be empty: ${key}`
    );
  }
});

test("Every static Movement translation reference exists in all three UI locales", () => {
  const en =
    readJson(
      "src/i18n/ui.en.json"
    );

  const hu =
    readJson(
      "src/i18n/ui.hu.json"
    );

  const de =
    readJson(
      "src/i18n/ui.de.json"
    );

  const movementDir =
    path.join(
      webUiRoot,
      "src",
      "components",
      "movement"
    );

  const sources =
    fs.readdirSync(
      movementDir
    )
      .filter(
        name =>
          /\.(?:ts|tsx)$/.test(
            name
          )
      )
      .map(
        name =>
          fs.readFileSync(
            path.join(
              movementDir,
              name
            ),
            "utf8"
          )
      )
      .join(
        "\n"
      );

  const keys =
    [
      ...sources.matchAll(
        /\b(?:mt|movementText)\(\s*"([^"]+)"/g
      ),
    ].map(
      match =>
        match[1]
    );

  assert.ok(
    keys.length >
      0,
    "Movement translation references were not found"
  );

  for (
    const key of
    new Set(
      keys
    )
  ) {
    assert.ok(
      key in en,
      `Missing English Movement translation: ${key}`
    );

    assert.ok(
      key in hu,
      `Missing Hungarian Movement translation: ${key}`
    );

    assert.ok(
      key in de,
      `Missing German Movement translation: ${key}`
    );
  }
});

test("Movement editor does not regress to the known hardcoded English UI strings", () => {
  const files = [
    "src/components/movement/MovementEditorDialog.tsx",
    "src/components/movement/MovementPagesTable.tsx",
    "src/components/movement/MovementRouteRow.tsx",
    "src/components/movement/MovementRouteEditor.tsx",
    "src/components/movement/MovementActionEditor.tsx",
    "src/components/movement/MovementSafetyEditor.tsx",
    "src/components/movement/MovementRuntimeControls.tsx",
    "src/components/movement/MovementRouteVectorPreview.tsx",
    "src/components/movement/MovementBlockConditionsEditor.tsx",
    "src/components/movement/MovementSelectedResourceEditor.tsx",
    "src/components/movement/MovementResourceEventConditionsEditor.tsx",
    "src/components/movement/MovementExecutionScriptDialog.tsx",
  ];

  const source =
    files
      .map(
        read
      )
      .join(
        "\n"
      );

  const forbidden = [
    "Movement / Dispatcher Editor",
    "Movement load failed",
    "Movement saved",
    "Movement save failed",
    "Movement is running",
    "Stop or abort the movement before deleting it.",
    "Saved movements",
    "Edit movement",
    "Stop All",
    "Abort All",
    "Emergency Stop",
    "Clear E-Stop",
    "Track power is OFF",
    "Start movement",
    "Stop movement",
    "Action event",
    "BACKGROUND SEQUENCE",
    "BLOCKING SEQUENCE",
    "Add blocking sequence",
    "Add background sequence",
    "No sequences for this event.",
    "Approach when",
    "Arrived when",
    "Depart when",
    "Leave when",
    "No configured sensors are available in the layout.",
    "Conditions / Events",
    "Physical turnout passage",
    "No sensor in this segment",
    "Building physical movement plan...",
    "Building route vector...",
    "Movement route vector",
    "No physical safety sensors are used for this leg.",
    "Check sensor",
    "REQUIRED OFF",
    "IGNORED",
    "Read-only projection resolved from the same persisted Movement route plan used by the runtime engine.",
  ];

  for (
    const text of
    forbidden
  ) {
    assert.equal(
      source.includes(
        text
      ),
      false,
      `Hardcoded Movement UI text reintroduced: ${text}`
    );
  }
});
