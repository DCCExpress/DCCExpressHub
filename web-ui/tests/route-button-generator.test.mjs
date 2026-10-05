import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT =
  path.resolve(
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

test("RouteButton editor exposes generated one-way route selector", () => {
  const editor =
    read(
      "src/layout/property-panel/RouteTurnoutSelectionPropertyEditor.tsx"
    );

  assert.match(
    editor,
    /selectGeneratedRoute/
  );

  assert.match(
    editor,
    /selectGeneratedRouteTitle/
  );

  assert.match(
    editor,
    /getAvailableGeneratedRouteButtonCandidates/
  );

  assert.match(
    editor,
    /routeCandidates\.map/
  );

  assert.match(
    editor,
    /candidate\.blockPath\.join/
  );

  assert.match(
    editor,
    /candidate\.locoDirection/
  );

  assert.match(
    editor,
    /applyGeneratedRouteButtonCandidate/
  );
});

test("generated RouteButton candidates come from graph and hide already assigned routes", () => {
  const generator =
    read(
      "src/services/routeButtonRouteGenerator.ts"
    );

  assert.match(
    generator,
    /ensureClientRouteGraph/
  );

  assert.match(
    generator,
    /ensured\.result\.routes/
  );

  assert.match(
    generator,
    /element\.id !==[\s\S]*currentRouteButtonId/
  );

  assert.match(
    generator,
    /element\.generatedRouteRef/
  );

  assert.match(
    generator,
    /!usedKeys\.has/
  );

  assert.match(
    generator,
    /fromBlock\.id[\s\S]*toBlock\.id/
  );
});

test("graph route generation maps stable turnout element IDs including multi-motor states", () => {
  const generator =
    read(
      "src/services/routeButtonRouteGenerator.ts"
    );

  assert.match(
    generator,
    /passage\.elementId/
  );

  assert.match(
    generator,
    /turnout\.turnout1Address/
  );

  assert.match(
    generator,
    /turnout\.turnout2Address/
  );

  assert.match(
    generator,
    /secondClosed:[\s\S]*second\.closed/
  );

  assert.match(
    generator,
    /turnoutId:[\s\S]*turnout\.id/
  );
});

test("generated route identity persists and manual turnout editing clears it", () => {
  const element =
    read(
      "src/models/editor/elements/RouteButtonElement.ts"
    );

  const dto =
    read(
      "src/domain/layout/layoutDto.ts"
    );

  assert.match(
    element,
    /generatedRouteRef/
  );

  assert.match(
    element,
    /clearGeneratedRoute/
  );

  assert.match(
    element,
    /addOrUpdateTurnout[\s\S]*clearGeneratedRoute/
  );

  assert.match(
    element,
    /removeTurnout[\s\S]*clearGeneratedRoute/
  );

  assert.match(
    element,
    /toJSON\(\)[\s\S]*generatedRouteRef/
  );

  assert.match(
    element,
    /fromJSON[\s\S]*generatedRouteRef/
  );

  assert.match(
    dto,
    /generatedRouteRef\?: RouteReferenceDto/
  );
});

test("generated route selector labels are translated in all UI languages", () => {
  for (
    const language of
    [
      "en",
      "hu",
      "de",
    ]
  ) {
    const ui =
      read(
        `src/i18n/ui.${language}.json`
      );

    assert.match(
      ui,
      /"selectGeneratedRoute":/
    );

    assert.match(
      ui,
      /"selectGeneratedRouteTitle":/
    );

    assert.match(
      ui,
      /"selectGeneratedRouteDescription":/
    );

    assert.match(
      ui,
      /"noUnusedGeneratedRoutes":/
    );

    assert.match(
      ui,
      /"blockPath":/
    );
  }
});


test("generated route selector button lives in RouteButton property panel header", () => {
  const page =
    read(
      "src/LiteLayoutPage.tsx"
    );

  const editor =
    read(
      "src/layout/property-panel/RouteTurnoutSelectionPropertyEditor.tsx"
    );

  assert.match(
    page,
    /selectedElement instanceof[\s\S]*RouteButtonElement[\s\S]*selectGeneratedRoute/
  );

  assert.match(
    page,
    /routeSelectRequest/
  );

  assert.match(
    editor,
    /routeSelectRequest/
  );

  assert.match(
    editor,
    /useEffect[\s\S]*openRouteSelect/
  );

  assert.doesNotMatch(
    editor,
    /IconListCheck/
  );
});


test("generated RouteButton name uses hyphen-separated block path", () => {
  const generator =
    read(
      "src/services/routeButtonRouteGenerator.ts"
    );

  assert.match(
    generator,
    /routeButton\.name/
  );

  assert.match(
    generator,
    /candidate\.blockPath\.join\([\s\S]*" - "/
  );
});
