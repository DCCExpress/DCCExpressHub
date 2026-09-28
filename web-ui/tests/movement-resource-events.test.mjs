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

test("Movement resource event rules keep existing WHEN names", () => {
  const domain =
    read(
      "src/domain/movement.ts"
    );

  assert.match(
    domain,
    /MovementResourceEventName =[sS]*"enter"[sS]*"approach"[sS]*"leave"/
  );

  assert.match(
    domain,
    /resourceEventRules:[sS]*MovementResourceEventRule[]/
  );

  assert.match(
    domain,
    /MovementWhen =[sS]*"enter"[sS]*"leave"[sS]*"approach"/
  );

  assert.doesNotMatch(
    domain,
    /event:${string}/
  );
});

test("Default segment and turnout rules are visible sensor conditions", () => {
  const source =
    read(
      "src/services/movementResourceEvents.ts"
    );

  assert.match(
    source,
    /resource\.kind ===[sS]*"segment"[sS]*"enter"[sS]*"leave"/
  );

  assert.match(
    source,
    /resource\.kind ===[sS]*"turnout"[sS]*"approach"[sS]*"leave"/
  );

  assert.match(
    source,
    /event ===[sS]*"leave"[sS]*\? "all"[sS]*: "any"/
  );

  assert.match(
    source,
    /state:[sS]*active/
  );
});

test("Resource condition editor shows DEFAULT rows with ANY ALL and ON OFF", () => {
  const source =
    read(
      "src/components/movement/MovementResourceEventConditionsEditor.tsx"
    );

  assert.match(
    source,
    /"DEFAULT"/
  );

  assert.match(
    source,
    /value:[sS]*"all"[sS]*label:[sS]*"ALL"/
  );

  assert.match(
    source,
    /value:[sS]*"any"[sS]*label:[sS]*"ANY"/
  );

  assert.match(
    source,
    /condition\.state[sS]*"ON"[sS]*"OFF"/
  );

  assert.match(
    source,
    /Default: ALL assigned sensors are OFF/
  );

  assert.match(
    source,
    /Default: ANY assigned sensor is ON/
  );
});

test("Selected segment and turnout use the resource condition editor", () => {
  const source =
    read(
      "src/components/movement/MovementSelectedResourceEditor.tsx"
    );

  assert.match(
    source,
    /MovementResourceEventConditionsEditor/
  );

  assert.match(
    source,
    /resourceEventRules/
  );

  assert.match(
    source,
    /onResourceEventRulesChange/
  );
});

test("Movement runtime preserves route locking and changes only resource event boundaries", () => {
  const engine =
    read(
      "src/services/movementEngine.ts"
    );

  assert.match(
    engine,
    /effectiveMovementResourceEventRule/
  );

  assert.match(
    engine,
    /movementResourceRuleSatisfied/
  );

  assert.match(
    engine,
    /resourceEntryEvent[sS]*"turnout"[sS]*"approach"[sS]*"enter"/
  );

  assert.match(
    engine,
    /armResourceLeave/
  );

  assert.match(
    engine,
    /captureResourceLeaveTransitions/
  );

  assert.match(
    engine,
    /resourceLeaveFired/
  );

  assert.match(
    engine,
    /runLegacyLeaveIfNeeded/
  );

  assert.match(
    engine,
    /waitForLegClearance/
  );

  assert.match(
    engine,
    /tryAcquireAndSetTurnouts/
  );
});

test("Timetable snapshots deep-clone resource event rules", () => {
  const source =
    read(
      "src/services/timetableScheduler.ts"
    );

  assert.match(
    source,
    /resourceEventRules:[sS]*movement\.resourceEventRules\.map/
  );

  assert.match(
    source,
    /rule\.conditions\.map/
  );
});
