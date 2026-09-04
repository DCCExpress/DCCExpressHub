const TURNOUT_TYPES = new Set([
  "trackturnout",
  "trackturnoutleft",
  "trackturnoutright",
  "trackturnoutdouble",
  "trackturnouttwoway",
  "trackturnouttreeway"
]);

const SIGNAL_TYPES = new Set([
  "tracksignal",
  "tracksignal2",
  "tracksignal3",
  "tracksignal4"
]);

export class LayoutRuntime {
  constructor(littlefs) {
    this.littlefs = littlefs;
    this.accessories = new Map();
    this.sensors = new Map();
  }

  clear() {
    this.accessories.clear();
    this.sensors.clear();
  }

  rebuildFromLayout(layout) {
    this.clear();

    const layers = Array.isArray(layout?.layers)
      ? layout.layers
      : [];

    for (const layer of layers) {
      const elements = Array.isArray(layer?.elements)
        ? layer.elements
        : [];

      for (const element of elements) {
        this.addElement(element);
      }
    }

    this.restorePersistedState();

    console.log(
      "RUNTIME REBUILT:",
      `${this.accessories.size} accessories,`,
      `${this.sensors.size} sensors`
    );
  }

  addElement(element) {
    if (!element || typeof element !== "object") return;

    const type = String(element.type || "").toLowerCase();
    const id = String(element.id ?? `${type}:${element.address ?? "?"}`);

    if (TURNOUT_TYPES.has(type)) {
      const address = Number(
        element.turnoutAddress ?? element.address ?? 0
      );

      if (address > 0) {
        this.accessories.set(`turnout:${address}`, {
          id,
          kind: "turnout",
          type,
          address,
          outputMode:
            element.outputMode === "vpin"
              ? "vpin"
              : "accessory",
          closedValue:
            element.turnoutClosedValue === undefined
              ? false
              : !!element.turnoutClosedValue,
          closed: false
        });
      }

      return;
    }

    if (SIGNAL_TYPES.has(type)) {
      const signalOutput =
        element.signalOutput &&
        typeof element.signalOutput === "object"
          ? element.signalOutput
          : {};

      const address = Number(
        signalOutput.address ?? element.address ?? 0
      );

      if (address > 0) {
        this.accessories.set(`signal:${address}`, {
          id,
          kind: "signal",
          type,
          address,
          protocol: signalOutput.protocol ?? "dccext",
          outputCount: Number(signalOutput.outputCount ?? 1),
          aspect: null
        });
      }

      return;
    }

    if (type === "button") {
      const address = Number(element.address ?? 0);

      if (address > 0) {
        const outputMode =
          element.outputMode === "vpin"
            ? "vpin"
            : "accessory";

        this.accessories.set(`${outputMode}:${address}`, {
          id,
          kind:
            outputMode === "vpin"
              ? "vpin"
              : "accessory",
          type,
          address,
          outputMode,
          activeValue:
            element.activeValue === undefined
              ? true
              : !!element.activeValue,
          active: false
        });
      }

      return;
    }

    if (type === "tracksensor") {
      const address = Number(element.address ?? 0);

      if (address > 0) {
        this.sensors.set(address, {
          id,
          kind: "sensor",
          type,
          address,
          on: false
        });
      }
    }
  }

  restorePersistedState() {
    const saved = this.littlefs.readJson(
      "/state/runtime-state.json",
      null
    );

    if (!saved || typeof saved !== "object") return;

    const accessories = saved.accessories ?? {};

    for (const [key, value] of Object.entries(accessories)) {
      const current = this.accessories.get(key);
      if (!current || !value || typeof value !== "object") continue;

      if (current.kind === "turnout" && "closed" in value) {
        current.closed = !!value.closed;
      } else if (current.kind === "signal" && "aspect" in value) {
        current.aspect =
          value.aspect === null
            ? null
            : Number(value.aspect);
      } else if ("active" in value) {
        current.active = !!value.active;
      }
    }

    const sensors = saved.sensors ?? {};

    for (const [addressText, value] of Object.entries(sensors)) {
      const sensor = this.sensors.get(Number(addressText));
      if (!sensor || !value || typeof value !== "object") continue;
      sensor.on = !!value.on;
    }
  }

  saveState() {
    const accessories = {};

    for (const [key, item] of this.accessories) {
      if (item.kind === "turnout") {
        accessories[key] = {
          closed: !!item.closed
        };
      } else if (item.kind === "signal") {
        accessories[key] = {
          aspect:
            item.aspect === undefined
              ? null
              : item.aspect
        };
      } else {
        accessories[key] = {
          active: !!item.active
        };
      }
    }

    const sensors = {};

    for (const [address, item] of this.sensors) {
      sensors[String(address)] = {
        on: !!item.on
      };
    }

    const document = {
      version: 1,
      savedAt: new Date().toISOString(),
      accessories,
      sensors
    };

    this.littlefs.writeJson(
      "/state/runtime-state.json",
      document
    );

    console.log(
      "RUNTIME STATE SAVED ON POWER OFF:",
      this.littlefs.stat("/state/runtime-state.json")
    );

    return document;
  }

  setTurnout(address, closed) {
    const key = `turnout:${Number(address)}`;
    const item = this.accessories.get(key);

    if (item) {
      item.closed = !!closed;
    }
  }

  setSignal(address, aspect) {
    const key = `signal:${Number(address)}`;
    const item = this.accessories.get(key);

    if (item) {
      item.aspect = Number(aspect);
    }
  }

  setAccessory(address, active) {
    const key = `accessory:${Number(address)}`;
    const item = this.accessories.get(key);

    if (item) {
      item.active = !!active;
    }
  }

  setVpin(vpin, active) {
    const key = `vpin:${Number(vpin)}`;
    const item = this.accessories.get(key);

    if (item) {
      item.active = !!active;
    }
  }

  setSensor(address, on) {
    const item = this.sensors.get(Number(address));

    if (item) {
      item.on = !!on;
    }
  }

  snapshot() {
    return {
      accessories: Object.fromEntries(this.accessories),
      sensors: Object.fromEntries(
        [...this.sensors.entries()].map(
          ([address, value]) => [String(address), value]
        )
      )
    };
  }
}
