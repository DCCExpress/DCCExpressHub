import type {
  Loco,
} from "@domain/types";
import {
  showWarningMessage,
} from "../../../helpers";
import i18n from "../../../i18n";
import {
  BlockElementView,
} from "../elements/BlockElementView";
import {
  RouteButtonElementView,
} from "../elements/RouteButtonElementView";
import {
  TrackStraightElementView,
} from "../elements/TrackStraightElementView";
import {
  TrackTurnoutLeftElementView,
} from "../elements/TrackTurnoutLeftElementView";
import {
  TrackTurnoutRightElementView,
} from "../elements/TrackTurnoutRightElementView";
import {
  TrackTurnoutTwoWayElementView,
} from "../elements/TrackTurnoutTwoWayElementView";
import TrackTurnoutDoubleElementView from "../elements/TrackTurnoutDoubleElementView";
import {
  TrackTurnoutThreeWayElementView,
} from "../elements/TrackTurnoutThreeWayElementView";
import type {
  DrawOptions,
} from "../types/EditorTypes";
import {
  BaseElementView,
} from "./BaseElementView";
import {
  ElementFactory,
} from "./ElementFactory";
import type {
  Graph,
} from "@domain/railway/graph";
import type {
  RouteGraphTrackRuntimeDto,
} from "@domain/railway/routeGraphDto";
import {
  Layout as CommonLayout,
} from "@domain/layout/model/Layout";
import {
  TrackElement as DomainTrackElement,
} from "@domain/layout/model/TrackElement";
import type {
  NeighborPointPair,
} from "@domain/layout/model/BaseElement";
import type {
  Point,
} from "@domain/Rect";
import {
  migrateSerializedLayoutIds,
} from "@domain/layout/layoutIdMigration";
import type {
  LayoutElementDto,
  SerializedLayoutDto,
} from "@domain/layout/layoutDto";
import {
  LayerView,
  type LayerId,
} from "./LayerView";
import { resolveRouteSecondClosed } from "../turnout/routeTurnoutState";

type LayoutTrackElement =
  BaseElementView &
  DomainTrackElement;

export type RouteTurnoutElement =
  | TrackTurnoutLeftElementView
  | TrackTurnoutRightElementView
  | TrackTurnoutTwoWayElementView;

export function isTurnoutElement(
  element: BaseElementView | null | undefined
): element is RouteTurnoutElement {
  return (
    element instanceof TrackTurnoutLeftElementView ||
    element instanceof TrackTurnoutRightElementView ||
    element instanceof TrackTurnoutTwoWayElementView
  );
}

function isMultiMotorTurnout(
  element: BaseElementView | null | undefined
): element is
  | TrackTurnoutDoubleElementView
  | TrackTurnoutThreeWayElementView {
  return (
    element instanceof TrackTurnoutDoubleElementView ||
    element instanceof TrackTurnoutThreeWayElementView
  );
}

function isRouteButtonTurnout(
  element: BaseElementView | null | undefined
): element is
  | RouteTurnoutElement
  | TrackTurnoutDoubleElementView
  | TrackTurnoutThreeWayElementView {
  return (
    isTurnoutElement(element) ||
    isMultiMotorTurnout(element)
  );
}

function routeTurnoutMatches(
  turnout:
    | RouteTurnoutElement
    | TrackTurnoutDoubleElementView
    | TrackTurnoutThreeWayElementView,
  reference: {
    closed: boolean;
    secondClosed?: boolean;
  }
): boolean {
  if (isMultiMotorTurnout(turnout)) {
    const secondClosed = resolveRouteSecondClosed(turnout, reference);
    if (typeof secondClosed !== "boolean") {
      return false;
    }

    return (
      turnout.turnout1Closed === reference.closed &&
      turnout.turnout2Closed === secondClosed
    );
  }

  return (
    turnout.turnoutClosed === reference.closed
  );
}

type RouteStateReference = {
  closed: boolean;
  secondClosed?: boolean;
};

type RouteStateMap =
  Map<number, RouteStateReference>;

function routeStatesMatch(
  turnoutStates: readonly {
    closed: boolean;
  }[],
  first: boolean,
  second: boolean
): boolean {
  return (
    turnoutStates.length >= 2 &&
    turnoutStates[0]!.closed === first &&
    turnoutStates[1]!.closed === second
  );
}

function getMultiMotorBits(
  element:
    | TrackTurnoutDoubleElementView
    | TrackTurnoutThreeWayElementView,
  routeStates?: RouteStateMap
): {
  first: boolean;
  second: boolean;
} {
  const configured =
    routeStates?.get(element.id);

  if (
    configured &&
    typeof configured.secondClosed ===
      "boolean"
  ) {
    return {
      first: configured.closed,
      second: configured.secondClosed,
    };
  }

  return {
    first: element.turnout1Closed,
    second: element.turnout2Closed,
  };
}

function getActiveConnectionPairs(
  element: LayoutTrackElement,
  routeStates?: RouteStateMap
): NeighborPointPair[] {
  if (
    element instanceof
    TrackTurnoutDoubleElementView
  ) {
    const bits =
      getMultiMotorBits(
        element,
        routeStates
      );

    const route =
      element.getAllowedRoutes().find(
        candidate =>
          routeStatesMatch(
            candidate.turnoutStates,
            bits.first,
            bits.second
          )
      );

    if (!route) {
      return [];
    }

    const c =
      element.getConnections();

    return [[
      c[route.from],
      c[route.to],
    ]];
  }

  if (
    element instanceof
    TrackTurnoutThreeWayElementView
  ) {
    const bits =
      getMultiMotorBits(
        element,
        routeStates
      );

    const route =
      element.getAllowedRoutes().find(
        candidate =>
          routeStatesMatch(
            candidate.turnoutStates,
            bits.first,
            bits.second
          )
      );

    if (!route) {
      return [];
    }

    const c =
      element.getConnections();

    return [[
      c[route.from],
      c[route.to],
    ]];
  }

  return element.getNeighborPointPairs();
}

function getExitPointsForEntry(
  element: LayoutTrackElement,
  enteredFrom: Point,
  routeStates?: RouteStateMap
): Point[] {
  const exits: Point[] = [];

  for (
    const [first, second]
    of getActiveConnectionPairs(
      element,
      routeStates
    )
  ) {
    if (first.isEqual(enteredFrom)) {
      exits.push(second);
    } else if (
      second.isEqual(enteredFrom)
    ) {
      exits.push(first);
    }
  }

  return exits;
}

function acceptsConnectionFrom(
  element: LayoutTrackElement,
  neighborCenter: Point,
  routeStates?: RouteStateMap
): boolean {
  return (
    getActiveConnectionPairs(
      element,
      routeStates
    ).some(
      ([first, second]) =>
        first.isEqual(neighborCenter) ||
        second.isEqual(neighborCenter)
    )
  );
}

export type CheckRoutesResult = {
  graph: Graph | null;
  error: string | null;
};

/** Kliensoldali layout-view. */
export class LayoutView
  extends CommonLayout<BaseElementView, LayerView> {
  constructor() {
    super(
      (id, name, options) =>
        new LayerView(id, name, options)
    );

    const track =
      new TrackStraightElementView(10, 10);

    // addElement owns ID allocation. Do not manufacture IDs in view classes.
    this.addElement(track, "track");
  }

  override removeElement(
    element: BaseElementView
  ): void {
    const elements = this.getAllElements();

    for (const current of elements) {
      if (!(current instanceof RouteButtonElementView)) {
        continue;
      }

      for (const turnout of current.routeTurnouts) {
        if (turnout.turnoutId !== element.id) {
          continue;
        }

        current.removeTurnout(element.id);

        showWarningMessage(
          current.name,
          i18n.t("editor.messages.routeTurnoutRemoved")
        );

        break;
      }
    }

    super.removeElement(element);
  }

  public getTrackElements(): LayoutTrackElement[] {
    return [
      ...this.track.elements as LayoutTrackElement[],
      ...this.blocks.elements as LayoutTrackElement[],
      ...this.signals.elements as LayoutTrackElement[],
      ...this.sensors.elements as LayoutTrackElement[],
    ];
  }

  getSelected(): BaseElementView | null {
    for (const layer of [
      this.track,
      this.blocks,
      this.signals,
      this.sensors,
      this.buildings,
    ]) {
      for (const element of layer.elements) {
        if (element.selected) {
          return element;
        }
      }
    }

    return null;
  }

  setSelected(element: BaseElementView): void {
    this.unselectAll();

    for (const layer of [
      this.track,
      this.blocks,
      this.signals,
      this.sensors,
      this.buildings,
    ]) {
      for (const current of layer.elements) {
        if (current.id === element.id) {
          current.selected = true;
        }
      }
    }
  }

  unselectAll(): void {
    for (const layer of [
      this.track,
      this.blocks,
      this.signals,
      this.sensors,
      this.buildings,
    ]) {
      for (const element of layer.elements) {
        element.selected = false;
      }
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    options: DrawOptions
  ): void {
    this.track.draw(ctx, options);
    this.sensors.draw(ctx, options);
    this.signals.draw(ctx, options);
    this.blocks.draw(ctx, options);
    this.buildings.draw(ctx, options);

    this.getAllElements().forEach(
      element => element.drawMarked(ctx)
    );
  }

  setBlockLocoAddress(
    selectedBlock: BlockElementView,
    loco: Loco
  ): void {
    const elements = this.getAllElements();

    for (const element of elements) {
      if (!(element instanceof BlockElementView)) {
        continue;
      }

      if (element.locoAddress === loco.address) {
        element.locoAddress = 0;
      }
    }

    selectedBlock.locoAddress = loco.address;
  }

  static fromJSON(data: unknown): LayoutView {
    const migration =
      migrateSerializedLayoutIds(
        (data ?? {}) as SerializedLayoutDto
      );

    const source = migration.layout;
    const layout = new LayoutView();

    layout.gridSize =
      source.gridSize ?? 40;

    if (source._activeLayerId) {
      layout.activeLayerId =
        source._activeLayerId as LayerId;
    }

    if (!Array.isArray(source.layers)) {
      return layout;
    }

    for (const layerData of source.layers) {
      if (!layerData.id) continue;

      const layer =
        layout.getLayer(layerData.id as LayerId);

      if (!layer) {
        continue;
      }

      layer.name =
        layerData.name ?? layer.name;

      layer.visible =
        layerData.visible ?? true;

      layer.locked =
        layerData.locked ?? false;

      layer.elements =
        ElementFactory.createMany(
          (layerData.elements ?? []) as LayoutElementDto[]
        );
    }

    // The raw migration guarantees stable unique IDs. Rebuild synchronizes the
    // allocator so every subsequently added/cloned element continues at max+1.
    layout.rebuildElementIdSequence();

    // Repair old single-bit references in memory so the editor previews and
    // the next explicit save also retain the recovered second motor value.
    for (const element of layout.getAllElements()) {
      if (!(element instanceof RouteButtonElementView)) continue;
      for (const reference of element.routeTurnouts) {
        const turnout = layout.getElementById(reference.turnoutId);
        if (!isMultiMotorTurnout(turnout)) continue;
        const secondClosed = resolveRouteSecondClosed(turnout, reference);
        if (typeof secondClosed === "boolean") reference.secondClosed = secondClosed;
      }
    }

    return layout;
  }

  resetRoutes(): void {
    const elements =
      this.getTrackElements();

    elements.forEach(
      (element: LayoutTrackElement) => {
        element.isVisited = false;
        element.isRoute = false;
        element.routeConnectionIndices = [];
        element.section = 0;
      }
    );
  }

  checkRoutes(
    existingGraph?: Graph | null
  ): CheckRoutesResult {
    const elements =
      this.getTrackElements();

    const graph: Graph | null =
      existingGraph ?? null;

    const routeGraphError: string | null =
      null;

    elements.forEach(
      (element: LayoutTrackElement) => {
        element.isVisited = false;
        element.isRoute = false;
        element.routeConnectionIndices = [];
      }
    );

    const routeButtons =
      this.getAllElements().filter(
        (element: BaseElementView) =>
          element instanceof
          RouteButtonElementView
      ) as RouteButtonElementView[];

    for (const routeButton of routeButtons) {
      const active =
        routeButton.routeTurnouts.length > 0 &&
        routeButton.routeTurnouts.every(
          reference => {
            const turnout =
              this.getElementById(
                reference.turnoutId
              );

            return (
              isRouteButtonTurnout(turnout) &&
              routeTurnoutMatches(
                turnout,
                reference
              )
            );
          }
        );

      routeButton.active = active;

      if (!active) {
        continue;
      }

      const routeStates:
        RouteStateMap =
          new Map();

      for (
        const reference
        of routeButton.routeTurnouts
      ) {
        routeStates.set(
          reference.turnoutId,
          {
            closed:
              reference.closed,
            ...(typeof reference.secondClosed ===
              "boolean"
              ? {
                  secondClosed:
                    reference.secondClosed,
                }
              : {}),
          }
        );
      }

      // A button can configure several independent connected track sections.
      // Seed every configured turnout, sharing visits without losing crossing
      // entries. The order in the property editor must not affect the result.
      const visitedConnections = new Set<string>();
      for (const reference of routeButton.routeTurnouts) {
        const turnout = this.getElementById(reference.turnoutId);
        if (isRouteButtonTurnout(turnout)) {
          this.walkActiveRoute(turnout, null, visitedConnections, routeStates);
        }
      }
    }

    // Blocks, signals and sensors are drawn over physical rails. Looking up
    // the rail first during traversal must not leave those overlays unmarked.
    for (const overlay of elements) {
      if (this.track.elements.includes(overlay)) continue;
      const track = this.track.elements.find(element =>
        element instanceof DomainTrackElement &&
        element.x === overlay.x && element.y === overlay.y
      ) as LayoutTrackElement | undefined;
      if (track) {
        overlay.isRoute = track.isRoute;
        overlay.routeConnectionIndices = [...track.routeConnectionIndices];
      }
    }

    return {
      graph,
      error: routeGraphError,
    };
  }

  startWalk(
    obj: LayoutTrackElement,
    routeStates?: RouteStateMap
  ): void {
    this.walkActiveRoute(
      obj,
      null,
      new Set<string>(),
      routeStates
    );
  }

  private walkActiveRoute(
    obj: LayoutTrackElement,
    enteredFrom:
      Point |
      null,
    visitedConnections: Set<string>,
    routeStates?: RouteStateMap
  ): void {
    const visitKey =
      enteredFrom
        ? `${obj.id}:${enteredFrom.x}:${enteredFrom.y}`
        : `${obj.id}:start`;

    if (
      visitedConnections.has(
        visitKey
      )
    ) {
      return;
    }

    visitedConnections.add(
      visitKey
    );

    obj.isVisited = true;
    const pairs = getActiveConnectionPairs(obj, routeStates);
    for (const [index, [first, second]] of pairs.entries()) {
      if (!enteredFrom || first.isEqual(enteredFrom) || second.isEqual(enteredFrom)) {
        obj.isRoute = true;
        if (!obj.routeConnectionIndices.includes(index)) {
          obj.routeConnectionIndices.push(index);
        }
      }
    }

    const exitPoints =
      enteredFrom
        ? getExitPointsForEntry(
            obj,
            enteredFrom,
            routeStates
          )
        : getActiveConnectionPairs(
            obj,
            routeStates
          ).flatMap(
            ([first, second]) => [
              first,
              second,
            ]
          );

    for (
      const exit
      of exitPoints
    ) {
      // Connectivity uses anchor cells, not visual hit boxes. A three-cell
      // block overlay must never hide a neighboring standalone sensor/rail.
      const candidate =
        this.getTrackElements().find(element =>
          element instanceof DomainTrackElement &&
          element.x === exit.x && element.y === exit.y
        );

      if (
        !candidate ||
        candidate === obj ||
        !(candidate instanceof
          DomainTrackElement)
      ) {
        continue;
      }

      const next =
        candidate as
          LayoutTrackElement;

      if (
        !acceptsConnectionFrom(
          next,
          obj.pos,
          routeStates
        )
      ) {
        continue;
      }

      next.isRoute = true;

      this.walkActiveRoute(
        next,
        obj.pos,
        visitedConnections,
        routeStates
      );
    }
  }


  walkTrack(
    obj: LayoutTrackElement,
    section: number
  ): void {
    obj.isVisited = true;
    obj.isRoute = true;
    obj.section = section;

    const nextPosition = obj.getNextItemXy();
    const prevPosition = obj.getPrevItemXy();

    const next = this.getObjectXy(nextPosition) as LayoutTrackElement;

    if (
      next &&
      !isRouteButtonTurnout(next) &&
      !next.isVisited &&
      (
        obj.pos.isEqual(next.getNextItemXy()) ||
        obj.pos.isEqual(next.getPrevItemXy())
      )
    ) {
      next.isRoute = true;
      this.walkTrack(next, section);
    }

    const prev = this.getObjectXy(prevPosition) as LayoutTrackElement;

    if (
      prev &&
      !isRouteButtonTurnout(prev) &&
      !prev.isVisited &&
      (
        obj.pos.isEqual(prev.getNextItemXy()) ||
        obj.pos.isEqual(prev.getPrevItemXy())
      )
    ) {
      prev.isRoute = true;
      this.walkTrack(prev, section);
    }
  }

  applyRouteGraphRuntime(
    trackRuntime:
      RouteGraphTrackRuntimeDto[] |
      null |
      undefined
  ): void {
    const trackElements =
      this.getTrackElements();

    for (const element of trackElements) {
      element.section = 0;
      element.travelDirection = "unknown";
    }

    if (!trackRuntime) {
      return;
    }

    const elementsById = new Map(
      trackElements.map(element => [
        element.id,
        element,
      ])
    );

    for (const runtime of trackRuntime) {
      const element =
        elementsById.get(runtime.id);

      if (!element) {
        continue;
      }

      element.section =
        runtime.section;

      element.travelDirection =
        runtime.travelDirection;
    }

    const physicalTrackElements =
      this.track.elements.filter(
        (element): element is LayoutTrackElement =>
          element instanceof DomainTrackElement
      );

    const normalizeRotation = (
      angle: number
    ): number => {
      const result = angle % 360;
      return result < 0 ? result + 360 : result;
    };

    for (const element of trackElements) {
      if (!(element instanceof BlockElementView)) {
        continue;
      }

      const centerTrack =
        physicalTrackElements.find(track =>
          track.x === element.x &&
          track.y === element.y
        );

      if (
        !centerTrack ||
        centerTrack.travelDirection === "unknown"
      ) {
        element.runtimeForwardRotation = null;
        continue;
      }

      element.runtimeForwardRotation =
        normalizeRotation(
          centerTrack.travelDirection === "forward"
            ? centerTrack.rotation
            : centerTrack.rotation + 180
        );
    }
  }
}
