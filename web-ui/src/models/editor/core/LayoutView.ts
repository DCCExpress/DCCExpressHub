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
    if (typeof reference.secondClosed !== "boolean") {
      return false;
    }

    return (
      turnout.turnout1Closed === reference.closed &&
      turnout.turnout2Closed === reference.secondClosed
    );
  }

  return (
    turnout.turnoutClosed === reference.closed
  );
}

function getActiveConnectionPairs(
  element: LayoutTrackElement
): NeighborPointPair[] {
  if (
    element instanceof
    TrackTurnoutDoubleElementView
  ) {
    const c =
      element.getConnections();

    if (
      !element.firstLogicalClosed &&
      !element.secondLogicalClosed
    ) {
      return [[
        c.aStraight,
        c.bStraight,
      ]];
    }

    if (
      !element.firstLogicalClosed &&
      element.secondLogicalClosed
    ) {
      return [[
        c.aStraight,
        c.bDiv,
      ]];
    }

    if (
      element.firstLogicalClosed &&
      !element.secondLogicalClosed
    ) {
      return [[
        c.aDiv,
        c.bStraight,
      ]];
    }

    return [[
      c.aDiv,
      c.bDiv,
    ]];
  }

  if (
    element instanceof
    TrackTurnoutThreeWayElementView
  ) {
    const c =
      element.getConnections();

    switch (element.position) {
      case "left":
        return [[
          c.entry,
          c.left,
        ]];

      case "right":
        return [[
          c.entry,
          c.right,
        ]];

      case "straight":
        return [[
          c.entry,
          c.straight,
        ]];

      case "invalid":
      default:
        return [];
    }
  }

  /*
   * Normal track elements already expose their real connection pair(s).
   *
   * - Straight / curve / corner: one pair
   * - Normal turnout: BaseElement calls the turnout's state-aware
   *   getPrevItemXy()/getNextItemXy(), therefore one active pair
   * - Crossing: two independent pairs
   *
   * Using connection pairs rather than a single global next/prev pair is the
   * key to following crossings and multi-ended track elements correctly.
   */
  return element.getNeighborPointPairs();
}

function getExitPointsForEntry(
  element: LayoutTrackElement,
  enteredFrom: Point
): Point[] {
  const exits: Point[] = [];

  for (
    const [first, second]
    of getActiveConnectionPairs(
      element
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
  neighborCenter: Point
): boolean {
  return (
    getActiveConnectionPairs(element)
      .some(
        ([first, second]) =>
          first.isEqual(
            neighborCenter
          ) ||
          second.isEqual(
            neighborCenter
          )
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

    return layout;
  }

  resetRoutes(): void {
    const elements =
      this.getTrackElements();

    elements.forEach(
      (element: LayoutTrackElement) => {
        element.isVisited = false;
        element.isRoute = false;
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
      }
    );

    const routeButtons =
      this.getAllElements().filter(
        (element: BaseElementView) =>
          element instanceof RouteButtonElementView
      ) as RouteButtonElementView[];

    routeButtons.forEach(routeButton => {
      let active =
        routeButton.routeTurnouts.length > 0;

      routeButton.routeTurnouts.forEach(turnoutRef => {
        const turnout =
          this.getElementById(turnoutRef.turnoutId);

        if (
          isRouteButtonTurnout(turnout) &&
          routeTurnoutMatches(
            turnout,
            turnoutRef
          )
        ) {
          return;
        }

        active = false;
      });

      routeButton.active = active;

      if (
        active &&
        routeButton.routeTurnouts.length > 0
      ) {
        const turnout = this.getElementById(
          routeButton.routeTurnouts[0]!.turnoutId
        );

        if (
          isRouteButtonTurnout(turnout)
        ) {
          this.startWalk(
            turnout as LayoutTrackElement
          );
        }
      }
    });

    return {
      graph,
      error: routeGraphError,
    };
  }

  startWalk(
    obj: LayoutTrackElement
  ): void {
    this.walkActiveRoute(
      obj,
      null
    );
  }

  private walkActiveRoute(
    obj: LayoutTrackElement,
    enteredFrom:
      Point |
      null
  ): void {
    if (obj.isVisited) {
      return;
    }

    obj.isVisited = true;
    obj.isRoute = true;

    let exitPoints: Point[];

    if (enteredFrom) {
      /*
       * We arrived from a concrete neighboring element. Only continue through
       * the active connection pair that contains that entry point.
       *
       * This is especially important for crossings: entering on one line must
       * not jump to the other crossing line.
       */
      exitPoints =
        getExitPointsForEntry(
          obj,
          enteredFrom
        );
    } else {
      /*
       * Route walk starts at the first turnout stored by the RouteButton.
       * A configured turnout has one active connection pair, so both ends are
       * valid starting directions.
       */
      exitPoints =
        getActiveConnectionPairs(obj)
          .flatMap(
            ([first, second]) => [
              first,
              second,
            ]
          );
    }

    for (const exit of exitPoints) {
      const candidate =
        this.getObjectXy(exit);

      if (
        !candidate ||
        candidate === obj ||
        !(candidate instanceof
          DomainTrackElement)
      ) {
        continue;
      }

      const next =
        candidate as LayoutTrackElement;

      if (next.isVisited) {
        continue;
      }

      /*
       * The neighboring element must actually expose an active connection
       * back to our center cell. Merely occupying the target grid cell is not
       * enough.
       */
      if (
        !acceptsConnectionFrom(
          next,
          obj.pos
        )
      ) {
        continue;
      }

      next.isRoute = true;

      this.walkActiveRoute(
        next,
        obj.pos
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
