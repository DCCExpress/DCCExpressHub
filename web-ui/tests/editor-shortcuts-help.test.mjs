import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = relativePath => readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");

test("empty property panel shows shortcut help directly below Layout Visibility", () => {
  const page = read("src/LiteLayoutPage.tsx");
  assert.match(page, /<VisibilitySettings title=\{i18next\.t\("ui\.layoutVisibility"\)\} \/>/);
  assert.match(page, /<VisibilitySettings[^>]*\/>\s*<EditorShortcutsHelp\s*\/>/);
  assert.match(page, /import EditorShortcutsHelp from/);
});

test("shortcut help lists implemented controls, with localized labels", () => {
  const help = read("src/layout/property-panel/EditorShortcutsHelp.tsx");
  const keys = [
    "editorShortcutsTitle", "editorShortcutRotate", "editorShortcutSelect",
    "editorShortcutSave", "editorShortcutPan", "editorShortcutZoom",
    "editorShortcutFit", "editorShortcutEditMode", "editorShortcutDelete",
    "editorShortcutClone", "editorShortcutMultiSelect",
    "editorShortcutPanKeys", "editorShortcutZoomKeys", "editorShortcutMultiSelectKeys",
    "editorShortcutsCanvasHint",
  ];
  for (const lang of ["en", "hu", "de"]) {
    const dict = JSON.parse(read("src/i18n/ui." + lang + ".json"));
    for (const key of keys) {
      assert.equal(typeof dict[key], "string", lang + ": " + key);
      assert.ok(dict[key].trim().length > 0, lang + ": " + key);
      assert.ok(help.includes('"ui.' + key + '"'), "unused help translation: " + key);
    }
  }
  assert.match(help, /<SimpleGrid cols=\{1\}/);
});

test("shortcut descriptions agree with actual keyboard and canvas handlers", () => {
  const keys = read("src/components/track-canvas/trackCanvasKeyboard.ts");
  const globals = read("src/hooks/layout/useLayoutPageShortcuts.ts");
  const mouse = read("src/components/track-canvas/trackCanvasMouseDown.ts");
  const wheel = read("src/components/track-canvas/trackCanvasWheel.ts");
  assert.match(keys, /event\.key === "r" \|\| event\.key === "R"/);
  assert.match(keys, /event\.key\.toLowerCase\(\) === "f"/);
  assert.match(keys, /event\.key === "Delete" \|\| event\.key === "Backspace"/);
  assert.match(keys, /event\.key\.toLowerCase\(\) === "c"/);
  assert.match(globals, /ev\.key\.toLowerCase\(\) === "s"/);
  assert.match(globals, /ev\.key === "Escape"/);
  assert.match(globals, /ev\.key\.toLowerCase\(\) === "e"/);
  assert.match(mouse, /event\.button === 2/);
  assert.match(mouse, /event\.ctrlKey/);
  assert.match(wheel, /event\.deltaY < 0/);
});
