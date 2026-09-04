import type { Loco } from "@domain/types";
import type { LayoutElementId } from "@domain/layout/layoutDto";
import { INVALID_LAYOUT_ELEMENT_ID } from "@domain/layout/layoutDto";
import type { SignalLogicDocumentDto } from "@domain/signalLogic";
import { validateSignalLogicDocument } from "@domain/signalLogic";
import { ELEMENT_TYPES } from "@domain/layout/elementTypes";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import { isTurnoutElement } from "@/models/editor/core/LayoutView";
import { TrackSensorElementView } from "@/models/editor/elements/TrackSensorElementView";
import { TrackSignalElementView } from "@/models/editor/elements/TrackSignalElementView";

export type IntegrityArea = "Layout" | "Route buttons" | "Automatic routes" | "Signal logic" | "Locomotives";
export type IntegrityIssue = { level: "error" | "warning"; area: IntegrityArea; message: string };
export type IntegrityAreaResult = { area: IntegrityArea; checked: number; issues: IntegrityIssue[] };
export type IntegrityReport = { areas: IntegrityAreaResult[]; issues: IntegrityIssue[] };

const AREAS: IntegrityArea[] = ["Layout", "Route buttons", "Automatic routes", "Signal logic", "Locomotives"];

function elementLabel(data: { name?: string; id?: LayoutElementId }, fallback: string): string {
  const name = data.name?.trim();
  const id = data.id && data.id !== INVALID_LAYOUT_ELEMENT_ID ? String(data.id) : "missing ID";
  return name && name !== "element" ? `${name} (${id})` : `${fallback} (${id})`;
}

export function inspectProjectIntegrity(
  layout: LayoutView,
  locos: Loco[],
  signalDocument: SignalLogicDocumentDto | null,
  signalLoadIssues: Array<{ level: "error" | "warning"; message: string }> = []
): IntegrityReport {
  const elements = layout.getAllElements();
  const issues: IntegrityIssue[] = [];
  const checked = new Map<IntegrityArea, number>(AREAS.map(area => [area, 0]));
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

  const turnoutById = new Map(elements.filter(isTurnoutElement).map(element => [element.id, element]));
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
      if (!turnoutById.has(turnoutId)) {
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
    checked.set("Signal logic", signalDocument.groups.reduce(
      (total, group) => total + group.rules.reduce((sum, rule) => sum + rule.conditions.length, 0), 0));
    const signalIssues = validateSignalLogicDocument(
      signalDocument,
      elements.filter((element): element is TrackSignalElementView => element instanceof TrackSignalElementView)
        .map(signal => ({ id: signal.id, address: signal.address, aspect: signal.aspect })),
      [...turnoutById.values()].map(turnout => ({ id: turnout.id, address: turnout.turnoutAddress })),
      elements.filter((element): element is TrackSensorElementView => element instanceof TrackSensorElementView)
        .map(sensor => ({ id: sensor.id, address: sensor.address }))
    );
    for (const issue of [...signalLoadIssues, ...signalIssues]) add("Signal logic", issue.level, issue.message);

    const signalIds = new Set(elements
      .filter((element): element is TrackSignalElementView => element instanceof TrackSignalElementView)
      .map(signal => signal.id));
    const sensorIds = new Set(elements
      .filter((element): element is TrackSensorElementView => element instanceof TrackSensorElementView)
      .map(sensor => sensor.id));

    for (const group of signalDocument.groups) {
      if (group.signalId !== INVALID_LAYOUT_ELEMENT_ID && !signalIds.has(group.signalId)) {
        add("Signal logic", "error", `Signal rule group ${group.id} references deleted signal ${group.signalId}.`);
      }
      for (const rule of group.rules) {
        for (const condition of rule.conditions) {
          if (condition.type === "turnout" && condition.turnoutId !== INVALID_LAYOUT_ELEMENT_ID && !turnoutById.has(condition.turnoutId)) {
            add("Signal logic", "error", `Signal rule ${rule.id} references deleted turnout ${condition.turnoutId}.`);
          }
          if (condition.type === "sensor" && condition.sensorId !== INVALID_LAYOUT_ELEMENT_ID && !sensorIds.has(condition.sensorId)) {
            add("Signal logic", "error", `Signal rule ${rule.id} references deleted sensor ${condition.sensorId}.`);
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
    areas: AREAS.map(area => ({ area, checked: checked.get(area) ?? 0, issues: uniqueIssues.filter(issue => issue.area === area) })),
    issues: uniqueIssues,
  };
}
