import type { Loco } from "@domain/types";
import type { LayoutElementId } from "@domain/layout/layoutDto";
import { INVALID_LAYOUT_ELEMENT_ID } from "@domain/layout/layoutDto";
import type { SignalLogicDocumentDto } from "@domain/signalLogic";
import { validateSignalLogicDocument } from "@domain/signalLogic";
import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import { isTurnoutElement } from "@/models/editor/core/LayoutView";
import TrackTurnoutDoubleElement from "../models/editor/elements/TrackTurnoutDoubleElement";
import { TrackTurnoutThreeWayElement } from "../models/editor/elements/TrackTurnoutThreeWayElement";
import { TrackSignalElement } from "../models/editor/elements/TrackSignalElement";
import { TrackLevelCrossingElement } from "../models/editor/elements/TrackLevelCrossingElement";

export type IntegrityArea = "Layout" | "Blocks" | "Sensors" | "Route buttons" | "Automatic routes" | "Signal logic" | "Locomotives";
export type IntegrityIssue = { level: "error" | "warning"; area: IntegrityArea; message: string };
export type IntegrityAreaResult = { area: IntegrityArea; checked: number; summary?: string; issues: IntegrityIssue[] };
export type IntegrityReport = { areas: IntegrityAreaResult[]; issues: IntegrityIssue[] };

const AREAS: IntegrityArea[] = ["Layout", "Blocks", "Sensors", "Route buttons", "Automatic routes", "Signal logic", "Locomotives"];

function elementLabel(data: { name?: string; id?: LayoutElementId }, fallback: string): string {
  const name = data.name?.trim();
  const id = data.id && data.id !== INVALID_LAYOUT_ELEMENT_ID ? String(data.id) : "missing ID";
  return name && name !== "element" ? `${name} (${id})` : `${fallback} (${id})`;
}

function isSignalLogicTurnoutElement(
  element: ReturnType<LayoutView["getAllElements"]>[number]
): boolean {
  return (
    isTurnoutElement(element) ||
    element instanceof TrackTurnoutDoubleElement ||
    element instanceof TrackTurnoutThreeWayElement
  );
}

function isSignalLogicSensorElement(
  element: ReturnType<LayoutView["getAllElements"]>[number]
): boolean {
  const address =
    Number(
      (element as unknown as { address?: unknown }).address ??
      0
    );

  if (
    !Number.isInteger(address) ||
    address <= 0 ||
    element.type === ELEMENT_TYPES.TRACK_BLOCK
  ) {
    return false;
  }

  if (
    element instanceof TrackSignalElement
  ) {
    return false;
  }

  if (isSignalLogicTurnoutElement(element)) {
    const data =
      element.toJSON() as {
        turnoutAddress?: number;
        turnout1Address?: number;
        turnout2Address?: number;
      };

    return (
      Number(data.turnoutAddress ?? 0) > 0 ||
      Number(data.turnout1Address ?? 0) > 0 ||
      Number(data.turnout2Address ?? 0) > 0
    );
  }

  return String(element.type).startsWith("track");
}

// These physical elements expose sensor addresses in LayoutRuntime.AddElement.
// Block overlays use their own sensorAddress reference; signal output addresses
// are not occupancy inputs. Multiple rail elements may legitimately share one
// occupancy address within the SAME physical section.
const OCCUPANCY_INPUT_TYPES = new Set<string>([
  ELEMENT_TYPES.TRACK_STRAIGHT,
  ELEMENT_TYPES.TRACK_BRIDGE,
  ELEMENT_TYPES.TRACK_DIRECTION,
  ELEMENT_TYPES.TRACK_END,
  ELEMENT_TYPES.TRACK_CORNER,
  ELEMENT_TYPES.TRACK_CURVE,
  ELEMENT_TYPES.TRACK_CROSSING,
  ELEMENT_TYPES.TRACK_LEVEL_CROSSING,
  ELEMENT_TYPES.TRACK_SENSOR,
  ELEMENT_TYPES.TRACK_TURNOUT,
  ELEMENT_TYPES.TRACK_TURNOUT_LEFT,
  ELEMENT_TYPES.TRACK_TURNOUT_RIGHT,
  ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE,
  ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY,
  ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY,
]);

export function inspectProjectIntegrity(
  layout: LayoutView,
  locos: Loco[],
  signalDocument: SignalLogicDocumentDto | null,
  signalLoadIssues: Array<{ level: "error" | "warning"; message: string }> = [],
  knownSensorStates?: ReadonlyMap<number, boolean>
): IntegrityReport {
  const elements = layout.getAllElements();
  const issues: IntegrityIssue[] = [];
  const checked = new Map<IntegrityArea, number>(AREAS.map(area => [area, 0]));
  const summaries = new Map<IntegrityArea, string>();
  const add = (area: IntegrityArea, level: IntegrityIssue["level"], message: string) => issues.push({ area, level, message });

  checked.set("Layout", elements.length);
  const idCounts = new Map<LayoutElementId, number>();
  for (const element of elements) {
    if (!Number.isInteger(element.id) || element.id < 1 || element.id > 0xffff) {
      add("Layout", "error", `${element.type} has no valid numeric element ID.`);
      continue;
    }
    idCounts.set(element.id, (idCounts.get(element.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) if (count > 1) add("Layout", "error", `Element ID ${id} is used ${count} times.`);

  // Output addresses are optional while editing a layout, but elements without
  // them cannot participate in routes or signal automation. Report these as
  // warnings instead of errors so an unfinished layout remains valid.
  for (const element of elements) {
    if (
      element instanceof TrackTurnoutDoubleElement ||
      element instanceof TrackTurnoutThreeWayElement
    ) {
      const data = element.toJSON() as {
        id?: LayoutElementId;
        name?: string;
        turnout1Address?: number;
        turnout2Address?: number;
      };

      const label = elementLabel(
        data,
        element instanceof TrackTurnoutThreeWayElement
          ? "Three-way turnout"
          : "Double turnout"
      );

      if (Number(data.turnout1Address ?? 0) <= 0) {
        add(
          "Layout",
          "warning",
          `${label} has no output address configured for motor 1.`
        );
      }

      if (Number(data.turnout2Address ?? 0) <= 0) {
        add(
          "Layout",
          "warning",
          `${label} has no output address configured for motor 2.`
        );
      }

      continue;
    }

    if (isTurnoutElement(element)) {
      const data = element.toJSON() as {
        id?: LayoutElementId;
        name?: string;
        turnoutAddress?: number;
      };

      if (Number(data.turnoutAddress ?? 0) <= 0) {
        add(
          "Layout",
          "warning",
          `${elementLabel(data, "Turnout")} has no output address configured.`
        );
      }

      continue;
    }

    if (element instanceof TrackSignalElement) {
      const data = element.toJSON() as {
        id?: LayoutElementId;
        name?: string;
        signalOutput?: {
          address?: number;
        };
      };

      const isLevelCrossing =
        element instanceof TrackLevelCrossingElement;

      if (Number(data.signalOutput?.address ?? 0) <= 0) {
        add(
          "Layout",
          "warning",
          `${elementLabel(
            data,
            isLevelCrossing ? "Level crossing" : "Signal"
          )} has no signal output address configured.`
        );
      }
    }
  }

  // Automatic Movement safety: validate the actual block->sensor references,
  // not merely the presence of a numeric sensorAddress field. Like the .NET
  // MovementRuntime, every routed block needs a real physical sensor binding.
  const blocks = elements.filter(element => element.type === ELEMENT_TYPES.TRACK_BLOCK);
  checked.set("Blocks", blocks.length);

  const sensorsByAddress = new Map<number, string[]>();
  for (const element of elements) {
    if (!OCCUPANCY_INPUT_TYPES.has(element.type)) continue;
    const address = Number((element as unknown as { address?: unknown }).address ?? 0);
    if (!Number.isInteger(address) || address < 1 || address > 65535) continue;
    const labels = sensorsByAddress.get(address) ?? [];
    labels.push(elementLabel(element, "Track/sensor"));
    sensorsByAddress.set(address, labels);
  }
  checked.set("Sensors", sensorsByAddress.size);

  const blocksBySensor = new Map<number, string[]>();
  for (const element of blocks) {
    const data = element as unknown as { id: LayoutElementId; name?: string; sensorAddress?: unknown };
    const label = elementLabel(data, "Block");
    const address = Number(data.sensorAddress ?? 0);

    if (!Number.isInteger(address) || address < 1 || address > 65535) {
      add("Blocks", "error",
        `Block ${label} has no valid occupancy sensor address. Automatic Movement cannot start from/to this block.`);
      continue;
    }

    const blockLabels = blocksBySensor.get(address) ?? [];
    blockLabels.push(label);
    blocksBySensor.set(address, blockLabels);

    if (!sensorsByAddress.has(address)) {
      add("Blocks", "error",
        `Block ${label} references sensor #${address}, but no physical track/sensor element has that address. Automatic Movement cannot start.`);
    }
  }

  for (const [address, blockLabels] of blocksBySensor) {
    if (blockLabels.length <= 1) continue;
    add("Blocks", "error",
      `Occupancy sensor #${address} is assigned to multiple blocks: ${blockLabels.join(", ")}. Each block requires a unique sensor address; automatic Movement cannot start.`);
  }
  summaries.set("Blocks", `${blocks.length} blocks · ${blocksBySensor.size} sensor addresses`);

  // ON and OFF are both known states. Only absent addresses are UNKNOWN.
  // The websocket cache is cleared on reconnect and on a new sensor snapshot,
  // so stale last-known sensor values cannot falsely pass this check.
  if (knownSensorStates !== undefined) {
    let unknownCount = 0;
    for (const [address, labels] of [...sensorsByAddress].sort(([a], [b]) => a - b)) {
      if (knownSensorStates.has(address)) continue;
      unknownCount++;
      const assignedBlocks = blocksBySensor.get(address) ?? [];
      const references = assignedBlocks.length > 0
        ? `block(s): ${assignedBlocks.join(", ")}`
        : `track elements: ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ` (+${labels.length - 3} more)` : ""}`;
      add("Sensors", "error",
        `Occupancy sensor #${address} is UNKNOWN (no current feedback); used by ${references}. Check the connection/snapshot before automatic Movement.`);
    }
    summaries.set("Sensors", `${sensorsByAddress.size} configured addresses · ${unknownCount} UNKNOWN`);
  } else {
    summaries.set("Sensors", `${sensorsByAddress.size} configured addresses · live states not checked`);
  }

  const turnoutById = new Map(
    elements
      .filter(isSignalLogicTurnoutElement)
      .map(element => [element.id, element])
  );

  const routeTurnoutById = new Map(
    elements
      .filter(isSignalLogicTurnoutElement)
      .map(element => [element.id, element])
  );

  const blockById = new Map(elements.filter(element => element.type === ELEMENT_TYPES.TRACK_BLOCK).map(element => [element.id, element]));

  const routeButtons = elements.filter(element => element.type === ELEMENT_TYPES.BUTTON_ROUTE);
  checked.set("Route buttons", routeButtons.length);
  for (const element of routeButtons) {
    const data = element.toJSON() as {
      id: LayoutElementId;
      name?: string;
      routeTurnouts?: Array<{ turnoutId?: LayoutElementId; closed?: boolean; channel?: 0 | 1 }>;
    };
    const label = elementLabel(data, "Route button");
    const routeTurnouts = Array.isArray(data.routeTurnouts) ? data.routeTurnouts : [];
    if (routeTurnouts.length === 0) add("Route buttons", "warning", `${label} has no turnouts assigned.`);
    const usedTurnouts = new Set<string>();
    for (const reference of routeTurnouts) {
      const turnoutId = Number(reference.turnoutId ?? 0);
      const channel = reference.channel === 1 ? 1 : 0;
      if (!Number.isInteger(turnoutId) || turnoutId < 1 || turnoutId > 0xffff) {
        add("Route buttons", "error", `${label} contains a turnout reference without a valid numeric ID.`);
        continue;
      }
      const key = `${turnoutId}:${channel}`;
      if (usedTurnouts.has(key)) add("Route buttons", "error", `${label} references turnout ${turnoutId}/${channel} more than once.`);
      usedTurnouts.add(key);
      if (!routeTurnoutById.has(turnoutId)) {
        const existing = elements.find(candidate => candidate.id === turnoutId);
        add("Route buttons", "error", existing
          ? `${label} references ${turnoutId}, but that element is not a supported turnout.`
          : `${label} references deleted turnout ${turnoutId}.`);
      }
    }
  }

  const automaticRoutes = elements.filter(element => element.type === ELEMENT_TYPES.BUTTON_ROUTE_EXTENDED);
  checked.set("Automatic routes", automaticRoutes.length);
  for (const element of automaticRoutes) {
    const data = element.toJSON() as {
      id: LayoutElementId;
      name?: string;
      fromBlockId?: LayoutElementId;
      toBlockId?: LayoutElementId;
    };
    const label = elementLabel(data, "Automatic route");
    const from = Number(data.fromBlockId ?? 0);
    const to = Number(data.toBlockId ?? 0);
    if (!from) add("Automatic routes", "error", `${label} has no start block.`);
    else if (!blockById.has(from)) add("Automatic routes", "error", `${label} references deleted or invalid start block ${from}.`);
    if (!to) add("Automatic routes", "error", `${label} has no destination block.`);
    else if (!blockById.has(to)) add("Automatic routes", "error", `${label} references deleted or invalid destination block ${to}.`);
    if (from && to && from === to) add("Automatic routes", "error", `${label} uses the same block as start and destination.`);
  }

  if (signalDocument) {
    const signalGroupCount = signalDocument.groups.length;
    const signalRuleCount = signalDocument.groups.reduce(
      (total, group) => total + group.rules.length,
      0
    );
    const signalConditionCount = signalDocument.groups.reduce(
      (total, group) => total + group.rules.reduce(
        (sum, rule) => sum + rule.conditions.length,
        0
      ),
      0
    );

    checked.set(
      "Signal logic",
      signalGroupCount + signalRuleCount + signalConditionCount
    );
    summaries.set(
      "Signal logic",
      `${signalGroupCount} groups · ${signalRuleCount} rules · ${signalConditionCount} conditions`
    );

    const signalSensors =
      elements
        .filter(isSignalLogicSensorElement)
        .map(element => ({
          id: element.id,
          address: Number(
            (element as unknown as { address?: unknown }).address ??
            0
          ),
        }));

    const signalIssues = validateSignalLogicDocument(
      signalDocument,
      elements.filter((element): element is TrackSignalElement => element instanceof TrackSignalElement)
        .map(signal => ({ id: signal.id, address: signal.address, aspect: signal.aspect })),
      [...turnoutById.values()].map(turnout => {
        const data =
          turnout.toJSON() as {
            turnoutAddress?: number;
            turnout1Address?: number;
          };

        return {
          id: turnout.id,
          address:
            Number(
              data.turnoutAddress ??
              data.turnout1Address ??
              0
            ),
        };
      }),
      signalSensors
    );

    for (const issue of [...signalLoadIssues, ...signalIssues]) add("Signal logic", issue.level, issue.message);

    const signalIds = new Set(elements
      .filter((element): element is TrackSignalElement => element instanceof TrackSignalElement)
      .map(signal => signal.id));

    const sensorAddresses = new Set(
      elements
        .filter(isSignalLogicSensorElement)
        .map(sensor =>
          Number(
            (
              sensor as unknown as {
                address?: unknown;
              }
            ).address ??
            0
          )
        )
        .filter(
          address =>
            Number.isInteger(address) &&
            address > 0
        )
    );

    for (const group of signalDocument.groups) {
      if (group.signalId !== INVALID_LAYOUT_ELEMENT_ID && !signalIds.has(group.signalId)) {
        add("Signal logic", "error", `Signal rule group ${group.id} references deleted signal ${group.signalId}.`);
      }
      for (const rule of group.rules) {
        for (const condition of rule.conditions) {
          if (condition.type === "turnout" && condition.turnoutId !== INVALID_LAYOUT_ELEMENT_ID && !turnoutById.has(condition.turnoutId)) {
            add("Signal logic", "error", `Signal rule ${rule.id} references deleted turnout ${condition.turnoutId}.`);
          }
          if (condition.type === "sensor") {
            const address =
              Number(
                condition.sensorAddress ??
                0
              );

            if (
              !Number.isInteger(address) ||
              address < 1 ||
              !sensorAddresses.has(address)
            ) {
              add(
                "Signal logic",
                "error",
                `Signal rule ${rule.id} references missing occupancy sensor address ${address || "?"}.`
              );
            }
          }
        }
      }
    }
  } else {
    add("Signal logic", "error", "Signal rules could not be loaded, so their references were not verified.");
  }

  checked.set("Locomotives", locos.length);
  const locoIds = new Set<string>();
  const locoAddresses = new Map<number, string>();
  for (const loco of locos) {
    if (!loco.id?.trim()) add("Locomotives", "error", `Locomotive ${loco.name || `#${loco.address}`} has no ID.`);
    else if (locoIds.has(loco.id)) add("Locomotives", "error", `Locomotive ID ${loco.id} is used more than once.`);
    else locoIds.add(loco.id);
    if (locoAddresses.has(loco.address)) {
      add("Locomotives", "error", `DCC address ${loco.address} is used by both ${locoAddresses.get(loco.address)} and ${loco.name}.`);
    } else locoAddresses.set(loco.address, loco.name);

    const functionNumbers = new Set<number>();
    for (const fn of loco.functions ?? []) {
      if (functionNumbers.has(fn.number)) add("Locomotives", "warning", `${loco.name} defines function F${fn.number} more than once.`);
      functionNumbers.add(fn.number);
    }
  }

  const uniqueIssues = issues.filter((issue, index, all) =>
    all.findIndex(candidate => candidate.area === issue.area && candidate.level === issue.level && candidate.message === issue.message) === index);
  return {
    areas: AREAS.map(area => ({
      area,
      checked: checked.get(area) ?? 0,
      ...(summaries.has(area) ? { summary: summaries.get(area)! } : {}),
      issues: uniqueIssues.filter(issue => issue.area === area),
    })),
    issues: uniqueIssues,
  };
}
