import {
  ELEMENT_TYPES,
} from "../elementTypes.js";
import {
  type IRect,
  Point,
} from "../../Rect.js";
import {
  BaseElement,
} from "./BaseElement.js";
import {
  Layer,
  type LayerId,
  type LayerOptions,
} from "./Layer.js";
import type {
  LayoutElementId,
} from "../layoutDto.js";
import {
  INVALID_LAYOUT_ELEMENT_ID,
  MAX_LAYOUT_ELEMENT_ID,
} from "../layoutDto.js";

type LayerFactory<
  TElement extends BaseElement,
  TLayer extends Layer<TElement>
> = (
  id: LayerId,
  name: string,
  options?: LayerOptions
) => TLayer;

function rectsIntersect(a: IRect, b: IRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function elementsIntersect(first: BaseElement, second: BaseElement): boolean {
  if (
    first.type === ELEMENT_TYPES.TRACK_BLOCK &&
    second.type === ELEMENT_TYPES.TRACK_BLOCK
  ) {
    return rectsIntersect(first.getBounds(), second.getBounds());
  }

  return rectsIntersect(first.getCollisionBounds(), second.getCollisionBounds());
}

/** Grafikamentes, közös layout modell. */
export class Layout<
  TElement extends BaseElement = BaseElement,
  TLayer extends Layer<TElement> = Layer<TElement>
> {
  protected layers: TLayer[] = [];
  protected _activeLayerId: LayerId = "track";
  private nextElementId: LayoutElementId = 1;

  gridSize: number = 40;

  constructor(
    private readonly layerFactory: LayerFactory<TElement, TLayer> =
      ((id, name, options) =>
        new Layer<TElement>(id, name, options) as TLayer)
  ) {
    this.layers = [
      this.layerFactory("buildings", "Épületek"),
      this.layerFactory("blocks", "Blokkok"),
      this.layerFactory("sensors", "Sensors"),
      this.layerFactory("signals", "Signals"),
      this.layerFactory("track", "Pálya"),
    ];
  }

  public get activeLayerId(): LayerId {
    return this._activeLayerId;
  }

  public set activeLayerId(value: LayerId) {
    if (this.layers.some(layer => layer.id === value)) {
      this._activeLayerId = value;
    }
  }

  public get activeLayer(): TLayer {
    const layer = this.getLayer(this._activeLayerId);
    if (!layer) throw new Error(`Active layer not found: ${this._activeLayerId}`);
    return layer;
  }

  public get track(): TLayer { return this.requireLayer("track"); }
  public get blocks(): TLayer { return this.requireLayer("blocks"); }
  public get sensors(): TLayer { return this.requireLayer("sensors"); }
  public get signals(): TLayer { return this.requireLayer("signals"); }
  public get buildings(): TLayer { return this.requireLayer("buildings"); }

  public addLayer(id: LayerId, name: string, options?: LayerOptions): TLayer {
    const existing = this.getLayer(id);
    if (existing) return existing;
    const layer = this.layerFactory(id, name, options);
    this.layers.push(layer);
    return layer;
  }

  public getLayer(id: LayerId): TLayer | undefined {
    return this.layers.find(layer => layer.id === id);
  }

  public requireLayer(id: LayerId): TLayer {
    const layer = this.getLayer(id);
    if (!layer) throw new Error(`Layer not found: ${id}`);
    return layer;
  }

  /**
   * Issues a stable uint16 ID. IDs are never reused inside a loaded layout
   * session; after loading, rebuildElementIdSequence() starts after the largest
   * persisted ID.
   */
  public allocateElementId(): LayoutElementId {
    const used = new Set(this.getAllElements().map(element => element.id));

    for (let attempts = 0; attempts < MAX_LAYOUT_ELEMENT_ID; attempts += 1) {
      const candidate = this.nextElementId;
      this.nextElementId =
        candidate >= MAX_LAYOUT_ELEMENT_ID ? 1 : candidate + 1;

      if (candidate !== INVALID_LAYOUT_ELEMENT_ID && !used.has(candidate)) {
        return candidate;
      }
    }

    throw new Error("No free uint16 layout element ID is available.");
  }

  /** Re-synchronizes the allocator after a layout has been deserialized. */
  public rebuildElementIdSequence(): void {
    let maxId = 0;
    const seen = new Set<number>();

    for (const element of this.getAllElements()) {
      if (
        !Number.isInteger(element.id) ||
        element.id <= 0 ||
        element.id > MAX_LAYOUT_ELEMENT_ID ||
        seen.has(element.id)
      ) {
        element.id = INVALID_LAYOUT_ELEMENT_ID;
        continue;
      }

      seen.add(element.id);
      maxId = Math.max(maxId, element.id);
    }

    this.nextElementId = maxId >= MAX_LAYOUT_ELEMENT_ID ? 1 : maxId + 1;

    for (const element of this.getAllElements()) {
      if (element.id === INVALID_LAYOUT_ELEMENT_ID) {
        element.id = this.allocateElementId();
      }
    }
  }

  public addElement(element: TElement, layerId?: LayerId): void {
    const layer = layerId ? this.requireLayer(layerId) : this.activeLayer;
    if (layer.locked) return;

    const duplicate =
      element.id !== INVALID_LAYOUT_ELEMENT_ID &&
      this.getAllElements().some(current => current !== element && current.id === element.id);

    if (element.id === INVALID_LAYOUT_ELEMENT_ID || duplicate) {
      element.id = this.allocateElementId();
    }

    layer.add(element);
  }

  public removeElement(element: TElement): void {
    for (const layer of this.layers) {
      const index = layer.elements.indexOf(element);
      if (index >= 0) {
        layer.elements.splice(index, 1);
        return;
      }
    }
  }

  public clearAll(): void {
    for (const layer of this.layers) layer.clear();
    this.nextElementId = 1;
  }

  public getAllVisibleElements(): TElement[] {
    return this.layers.filter(layer => layer.visible).flatMap(layer => layer.elements);
  }

  public getAllElements(): TElement[] {
    return [
      ...this.track.elements,
      ...this.blocks.elements,
      ...this.signals.elements,
      ...this.sensors.elements,
      ...this.buildings.elements,
    ];
  }

  public getElementAtGrid(x: number, y: number): TElement | null {
    const all = this.getAllElements();
    for (let index = all.length - 1; index >= 0; index--) {
      const element = all[index]!;
      if (element.hitTest(x, y)) return element;
    }
    return null;
  }

  public isOccupied(x: number, y: number): boolean {
    return this.getElementAtGrid(x, y) !== null;
  }

  public findLayerOfElement(element: TElement): TLayer | undefined {
    return this.layers.find(layer => layer.elements.includes(element));
  }

  public getElement(x: number, y: number): TElement | null {
    for (const layer of this.layers) {
      for (const element of layer.elements) {
        if (element.hitTest(x, y)) return element;
      }
    }
    return null;
  }

  public getLayeredElement(referenceElement: TElement, x: number, y: number): TElement | null {
    const originalX = referenceElement.x;
    const originalY = referenceElement.y;
    referenceElement.x = x;
    referenceElement.y = y;

    try {
      for (const layer of this.layers) {
        for (const element of layer.elements) {
          if (element === referenceElement || element.layerName !== referenceElement.layerName) continue;
          if (elementsIntersect(referenceElement, element)) return element;
        }
      }
      return null;
    } finally {
      referenceElement.x = originalX;
      referenceElement.y = originalY;
    }
  }

  public checkElementCollision(first: TElement, second: TElement): boolean {
    const firstLayer = this.findLayerOfElement(first);
    const secondLayer = this.findLayerOfElement(second);
    if (firstLayer?.name !== secondLayer?.name) return false;
    return elementsIntersect(first, second);
  }

  public getElements(x: number, y: number): TElement[] {
    const list: TElement[] = [];
    for (const layer of this.layers) {
      for (const element of layer.elements) {
        if (element.hitTest(x, y)) list.push(element);
      }
    }
    return list;
  }

  public getElementById(id: LayoutElementId): TElement | undefined {
    return this.getAllElements().find(element => element.id === id);
  }

  public getElementByName(name: string): TElement | undefined {
    return this.getAllElements().find(element => element.name === name);
  }

  public isExists(x: number, y: number): boolean {
    return this.getElements(x, y).length > 0;
  }

  public getLayoutBounds(): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null {
    const elements = this.getAllElements();
    if (elements.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const element of elements) {
      const bounds = element.getBounds();
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width - 1);
      maxY = Math.max(maxY, bounds.y + bounds.height - 1);
    }

    return { minX, minY, maxX, maxY };
  }

  public getObjectXy(point: Point): TElement | undefined {
    return this.getAllElements().find(element => element.hitTest(point.x, point.y));
  }
}
