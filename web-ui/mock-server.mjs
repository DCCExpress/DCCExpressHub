import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

import {
  MockLittleFS,
  contentTypeFor,
  parseMultipartSingleFile
} from "./mock-littlefs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOCK_HTTP_PORT || 3001);
const MOCK_FS_ROOT =
  process.env.MOCK_LITTLEFS_ROOT ||
  path.join(__dirname, "mock-fs");

const littlefs = new MockLittleFS(
  MOCK_FS_ROOT,
  Number(process.env.MOCK_LITTLEFS_BYTES || 4 * 1024 * 1024)
);

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
  cv: new Map([[1, 3], [29, 6]])
};

function savedLocos() {
  return littlefs.readJson("/config/locos.json", []);
}

function savedLayout() {
  return littlefs.readJson("/config/layout.json", null);
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

function dccStatus() {
  return {
    version: "5.6.1",
    hardware: "DCCExpressHub Local DCC-EX simulator",
    trackVoltageOn: state.power,
    voltageMeasured: true,
    trackVoltageV: state.power ? 14.8 : 0,
    mainCurrentMa: state.power ? 120 : 0,
    progCurrentMa: 0,
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
  ws.send(JSON.stringify({ type, data, ...(uuid ? { uuid } : {}) }));
}

function broadcast(type, data = {}) {
  for (const client of wss.clients) {
    send(client, type, data);
  }
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
    broadcast("powerInfo", powerInfo());
    broadcast("dccExStatus", dccStatus());
    return "<p0>";
  }

  if (c === "<s>") {
    return "<iDCC-EX V-5.6.1 / DCCExpressHub Local Simulator>";
  }

  return `<r ${c}>`;
}

function okMeta(data, extra = {}) {
  return {
    requestId: data?.requestId ?? "",
    action: data?.action ?? "",
    ok: true,
    ...extra
  };
}

function handleWsMessage(ws, message) {
  const { type, data = {}, uuid } = message ?? {};

  switch (type) {
    case "heartbeat":
      return send(ws, "heartbeatAck", {}, uuid);

    case "setTrackPower":
      state.power = !!data.on;
      state.emergencyStop = false;
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
      return send(
        ws,
        "locoState",
        { loco: locoState(Number(data.locoAddress)) }
      );

    case "setLocoFunction": {
      const loco = locoState(Number(data.locoAddress));
      loco.functions[Number(data.functionNumber)] = !!data.active;
      broadcast("locoState", { loco });
      return;
    }

    case "setTurnout":
      state.turnouts.set(Number(data.address), !!data.closed);
      return broadcast("turnoutChanged", {
        address: Number(data.address),
        closed: !!data.closed
      });

    case "setSensor":
      state.sensors.set(Number(data.address), !!data.on);
      return broadcast("sensorChanged", {
        address: Number(data.address),
        on: !!data.on
      });

    case "setBasicAccessory":
      state.accessories.set(Number(data.address), !!data.active);
      return broadcast("accessoryChanged", {
        address: Number(data.address),
        active: !!data.active
      });

    case "setVpin":
      state.vpins.set(Number(data.vpin), !!data.active);
      return broadcast("vpinChanged", {
        vpin: Number(data.vpin),
        active: !!data.active
      });

    case "setSignalAspect":
      state.signals.set(Number(data.address), Number(data.aspect));
      return broadcast("signalAspectChanged", {
        address: Number(data.address),
        aspect: Number(data.aspect)
      });

    case "setBlock":
      state.blocks[data.blockId] = {
        blockId: data.blockId,
        locoId: data.locoId ?? null,
        ...(data.locoAddress === undefined
          ? {}
          : { locoAddress: Number(data.locoAddress) })
      };
      return broadcast("blockStateChanged", state.blocks);

    case "setBlockRemove":
      delete state.blocks[data.blockId];
      return broadcast("blockStateChanged", state.blocks);

    case "setBlocksReset":
      state.blocks = {};
      return broadcast("blockStateChanged", state.blocks);

    case "getBlocks":
    case "getLayoutRuntimeSnapshot":
      return send(ws, "blockStateChanged", state.blocks);

    case "locosCommand":
      if (data.action === "save" && Array.isArray(data.locos)) {
        littlefs.writeJson("/config/locos.json", data.locos);
      }
      return send(
        ws,
        "locosResponse",
        okMeta(data, {
          locos: savedLocos(),
          count: savedLocos().length
        }),
        uuid
      );

    case "layoutCommand": {
      console.log("LAYOUT COMMAND:", data.action, data.requestId);

      if (data.action === "save" && data.layout !== undefined) {
        console.log("Saving layout to LittleFS...");
        littlefs.writeJson("/config/layout.json", data.layout);
        console.log("Layout saved:", littlefs.stat("/config/layout.json"));
      }

      const layout = savedLayout();
      const response = {
        requestId: data.requestId ?? "",
        action: data.action ?? "",
        ok: true,
        ...(layout ? { layout } : {})
      };

      console.log("Sending layoutResponse:", {
        requestId: response.requestId,
        action: response.action,
        ok: response.ok,
        hasLayout: !!response.layout
      });

      return send(ws, "layoutResponse", response, uuid);
    }

    case "programmingCommand": {
      let value;

      if (data.action === "readCv") {
        value = state.cv.get(Number(data.cv)) ?? 0;
      }

      if (
        data.action === "writeCv" ||
        data.action === "pomWriteCv"
      ) {
        state.cv.set(Number(data.cv), Number(data.value));
        value = Number(data.value);
      }

      if (data.action === "readAddress") {
        value = state.cv.get(1) ?? 3;
      }

      if (data.action === "writeAddress") {
        state.cv.set(1, Number(data.address));
        value = Number(data.address);
      }

      return send(
        ws,
        "programmingResponse",
        okMeta(data, {
          ...(value === undefined ? {} : { value }),
          raw: "DCCExpressHub mock"
        }),
        uuid
      );
    }

    case "commandCenterConfigCommand": {
      if (data.action === "save" && data.config) {
        littlefs.writeJson(
          "/config/command-center.json",
          data.config
        );
      }

      return send(
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
    }

    case "appSettingsCommand": {
      if (data.action === "save" && data.settings) {
        littlefs.writeJson(
          "/config/app-settings.json",
          data.settings
        );
      }

      return send(
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
    }

    case "signalLogicCommand":
      return send(
        ws,
        "signalLogicResponse",
        okMeta(data, {
          document: { version: 1, rules: [] },
          issues: []
        }),
        uuid
      );

    case "fileCommand": {
      try {
        let extra = { fileName: data.fileName };

        if (data.action === "readText") {
          extra.content = littlefs.readText(data.fileName);
        } else if (data.action === "writeText") {
          littlefs.writeText(
            data.fileName,
            data.content ?? ""
          );
        } else if (data.action === "readJson") {
          extra.data = littlefs.readJson(data.fileName, null);
        } else if (data.action === "writeJson") {
          littlefs.writeJson(data.fileName, data.data);
        }

        return send(
          ws,
          "fileResponse",
          okMeta(data, extra),
          uuid
        );
      } catch (error) {
        return send(
          ws,
          "fileResponse",
          {
            requestId: data.requestId ?? "",
            action: data.action ?? "",
            ok: false,
            message: error.message,
            fileName: data.fileName
          },
          uuid
        );
      }
    }

    case "automationCommand":
      return send(
        ws,
        "automationResponse",
        okMeta(data, {
          state: {
            running: data.action === "start",
            tickMs: 100,
            modules: []
          }
        }),
        uuid
      );

    case "routeLock":
      return broadcast("commandCenterLockChanged", {
        locked: true,
        lockOwner: "mock",
        reason: "route"
      });

    case "routeUnlock":
      return broadcast("commandCenterLockChanged", {
        locked: false,
        lockOwner: null,
        reason: null
      });

    default:
      return send(
        ws,
        "ack",
        `Mock accepted: ${String(type)}`,
        uuid
      );
  }
}

async function handleHttp(req, res) {
  const url = new URL(
    req.url,
    `http://${req.headers.host || "127.0.0.1"}`
  );

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

      /*
       * Lite loco image upload calls POST /upload without ?path.
       * The real Lite UI expects those files under /images.
       */
      const requestedDirectory =
        url.searchParams.get("path") || "/images";

      const targetVirtual = littlefs.virtualJoin(
        requestedDirectory,
        uploaded.fileName
      );

      littlefs.writeBuffer(
        targetVirtual,
        uploaded.data
      );

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

    /*
     * Any existing file inside mock-fs can be fetched by its
     * LittleFS virtual path, e.g. /images/loco.jpg.
     */
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
      error: "Mock route not found",
      path: url.pathname
    });
  } catch (error) {
    const code = error?.code === "ENOENT" ? 404 :
      error?.code === "ENOSPC" ? 507 : 500;

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

  send(ws, "commandCenterInfo", {
    alive: true,
    power: state.power,
    type: "simulator",
    name: "Local DCC-EX simulator",
    ip: "127.0.0.1",
    port: 3001,
    connectionString: "ws://127.0.0.1:3001/ws"
  });

  send(ws, "commandCenterLockChanged", {
    locked: false,
    lockOwner: null,
    reason: null
  });

  send(ws, "powerInfo", powerInfo());
  send(ws, "dccExStatus", dccStatus());
  send(ws, "sensorSnapshot", { groups: [] });

  ws.on("message", raw => {
    try {
      const text = raw.toString();
      console.log("WS RX:", text);
      handleWsMessage(ws, JSON.parse(text));
    } catch (error) {
      console.error("WS ERROR:", error);
      send(ws, "error", {
        message: `Invalid mock message: ${error.message}`
      });
    }
  });
});

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
