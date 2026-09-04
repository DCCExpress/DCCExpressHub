import {
  ELEMENT_TYPES,
} from "../elementTypes.js";

import type {
  OutputCommandModeDto,
  TrackSignalElementDto,
} from "../layoutDto.js";

import {
  TrackElement,
} from "../model/TrackElement.js";

import type {
  SignalOutputConfiguration,
  SignalOutputState,
} from "../signalOutput.js";

import {
  cloneSignalOutputConfiguration,
  createDefaultSignalOutputConfiguration,
  MAX_SIGNAL_LAMPS,
  newSignalOutputStateId,
  resizeDccOutputs,
  resizeSignalLamps,
} from "../signalOutput.js";

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
  /**
   * `tracksignal2` is now the canonical persisted generic Signal element.
   * TRACK_SIGNAL3 / TRACK_SIGNAL4 remain legacy import aliases only.
   */
  override type:
    typeof ELEMENT_TYPES.TRACK_SIGNAL2 =
      ELEMENT_TYPES.TRACK_SIGNAL2;

  signalOutput:
    SignalOutputConfiguration =
      createDefaultSignalOutputConfiguration(1, 2);

  currentStateIndex = 0;
  private dccFeedbackOutputs: ReturnType<typeof resizeDccOutputs> | null = null;

  lightsAll = false;
  showAddress = false;

  constructor(x: number, y: number) {
    super(x, y);

    this.address = 1;
    this.rotation = 90;
    this.rotationStep = 45;
    this.layerName = "signals";
  }

  get currentState(): SignalOutputState {
    return (
      this.signalOutput.states[this.currentStateIndex] ??
      this.signalOutput.states[0]!
    );
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

    return (
      this.signalOutput.address +
      Math.max(0, this.signalOutput.outputCount - 1)
    );
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
    const lampCount = Math.max(
      1,
      Math.min(MAX_SIGNAL_LAMPS, Math.trunc(Number(value) || 2))
    );

    if (this.signalOutput.lampCount === lampCount) {
      return;
    }

    this.signalOutput = {
      ...this.signalOutput,
      lampCount,
      states: this.signalOutput.states.map(state => ({
        ...state,
        lamps: resizeSignalLamps(state.lamps, lampCount),
      })),
    };
  }

  get addressLength(): number {
    return this.signalOutput.outputCount;
  }

  set addressLength(value: number) {
    const outputCount = Math.max(
      1,
      Math.min(16, Math.trunc(Number(value) || 1))
    );

    this.signalOutput = {
      ...this.signalOutput,
      outputCount,
      states: this.signalOutput.states.map(state => ({
        ...state,
        dccOutputs: resizeDccOutputs(
          state.dccOutputs,
          outputCount
        ),
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

  setSignalOutput(
    config: SignalOutputConfiguration
  ): void {
    this.signalOutput =
      cloneSignalOutputConfiguration(config);

    this.address = this.signalOutput.address;

    if (
      this.currentStateIndex >=
      this.signalOutput.states.length
    ) {
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
      ((Math.trunc(index) % this.stateCount) + this.stateCount) %
      this.stateCount;
    this.syncDccFeedbackFromCurrentState();
  }

  setCurrentStateById(stateId: string): void {
    const index = this.signalOutput.states.findIndex(
      state => state.id === stateId
    );

    if (index >= 0) {
      this.setCurrentStateIndex(index);
    }
  }

  setCurrentStateByAspect(aspect: number): void {
    const index = this.signalOutput.states.findIndex(
      state => state.aspect === aspect
    );

    if (index >= 0) {
      this.currentStateIndex = index;
    }
  }

  private findState(label: string): SignalOutputState | undefined {
    const normalized = label.trim().toLowerCase();

    return this.signalOutput.states.find(
      state => state.label.trim().toLowerCase() === normalized
    );
  }

  private bitmaskOf(
    state: SignalOutputState | undefined
  ): number {
    if (!state) {
      return 0;
    }

    return state.dccOutputs.reduce(
      (result, direction, index) =>
        direction === "G"
          ? result | (1 << index)
          : result,
      0
    );
  }

  private syncDccFeedbackFromCurrentState(): void {
    if (this.signalOutput.protocol !== "dcc") {
      this.dccFeedbackOutputs = null;
      return;
    }

    this.dccFeedbackOutputs = resizeDccOutputs(
      this.currentState?.dccOutputs ?? [],
      this.signalOutput.outputCount
    );
  }

  private applyLegacyBitmask(
    label: string,
    bitmask: number,
    color: string,
    aspect: number
  ): void {
    let state = this.findState(label);

    if (!state) {
      state = {
        id: newSignalOutputStateId(),
        label,
        aspect,
        lamps: Array.from(
          { length: this.lampCount },
          (_, index) => ({
            color: index === 0 ? color : "#868e96",
            active: index === 0,
          })
        ),
        dccOutputs: [],
      };

      this.signalOutput = {
        ...this.signalOutput,
        states: [...this.signalOutput.states, state],
      };
    }

    state.dccOutputs = Array.from(
      { length: this.addressLength },
      (_, index) =>
        ((bitmask >> index) & 1) === 1
          ? "G"
          : "R"
    );
  }

  get valueGreen(): number {
    return this.bitmaskOf(this.findState("Green"));
  }

  set valueGreen(value: number) {
    this.applyLegacyBitmask(
      "Green",
      value,
      "#40c057",
      16
    );
  }

  get valueRed(): number {
    return this.bitmaskOf(this.findState("Red"));
  }

  set valueRed(value: number) {
    this.applyLegacyBitmask(
      "Red",
      value,
      "#fa5252",
      0
    );
  }

  get valueYellow(): number {
    return this.bitmaskOf(this.findState("Yellow"));
  }

  set valueYellow(value: number) {
    this.applyLegacyBitmask(
      "Yellow",
      value,
      "#fab005",
      2
    );
  }

  get valueWhite(): number {
    return this.bitmaskOf(this.findState("White"));
  }

  set valueWhite(value: number) {
    this.applyLegacyBitmask(
      "White",
      value,
      "#ffffff",
      3
    );
  }

  get signalState(): SignalStates {
    const label =
      this.currentState?.label.trim().toLowerCase();

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

    if (
      address < this.signalOutput.address ||
      address > this.lastAddress
    ) {
      return;
    }

    const outputIndex =
      address - this.signalOutput.address;

    const currentOutputs = resizeDccOutputs(
      this.dccFeedbackOutputs ??
        this.currentState?.dccOutputs ??
        [],
      this.signalOutput.outputCount
    );

    currentOutputs[outputIndex] =
      active ? "G" : "R";
    this.dccFeedbackOutputs = currentOutputs;

    const matchedIndex =
      this.signalOutput.states.findIndex(state => {
        const outputs = resizeDccOutputs(
          state.dccOutputs,
          this.signalOutput.outputCount
        );

        return outputs.every(
          (direction, index) =>
            direction === currentOutputs[index]
        );
      });

    if (matchedIndex >= 0) {
      this.currentStateIndex = matchedIndex;
    }
  }

  static fromJSON(
    data: TrackSignalElementDto
  ): TrackSignalElement {
    const element =
      new TrackSignalElement(data.x, data.y);

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
          data.signalOutput.displayAsSingleLamp ??
          data.dispalyAsSingleLamp ??
          false,
      };

      element.setSignalOutput(migrated);
      element.currentStateIndex = Math.max(
        0,
        Math.min(
          migrated.states.length - 1,
          data.currentStateIndex ?? 0
        )
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
          : Math.max(
              2,
              Math.min(4, data.aspect ?? 2)
            );

    const outputCount = Math.max(
      1,
      data.addressLength ?? lampCount
    );

    const directions = (bitmask: number) =>
      Array.from(
        { length: outputCount },
        (_, index) =>
          ((bitmask >> index) & 1) === 1
            ? "G" as const
            : "R" as const
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
        ? [{
            label: "Yellow",
            color: "#fab005",
            aspect: 2,
            value: data.valueYellow ?? 0,
            lampIndex: 2,
          }]
        : []),
      ...(lampCount >= 4
        ? [{
            label: "White",
            color: "#ffffff",
            aspect: 3,
            value: data.valueWhite ?? 0,
            lampIndex: 3,
          }]
        : []),
    ];

    element.setSignalOutput({
      protocol: "dcc",
      address: Math.max(1, data.address ?? 1),
      outputCount,
      lampCount,
      displayAsSingleLamp:
        data.dispalyAsSingleLamp ?? false,
      states: stateDefs.map((state, stateIndex) => ({
        id: `legacy-${element.id}-${stateIndex}`,
        label: state.label,
        aspect: state.aspect,
        lamps: Array.from(
          { length: lampCount },
          (_, lampIndex) => ({
            color:
              lampIndex === state.lampIndex
                ? state.color
                : "#868e96",
            active: lampIndex === state.lampIndex,
          })
        ),
        dccOutputs: directions(state.value),
      })),
    });

    element.currentStateIndex = Math.min(
      0,
      element.signalOutput.states.length - 1
    );

    return element;
  }

  override toJSON(): TrackSignalElementDto {
    return {
      ...super.toJSON(),
      type: ELEMENT_TYPES.TRACK_SIGNAL2,
      address: this.signalOutput.address,
      signalOutput:
        cloneSignalOutputConfiguration(this.signalOutput),
      currentStateIndex: this.currentStateIndex,

      /**
       * Transitional legacy fields.
       * They make older builds less likely to explode on a new layout file.
       */
      outputMode: "accessory",
      aspect: this.signalOutput.lampCount,
      addressLength: this.signalOutput.outputCount,
      dispalyAsSingleLamp:
        this.signalOutput.displayAsSingleLamp,
      valueGreen: this.valueGreen,
      valueRed: this.valueRed,
      valueYellow: this.valueYellow,
      valueWhite: this.valueWhite,
    };
  }
}
