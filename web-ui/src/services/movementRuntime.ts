import type {
  MovementPage,
} from "../domain/movement";

import type {
  AutomationBlockOption,
} from "./automationBlockCatalog";

function blockName(
  blockId: number,
  catalog:
    AutomationBlockOption[]
): string {
  const block =
    catalog.find(
      item =>
        item.id ===
        blockId
    );

  if (!block) {
    throw new Error(
      `Movement references missing block #${blockId}.`
    );
  }

  return block.name;
}

export function movementExecutionId(
  pageId: string
): string {
  return `movement:${pageId}`;
}

export function buildMovementScript(
  page:
    MovementPage,
  catalog:
    AutomationBlockOption[]
): string {
  if (
    page.fromBlockId ===
      null ||
    page.toBlockId ===
      null
  ) {
    throw new Error(
      "Movement requires FROM and TO blocks."
    );
  }

  const routeIds = [
    page.fromBlockId,
    ...page.viaBlockIds,
    page.toBlockId,
  ];

  if (
    routeIds.length <
    2
  ) {
    throw new Error(
      "Movement requires at least two route blocks."
    );
  }

  const route =
    routeIds.map(
      blockId => {
        const name =
          blockName(
            blockId,
            catalog
          );

        const rule =
          page.blockRules.find(
            item =>
              item.blockId ===
              blockId
          );

        if (
          blockId ===
            page.fromBlockId ||
          !rule ||
          rule.arrivedWhen.length ===
            0
        ) {
          return JSON.stringify(
            name
          );
        }

        const arrivedWhen =
          rule.arrivedWhen.map(
            condition => ({
              sensor:
                condition.sensor,
              state:
                condition.state,
            })
          );

        return JSON.stringify({
          block:
            name,
          arrivedWhen,
        });
      }
    );

  const checkpointNames =
    routeIds
      .slice(1)
      .map(
        blockId =>
          blockName(
            blockId,
            catalog
          )
      );

  const speed =
    Math.max(
      0,
      Math.min(
        126,
        Math.round(
          page.speed
        )
      )
    );

  const waits =
    checkpointNames
      .map(
        name =>
          `    await run.waitForBlock(${JSON.stringify(name)});`
      )
      .join(
        "\n"
      );

  return [
    "await smartDispatcher(",
    "  [",
    route
      .map(
        item =>
          `    ${item}`
      )
      .join(",\n"),
    "  ],",
    "  async (loco, dir, run) => {",
    `    log("Movement started", ${JSON.stringify(page.name)}, loco, dir);`,
    `    run.setSpeed(${speed});`,
    waits,
    `    log("Movement completed", ${JSON.stringify(page.name)}, loco, dir);`,
    "  }",
    ");",
  ].join(
    "\n"
  );
}
