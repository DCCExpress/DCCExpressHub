import type { SerializedLayoutDto } from "../domain/layout/layoutDto";
import type { PersistedRouteTableEntry } from "./clientRouteGraphCache";

export type ScriptRouteOption = {
  id: string;
  label: string;
  path: string;
  direction: "forward" | "reverse";
  route: PersistedRouteTableEntry;
};

type ScriptRouteLeg = {
  from: string;
  to: string;
  sensor: number;
  turnouts: Array<{ address: number; closed: boolean }>;
};

function isValidSensor(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isInteger(value) && value > 0 && value <= 65535;
}

/** Use the saved, direction-aware graph; never join independent route fragments. */
export function listScriptRoutes(layout: SerializedLayoutDto): ScriptRouteOption[] {
  const topology = layout.routeTopology as
    { graph?: { ready?: boolean }; routeTable?: PersistedRouteTableEntry[] } | undefined;
  if (!topology?.graph?.ready || !Array.isArray(topology.routeTable)) {
    throw new Error("No saved route graph. Generate and save the route graph in the editor first.");
  }

  return topology.routeTable
    .filter(route =>
      (route.locoDirection === "forward" || route.locoDirection === "reverse") &&
      Array.isArray(route.blockPath) &&
      route.blockPath.length >= 2 &&
      route.blockPath[0]?.id === route.fromBlockId &&
      route.blockPath[route.blockPath.length - 1]?.id === route.toBlockId &&
      Array.isArray(route.edgePath))
    .map((route, index) => ({
      id: String(index),
      path: route.blockPath.map(block => block.name).join(" → "),
      label: route.blockPath.map(block => block.name).join(" → ") +
        ` (${route.locoDirection})`,
      direction: route.locoDirection as "forward" | "reverse",
      route,
    }));
}

/** Generate an editable script; it is never executed by this function. */
export function generateScriptFromRoute(
  layout: SerializedLayoutDto,
  choice: ScriptRouteOption,
): string {
  const route = choice.route;
  const blocks = route.blockPath;
  const sensorByBlock = new Map<number, number>();
  const seenBlockNames = new Set<string>();

  for (const layer of layout.layers ?? []) {
    for (const element of layer.elements ?? []) {
      if (element.type !== "trackblock") continue;
      if (isValidSensor(element.id) && isValidSensor(element.sensorAddress)) {
        sensorByBlock.set(element.id, element.sensorAddress);
      }
    }
  }

  for (const block of blocks) {
    if (!block.name?.trim() || seenBlockNames.has(block.name)) {
      throw new Error("Route block names must be present and unique for script commands.");
    }
    seenBlockNames.add(block.name);
  }

  const legs: ScriptRouteLeg[] = [];
  for (let index = 0; index < blocks.length - 1; index++) {
    const from = blocks[index]!;
    const to = blocks[index + 1]!;
    const sensor = sensorByBlock.get(to.id);
    if (!isValidSensor(sensor)) {
      throw new Error(`Missing block sensor in ${to.name}; configure its sensor address first.`);
    }
    if (to.nodeIndex <= from.nodeIndex) {
      throw new Error(`Invalid route node order: ${from.name} → ${to.name}.`);
    }

    const turnoutStates = new Map<number, boolean>();
    for (let edgeIndex = from.nodeIndex; edgeIndex < to.nodeIndex; edgeIndex++) {
      const edge = route.edgePath[edgeIndex];
      if (!edge) throw new Error(`Missing route edge ${edgeIndex} for ${from.name} → ${to.name}.`);
      const passages = edge.turnoutPath?.length
        ? edge.turnoutPath
        : [{ turnoutStates: edge.turnoutStates }];
      for (const passage of passages) {
        for (const turnout of passage.turnoutStates ?? []) {
          if (!isValidSensor(turnout.address) || typeof turnout.closed !== "boolean") {
            throw new Error(`Invalid turnout state in route ${choice.path}.`);
          }
          if (turnoutStates.has(turnout.address) &&
              turnoutStates.get(turnout.address) !== turnout.closed) {
            throw new Error(`Conflicting turnout state for #${turnout.address} on ${from.name} → ${to.name}.`);
          }
          turnoutStates.set(turnout.address, turnout.closed);
        }
      }
    }
    legs.push({
      from: from.name,
      to: to.name,
      sensor,
      turnouts: [...turnoutStates].map(([address, closed]) => ({ address, closed })),
    });
  }

  // Match typical names such as A1_to_B1, but handle whitespace/accents too.
  const identifier = (value: string): string => {
    const normalized = value.normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9_$]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return /^[A-Za-z_$]/.test(normalized) ? normalized : "_" + (normalized || "block");
  };

  const usedNames = new Set<string>();
  const functions = legs.map(leg => {
    const base = `${identifier(leg.from)}_to_${identifier(leg.to)}`;
    let name = base;
    let suffix = 2;
    while (usedNames.has(name)) name = `${base}_${suffix++}`;
    usedNames.add(name);
    return { name, leg };
  });

  const lines: string[] = [
    `// Generated from saved route: ${choice.path} (${choice.direction})`,
    "// Each leg is an editable async function, with BEFORE START and ARRIVED hooks.",
    "// Review the route and safety requirements before running on a real layout.",
    "const SPEED = 20; // DCC speed steps (0..126)",
    `const DIRECTION = ${JSON.stringify(choice.direction)};`,
    "const TIMEOUT_MS = 60000;",
    `const loco = dcc.getBlock(${JSON.stringify(blocks[0]!.name)});`,
    "",
  ];

  for (const { name, leg } of functions) {
    const from = JSON.stringify(leg.from);
    const to = JSON.stringify(leg.to);
    const label = `${leg.from} → ${leg.to}`;
    const addresses = leg.turnouts.map(turnout => turnout.address);
    lines.push(
      "// ============================================================",
      `// ${label}`,
      "// ============================================================",
      `async function ${name}() {`,
      `  const FROM = ${from};`,
      `  const TO = ${to};`,
      `  const SENSOR = ${leg.sensor};`,
      "",
      "  if (dcc.getBlock(FROM) !== loco) {",
      '    setInfo(`Locomotive #${loco} is no longer in ${FROM}`);',
      "    return false;",
      "  }",
      "  if (dcc.getBlock(TO) > 0 || dcc.getBlockTargetLoco(TO) > 0) {",
      '    setInfo(`Destination ${TO} is occupied or reserved`);',
      "    return false;",
      "  }",
      "",
      "  // Do not mistake a contact left ON for a new arrival.",
      "  if (dcc.getSensor(SENSOR) === true) {",
      "    await dcc.waitForSensor(SENSOR, false, TIMEOUT_MS);",
      "  }",
      "",
      "  async function run(sw) {",
    );

    if (leg.turnouts.length) {
      lines.push(
        `    // Required turnout positions for ${label}`,
        ...leg.turnouts.map(turnout =>
          `    await sw.setTurnout(${turnout.address}, ${turnout.closed});`),
        "",
      );
    }

    lines.push(
      "    // Recheck availability after acquiring turnout locks.",
      "    if (dcc.getBlock(TO) > 0 || dcc.getBlockTargetLoco(TO) > 0) {",
      '      setInfo(`Destination ${TO} became unavailable`);',
      "      return false;",
      "    }",
      "    dcc.setBlockTargetLoco(TO, loco);",
      "",
      "    try {",
      `      // ===== beforeStart: ${label} =====`,
      "      // Add commands here:",
      "      // await delay(1000);",
      "      // dcc.setLocoFunction(loco, 2, true);",
      "",
      '      setInfo(`#${loco}: ${FROM} → ${TO}`);',
      "      dcc.setLoco(loco, SPEED, DIRECTION);",
      "      await dcc.waitForSensor(SENSOR, true, TIMEOUT_MS);",
      "      dcc.setLoco(loco, 0, DIRECTION);",
      "",
      "      // setBlock moves this loco from its previous block.",
      "      // In reed mode the sensor may have done this already.",
      "      dcc.setBlock(TO, loco);",
      "",
      `      // ===== arrived: ${label} =====`,
      "      // Add arrival commands here:",
      "      // dcc.setLocoFunction(loco, 2, false);",
      "      // await delay(2000);",
      "",
      '      setInfo(`#${loco} arrived in ${TO}`);',
      "      return true;",
      "    } finally {",
      "      dcc.setLoco(loco, 0, DIRECTION);",
      "      if (dcc.getBlock(TO) !== loco) {",
      "        dcc.clearBlockTargetLoco(TO);",
      "      }",
      "    }",
      "  }",
      "",
    );

    if (addresses.length) {
      lines.push(
        `  return await switchMan(${JSON.stringify(addresses)}, async sw => run(sw), TIMEOUT_MS);`,
      );
    } else {
      lines.push(
        "  // This leg has no turnouts to lock.",
        "  return await run(null);",
      );
    }
    lines.push("}", "");
  }

  lines.push(
    "// Run each block-to-block function in the selected route order.",
    "if (loco <= 0) {",
    `  setInfo(${JSON.stringify("No locomotive assigned to " + blocks[0]!.name)});`,
    "} else {",
  );

  functions.forEach(({ name }, index) => {
    lines.push(
      index === 0
        ? `  let proceed = await ${name}();`
        : `  if (proceed) proceed = await ${name}();`,
    );
  });

  lines.push("}");
  return lines.join("\n");
}
