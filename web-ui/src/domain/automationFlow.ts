export const AUTOMATION_FLOW_VERSION = 1 as const;

export type AutomationFlowNodeKind =
  | "trigger"
  | "smartDispatcher"
  | "setSpeed"
  | "waitForBlock"
  | "waitForSensor"
  | "setSensor"
  | "setTurnout"
  | "setAccessory"
  | "horn"
  | "delay"
  | "log";

export type AutomationArrivalRule = {
  id: string;
  block: string;
  sensor: number;
  state: boolean;
};

export type AutomationFlowPage = {
  id: string;
  name: string;
  enabled: boolean;
  viewportX?: number;
  viewportY?: number;
  viewportZoom?: number;
};

export type AutomationFlowNodeData = Record<string, unknown> & {
  kind: AutomationFlowNodeKind;
  label: string;
  pageId: string;

  route?: string[];
  arrivalRules?: AutomationArrivalRule[];

  speed?: number;
  blockName?: string;
  sensorAddress?: number;
  sensorState?: boolean;

  turnoutAddress?: number;
  turnoutClosed?: boolean;

  accessoryAddress?: number;
  accessoryActive?: boolean;

  functionNumber?: number;
  pulseMs?: number;
  delayMs?: number;
  message?: string;

  triggerMode?:
    | "manual"
    | "interval";
  intervalMs?: number;
};

export type AutomationFlowNode = {
  id: string;
  type: "automationNode";
  position: {
    x: number;
    y: number;
  };
  data: AutomationFlowNodeData;
};

export type AutomationFlowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
};

export type AutomationFlowDocument = {
  version: typeof AUTOMATION_FLOW_VERSION;
  pages: AutomationFlowPage[];
  activePageId: string;
  nodes: AutomationFlowNode[];
  edges: AutomationFlowEdge[];
};

const NODE_KINDS =
  new Set<AutomationFlowNodeKind>([
    "trigger",
    "smartDispatcher",
    "setSpeed",
    "waitForBlock",
    "waitForSensor",
    "setSensor",
    "setTurnout",
    "setAccessory",
    "horn",
    "delay",
    "log",
  ]);

export function createAutomationFlowId(
  prefix: string
): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return (
    `${prefix}-${Date.now()}-` +
    Math.random()
      .toString(36)
      .slice(2, 10)
  );
}

export function createAutomationFlowPage(
  name = "Main"
): AutomationFlowPage {
  return {
    id:
      createAutomationFlowId(
        "page"
      ),
    name,
    enabled: true,
  };
}

export function createEmptyAutomationFlowDocument(): AutomationFlowDocument {
  const page =
    createAutomationFlowPage();

  return {
    version:
      AUTOMATION_FLOW_VERSION,
    pages: [
      page,
    ],
    activePageId:
      page.id,
    nodes: [],
    edges: [],
  };
}

function finiteNumber(
  value: unknown,
  fallback: number
): number {
  const numeric =
    Number(value);

  return Number.isFinite(numeric)
    ? numeric
    : fallback;
}

function normalizeRoute(
  value: unknown
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];

  for (const raw of value) {
    const name =
      String(
        raw ?? ""
      ).trim();

    if (
      name &&
      !result.some(
        item =>
          item.toLocaleLowerCase() ===
          name.toLocaleLowerCase()
      )
    ) {
      result.push(
        name
      );
    }
  }

  return result;
}

function normalizeArrivalRules(
  value: unknown
): AutomationArrivalRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result:
    AutomationArrivalRule[] = [];

  const used =
    new Set<string>();

  for (const raw of value) {
    if (
      !raw ||
      typeof raw !== "object"
    ) {
      continue;
    }

    const candidate =
      raw as Record<string, unknown>;

    const block =
      String(
        candidate.block ?? ""
      ).trim();

    const sensor =
      Math.round(
        finiteNumber(
          candidate.sensor,
          0
        )
      );

    if (
      !block ||
      sensor < 1 ||
      sensor > 65535
    ) {
      continue;
    }

    let id =
      String(
        candidate.id ?? ""
      ).trim();

    if (
      !id ||
      used.has(id)
    ) {
      id =
        createAutomationFlowId(
          "arrival"
        );
    }

    used.add(id);

    result.push({
      id,
      block,
      sensor,
      state:
        candidate.state !==
        false,
    });
  }

  return result;
}

function normalizeNodeData(
  raw: unknown,
  fallbackPageId: string
): AutomationFlowNodeData | null {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  const candidate =
    raw as Record<string, unknown>;

  const kind =
    String(
      candidate.kind ?? ""
    ) as AutomationFlowNodeKind;

  if (
    !NODE_KINDS.has(
      kind
    )
  ) {
    return null;
  }

  const label =
    typeof candidate.label === "string" &&
    candidate.label.trim()
      ? candidate.label.trim()
      : kind;

  const pageId =
    typeof candidate.pageId === "string" &&
    candidate.pageId.trim()
      ? candidate.pageId.trim()
      : fallbackPageId;

  return {
    kind,
    label,
    pageId,
    route:
      normalizeRoute(
        candidate.route
      ),
    arrivalRules:
      normalizeArrivalRules(
        candidate.arrivalRules
      ),
    speed:
      Math.max(
        0,
        Math.min(
          126,
          Math.round(
            finiteNumber(
              candidate.speed,
              20
            )
          )
        )
      ),
    blockName:
      typeof candidate.blockName === "string"
        ? candidate.blockName.trim()
        : "",
    sensorAddress:
      Math.max(
        0,
        Math.min(
          65535,
          Math.round(
            finiteNumber(
              candidate.sensorAddress,
              0
            )
          )
        )
      ),
    sensorState:
      candidate.sensorState !==
      false,
    turnoutAddress:
      Math.max(
        0,
        Math.min(
          2048,
          Math.round(
            finiteNumber(
              candidate.turnoutAddress,
              1
            )
          )
        )
      ),
    turnoutClosed:
      candidate.turnoutClosed !==
      false,
    accessoryAddress:
      Math.max(
        0,
        Math.min(
          2048,
          Math.round(
            finiteNumber(
              candidate.accessoryAddress,
              1
            )
          )
        )
      ),
    accessoryActive:
      candidate.accessoryActive !==
      false,
    functionNumber:
      Math.max(
        0,
        Math.min(
          68,
          Math.round(
            finiteNumber(
              candidate.functionNumber,
              2
            )
          )
        )
      ),
    pulseMs:
      Math.max(
        1,
        Math.min(
          600000,
          Math.round(
            finiteNumber(
              candidate.pulseMs,
              700
            )
          )
        )
      ),
    delayMs:
      Math.max(
        0,
        Math.min(
          600000,
          Math.round(
            finiteNumber(
              candidate.delayMs,
              500
            )
          )
        )
      ),
    message:
      typeof candidate.message === "string"
        ? candidate.message
        : "",
    triggerMode:
      candidate.triggerMode ===
        "interval"
        ? "interval"
        : "manual",
    intervalMs:
      Math.max(
        1000,
        Math.min(
          86400000,
          Math.round(
            finiteNumber(
              candidate.intervalMs,
              60000
            )
          )
        )
      ),
  };
}

export function normalizeAutomationFlowDocument(
  raw: unknown
): AutomationFlowDocument {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return createEmptyAutomationFlowDocument();
  }

  const candidate =
    raw as Record<string, unknown>;

  const pages: AutomationFlowPage[] = [];
  const usedPageIds =
    new Set<string>();

  for (
    const rawPage of
    Array.isArray(
      candidate.pages
    )
      ? candidate.pages
      : []
  ) {
    if (
      !rawPage ||
      typeof rawPage !== "object"
    ) {
      continue;
    }

    const page =
      rawPage as Record<string, unknown>;

    let id =
      String(
        page.id ?? ""
      ).trim();

    if (
      !id ||
      usedPageIds.has(id)
    ) {
      id =
        createAutomationFlowId(
          "page"
        );
    }

    usedPageIds.add(id);

    const name =
      typeof page.name === "string" &&
      page.name.trim()
        ? page.name.trim()
        : `Page ${pages.length + 1}`;

    pages.push({
      id,
      name,
      enabled:
        page.enabled !==
        false,
      ...(
        Number.isFinite(
          Number(
            page.viewportX
          )
        )
          ? {
              viewportX:
                Number(
                  page.viewportX
                ),
            }
          : {}
      ),
      ...(
        Number.isFinite(
          Number(
            page.viewportY
          )
        )
          ? {
              viewportY:
                Number(
                  page.viewportY
                ),
            }
          : {}
      ),
      ...(
        Number.isFinite(
          Number(
            page.viewportZoom
          )
        )
          ? {
              viewportZoom:
                Number(
                  page.viewportZoom
                ),
            }
          : {}
      ),
    });
  }

  if (
    pages.length === 0
  ) {
    pages.push(
      createAutomationFlowPage()
    );
  }

  const pageIds =
    new Set(
      pages.map(
        page =>
          page.id
      )
    );

  const defaultPageId =
    pages[0]!.id;

  const nodes:
    AutomationFlowNode[] = [];

  const nodeIds =
    new Set<string>();

  for (
    const rawNode of
    Array.isArray(
      candidate.nodes
    )
      ? candidate.nodes
      : []
  ) {
    if (
      !rawNode ||
      typeof rawNode !== "object"
    ) {
      continue;
    }

    const node =
      rawNode as Record<string, unknown>;

    let id =
      String(
        node.id ?? ""
      ).trim();

    if (
      !id ||
      nodeIds.has(id)
    ) {
      id =
        createAutomationFlowId(
          "node"
        );
    }

    const data =
      normalizeNodeData(
        node.data,
        defaultPageId
      );

    if (!data) {
      continue;
    }

    if (
      !pageIds.has(
        data.pageId
      )
    ) {
      data.pageId =
        defaultPageId;
    }

    const position =
      node.position &&
      typeof node.position === "object"
        ? node.position as Record<string, unknown>
        : {};

    nodeIds.add(id);

    nodes.push({
      id,
      type:
        "automationNode",
      position: {
        x:
          finiteNumber(
            position.x,
            0
          ),
        y:
          finiteNumber(
            position.y,
            0
          ),
      },
      data,
    });
  }

  const nodeById =
    new Map(
      nodes.map(
        node =>
          [
            node.id,
            node,
          ] as const
      )
    );

  const edges:
    AutomationFlowEdge[] = [];

  const edgeIds =
    new Set<string>();

  for (
    const rawEdge of
    Array.isArray(
      candidate.edges
    )
      ? candidate.edges
      : []
  ) {
    if (
      !rawEdge ||
      typeof rawEdge !== "object"
    ) {
      continue;
    }

    const edge =
      rawEdge as Record<string, unknown>;

    const source =
      String(
        edge.source ?? ""
      ).trim();

    const target =
      String(
        edge.target ?? ""
      ).trim();

    const sourceNode =
      nodeById.get(
        source
      );

    const targetNode =
      nodeById.get(
        target
      );

    if (
      !sourceNode ||
      !targetNode ||
      sourceNode.data.pageId !==
        targetNode.data.pageId
    ) {
      continue;
    }

    let id =
      String(
        edge.id ?? ""
      ).trim();

    if (
      !id ||
      edgeIds.has(id)
    ) {
      id =
        createAutomationFlowId(
          "edge"
        );
    }

    edgeIds.add(id);

    edges.push({
      id,
      source,
      target,
      ...(
        typeof edge.sourceHandle ===
        "string"
          ? {
              sourceHandle:
                edge.sourceHandle,
            }
          : {}
      ),
      ...(
        typeof edge.targetHandle ===
        "string"
          ? {
              targetHandle:
                edge.targetHandle,
            }
          : {}
      ),
      type:
        typeof edge.type ===
        "string"
          ? edge.type
          : "smoothstep",
    });
  }

  const requestedActive =
    typeof candidate.activePageId ===
    "string"
      ? candidate.activePageId
      : "";

  return {
    version:
      AUTOMATION_FLOW_VERSION,
    pages,
    activePageId:
      pageIds.has(
        requestedActive
      )
        ? requestedActive
        : defaultPageId,
    nodes,
    edges,
  };
}

function jsString(
  value: string
): string {
  return JSON.stringify(
    value
  );
}

function indent(
  source: string,
  spaces = 2
): string {
  const prefix =
    " ".repeat(
      spaces
    );

  return source
    .split("\n")
    .map(
      line =>
        line
          ? prefix + line
          : line
    )
    .join("\n");
}

function generateStatement(
  data: AutomationFlowNodeData
): string {
  switch (data.kind) {
    case "setSpeed":
      return `run.setSpeed(${Math.max(0, Math.min(126, Math.round(data.speed ?? 20)))});`;

    case "waitForBlock":
      return `await run.waitForBlock(${jsString(data.blockName || "")});`;

    case "waitForSensor":
      return `await dcc.waitForSensor(${Math.max(0, Math.round(data.sensorAddress ?? 0))}, ${data.sensorState !== false ? "true" : "false"});`;

    case "setSensor":
      return `dcc.setSensor(${Math.max(1, Math.min(65535, Math.round(data.sensorAddress ?? 1)))}, ${data.sensorState !== false ? "true" : "false"});`;

    case "setTurnout":
      return `dcc.setTurnout(${Math.max(1, Math.min(2048, Math.round(data.turnoutAddress ?? 1)))}, ${data.turnoutClosed !== false ? "true" : "false"});`;

    case "setAccessory":
      return `dcc.setAccessory(${Math.max(1, Math.min(2048, Math.round(data.accessoryAddress ?? 1)))}, ${data.accessoryActive !== false ? "true" : "false"});`;

    case "horn": {
      const fn =
        Math.max(
          0,
          Math.min(
            68,
            Math.round(
              data.functionNumber ??
              2
            )
          )
        );

      const pulse =
        Math.max(
          1,
          Math.round(
            data.pulseMs ??
            700
          )
        );

      return [
        `dcc.setLocoFunction(loco, ${fn}, true);`,
        `await delay(${pulse});`,
        `dcc.setLocoFunction(loco, ${fn}, false);`,
      ].join("\n");
    }

    case "delay":
      return `await delay(${Math.max(0, Math.round(data.delayMs ?? 500))});`;

    case "log":
      return `log(${jsString(data.message || "")});`;

    default:
      return "";
  }
}

export type GeneratedAutomationFlowScript = {
  code: string;
  warnings: string[];
};

export type GenerateAutomationFlowPageScriptOptions = {
  testRun?: boolean;
};

function wrapWithTrigger(
  code: string,
  trigger:
    AutomationFlowNode |
    undefined,
  pageId: string,
  testRun: boolean
): string {
  if (
    !trigger ||
    trigger.data.triggerMode !==
      "interval" ||
    testRun
  ) {
    return code;
  }

  const intervalMs =
    Math.max(
      1000,
      Math.min(
        86400000,
        Math.round(
          trigger.data.intervalMs ??
          60000
        )
      )
    );

  const taskName =
    "FLOW_" +
    pageId.replace(
      /[^a-zA-Z0-9_-]/g,
      "_"
    );

  return [
    "while (isRunning()) {",
    `  startTask(${jsString(taskName)}, async () => {`,
    indent(
      code,
      4
    ),
    "  });",
    "",
    `  await delay(${intervalMs});`,
    "}",
  ].join("\n");
}

export function generateAutomationFlowPageScript(
  document: AutomationFlowDocument,
  pageId: string,
  options:
    GenerateAutomationFlowPageScriptOptions = {}
): GeneratedAutomationFlowScript {
  const warnings:
    string[] = [];

  const pageNodes =
    document.nodes.filter(
      node =>
        node.data.pageId ===
        pageId
    );

  const nodeById =
    new Map(
      pageNodes.map(
        node =>
          [
            node.id,
            node,
          ] as const
      )
    );

  const pageEdges =
    document.edges.filter(
      edge =>
        nodeById.has(
          edge.source
        ) &&
        nodeById.has(
          edge.target
        )
    );

  const incoming =
    new Map<
      string,
      AutomationFlowEdge[]
    >();

  const outgoing =
    new Map<
      string,
      AutomationFlowEdge[]
    >();

  for (const edge of pageEdges) {
    incoming.set(
      edge.target,
      [
        ...(
          incoming.get(
            edge.target
          ) ??
          []
        ),
        edge,
      ]
    );

    outgoing.set(
      edge.source,
      [
        ...(
          outgoing.get(
            edge.source
          ) ??
          []
        ),
        edge,
      ]
    );
  }

  const triggerNodes =
    pageNodes.filter(
      node =>
        node.data.kind ===
        "trigger"
    );

  if (
    triggerNodes.length > 1
  ) {
    warnings.push(
      "Only the first Trigger node is used."
    );
  }

  const trigger =
    triggerNodes[0];

  const triggerNextId =
    trigger
      ? (
          outgoing.get(
            trigger.id
          ) ??
          []
        )[0]?.target
      : undefined;

  const smartNodes =
    pageNodes.filter(
      node =>
        node.data.kind ===
        "smartDispatcher"
    );

  if (
    smartNodes.length === 0
  ) {
    if (
      pageNodes.length === 0
    ) {
      return {
        code:
          "// Add nodes to generate a runnable script.",
        warnings: [
          "This page has no nodes.",
        ],
      };
    }

    const roots =
      pageNodes.filter(
        node =>
          node.data.kind !==
            "trigger" &&
          (
            incoming.get(
              node.id
            ) ??
            []
          ).filter(
            edge =>
              nodeById.get(
                edge.source
              )?.data.kind !==
                "trigger"
          ).length ===
          0
      );

    if (
      triggerNextId
    ) {
      const triggeredRoot =
        nodeById.get(
          triggerNextId
        );

      if (
        triggeredRoot &&
        triggeredRoot.data.kind !==
          "smartDispatcher"
      ) {
        roots.splice(
          0,
          roots.length,
          triggeredRoot
        );
      }
    }

    if (
      roots.length === 0
    ) {
      return {
        code:
          "// The flow has no start node.",
        warnings: [
          "No start node found. Break the cycle or remove an incoming connection.",
        ],
      };
    }

    if (
      roots.length > 1
    ) {
      warnings.push(
        "Multiple start nodes found. The current linear generator follows only the first one."
      );
    }

    const statements:
      string[] = [];

    const visited =
      new Set<string>();

    let current:
      AutomationFlowNode |
      undefined =
      roots[0];

    while (current) {
      if (
        visited.has(
          current.id
        )
      ) {
        warnings.push(
          "A cycle was detected. Generation stopped before the loop."
        );
        break;
      }

      visited.add(
        current.id
      );

      if (
        current.data.kind ===
          "setSpeed" ||
        current.data.kind ===
          "waitForBlock" ||
        current.data.kind ===
          "horn"
      ) {
        warnings.push(
          `Node "${current.data.label}" requires SmartDispatcher context and was skipped.`
        );
      } else {
        const statement =
          generateStatement(
            current.data
          );

        if (statement) {
          statements.push(
            statement
          );
        }
      }

      const nextEdges =
        outgoing.get(
          current.id
        ) ??
        [];

      if (
        nextEdges.length ===
        0
      ) {
        break;
      }

      if (
        nextEdges.length >
        1
      ) {
        warnings.push(
          `Node ${current.id} has multiple outputs. The current linear generator follows only the first one.`
        );
      }

      current =
        nodeById.get(
          nextEdges[0]!.target
        );
    }

    const code =
      statements.length >
      0
        ? statements.join(
            "\n\n"
          )
        : "// No runnable statements on this page.";

    return {
      code:
        wrapWithTrigger(
          code,
          trigger,
          pageId,
          options.testRun ===
            true
        ),
      warnings,
    };
  }

  if (
    smartNodes.length > 1
  ) {
    warnings.push(
      "Only the first SmartDispatcher node is used by the current linear generator."
    );
  }

  const root =
    (
      triggerNextId
        ? smartNodes.find(
            node =>
              node.id ===
              triggerNextId
          )
        : undefined
    ) ??
    smartNodes[0]!;

  const route =
    normalizeRoute(
      root.data.route
    );

  if (
    route.length < 2
  ) {
    warnings.push(
      "SmartDispatcher route needs at least two block names."
    );
  }

  const rules =
    normalizeArrivalRules(
      root.data.arrivalRules
    );

  const rulesByBlock =
    new Map<
      string,
      AutomationArrivalRule[]
    >();

  for (const rule of rules) {
    const key =
      rule.block.toLocaleLowerCase();

    rulesByBlock.set(
      key,
      [
        ...(
          rulesByBlock.get(
            key
          ) ??
          []
        ),
        rule,
      ]
    );
  }

  const routeSource =
    route.map(
      block => {
        const blockRules =
          rulesByBlock.get(
            block.toLocaleLowerCase()
          ) ??
          [];

        if (
          blockRules.length === 0
        ) {
          return (
            "    " +
            jsString(
              block
            )
          );
        }

        return [
          "    {",
          `      block: ${jsString(block)},`,
          "      arrivedWhen: [",
          ...blockRules.map(
            rule =>
              `        { sensor: ${rule.sensor}, state: ${rule.state ? "true" : "false"} },`
          ),
          "      ]",
          "    }",
        ].join("\n");
      }
    )
    .join(",\n");

  const statements:
    string[] = [];

  const visited =
    new Set<string>([
      root.id,
    ]);

  let currentId =
    root.id;

  while (true) {
    const nextEdges =
      outgoing.get(
        currentId
      ) ??
      [];

    if (
      nextEdges.length === 0
    ) {
      break;
    }

    if (
      nextEdges.length > 1
    ) {
      warnings.push(
        `Node ${currentId} has multiple outputs. The current generator follows only the first one.`
      );
    }

    const next =
      nodeById.get(
        nextEdges[0]!.target
      );

    if (!next) {
      break;
    }

    if (
      visited.has(
        next.id
      )
    ) {
      warnings.push(
        "A cycle was detected. Generation stopped before the loop."
      );
      break;
    }

    visited.add(
      next.id
    );

    if (
      next.data.kind ===
      "smartDispatcher"
    ) {
      warnings.push(
        "Nested SmartDispatcher nodes are not generated yet."
      );
      break;
    }

    const statement =
      generateStatement(
        next.data
      );

    if (statement) {
      statements.push(
        statement
      );
    }

    currentId =
      next.id;
  }

  const body =
    statements.length > 0
      ? statements
          .map(
            statement =>
              indent(
                statement,
                4
              )
          )
          .join("\n\n")
      : "    // Connect movement/action nodes here.";

  const code =
    [
      "await smartDispatcher(",
      "  [",
      routeSource ||
        '    "FROM",\n    "TO"',
      "  ],",
      "  async (loco, dir, run) => {",
      body,
      "  }",
      ");",
    ].join("\n");

  return {
    code:
      wrapWithTrigger(
        code,
        trigger,
        pageId,
        options.testRun ===
          true
      ),
    warnings,
  };
}
