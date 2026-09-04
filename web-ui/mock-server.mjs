import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

import {
  MockLittleFS,
  contentTypeFor,
  parseMultipartSingleFile
} from "./mock-littlefs.mjs";

import {
  LayoutRuntime
} from "./mock-layout-runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOCK_HTTP_PORT || 3001);
const MOCK_FS_ROOT =
  process.env.MOCK_LITTLEFS_ROOT ||
  path.join(__dirname, "mock-fs");

const littlefs = new MockLittleFS(
  MOCK_FS_ROOT,
  Number(process.env.MOCK_LITTLEFS_BYTES || 4 * 1024 * 1024)
);

const layoutRuntime = new LayoutRuntime(littlefs);

const startedAt = Date.now();

const state = {
  power: false,
  programmingPower: false,
  emergencyStop: false,
  locos: new Map(),
  turnouts: new Map(),
  sensors: new Map(),
  accessories: new Map(),
  vpins: new Map(),
  signals: new Map(),
  blocks: {},
  routeReservations: [],
  locoReservations: new Map(),
  runtimeVariables: {},
  taskState: {
    running: [],
    paused: [],
    finished: [],
    aborted: []
  },
  scriptState: {
    running: false,
    source: null,
    elementId: null
  },
  cv: new Map([[1, 3], [29, 6]])
};

function savedLocos() {
  return littlefs.readJson("/config/locos.json", []);
}

function savedLayout() {
  return littlefs.readJson("/config/layout.json", {});
}

function rebuildLayoutRuntime() {
  layoutRuntime.rebuildFromLayout(savedLayout());
}

function json(res, code, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": encoded.length,
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS"
  });
  res.end(encoded);
}

function text(res, code, body, type = "text/plain; charset=utf-8") {
  const encoded = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(code, {
    "content-type": type,
    "content-length": encoded.length,
    "access-control-allow-origin": "*"
  });
  res.end(encoded);
}

function readRequestBody(req, maxBytes = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function powerInfo() {
  return {
    emergencyStop: state.emergencyStop,
    trackVoltageOn: state.power,
    trackVoltageOff: !state.power,
    shortCircuit: false,
    programmingModeActive: state.programmingPower
  };
}

function commandCenterInfo() {
  return {
    alive: true,
    power: state.power,
    type: "simulator",
    name: "DCCExpressHub Local Simulator",
    ip: "127.0.0.1",
    port: PORT,
    connectionString: `ws://127.0.0.1:${PORT}/ws`
  };
}

function dccStatus() {
  return {
    version: "5.6.1",
    hardware: "DCCExpressHub Local DCC-EX simulator",
    trackVoltageOn: state.power,
    voltageMeasured: true,
    trackVoltageV: state.power ? 14.8 : 0,
    mainCurrentMa: state.power ? 120 : 0,
    progCurrentMa: state.programmingPower ? 40 : 0,
    uptimeMs: Date.now() - startedAt,
    freeHeapBytes: 220000,
    cpuCores: 2,
    cpuFrequencyMhz: 240,
    cpuCore0Percent: 4,
    cpuCore1Percent: 3,
    chipTemperatureC: 41,
    wsClients: wss.clients.size,
    wsCommandQueueLength: 0,
    droppedWsCommands: 0,
    droppedWsTelemetry: 0,
    droppedWsControl: 0,
    droppedWsLowMemory: 0,
    droppedWsRawLines: 0
  };
}

function send(ws, type, data = {}, uuid = null) {
  if (ws.readyState !== WebSocket.OPEN) return;

  const message = {
    type,
    data,
    ...(uuid ? { uuid } : {})
  };

  ws.send(JSON.stringify(message));

  if (type !== "heartbeatAck" && type !== "dccExStatus") {
    console.log("WS TX:", JSON.stringify(message));
  }
}

function broadcast(type, data = {}) {
  for (const client of wss.clients) {
    send(client, type, data);
  }
}

function sendRuntimeSnapshot(ws) {
  send(ws, "commandCenterInfo", commandCenterInfo());
  send(ws, "commandCenterLockChanged", {
    locked: false,
    lockOwner: null,
    reason: null
  });
  send(ws, "powerInfo", powerInfo());
  send(ws, "dccExStatus", dccStatus());
  send(ws, "sensorSnapshot", { groups: [] });
}

function locoState(address) {
  let loco = state.locos.get(address);

  if (!loco) {
    loco = {
      address,
      speed: 0,
      direction: "forward",
      functions: {}
    };
    state.locos.set(address, loco);
  }

  return loco;
}

function okMeta(data, extra = {}) {
  return {
    requestId: data?.requestId ?? "",
    action: data?.action ?? "",
    ok: true,
    ...extra
  };
}

function rawDccEx(command) {
  const c = String(command || "").trim();

  if (c === "<1>") {
    state.power = true;
    state.emergencyStop = false;
    broadcast("powerInfo", powerInfo());
    broadcast("dccExStatus", dccStatus());
    return "<p1>";
  }

  if (c === "<0>") {
    state.power = false;
    layoutRuntime.saveState();
    broadcast("powerInfo", powerInfo());
    broadcast("dccExStatus", dccStatus());
    return "<p0>";
  }

  if (c === "<s>") {
    return "<iDCC-EX V-5.6.1 / DCCExpressHub Local Simulator>";
  }

  return `<r ${c}>`;
}

function handleWsMessage(ws, message) {
  const { type, data = {}, uuid } = message ?? {};

  switch (type) {
    case "heartbeat":
      send(ws, "heartbeatAck", {}, uuid);
      sendRuntimeSnapshot(ws);
      return;

    case "setTrackPower":
      state.power = !!data.on;
      state.emergencyStop = false;

      if (!state.power) {
        layoutRuntime.saveState();
      }

      broadcast("powerInfo", powerInfo());
      broadcast("dccExStatus", dccStatus());
      return;

    case "setProgrammingPower":
      state.programmingPower = !!data.on;
      broadcast("powerInfo", powerInfo());
      return;

    case "emergencyStop":
      state.emergencyStop = true;
      state.power = false;
      broadcast("powerInfo", powerInfo());
      broadcast("dccExStatus", dccStatus());
      return;

    case "writeDccExDirectCommand": {
      const response = rawDccEx(data.command);
      send(ws, "dccExDirectCommandResponse", { response }, uuid);
      send(ws, "rawInfo", { raw: response });
      return;
    }

    case "setLoco": {
      const loco = locoState(Number(data.locoAddress));
      loco.speed = Number(data.speed) || 0;
      loco.direction =
        data.direction === "reverse" ? "reverse" : "forward";
      loco.lastRunAt = new Date().toISOString();
      broadcast("locoState", { loco });
      return;
    }

    case "getLoco":
      send(ws, "locoState", {
        loco: locoState(Number(data.locoAddress))
      });
      return;

    case "setLocoFunction": {
      const loco = locoState(Number(data.locoAddress));
      loco.functions[Number(data.functionNumber)] = !!data.active;
      broadcast("locoState", { loco });
      return;
    }

    case "setTurnout": {
      const address = Number(data.address);
      const closed = !!data.closed;

      state.turnouts.set(address, closed);
      layoutRuntime.setTurnout(address, closed);

      broadcast("turnoutChanged", {
        address,
        closed
      });

      send(ws, "rawInfo", {
        raw: `<A ${address} ${closed ? 0 : 1}>`
      });

      return;
    }

    case "setSensor":
      state.sensors.set(Number(data.address), !!data.on);
      broadcast("sensorChanged", {
        address: Number(data.address),
        on: !!data.on
      });
      return;

    case "setBasicAccessory": {
      const address = Number(data.address);
      const active = !!data.active;

      state.accessories.set(address, active);
      layoutRuntime.setAccessory(address, active);

      broadcast("accessoryChanged", {
        address,
        active
      });

      send(ws, "rawInfo", {
        raw: `<A ${address} ${active ? 1 : 0}>`
      });

      return;
    }

    case "setVpin":
      state.vpins.set(Number(data.vpin), !!data.active);
      broadcast("vpinChanged", {
        vpin: Number(data.vpin),
        active: !!data.active
      });
      return;

    case "setSignalAspect": {
      const address = Number(data.address);
      const aspect = Number(data.aspect);

      state.signals.set(address, {
        aspect,
        ...(data.turnoutPhysicalValue === undefined
          ? {}
          : { turnoutPhysicalValue: !!data.turnoutPhysicalValue })
      });

      layoutRuntime.setSignal(address, aspect);

      broadcast("signalAspectChanged", {
        address,
        aspect,
        ...(data.turnoutPhysicalValue === undefined
          ? {}
          : { turnoutPhysicalValue: !!data.turnoutPhysicalValue })
      });

      send(ws, "rawInfo", {
        raw: `<A ${address} ${aspect}>`
      });

      return;
    }

    case "getBlocks":
    case "getLayoutRuntimeSnapshot":
      send(ws, "blockStateChanged", state.blocks);
      return;

    case "setBlock":
      state.blocks[data.blockId] = {
        blockId: data.blockId,
        locoId: data.locoId ?? null,
        ...(data.locoAddress === undefined
          ? {}
          : { locoAddress: Number(data.locoAddress) })
      };
      broadcast("blockStateChanged", state.blocks);
      return;

    case "setBlockRemove":
      delete state.blocks[data.blockId];
      broadcast("blockStateChanged", state.blocks);
      return;

    case "setBlocksReset":
      state.blocks = {};
      broadcast("blockStateChanged", state.blocks);
      return;

    case "reserveLoco": {
      const reservation = {
        locoAddress: Number(data.locoAddress),
        ownerId: String(data.ownerId),
        ownerType: data.ownerType,
        ...(data.ownerName ? { ownerName: data.ownerName } : {}),
        ...(data.reason ? { reason: data.reason } : {})
      };
      state.locoReservations.set(reservation.locoAddress, reservation);
      broadcast("locoReservationChanged", reservation);
      return;
    }

    case "releaseLocoReservation": {
      const locoAddress = Number(data.locoAddress);
      const reservation = state.locoReservations.get(locoAddress);
      if (
        reservation &&
        reservation.ownerId === String(data.ownerId)
      ) {
        state.locoReservations.delete(locoAddress);
      }
      broadcast("locoReservationChanged", {
        locoAddress,
        reservation: null
      });
      return;
    }

    case "reserveRoute": {
      const reservation = {
        fromBlockName: String(data.fromBlockName),
        toBlockName: String(data.toBlockName),
        reservedAt: new Date().toISOString()
      };

      const exists = state.routeReservations.some(item =>
        item.fromBlockName === reservation.fromBlockName &&
        item.toBlockName === reservation.toBlockName
      );

      if (!exists) {
        state.routeReservations.push(reservation);
      }

      broadcast("routeReservationChanged", {
        reservations: state.routeReservations
      });
      return;
    }

    case "releaseRouteReservation":
      state.routeReservations = state.routeReservations.filter(item =>
        !(
          item.fromBlockName === String(data.fromBlockName) &&
          item.toBlockName === String(data.toBlockName)
        )
      );
      broadcast("routeReservationReleased", {
        fromBlockName: String(data.fromBlockName),
        toBlockName: String(data.toBlockName),
        reservations: state.routeReservations
      });
      return;

    case "clearAllRouteReservations":
      state.routeReservations = [];
      broadcast("allRouteReservationsCleared", {
        reservations: []
      });
      return;

    case "getRouteReservations":
      send(ws, "routeReservationChanged", {
        reservations: state.routeReservations
      });
      return;

    case "setRuntimeVariable":
      state.runtimeVariables[String(data.key)] = data.value;
      broadcast("runtimeVariablesChanged", {
        variables: state.runtimeVariables
      });
      return;

    case "getRuntimeVariables":
      send(ws, "runtimeVariablesChanged", {
        variables: state.runtimeVariables
      });
      return;

    case "runScript":
      state.scriptState = {
        running: true,
        source: data.source ?? null,
        elementId: data.elementId ?? null
      };
      broadcast("scriptRuntimeState", state.scriptState);
      return;

    case "stopScript":
      state.scriptState = {
        ...state.scriptState,
        running: false
      };
      broadcast("scriptRuntimeState", state.scriptState);
      return;

    case "getScriptRuntimeState":
      send(ws, "scriptRuntimeState", state.scriptState);
      return;

    case "startTask":
      state.taskState.running.push(String(data.taskIdOrName));
      broadcast("taskRuntimeState", state.taskState);
      return;

    case "startAllTasks":
      broadcast("taskRuntimeState", state.taskState);
      return;

    case "pauseTask":
      state.taskState.paused.push(String(data.taskIdOrName));
      broadcast("taskRuntimeState", state.taskState);
      return;

    case "pauseAllTasks":
      broadcast("taskRuntimeState", state.taskState);
      return;

    case "resumeTask":
      state.taskState.paused = state.taskState.paused.filter(
        value => value !== String(data.taskIdOrName)
      );
      broadcast("taskRuntimeState", state.taskState);
      return;

    case "finishTask":
      state.taskState.finished.push(String(data.taskIdOrName));
      broadcast("taskRuntimeState", state.taskState);
      return;

    case "abortTask":
      state.taskState.aborted.push(String(data.taskIdOrName));
      broadcast("taskRuntimeState", state.taskState);
      return;

    case "finishAllTasks":
      broadcast("taskRuntimeState", state.taskState);
      return;

    case "abortAllTasks":
      broadcast("taskRuntimeState", state.taskState);
      return;

    case "getTaskRuntimeState":
      send(ws, "taskRuntimeState", state.taskState);
      return;

    case "setEditorEditMode":
      send(ws, "ack", {
        ok: true,
        editMode: !!data.editMode
      });
      return;

    case "locosCommand":
      if (data.action === "save" && Array.isArray(data.locos)) {
        littlefs.writeJson("/config/locos.json", data.locos);
      }
      send(
        ws,
        "locosResponse",
        okMeta(data, {
          locos: savedLocos(),
          count: savedLocos().length
        }),
        uuid
      );
      return;

    case "layoutCommand":
      if (data.action === "save" && data.layout !== undefined) {
        littlefs.writeJson("/config/layout.json", data.layout);
        rebuildLayoutRuntime();
      }
      send(
        ws,
        "layoutResponse",
        okMeta(data, {
          layout: savedLayout()
        }),
        uuid
      );
      return;

    case "fastClockCommand":
      send(
        ws,
        "fastClockResponse",
        okMeta(data, {
          state: {
            running: false,
            time: "12:00",
            multiplier: 1
          }
        }),
        uuid
      );
      return;

    case "programmingCommand": {
      let value;

      if (data.action === "readCv") {
        value = state.cv.get(Number(data.cv)) ?? 0;
      } else if (
        data.action === "writeCv" ||
        data.action === "pomWriteCv"
      ) {
        state.cv.set(Number(data.cv), Number(data.value));
        value = Number(data.value);
      } else if (data.action === "readAddress") {
        value = state.cv.get(1) ?? 3;
      } else if (data.action === "writeAddress") {
        state.cv.set(1, Number(data.address));
        value = Number(data.address);
      }

      send(
        ws,
        "programmingResponse",
        okMeta(data, {
          ...(value === undefined ? {} : { value }),
          raw: "DCCExpressHub mock"
        }),
        uuid
      );
      return;
    }

    case "commandCenterConfigCommand":
      if (data.action === "save" && data.config) {
        littlefs.writeJson("/config/command-center.json", data.config);
      }
      send(
        ws,
        "commandCenterConfigResponse",
        okMeta(data, {
          config: littlefs.readJson(
            "/config/command-center.json",
            null
          )
        }),
        uuid
      );
      return;

    case "appSettingsCommand":
      if (data.action === "save" && data.settings) {
        littlefs.writeJson("/config/app-settings.json", data.settings);
      }
      send(
        ws,
        "appSettingsResponse",
        okMeta(data, {
          settings: littlefs.readJson(
            "/config/app-settings.json",
            {}
          )
        }),
        uuid
      );
      return;

    case "signalLogicCommand":
      send(
        ws,
        "signalLogicResponse",
        okMeta(data, {
          document: { version: 1, groups: [], rules: [] },
          issues: []
        }),
        uuid
      );
      return;

    case "routeLock":
      broadcast("commandCenterLockChanged", {
        locked: true,
        lockOwner: "mock",
        reason: "route"
      });
      return;

    case "routeUnlock":
      broadcast("commandCenterLockChanged", {
        locked: false,
        lockOwner: null,
        reason: null
      });
      return;

    default:
      send(
        ws,
        "ack",
        {
          ok: true,
          message: `Mock accepted: ${String(type)}`
        },
        uuid
      );
  }
}

async function handleHttp(req, res) {
  const url = new URL(
    req.url,
    `http://${req.headers.host || "127.0.0.1"}`
  );

  console.log("HTTP RX:", req.method, url.pathname + url.search);

  try {
    if (req.method === "OPTIONS") {
      return json(res, 204, {});
    }

    if (url.pathname === "/api/status") {
      return json(res, 200, {
        ok: true,
        simulator: true,
        version: "5.6.1",
        wsClients: wss.clients.size,
        power: state.power,
        uptimeMs: Date.now() - startedAt,
        littlefs: littlefs.info()
      });
    }

    if (url.pathname === "/api/layout") {
      if (req.method === "GET") {
        console.log("HTTP GET /api/layout");
        return json(res, 200, savedLayout());
      }

      if (req.method === "POST") {
        const body = await readRequestBody(req);
        const layout = JSON.parse(body.toString("utf8"));

        littlefs.writeJson("/config/layout.json", layout);
        rebuildLayoutRuntime();

        console.log(
          "HTTP POST /api/layout ->",
          littlefs.stat("/config/layout.json")
        );

        return json(res, 200, { ok: true });
      }

      return json(res, 405, {
        ok: false,
        message: "Method not allowed"
      });
    }

    if (url.pathname === "/api/locos") {
      if (req.method === "GET") {
        console.log("HTTP GET /api/locos");
        return json(res, 200, savedLocos());
      }

      if (req.method === "POST") {
        const body = await readRequestBody(req);
        const locos = JSON.parse(body.toString("utf8"));

        if (!Array.isArray(locos)) {
          return json(res, 400, {
            ok: false,
            message: "Locomotives payload must be an array"
          });
        }

        littlefs.writeJson("/config/locos.json", locos);

        console.log(
          "HTTP POST /api/locos ->",
          `${locos.length} locomotive(s)`,
          littlefs.stat("/config/locos.json")
        );

        return json(res, 200, {
          ok: true,
          count: locos.length
        });
      }

      return json(res, 405, {
        ok: false,
        message: "Method not allowed"
      });
    }

    if (url.pathname === "/api/mock/runtime") {
      return json(res, 200, {
        ok: true,
        ...layoutRuntime.snapshot(),
        persisted: littlefs.readJson(
          "/state/runtime-state.json",
          null
        )
      });
    }

    if (url.pathname === "/api/mock/state") {
      return json(res, 200, {
        power: state.power,
        programmingPower: state.programmingPower,
        emergencyStop: state.emergencyStop,
        locos: [...state.locos.values()],
        turnouts: Object.fromEntries(state.turnouts),
        sensors: Object.fromEntries(state.sensors),
        accessories: Object.fromEntries(state.accessories),
        vpins: Object.fromEntries(state.vpins),
        signals: Object.fromEntries(state.signals),
        blocks: state.blocks,
        routeReservations: state.routeReservations,
        locoReservations: Object.fromEntries(state.locoReservations),
        runtimeVariables: state.runtimeVariables,
        taskState: state.taskState,
        scriptState: state.scriptState,
        littlefs: littlefs.info(),
        littlefsRoot: MOCK_FS_ROOT
      });
    }

    if (
      url.pathname === "/api/mock/littlefs/reset" &&
      req.method === "POST"
    ) {
      return json(res, 200, {
        ok: true,
        littlefs: littlefs.reset()
      });
    }

    if (url.pathname === "/fsinfo") {
      return json(res, 200, littlefs.info());
    }

    if (url.pathname === "/list") {
      return json(
        res,
        200,
        littlefs.list(url.searchParams.get("path") || "/")
      );
    }

    if (
      url.pathname === "/api/files/text" &&
      req.method === "GET"
    ) {
      const filePath = url.searchParams.get("path");

      if (!filePath) {
        return text(res, 400, "Missing path");
      }

      return text(
        res,
        200,
        littlefs.readText(filePath),
        "text/plain; charset=utf-8"
      );
    }

    if (
      url.pathname === "/upload" &&
      req.method === "POST"
    ) {
      const body = await readRequestBody(req);
      const uploaded = parseMultipartSingleFile(
        body,
        req.headers["content-type"]
      );

      const requestedDirectory =
        url.searchParams.get("path") || "/images";

      const targetVirtual = littlefs.virtualJoin(
        requestedDirectory,
        uploaded.fileName
      );

      littlefs.writeBuffer(targetVirtual, uploaded.data);

      return json(res, 200, {
        ok: true,
        name: uploaded.fileName,
        path: targetVirtual,
        size: uploaded.data.length,
        contentType: uploaded.contentType
      });
    }

    if (
      url.pathname === "/delete" &&
      (req.method === "GET" || req.method === "DELETE")
    ) {
      const filePath = url.searchParams.get("path");

      if (!filePath) {
        return json(res, 400, {
          ok: false,
          message: "Missing path"
        });
      }

      return json(res, 200, {
        ok: true,
        ...littlefs.delete(filePath)
      });
    }

    if (req.method === "GET" && littlefs.exists(url.pathname)) {
      const stat = littlefs.stat(url.pathname);

      if (stat?.type === "file") {
        return text(
          res,
          200,
          littlefs.readBuffer(url.pathname),
          contentTypeFor(url.pathname)
        );
      }
    }

    return json(res, 404, {
      ok: false,
      error: "Mock route not found",
      path: url.pathname
    });
  } catch (error) {
    console.error("HTTP ERROR:", req.method, url.pathname, error);

    const code =
      error?.code === "ENOENT" ? 404 :
      error?.code === "ENOSPC" ? 507 :
      500;

    return json(res, code, {
      ok: false,
      error: error?.message || String(error)
    });
  }
}

const server = http.createServer((req, res) => {
  void handleHttp(req, res);
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(
    request.url,
    `http://${request.headers.host || "127.0.0.1"}`
  );

  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(
    request,
    socket,
    head,
    ws => wss.emit("connection", ws, request)
  );
});

wss.on("connection", (ws, request) => {
  console.log(
    "WS CONNECT:",
    request.socket.remoteAddress,
    request.url
  );

  ws.on("close", (code, reason) => {
    console.log(
      "WS CLOSE:",
      code,
      reason.toString()
    );
  });

  send(ws, "ws:welcome", {
    message: "DCCExpressHub Local DCC-EX simulator"
  });

  sendRuntimeSnapshot(ws);

  const runtimeSnapshot = layoutRuntime.snapshot();

  for (const item of Object.values(runtimeSnapshot.accessories)) {
    if (item.kind === "turnout") {
      send(ws, "turnoutChanged", {
        address: item.address,
        closed: !!item.closed
      });
    } else if (item.kind === "signal" && item.aspect !== null) {
      send(ws, "signalAspectChanged", {
        address: item.address,
        aspect: item.aspect
      });
    } else if (item.kind === "accessory") {
      send(ws, "accessoryChanged", {
        address: item.address,
        active: !!item.active
      });
    } else if (item.kind === "vpin") {
      send(ws, "vpinChanged", {
        vpin: item.address,
        active: !!item.active
      });
    }
  }

  for (const sensor of Object.values(runtimeSnapshot.sensors)) {
    send(ws, "sensorChanged", {
      address: sensor.address,
      on: !!sensor.on
    });
  }

  ws.on("message", raw => {
    try {
      const line = raw.toString();
      console.log("WS RX:", line);
      handleWsMessage(ws, JSON.parse(line));
    } catch (error) {
      console.error("WS ERROR:", error);
      send(ws, "error", {
        message: `Invalid mock message: ${error.message}`
      });
    }
  });
});

rebuildLayoutRuntime();

server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("DCCExpressHub Local simulator");
  console.log(`HTTP:      http://127.0.0.1:${PORT}`);
  console.log(`WebSocket: ws://127.0.0.1:${PORT}/ws`);
  console.log(`LittleFS:  ${MOCK_FS_ROOT}`);
  console.log(
    `Capacity:  ${(littlefs.info().totalBytes / 1024 / 1024).toFixed(1)} MB`
  );
  console.log("");
});
