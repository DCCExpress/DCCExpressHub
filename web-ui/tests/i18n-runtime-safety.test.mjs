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
  "language switch is a clean application-boundary reload",
  () => {
    const source =
      read(
        "src/components/LanguageSwitcher.tsx"
      );

    assert.match(
      source,
      /localStorage\.setItem\([\s\S]*?"lang"/
    );

    assert.match(
      source,
      /window\.history\.replaceState/
    );

    assert.match(
      source,
      /window\.location\.reload/
    );

    assert.doesNotMatch(
      source,
      /\.changeLanguage\s*\(/
    );
  }
);

test(
  "i18n generator never injects language dependencies into useCallback",
  () => {
    const source =
      read(
        "tools/apply-i18n.mjs"
      );

    assert.match(
      source,
      /parent\.expression\.getText\(ast\)\s*===\s*['"]useMemo['"]/
    );

    assert.doesNotMatch(
      source,
      /\[['"]useMemo['"]\s*,\s*['"]useCallback['"]\]/
    );
  }
);

test(
  "static translated labels require a stable identity field",
  () => {
    const source =
      read(
        "tools/apply-i18n.mjs"
      );

    for (
      const stableKey of [
        "id",
        "value",
        "key",
        "position",
        "type",
        "action",
        "mode",
        "protocol",
      ]
    ) {
      assert.ok(
        source.includes(
          `'${stableKey}'`
        ),
        `missing stable key guard: ${stableKey}`
      );
    }

    assert.match(
      source,
      /hasStableIdentitySibling/
    );
  }
);

test(
  "three-way turnout logic never compares translated labels",
  () => {
    const source =
      read(
        "src/layout/property-panel/TurnoutBitPropertyEditor.tsx"
      );

    assert.doesNotMatch(
      source,
      /position\.label\s*===/
    );

    assert.doesNotMatch(
      source,
      /switch\s*\(\s*position\.label\s*\)/
    );

    assert.match(
      source,
      /id:\s*"left"/
    );

    assert.match(
      source,
      /id:\s*"straight"/
    );

    assert.match(
      source,
      /id:\s*"right"/
    );
  }
);
