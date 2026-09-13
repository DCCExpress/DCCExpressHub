import { ELEMENT_TYPES } from "../../../domain/layout/elementTypes";
import type { OutputCommandModeDto, TrackSignalElementDto } from "../../../domain/layout/layoutDto";
import type {
  SignalOutputConfiguration,
  SignalOutputState,
} from "../../../domain/layout/signalOutput";
import {
  cloneSignalOutputConfiguration,
  createDefaultSignalOutputConfiguration,
  MAX_SIGNAL_LAMPS,
  newSignalOutputStateId,
  resizeDccOutputs,
  resizeSignalLamps,
} from "../../../domain/layout/signalOutput";
import { drawTextWithRoundedBackground } from "../../../graphics";
import { generateId } from "../../../helpers";
import { wsApi } from "../../../services/wsApi";
import { TrackElement } from "../core/TrackElement";
import type { DrawOptions, ITrackSignalElement } from "../types/EditorTypes";
import type { IEditableProperty } from "./PropertyDescriptor";
/**
 * Legacy compatibility enum.
 * New signal code uses signalOutput.states and currentStateIndex.
 */
export enum SignalStates {
  green,
  red,
  yellow,
  white,
}
export type SignalLight = {
  value: number;
  color: string;
};
export class TrackSignalElement extends TrackElement {
  signalOutput: SignalOutputConfiguration = createDefaultSignalOutputConfiguration(1, 2);
  currentStateIndex = 0;
  private dccFeedbackOutputs: ReturnType<typeof resizeDccOutputs> | null = null;
  lightsAll = false;
  showAddress = false;
  get currentState(): SignalOutputState {
    return this.signalOutput.states[this.currentStateIndex] ?? this.signalOutput.states[0]!;
  }
  get stateCount(): number {
    return this.signalOutput.states.length;
  }
  get lampCount(): number {
    return this.signalOutput.lampCount;
  }
  get lastAddress(): number {
    if (this.signalOutput.protocol === "dccext") {
      return this.signalOutput.address;
    }
    return this.signalOutput.address + Math.max(0, this.signalOutput.outputCount - 1);
  }
  /**
   * Legacy property used elsewhere in Lite.
   * Dynamic signals now use external Basic DCC or DCC Extended.
   */
  get outputMode(): OutputCommandModeDto {
    return "accessory";
  }
  set outputMode(_value: OutputCommandModeDto) {
    // Kept only for loading older layout JSON.
  }
  /**
   * Old `aspect` meant lamp count.
   * Keep it as a compatibility alias while new code uses lampCount.
   */
  get aspect(): number {
    return this.signalOutput.lampCount;
  }
  set aspect(value: number) {
    const lampCount = Math.max(1, Math.min(MAX_SIGNAL_LAMPS, Math.trunc(Number(value) || 2)));
    if (this.signalOutput.lampCount === lampCount) {
      return;
    }
    this.signalOutput = {
      ...this.signalOutput,
      lampCount,
      states: this.signalOutput.states.map((state) => ({
        ...state,
        lamps: resizeSignalLamps(state.lamps, lampCount),
      })),
    };
  }
  get addressLength(): number {
    return this.signalOutput.outputCount;
  }
  set addressLength(value: number) {
    const outputCount = Math.max(1, Math.min(16, Math.trunc(Number(value) || 1)));
    this.signalOutput = {
      ...this.signalOutput,
      outputCount,
      states: this.signalOutput.states.map((state) => ({
        ...state,
        dccOutputs: resizeDccOutputs(state.dccOutputs, outputCount),
      })),
    };
  }
  get dispalyAsSingleLamp(): boolean {
    return this.signalOutput.displayAsSingleLamp;
  }
  set dispalyAsSingleLamp(value: boolean) {
    this.signalOutput = {
      ...this.signalOutput,
      displayAsSingleLamp: Boolean(value),
    };
  }
  setSignalOutput(config: SignalOutputConfiguration): void {
    this.signalOutput = cloneSignalOutputConfiguration(config);
    this.address = this.signalOutput.address;
    if (this.currentStateIndex >= this.signalOutput.states.length) {
      this.currentStateIndex = 0;
    }
    this.syncDccFeedbackFromCurrentState();
  }
  setCurrentStateIndex(index: number): void {
    if (this.stateCount <= 0) {
      this.currentStateIndex = 0;
      this.syncDccFeedbackFromCurrentState();
      return;
    }
    this.currentStateIndex =
      ((Math.trunc(index) % this.stateCount) + this.stateCount) % this.stateCount;
    this.syncDccFeedbackFromCurrentState();
  }
  setCurrentStateById(stateId: string): void {
    const index = this.signalOutput.states.findIndex((state) => state.id === stateId);
    if (index >= 0) {
      this.setCurrentStateIndex(index);
    }
  }
  setCurrentStateByAspect(aspect: number): void {
    const index = this.signalOutput.states.findIndex((state) => state.aspect === aspect);
    if (index >= 0) {
      this.currentStateIndex = index;
    }
  }
  private findState(label: string): SignalOutputState | undefined {
    const normalized = label.trim().toLowerCase();
    return this.signalOutput.states.find(
      (state) => state.label.trim().toLowerCase() === normalized,
    );
  }
  private bitmaskOf(state: SignalOutputState | undefined): number {
    if (!state) {
      return 0;
    }
    return state.dccOutputs.reduce(
      (result, direction, index) => (direction === "G" ? result | (1 << index) : result),
      0,
    );
  }
  private syncDccFeedbackFromCurrentState(): void {
    if (this.signalOutput.protocol !== "dcc") {
      this.dccFeedbackOutputs = null;
      return;
    }
    this.dccFeedbackOutputs = resizeDccOutputs(
      this.currentState?.dccOutputs ?? [],
      this.signalOutput.outputCount,
    );
  }
  private applyLegacyBitmask(label: string, bitmask: number, color: string, aspect: number): void {
    let state = this.findState(label);
    if (!state) {
      state = {
        id: newSignalOutputStateId(),
        label,
        aspect,
        lamps: Array.from({ length: this.lampCount }, (_, index) => ({
          color: index === 0 ? color : "#868e96",
          active: index === 0,
        })),
        dccOutputs: [],
      };
      this.signalOutput = {
        ...this.signalOutput,
        states: [...this.signalOutput.states, state],
      };
    }
    state.dccOutputs = Array.from({ length: this.addressLength }, (_, index) =>
      ((bitmask >> index) & 1) === 1 ? "G" : "R",
    );
  }
  get valueGreen(): number {
    return this.bitmaskOf(this.findState("Green"));
  }
  set valueGreen(value: number) {
    this.applyLegacyBitmask("Green", value, "#40c057", 16);
  }
  get valueRed(): number {
    return this.bitmaskOf(this.findState("Red"));
  }
  set valueRed(value: number) {
    this.applyLegacyBitmask("Red", value, "#fa5252", 0);
  }
  get valueYellow(): number {
    return this.bitmaskOf(this.findState("Yellow"));
  }
  set valueYellow(value: number) {
    this.applyLegacyBitmask("Yellow", value, "#fab005", 2);
  }
  get valueWhite(): number {
    return this.bitmaskOf(this.findState("White"));
  }
  set valueWhite(value: number) {
    this.applyLegacyBitmask("White", value, "#ffffff", 3);
  }
  get signalState(): SignalStates {
    const label = this.currentState?.label.trim().toLowerCase();
    if (label === "green") {
      return SignalStates.green;
    }
    if (label === "yellow") {
      return SignalStates.yellow;
    }
    if (label === "white") {
      return SignalStates.white;
    }
    return SignalStates.red;
  }
  set signalState(value: SignalStates) {
    const label =
      value === SignalStates.green
        ? "Green"
        : value === SignalStates.yellow
          ? "Yellow"
          : value === SignalStates.white
            ? "White"
            : "Red";
    const state = this.findState(label);
    if (state) {
      this.setCurrentStateById(state.id);
    }
  }
  get isGreen(): boolean {
    return this.signalState === SignalStates.green;
  }
  get isRed(): boolean {
    return this.signalState === SignalStates.red;
  }
  get isYellow(): boolean {
    return this.signalState === SignalStates.yellow;
  }
  get isWhite(): boolean {
    return this.signalState === SignalStates.white;
  }
  setGreen(): void {
    this.signalState = SignalStates.green;
  }
  setRed(): void {
    this.signalState = SignalStates.red;
  }
  setYellow(): void {
    this.signalState = SignalStates.yellow;
  }
  setWhite(): void {
    this.signalState = SignalStates.white;
  }
  /**
   * Basic accessory feedback -> match the complete R/G pattern
   * against the configured logical states.
   */
  setValue(address: number, active: boolean): void {
    if (this.signalOutput.protocol !== "dcc") {
      return;
    }
    if (address < this.signalOutput.address || address > this.lastAddress) {
      return;
    }
    const outputIndex = address - this.signalOutput.address;
    const currentOutputs = resizeDccOutputs(
      this.dccFeedbackOutputs ?? this.currentState?.dccOutputs ?? [],
      this.signalOutput.outputCount,
    );
    currentOutputs[outputIndex] = active ? "G" : "R";
    this.dccFeedbackOutputs = currentOutputs;
    const matchedIndex = this.signalOutput.states.findIndex((state) => {
      const outputs = resizeDccOutputs(state.dccOutputs, this.signalOutput.outputCount);
      return outputs.every((direction, index) => direction === currentOutputs[index]);
    });
    if (matchedIndex >= 0) {
      this.currentStateIndex = matchedIndex;
    }
  }
  override type: typeof ELEMENT_TYPES.TRACK_SIGNAL2 = ELEMENT_TYPES.TRACK_SIGNAL2;
  constructor(x: number, y: number) {
    super(x, y);
    this.address = 1;
    this.rotation = 90;
    this.rotationStep = 45;
    this.layerName = "signals";
  }
  get canRotate(): boolean {
    return true;
  }
  get hasProperties(): boolean {
    return true;
  }
  override mouseDown(_event: MouseEvent): void {
    if (this.stateCount <= 0) {
      return;
    }
    const nextIndex = (this.currentStateIndex + 1) % this.stateCount;
    const state = this.signalOutput.states[nextIndex];
    if (state) {
      this.sendState(state);
    }
  }
  sendState(state: SignalOutputState): void {
    if (this.signalOutput.protocol === "dccext") {
      wsApi.setSignalAspect(this.signalOutput.address, state.aspect);
      this.setCurrentStateById(state.id);
      return;
    }
    state.dccOutputs.slice(0, this.signalOutput.outputCount).forEach((direction, index) => {
      wsApi.setBasicAccessory(this.signalOutput.address + index, direction === "G");
    });
    this.setCurrentStateById(state.id);
  }
  private sendNamedState(label: string): void {
    const state = this.signalOutput.states.find(
      (item) => item.label.trim().toLowerCase() === label.toLowerCase(),
    );
    if (state) {
      this.sendState(state);
    }
  }
  sendGreen(): void {
    this.sendNamedState("Green");
  }
  sendRed(): void {
    this.sendNamedState("Red");
  }
  sendYellow(): void {
    this.sendNamedState("Yellow");
  }
  sendWhite(): void {
    this.sendNamedState("White");
  }
  sendRedIfNotRed(): void {
    if (!this.isRed) {
      this.sendRed();
    }
  }
  sendGreenIfNotGreen(): void {
    if (!this.isGreen) {
      this.sendGreen();
    }
  }
  sendYellowIfNotYellow(): void {
    if (!this.isYellow) {
      this.sendYellow();
    }
  }
  sendWhiteIfNotWhite(): void {
    if (!this.isWhite) {
      this.sendWhite();
    }
  }
  private drawCircle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    color: string,
  ): void {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "black";
    ctx.stroke();
  }
  override draw(ctx: CanvasRenderingContext2D, options?: DrawOptions): void {
    this.drawSignal(ctx);
    if (options?.showSignalAddress) {
      drawTextWithRoundedBackground(
        ctx,
        this.posLeft,
        this.posBottom - 10,
        "#" + this.signalOutput.address.toString(),
      );
    }
    this.beginDraw(ctx);
    this.endDraw(ctx);
    this.drawSelection(ctx);
  }
  /**
   * Preserves the current Lite signal graphics:
   * - black rounded signal head
   * - white inner outline
   * - horizontal support/stem
   * - right-side post
   *
   * Only lamp count and lamp colors are now driven by signalOutput.
   */
  drawSignal(ctx: CanvasRenderingContext2D): void {
    this.beginDraw(ctx);
    ctx.translate(this.centerX, this.centerY);
    ctx.rotate((this.rotation * Math.PI) / 180);
    ctx.translate(-this.centerX, -this.centerY);
    let x = this.posLeft + 6;
    const y = this.centerY - 12;
    const radius = this.width / 13;
    const diameter = 2 * radius;
    const height = diameter + 4;
    const configuredLampCount = Math.max(1, this.signalOutput.lampCount);
    const lampCount = this.signalOutput.displayAsSingleLamp ? 1 : configuredLampCount;
    const frameLampCount = lampCount < 2 ? 2 : lampCount;
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "black";
    ctx.fillStyle = "black";
    ctx.roundRect(x - 4, y - radius - 2, frameLampCount * diameter + 5, 2 * radius + 4, height);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "white";
    ctx.fillStyle = "black";
    ctx.roundRect(x - 3, y - radius - 1, frameLampCount * diameter + 3, 2 * radius + 2, height);
    ctx.fillRect(x, y - radius / 2, this.width - 10, radius);
    ctx.fillRect(this.posRight - 4, y - radius / 2 - 3, 2, radius + 6);
    ctx.fill();
    ctx.stroke();
    x += lampCount === 1 ? 3 : 1;
    const state = this.currentState;
    if (lampCount === 1) {
      const activeLamp = state?.lamps.find((lamp) => lamp.active);
      this.drawCircle(ctx, x, y, radius, activeLamp?.color ?? "gray");
    } else {
      for (let index = 0; index < configuredLampCount; index++) {
        const lamp = state?.lamps[index];
        this.drawCircle(
          ctx,
          x + index * diameter,
          y,
          radius,
          this.lightsAll ? (lamp?.color ?? "gray") : lamp?.active ? (lamp.color ?? "gray") : "gray",
        );
      }
    }
    this.endDraw(ctx);
  }
  drawAddress(_ctx: CanvasRenderingContext2D): void {
    // Compatibility placeholder.
  }
  override toJSON(): ITrackSignalElement {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_SIGNAL2,
      address: this.signalOutput.address,
      signalOutput: cloneSignalOutputConfiguration(this.signalOutput),
      currentStateIndex: this.currentStateIndex,
      /**
       * Transitional legacy fields.
       * They make older builds less likely to explode on a new layout file.
       */
      outputMode: "accessory",
      aspect: this.signalOutput.lampCount,
      addressLength: this.signalOutput.outputCount,
      dispalyAsSingleLamp: this.signalOutput.displayAsSingleLamp,
      valueGreen: this.valueGreen,
      valueRed: this.valueRed,
      valueYellow: this.valueYellow,
      valueWhite: this.valueWhite,
    } as ITrackSignalElement;
  }
  static fromJSON(data: TrackSignalElementDto): TrackSignalElement {
    const element = new TrackSignalElement(data.x, data.y);
    element.id = data.id;
    element.name = data.name;
    element.layerName = data.layerName;
    element.rotation = data.rotation;
    element.rotationStep = data.rotationStep;
    element.length = data.length;
    element.address = data.address ?? 1;
    element.bg = data.bg;
    element.fg = data.fg;
    if (data.signalOutput) {
      const migrated = {
        ...data.signalOutput,
        displayAsSingleLamp:
          data.signalOutput.displayAsSingleLamp ?? data.dispalyAsSingleLamp ?? false,
      };
      element.setSignalOutput(migrated);
      element.currentStateIndex = Math.max(
        0,
        Math.min(migrated.states.length - 1, data.currentStateIndex ?? 0),
      );
      return element;
    }
    /**
     * Legacy 2/3/4-light layout migration.
     */
    const lampCount =
      data.type === "tracksignal4"
        ? 4
        : data.type === "tracksignal3"
          ? 3
          : Math.max(2, Math.min(4, data.aspect ?? 2));
    const outputCount = Math.max(1, data.addressLength ?? lampCount);
    const directions = (bitmask: number) =>
      Array.from({ length: outputCount }, (_, index) =>
        ((bitmask >> index) & 1) === 1 ? ("G" as const) : ("R" as const),
      );
    const stateDefs = [
      {
        label: "Red",
        color: "#fa5252",
        aspect: 0,
        value: data.valueRed ?? 0,
        lampIndex: 0,
      },
      {
        label: "Green",
        color: "#40c057",
        aspect: 16,
        value: data.valueGreen ?? 0,
        lampIndex: Math.min(1, lampCount - 1),
      },
      ...(lampCount >= 3
        ? [
            {
              label: "Yellow",
              color: "#fab005",
              aspect: 2,
              value: data.valueYellow ?? 0,
              lampIndex: 2,
            },
          ]
        : []),
      ...(lampCount >= 4
        ? [
            {
              label: "White",
              color: "#ffffff",
              aspect: 3,
              value: data.valueWhite ?? 0,
              lampIndex: 3,
            },
          ]
        : []),
    ];
    element.setSignalOutput({
      protocol: "dcc",
      address: Math.max(1, data.address ?? 1),
      outputCount,
      lampCount,
      displayAsSingleLamp: data.dispalyAsSingleLamp ?? false,
      states: stateDefs.map((state, stateIndex) => ({
        id: `legacy-${element.id}-${stateIndex}`,
        label: state.label,
        aspect: state.aspect,
        lamps: Array.from({ length: lampCount }, (_, lampIndex) => ({
          color: lampIndex === state.lampIndex ? state.color : "#868e96",
          active: lampIndex === state.lampIndex,
        })),
        dccOutputs: directions(state.value),
      })),
    });
    element.currentStateIndex = Math.min(0, element.signalOutput.states.length - 1);
    return element;
  }
  override clone(): TrackSignalElement {
    const copy = TrackSignalElement.fromJSON(this.toJSON());
    copy.id = generateId();
    copy.selected = this.selected;
    return copy;
  }
  override getEditableProperties(): IEditableProperty[] {
    return [
      ...super.getEditableProperties(),
      {
        label: "Signal",
        key: "signalOutput",
        type: "signal2",
        readonly: true,
      },
    ];
  }
  protected override get hasOccupancySensorProperty(): boolean {
    return false;
  }
}
