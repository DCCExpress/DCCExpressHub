import {
  isDemoMode,
} from "./demoMode";

import {
  demoSeedLayout,
  demoSeedLocos,
  demoSeedSignalRulesJsonl,
} from "./demoSeed.generated";

const STORAGE_PREFIX =
  "dccexpress-lite.demo.";

const DEFAULT_LAYOUT =
  demoSeedLayout;

const DEFAULT_LOCOS =
  demoSeedLocos;

const DEFAULT_SIGNAL_RULES =
  demoSeedSignalRulesJsonl;

type JsonRecord =
  Record<string, unknown>;

function storageGet(
  key: string,
  fallback: string
): string {
  try {
    return (
      window.localStorage.getItem(
        STORAGE_PREFIX + key
      ) ?? fallback
    );
  } catch {
    return fallback;
  }
}

function storageSet(
  key: string,
  value: string
): void {
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + key,
      value
    );
  } catch {
    // Demo mode must remain usable when storage is blocked.
  }
}

function jsonResponse(
  value: unknown,
  init: ResponseInit = {}
): Response {
  return new Response(
    JSON.stringify(value),
    {
      status: init.status ?? 200,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        ...(init.headers ?? {}),
      },
    }
  );
}

function textResponse(
  value: string,
  init: ResponseInit = {}
): Response {
  return new Response(
    value,
    {
      status: init.status ?? 200,
      headers: {
        "Content-Type":
          "text/plain; charset=utf-8",
        ...(init.headers ?? {}),
      },
    }
  );
}

async function requestBodyText(
  request: Request
): Promise<string> {
  try {
    return await request.clone().text();
  } catch {
    return "";
  }
}

function defaultNetworkSettings() {
  return {
    configured: false,
    ssid: "",
    hasPassword: false,
    hostname: "dccex-demo",
    mode: "station",
    currentIp: "demo",
    connectionUrl:
      window.location.href,
    restartPending: false,
  };
}

async function handleDemoFetch(
  request: Request
): Promise<Response | null> {
  const url =
    new URL(
      request.url,
      window.location.href
    );

  const method =
    request.method.toUpperCase();

  if (
    url.pathname.endsWith(
      "/version.json"
    )
  ) {
    return jsonResponse({
      version: "DEMO",
    });
  }

  if (
    url.pathname === "/api/locos"
  ) {
    if (method === "GET") {
      return jsonResponse(
        JSON.parse(
          storageGet(
            "locos",
            JSON.stringify(
              DEFAULT_LOCOS
            )
          )
        )
      );
    }

    if (method === "POST") {
      storageSet(
        "locos",
        await requestBodyText(
          request
        )
      );

      return jsonResponse({
        ok: true,
        demo: true,
      });
    }
  }

  if (
    url.pathname === "/api/layout"
  ) {
    if (method === "GET") {
      return jsonResponse(
        JSON.parse(
          storageGet(
            "layout",
            JSON.stringify(
              DEFAULT_LAYOUT
            )
          )
        )
      );
    }

    if (method === "POST") {
      storageSet(
        "layout",
        await requestBodyText(
          request
        )
      );

      return jsonResponse({
        ok: true,
        demo: true,
      });
    }
  }

  if (
    url.pathname ===
      "/api/settings/network"
  ) {
    if (method === "GET") {
      return jsonResponse(
        defaultNetworkSettings()
      );
    }

    if (method === "POST") {
      return jsonResponse({
        ok: true,
        message:
          "Demo mode: network settings are not changed.",
      });
    }
  }

  if (
    url.pathname ===
      "/api/settings/network/reset"
  ) {
    return jsonResponse({
      ok: true,
      message:
        "Demo mode: network settings are not changed.",
    });
  }

  if (
    url.pathname === "/fsinfo"
  ) {
    return jsonResponse({
      total: 4096,
      used: 860,
      free: 3236,
      totalBytes: 4 * 1024 * 1024,
      usedBytes: 860 * 1024,
      freeBytes: 3236 * 1024,
      flashChipBytes:
        16 * 1024 * 1024,
      firmwareBytes:
        1450 * 1024,
      firmwarePartitionBytes:
        2 * 1024 * 1024,
      otaPartitionBytes:
        2 * 1024 * 1024,
      systemReservedBytes:
        8 * 1024 * 1024,
    });
  }

  if (
    url.pathname === "/api/devices"
  ) {
    return jsonResponse({
      scannedAtMs:
        Math.floor(
          performance.now()
        ),
      configuredDevices: [],
      i2cDevices: [],
    });
  }

  if (
    url.pathname ===
      "/api/files/text"
  ) {
    const path =
      url.searchParams.get(
        "path"
      ) ?? "";

    if (
      path ===
      "/signal-rules.jsonl"
    ) {
      return textResponse(
        storageGet(
          "signal-rules.jsonl",
          DEFAULT_SIGNAL_RULES
        )
      );
    }

    return textResponse(
      "Demo file not found.",
      {
        status: 404,
      }
    );
  }

  if (
    url.pathname === "/upload" &&
    method === "POST"
  ) {
    try {
      const form =
        await request.clone()
          .formData();

      const file =
        form.get("file");

      if (file instanceof File) {
        storageSet(
          file.name,
          await file.text()
        );
      }

      return jsonResponse({
        ok: true,
        demo: true,
      });
    } catch {
      return jsonResponse(
        {
          ok: false,
          message:
            "Demo upload failed.",
        },
        {
          status: 400,
        }
      );
    }
  }

  if (
    url.pathname === "/list"
  ) {
    return jsonResponse({
      path:
        url.searchParams.get(
          "path"
        ) ?? "/",
      entries: [],
    });
  }

  if (
    url.pathname === "/delete"
  ) {
    return jsonResponse({
      ok: true,
      demo: true,
    });
  }

  return null;
}

type SocketHandler<TEvent> =
  ((event: TEvent) => void) | null;

class DemoWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readonly url: string;
  readonly protocol = "";
  readonly extensions = "";
  binaryType:
    BinaryType = "blob";

  bufferedAmount = 0;
  readyState =
    DemoWebSocket.CONNECTING;

  onopen:
    SocketHandler<Event> = null;

  onclose:
    SocketHandler<CloseEvent> =
      null;

  onerror:
    SocketHandler<Event> = null;

  onmessage:
    SocketHandler<MessageEvent> =
      null;

  private trackPowerOn = true;

  constructor(
    url: string | URL
  ) {
    this.url = String(url);

    window.setTimeout(
      () => {
        if (
          this.readyState !==
          DemoWebSocket.CONNECTING
        ) {
          return;
        }

        this.readyState =
          DemoWebSocket.OPEN;

        this.onopen?.(
          new Event("open")
        );

        this.emitInitialState();
      },
      20
    );
  }

  close(
    _code?: number,
    _reason?: string
  ): void {
    if (
      this.readyState ===
      DemoWebSocket.CLOSED
    ) {
      return;
    }

    this.readyState =
      DemoWebSocket.CLOSED;

    this.onclose?.(
      new CloseEvent(
        "close",
        {
          code: 1000,
          reason:
            "Demo connection closed",
          wasClean: true,
        }
      )
    );
  }

  send(
    data:
      | string
      | ArrayBufferLike
      | Blob
      | ArrayBufferView
  ): void {
    if (
      this.readyState !==
      DemoWebSocket.OPEN
    ) {
      throw new DOMException(
        "Demo WebSocket is not open."
      );
    }

    if (
      typeof data !== "string"
    ) {
      return;
    }

    let message:
      JsonRecord;

    try {
      message =
        JSON.parse(
          data
        ) as JsonRecord;
    } catch {
      return;
    }

    const type =
      typeof message.type ===
        "string"
        ? message.type
        : "";

    const payload =
      message.data &&
      typeof message.data ===
        "object"
        ? message.data as
          JsonRecord
        : {};

    this.handleCommand(
      type,
      payload
    );
  }

  addEventListener(
    _type: string,
    _listener:
      EventListenerOrEventListenerObject
  ): void {
    // wsClient uses onopen/onmessage/etc.
  }

  removeEventListener(
    _type: string,
    _listener:
      EventListenerOrEventListenerObject
  ): void {
    // wsClient uses onopen/onmessage/etc.
  }

  dispatchEvent(
    _event: Event
  ): boolean {
    return true;
  }

  private emit(
    type: string,
    data: unknown
  ): void {
    window.setTimeout(
      () => {
        if (
          this.readyState !==
          DemoWebSocket.OPEN
        ) {
          return;
        }

        this.onmessage?.(
          new MessageEvent(
            "message",
            {
              data:
                JSON.stringify({
                  type,
                  data,
                }),
            }
          )
        );
      },
      0
    );
  }

  private emitInitialState():
    void {
    this.emit(
      "commandCenterInfo",
      {
        alive: true,
        type:
          "dcc-ex-demo",
        name:
          "DCCExpress Lite DEMO",
        connectionString:
          "demo://browser",
      }
    );

    this.emitPowerInfo();

    this.emit(
      "commandCenterLockChanged",
      {
        locked: false,
        lockOwner: null,
        reason: null,
      }
    );

    this.emit(
      "dccExStatus",
      {
        version: "DEMO",
        hardware:
          "Browser simulator",
        trackVoltageOn:
          this.trackPowerOn,
        voltageMeasured: false,
        trackVoltageV: null,
        mainCurrentMa: 185,
        progCurrentMa: 0,
        uptimeMs:
          Math.floor(
            performance.now()
          ),
        freeHeapBytes:
          196 * 1024,
        minimumFreeHeapBytes:
          164 * 1024,
        largestFreeHeapBlockBytes:
          120 * 1024,
        cpuCores: 2,
        cpuFrequencyMhz: 240,
        cpuCore0Percent: 8,
        cpuCore1Percent: 4,
        chipTemperatureC: 42.5,
        wsClients: 1,
        wsCommandQueueLength: 0,
        droppedWsCommands: 0,
        droppedWsTelemetry: 0,
        droppedWsControl: 0,
        droppedWsLowMemory: 0,
        resetReason: "demo",
      }
    );
  }

  private emitPowerInfo():
    void {
    this.emit(
      "powerInfo",
      {
        emergencyStop: false,
        trackVoltageOn:
          this.trackPowerOn,
        trackVoltageOff:
          !this.trackPowerOn,
        shortCircuit: false,
        programmingModeActive:
          false,
      }
    );
  }

  private handleCommand(
    type: string,
    payload: JsonRecord
  ): void {
    if (type === "heartbeat") {
      this.emit(
        "heartbeatAck",
        {}
      );

      return;
    }

    if (
      type === "setTrackPower"
    ) {
      this.trackPowerOn =
        payload.on === true;

      this.emitPowerInfo();
      return;
    }

    if (
      type === "setTurnout"
    ) {
      this.emit(
        "turnoutChanged",
        {
          address:
            Number(
              payload.address
            ) || 0,
          closed:
            payload.closed ===
            true,
        }
      );

      return;
    }

    if (
      type ===
      "setBasicAccessory"
    ) {
      this.emit(
        "accessoryChanged",
        {
          address:
            Number(
              payload.address
            ) || 0,
          active:
            payload.active ===
            true,
        }
      );

      return;
    }

    if (type === "setVpin") {
      this.emit(
        "vpinChanged",
        {
          vpin:
            Number(
              payload.vpin
            ) || 0,
          active:
            payload.active ===
            true,
        }
      );

      return;
    }

    if (type === "setSignalAspect") {
      this.emit(
        "signalAspectChanged",
        {
          address:
            Number(
              payload.address
            ) || 0,
          aspect:
            Number(
              payload.aspect
            ) || 0,
        }
      );

      return;
    }

    if (
      type === "setSensor"
    ) {
      this.emit(
        "sensorChanged",
        {
          address:
            Number(
              payload.address
            ) || 0,
          on:
            payload.on === true,
        }
      );

      return;
    }

    if (
      type === "setLoco" ||
      type === "getLoco"
    ) {
      const address =
        Number(
          payload.locoAddress
        ) || 3;

      this.emit(
        "locoState",
        {
          loco: {
            address,
            speed:
              Number(
                payload.speed
              ) || 0,
            direction:
              payload.direction ===
                "reverse"
                ? "reverse"
                : "forward",
            functions: {},
          },
        }
      );

      return;
    }

    if (
      type ===
      "writeDccExDirectCommand"
    ) {
      this.emit(
        "dccExDirectCommandResponse",
        {
          response:
            String(
              payload.command ??
              ""
            ),
        }
      );

      return;
    }

    if (
      type ===
      "getLayoutRuntimeSnapshot"
    ) {
      this.emitInitialState();

      this.emit(
        "sensorSnapshot",
        {
          groups: [],
        }
      );

      this.emit(
        "blockStateChanged",
        {}
      );

      return;
    }

    if (
      type ===
      "programmingCommand"
    ) {
      this.emit(
        "programmingResponse",
        {
          requestId:
            String(
              payload.requestId ??
              "demo"
            ),
          action:
            String(
              payload.action ??
              ""
            ),
          ok: true,
          message:
            "Demo mode: no decoder was changed.",
        }
      );

      return;
    }

    if (
      type ===
      "signalLogicCommand"
    ) {
      this.emit(
        "signalLogicResponse",
        {
          requestId:
            String(
              payload.requestId ??
              "demo"
            ),
          action:
            String(
              payload.action ??
              ""
            ),
          ok: true,
          created: false,
          document: {
            version: 3,
            enabled: false,
            groups: [],
          },
          issues: [],
          state: {
            running: false,
            enabled: false,
          },
        }
      );
    }
  }
}

function installDemoBanner():
  void {
  const id =
    "dccexpress-demo-banner";

  if (
    document.getElementById(id)
  ) {
    return;
  }

  const banner =
    document.createElement(
      "div"
    );

  banner.id = id;
  banner.textContent =
    "DCCExpress Lite · DEMO";

  Object.assign(
    banner.style,
    {
      position: "fixed",
      right: "12px",
      bottom: "12px",
      zIndex: "999999",
      padding:
        "7px 11px",
      borderRadius: "999px",
      background:
        "rgba(15, 23, 42, .92)",
      color: "#67e8f9",
      border:
        "1px solid rgba(103, 232, 249, .45)",
      fontFamily:
        "system-ui, sans-serif",
      fontWeight: "700",
      fontSize: "12px",
      letterSpacing:
        ".04em",
      boxShadow:
        "0 6px 24px rgba(0,0,0,.28)",
      pointerEvents:
        "none",
    }
  );

  document.body.appendChild(
    banner
  );
}

export function
installDemoRuntime():
  void {
  if (!isDemoMode) {
    return;
  }

  const nativeFetch =
    window.fetch.bind(window);

  window.fetch =
    async (
      input:
        RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const request =
        new Request(
          input,
          init
        );

      const demoResponse =
        await handleDemoFetch(
          request
        );

      if (demoResponse) {
        return demoResponse;
      }

      return nativeFetch(
        input,
        init
      );
    };

  window.WebSocket =
    DemoWebSocket as unknown as typeof WebSocket;

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      installDemoBanner,
      {
        once: true,
      }
    );
  } else {
    installDemoBanner();
  }

  console.info(
    "[DCCExpressLite] DEMO mode enabled"
  );
}
