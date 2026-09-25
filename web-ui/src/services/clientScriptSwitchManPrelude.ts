export function buildClientScriptSwitchManPrelude(
  ownerBaseId: string,
  ownerName: string
): string {
  const encodedOwnerBaseId =
    JSON.stringify(ownerBaseId);

  const encodedOwnerName =
    JSON.stringify(ownerName);

  return `
const __dccSwitchManOwnerBaseId = ${encodedOwnerBaseId};
const __dccSwitchManOwnerName = ${encodedOwnerName};
let __dccSwitchManSocket = null;
let __dccSwitchManOpenPromise = null;
let __dccSwitchManRequestSequence = 0;
let __dccSwitchManScopeSequence = 0;
let __dccSwitchManActiveScopeCount = 0;
const __dccSwitchManPending = new Map();

const __dccSwitchManWsUrl = (() => {
  const protocol = self.location.protocol === "https:" ? "wss:" : "ws:";
  return protocol + "//" + self.location.host + "/ws";
})();

const __dccSwitchManNormalizeAddresses = value => {
  const source = Array.isArray(value) ? value : [value];
  const result = [];
  const seen = new Set();

  for (const raw of source) {
    const address = Number(raw);

    if (
      !Number.isInteger(address) ||
      address < 1 ||
      address > 2048
    ) {
      throw new Error(
        "switchMan: turnout address must be an integer between 1 and 2048."
      );
    }

    if (!seen.has(address)) {
      seen.add(address);
      result.push(address);
    }
  }

  result.sort((a, b) => a - b);

  if (result.length === 0) {
    throw new Error(
      "switchMan: at least one turnout address is required."
    );
  }

  return result;
};

const __dccSwitchManNormalizeOptions = value => {
  if (value === null || value === undefined) {
    return {
      timeoutMs: null,
      onBlocked: null,
    };
  }

  // Backward-compatible form:
  // switchMan(addresses, callback, 30000)
  if (typeof value !== "object" || Array.isArray(value)) {
    return {
      timeoutMs: Math.max(
        0,
        Math.min(600000, Number(value) || 0)
      ),
      onBlocked: null,
    };
  }

  const rawTimeout = value.timeoutMs;
  const timeoutMs =
    rawTimeout === null || rawTimeout === undefined
      ? null
      : Math.max(
          0,
          Math.min(600000, Number(rawTimeout) || 0)
        );

  const onBlocked =
    value.onBlocked === null || value.onBlocked === undefined
      ? null
      : value.onBlocked;

  if (onBlocked !== null && typeof onBlocked !== "function") {
    throw new Error(
      "switchMan: options.onBlocked must be a function."
    );
  }

  return {
    timeoutMs,
    onBlocked,
  };
};

const __dccSwitchManNormalizeSetDelay = value => {
  if (value === null || value === undefined) {
    return 0;
  }

  const delayMs = Number(value);

  if (
    !Number.isFinite(delayMs) ||
    delayMs < 0 ||
    delayMs > 600000
  ) {
    throw new Error(
      "sw.setTurnout: delayMs must be a number between 0 and 600000."
    );
  }

  return delayMs;
};

const __dccSwitchManSafeConflicts = conflicts =>
  Object.freeze(
    conflicts.map(item =>
      Object.freeze({
        address: Number(item && item.address) || 0,
        ownerId: String(item && item.ownerId || ""),
        ownerName: String(item && item.ownerName || ""),
        acquiredAtMs: Number(item && item.acquiredAtMs) || 0,
      })
    )
  );

const __dccSwitchManRejectPending = error => {
  for (const pending of __dccSwitchManPending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  __dccSwitchManPending.clear();
};

const __dccSwitchManEnsureSocket = async () => {
  if (
    __dccSwitchManSocket &&
    __dccSwitchManSocket.readyState === WebSocket.OPEN
  ) {
    return __dccSwitchManSocket;
  }

  if (__dccSwitchManOpenPromise) {
    return __dccSwitchManOpenPromise;
  }

  __dccSwitchManOpenPromise = new Promise((resolve, reject) => {
    const socket = new WebSocket(__dccSwitchManWsUrl);
    __dccSwitchManSocket = socket;

    let settled = false;

    const failOpen = message => {
      if (settled) {
        return;
      }

      settled = true;

      if (__dccSwitchManSocket === socket) {
        __dccSwitchManSocket = null;
      }

      __dccSwitchManOpenPromise = null;
      reject(new Error(message));
    };

    socket.onopen = () => {
      if (settled) {
        return;
      }

      settled = true;
      __dccSwitchManOpenPromise = null;
      resolve(socket);
    };

    socket.onmessage = event => {
      let message;

      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (
        !message ||
        message.type !== "switchManResponse"
      ) {
        return;
      }

      const data = message.data || {};
      const requestId = String(data.requestId || "");
      const pending = __dccSwitchManPending.get(requestId);

      if (!pending) {
        return;
      }

      __dccSwitchManPending.delete(requestId);
      clearTimeout(pending.timer);

      if (data.ok) {
        pending.resolve(data);
        return;
      }

      const conflicts =
        data.extra && Array.isArray(data.extra.conflicts)
          ? data.extra.conflicts
          : [];

      const detail =
        conflicts.length > 0
          ? " (foglalt: " +
            conflicts
              .map(item =>
                String(item.address) +
                ": " +
                String(item.ownerName || item.ownerId || "ismeretlen")
              )
              .join(", ") +
            ")"
          : "";

      const error = new Error(
        String(data.message || "switchman_failed") + detail
      );

      error.code = String(data.message || "switchman_failed");
      error.details = data.extra || null;
      pending.reject(error);
    };

    socket.onerror = () => {
      if (socket.readyState !== WebSocket.OPEN) {
        failOpen("SwitchMan WebSocket connection failed.");
      }
    };

    socket.onclose = () => {
      if (__dccSwitchManSocket === socket) {
        __dccSwitchManSocket = null;
      }

      __dccSwitchManOpenPromise = null;

      __dccSwitchManRejectPending(
        new Error("SwitchMan WebSocket connection closed.")
      );
    };
  });

  return __dccSwitchManOpenPromise;
};

const __dccSwitchManRequest = async (
  action,
  ownerId,
  payload = {},
  timeoutMs = 10000
) => {
  const socket = await __dccSwitchManEnsureSocket();

  const requestId =
    __dccSwitchManOwnerBaseId +
    ":switchman-request:" +
    (++__dccSwitchManRequestSequence);

  const safeTimeout = Math.max(
    1000,
    Math.min(30000, Number(timeoutMs) || 10000)
  );

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      __dccSwitchManPending.delete(requestId);
      reject(
        new Error(
          "SwitchMan request timed out: " + action
        )
      );
    }, safeTimeout);

    __dccSwitchManPending.set(requestId, {
      resolve,
      reject,
      timer,
    });

    try {
      socket.send(JSON.stringify({
        type: "switchManCommand",
        data: {
          requestId,
          action,
          ownerId,
          ownerName: __dccSwitchManOwnerName,
          ...payload,
        },
      }));
    } catch (error) {
      clearTimeout(timer);
      __dccSwitchManPending.delete(requestId);
      reject(
        error instanceof Error
          ? error
          : new Error(String(error))
      );
    }
  });
};

const switchMan = async (
  addresses,
  callback,
  optionsOrTimeout = null
) => {
  if (typeof callback !== "function") {
    throw new Error(
      "switchMan(addresses, callback, optionsOrTimeout?): callback must be a function."
    );
  }

  const normalized =
    __dccSwitchManNormalizeAddresses(addresses);

  const options =
    __dccSwitchManNormalizeOptions(optionsOrTimeout);

  const timeout = options.timeoutMs;
  const onBlocked = options.onBlocked;

  const deadline =
    timeout === null
      ? null
      : Date.now() + timeout;

  const ownerId =
    __dccSwitchManOwnerBaseId +
    ":scope:" +
    (++__dccSwitchManScopeSequence);

  let acquired = false;
  let onBlockedCalled = false;

  setInfo(
    "Váltókörzetre vár: " + normalized.join(", ")
  );

  while (!acquired) {
    await delay(0);

    try {
      await __dccSwitchManRequest(
        "acquire",
        ownerId,
        {
          addresses: normalized,
          timeoutMs: 0,
        }
      );

      acquired = true;
    } catch (error) {
      if (
        !error ||
        error.code !== "turnout_locked"
      ) {
        throw error;
      }

      const conflicts =
        error.details && Array.isArray(error.details.conflicts)
          ? error.details.conflicts
          : [];

      const selfConflict = conflicts.find(item =>
        String(item.ownerId || "").startsWith(
          __dccSwitchManOwnerBaseId + ":scope:"
        )
      );

      if (selfConflict) {
        throw new Error(
          "switchMan: overlapping turnout sections inside the same script are not allowed (turnout " +
          String(selfConflict.address) +
          ")."
        );
      }

      if (conflicts.length > 0) {
        setInfo(
          "Váltókörzetre vár: " +
          conflicts
            .map(item =>
              String(item.address) +
              " (" +
              String(item.ownerName || item.ownerId || "foglalt") +
              ")"
            )
            .join(", ")
        );
      }

      if (!onBlockedCalled && onBlocked) {
        onBlockedCalled = true;

        await onBlocked(
          __dccSwitchManSafeConflicts(conflicts)
        );
      }

      if (
        timeout !== null &&
        (
          timeout === 0 ||
          (deadline !== null && Date.now() >= deadline)
        )
      ) {
        const timeoutError = new Error(
          "switchMan timeout: " + normalized.join(", ")
        );

        timeoutError.code = "switchman_timeout";
        throw timeoutError;
      }

      const remaining =
        deadline === null
          ? 250
          : Math.max(
              1,
              deadline - Date.now()
            );

      await delay(
        Math.min(250, remaining)
      );
    }
  }

  setInfo(
    "Váltókörzet szabad: " + normalized.join(", ")
  );

  const owned = new Set(normalized);

  const sw = Object.freeze({
    addresses: Object.freeze([...normalized]),

    async setTurnout(address, closed, delayMs = 0) {
      const normalizedAddress =
        __dccSwitchManNormalizeAddresses(address)[0];

      if (!owned.has(normalizedAddress)) {
        throw new Error(
          "SwitchMan scope does not own turnout " + normalizedAddress + "."
        );
      }

      const waitAfterMs =
        __dccSwitchManNormalizeSetDelay(delayMs);

      await delay(0);

      const response = await __dccSwitchManRequest(
        "set",
        ownerId,
        {
          address: normalizedAddress,
          closed: Boolean(closed),
        },
        15000
      );

      await delay(waitAfterMs);

      return response.extra || {
        address: normalizedAddress,
        closed: Boolean(closed),
      };
    },
  });

  let callbackError = null;
  let releaseError = null;

  __dccSwitchManActiveScopeCount += 1;

  try {
    return await callback(sw);
  } catch (error) {
    callbackError = error;
    throw error;
  } finally {
    if (acquired) {
      try {
        await __dccSwitchManRequest(
          "release",
          ownerId,
          { addresses: normalized },
          10000
        );
      } catch (error) {
        releaseError = error;
        console.error(
          "[SwitchMan] turnout release failed",
          error
        );
      }
    }

    __dccSwitchManActiveScopeCount = Math.max(
      0,
      __dccSwitchManActiveScopeCount - 1
    );

    if (releaseError && !callbackError) {
      throw releaseError;
    }
  }
};

// -----------------------------------------------------------------------------
// Dispatcher – route-aware train movement reservation.
// -----------------------------------------------------------------------------
//
// Canonical form:
//
// await dispatcher(["A1", "B2", "D4"], async (loco, dir) => {
//   dcc.setLoco(loco, 10, dir);
//   await dcc.waitForSensor(1001, true);
//   dcc.setLoco(loco, 0, dir);
// }, {
//   onEmpty: async dir => {
//     log("A1 üres", dir);
//   },
//   onBlocked: async (loco, dir, conflicts) => {
//     dcc.setLoco(loco, 0, dir);
//   },
// });
//
// Rules:
// - block order is significant;
// - source block must contain the requested locomotive;
// - every block after the source must be FREE:
//     actual loco == 0
//     target loco == 0
//     configured occupancy sensor == OFF
// - every downstream block is marked as target for the locomotive BEFORE
//   movement begins;
// - turnout locks remain SwitchMan-authoritative;
// - successful callback COMMIT:
//     all previous blocks -> clear actual + target
//     destination -> actual loco
// - callback exception / abort ROLLBACK:
//     only dispatcher-owned target markers are cleared;
//     actual block ownership is not falsified.
//
// Browser-side Web Locks serialize overlapping Dispatcher block reservations
// across scripts/tabs belonging to the same origin. Backend SwitchMan remains
// authoritative for physical turnout locks.

let __dccDispatcherLayoutPromise = null;
const __dccDispatcherActiveBlockIds = new Set();

const __dccDispatcherNormalizeBlocks = value => {
  if (
    !Array.isArray(value) ||
    value.length < 2
  ) {
    throw new Error(
      "dispatcher(blocks, callback, options?): blocks must contain at least FROM and TO block names."
    );
  }

  const blocks =
    value.map(
      item =>
        String(
          item ?? ""
        ).trim()
    );

  if (
    blocks.some(
      name =>
        !name
    )
  ) {
    throw new Error(
      "dispatcher: block names must not be empty."
    );
  }

  if (
    blocks[0] ===
      blocks[blocks.length - 1]
  ) {
    throw new Error(
      "dispatcher: source and destination block must be different."
    );
  }

  const folded =
    blocks.map(
      name =>
        name.toLocaleLowerCase()
    );

  if (
    new Set(folded).size !==
      folded.length
  ) {
    throw new Error(
      "dispatcher: the same checkpoint block may not be listed more than once."
    );
  }

  return Object.freeze(
    blocks
  );
};

const __dccDispatcherNormalizeOptions = value => {
  if (
    value === null ||
    value === undefined
  ) {
    return {
      timeoutMs: null,
      onBlocked: null,
      onEmpty: null,
      setDelayMs: 250,
      blockPollMs: 250,
    };
  }

  if (
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "dispatcher: options must be an object."
    );
  }

  const rawTimeout =
    value.timeoutMs;

  const timeoutMs =
    rawTimeout === null ||
    rawTimeout === undefined
      ? null
      : Math.max(
          0,
          Math.min(
            600000,
            Number(rawTimeout) || 0
          )
        );

  const onBlocked =
    value.onBlocked === null ||
    value.onBlocked === undefined
      ? null
      : value.onBlocked;

  if (
    onBlocked !== null &&
    typeof onBlocked !== "function"
  ) {
    throw new Error(
      "dispatcher: options.onBlocked must be a function."
    );
  }

  const onEmpty =
    value.onEmpty === null ||
    value.onEmpty === undefined
      ? null
      : value.onEmpty;

  if (
    onEmpty !== null &&
    typeof onEmpty !== "function"
  ) {
    throw new Error(
      "dispatcher: options.onEmpty must be a function."
    );
  }

  const setDelayMs =
    value.setDelayMs === null ||
    value.setDelayMs === undefined
      ? 250
      : Number(value.setDelayMs);

  if (
    !Number.isFinite(setDelayMs) ||
    setDelayMs < 0 ||
    setDelayMs > 600000
  ) {
    throw new Error(
      "dispatcher: options.setDelayMs must be a number between 0 and 600000."
    );
  }

  const blockPollMs =
    value.blockPollMs === null ||
    value.blockPollMs === undefined
      ? 250
      : Number(value.blockPollMs);

  if (
    !Number.isFinite(blockPollMs) ||
    blockPollMs < 25 ||
    blockPollMs > 5000
  ) {
    throw new Error(
      "dispatcher: options.blockPollMs must be a number between 25 and 5000."
    );
  }

  return {
    timeoutMs,
    onBlocked,
    onEmpty,
    setDelayMs,
    blockPollMs,
  };
};

const __dccDispatcherAsPositiveInt = (
  value,
  min,
  max
) => {
  const numeric =
    Number(value);

  return (
    Number.isInteger(numeric) &&
    numeric >= min &&
    numeric <= max
  )
    ? numeric
    : null;
};

const __dccDispatcherLoadLayout = async () => {
  if (__dccDispatcherLayoutPromise) {
    return __dccDispatcherLayoutPromise;
  }

  __dccDispatcherLayoutPromise =
    (async () => {
      const response =
        await fetch(
          "/api/layout",
          {
            cache: "no-store",
          }
        );

      if (!response.ok) {
        throw new Error(
          "dispatcher: layout could not be loaded (HTTP " +
          String(response.status) +
          ")."
        );
      }

      const layout =
        await response.json();

      const topology =
        layout &&
        typeof layout === "object"
          ? layout.routeTopology
          : null;

      if (
        !topology ||
        typeof topology !== "object"
      ) {
        throw new Error(
          "dispatcher: no saved routeTopology. Generate/save the route graph first."
        );
      }

      if (
        Number(topology.version) !== 1
      ) {
        throw new Error(
          "dispatcher: unsupported routeTopology version."
        );
      }

      const topologyRevision =
        Number(topology.topologyRevision);

      const graphRevision =
        Number(topology.graphRevision);

      if (
        !Number.isInteger(topologyRevision) ||
        !Number.isInteger(graphRevision) ||
        topologyRevision < 0 ||
        graphRevision < 0 ||
        topologyRevision !== graphRevision
      ) {
        throw new Error(
          "dispatcher: saved routeTopology is stale. Regenerate/save the layout."
        );
      }

      if (!Array.isArray(topology.routeTable)) {
        throw new Error(
          "dispatcher: saved routeTopology has no route table."
        );
      }

      const blocksById =
        new Map();

      const blocksByName =
        new Map();

      for (
        const layer of
        Array.isArray(layout.layers)
          ? layout.layers
          : []
      ) {
        for (
          const element of
          Array.isArray(layer && layer.elements)
            ? layer.elements
            : []
        ) {
          if (
            !element ||
            element.type !== "trackblock"
          ) {
            continue;
          }

          const id =
            __dccDispatcherAsPositiveInt(
              element.id,
              1,
              65535
            );

          const name =
            String(
              element.name ?? ""
            ).trim();

          const sensorAddress =
            __dccDispatcherAsPositiveInt(
              element.sensorAddress,
              1,
              65535
            );

          if (
            id === null ||
            !name
          ) {
            continue;
          }

          const config =
            Object.freeze({
              id,
              name,
              sensorAddress:
                sensorAddress ?? 0,
            });

          blocksById.set(
            id,
            config
          );

          const existing =
            blocksByName.get(name);

          if (existing === undefined) {
            blocksByName.set(
              name,
              config
            );
          } else {
            // Exact duplicate names are unsafe for Dispatcher lookup.
            blocksByName.set(
              name,
              null
            );
          }
        }
      }

      return Object.freeze({
        routeTable:
          topology.routeTable,
        blocksById,
        blocksByName,
      });
    })();

  try {
    return await __dccDispatcherLayoutPromise;
  } catch (error) {
    // Save/generation can fix a stale layout. Allow the next dispatcher call
    // to retry instead of caching a permanent failure.
    __dccDispatcherLayoutPromise = null;
    throw error;
  }
};

const __dccDispatcherRouteMatchesCheckpoints = (
  route,
  requestedBlocks,
  ignoreCase = false
) => {
  if (
    !Array.isArray(
      route && route.blockPath
    ) ||
    route.blockPath.length < 2
  ) {
    return false;
  }

  const normalize =
    value => {
      const text =
        String(
          value ?? ""
        );

      return ignoreCase
        ? text.toLocaleLowerCase()
        : text;
    };

  const pathNames =
    route.blockPath.map(
      block =>
        normalize(
          block && block.name
        )
    );

  const requested =
    requestedBlocks.map(
      normalize
    );

  if (
    pathNames[0] !==
      requested[0] ||
    pathNames[pathNames.length - 1] !==
      requested[requested.length - 1]
  ) {
    return false;
  }

  /*
   * Ordered subsequence matching:
   * requested A1 -> B2 -> D4 matches full path A1 -> B2 -> C3 -> D4.
   * It does NOT match A1 -> C3 -> B2 -> D4.
   */
  let pathIndex =
    0;

  for (const checkpoint of requested) {
    let found =
      false;

    while (
      pathIndex <
        pathNames.length
    ) {
      if (
        pathNames[pathIndex] ===
          checkpoint
      ) {
        found =
          true;

        pathIndex +=
          1;

        break;
      }

      pathIndex +=
        1;
    }

    if (!found) {
      return false;
    }
  }

  return true;
};

const __dccDispatcherFindRoute = async (
  requestedBlocks
) => {
  const loaded =
    await __dccDispatcherLoadLayout();

  const routes =
    loaded.routeTable;

  if (
    !Array.isArray(routes)
  ) {
    throw new Error(
      "dispatcher: saved routeTopology has no route table."
    );
  }

  if (
    routes.some(
      route =>
        !Array.isArray(
          route && route.blockPath
        )
    )
  ) {
    throw new Error(
      "dispatcher: saved routeTopology is missing blockPath data. Save the layout again with the current route generator."
    );
  }

  let matches =
    routes.filter(
      route =>
        __dccDispatcherRouteMatchesCheckpoints(
          route,
          requestedBlocks,
          false
        )
    );

  if (matches.length === 0) {
    matches =
      routes.filter(
        route =>
          __dccDispatcherRouteMatchesCheckpoints(
            route,
            requestedBlocks,
            true
          )
      );
  }

  const displayPath =
    requestedBlocks.join(
      " -> "
    );

  if (matches.length === 0) {
    const error =
      new Error(
        'dispatcher: route "' +
        displayPath +
        '" was not found.'
      );

    error.code =
      "dispatcher_route_not_found";

    throw error;
  }

  /*
   * Deliberately DO NOT auto-select between alternatives.
   * The script author must add enough checkpoint blocks to reduce the set to
   * exactly one physical route.
   */
  if (matches.length !== 1) {
    const error =
      new Error(
        'dispatcher: route "' +
        displayPath +
        '" is ambiguous (' +
        String(matches.length) +
        ' matching routes). Add one or more intermediate checkpoint blocks.'
      );

    error.code =
      "dispatcher_route_ambiguous";

    error.matches =
      matches.map(
        route =>
          route.blockPath.map(
            block =>
              String(
                block && block.name || ""
              )
          )
      );

    throw error;
  }

  const route =
    matches[0];

  const direction =
    String(
      route && route.locoDirection || ""
    );

  if (
    direction !== "forward" &&
    direction !== "reverse"
  ) {
    throw new Error(
      'dispatcher: route "' +
      displayPath +
      '" has no usable direction.'
    );
  }

  const blocks = [];
  const seenBlockIds =
    new Set();

  for (
    const raw of
    route.blockPath
  ) {
    const id =
      __dccDispatcherAsPositiveInt(
        raw && raw.id,
        1,
        65535
      );

    if (id === null) {
      throw new Error(
        "dispatcher: route blockPath contains an invalid block ID."
      );
    }

    if (seenBlockIds.has(id)) {
      throw new Error(
        "dispatcher: route blockPath contains the same block more than once (" +
        String(id) +
        ")."
      );
    }

    seenBlockIds.add(id);

    const config =
      loaded.blocksById.get(id);

    if (!config) {
      throw new Error(
        "dispatcher: route block #" +
        String(id) +
        " is missing from the current layout."
      );
    }

    blocks.push(config);
  }

  const first =
    blocks[0];

  const last =
    blocks[
      blocks.length - 1
    ];

  const requestedFrom =
    String(
      requestedBlocks[0]
    );

  const requestedTo =
    String(
      requestedBlocks[
        requestedBlocks.length - 1
      ]
    );

  if (
    first.name.toLocaleLowerCase() !==
      requestedFrom.toLocaleLowerCase() ||
    last.name.toLocaleLowerCase() !==
      requestedTo.toLocaleLowerCase()
  ) {
    throw new Error(
      'dispatcher: saved blockPath does not match requested endpoints "' +
      displayPath +
      '". Save the layout again.'
    );
  }

  for (const block of blocks) {
    if (
      !Number.isInteger(
        block.sensorAddress
      ) ||
      block.sensorAddress < 1
    ) {
      throw new Error(
        'dispatcher: block "' +
        block.name +
        '" has no valid occupancy sensor address.'
      );
    }
  }

  const rawStates =
    Array.isArray(
      route && route.turnoutStates
    )
      ? route.turnoutStates
      : [];

  const byAddress =
    new Map();

  for (const raw of rawStates) {
    const address =
      Number(
        raw && raw.address
      );

    if (
      !Number.isInteger(address) ||
      address < 1 ||
      address > 2048
    ) {
      throw new Error(
        "dispatcher: route contains an invalid turnout address."
      );
    }

    const closed =
      Boolean(
        raw && raw.closed
      );

    if (
      byAddress.has(address) &&
      byAddress.get(address) !== closed
    ) {
      throw new Error(
        "dispatcher: route contains contradictory turnout states for address " +
        String(address) +
        "."
      );
    }

    byAddress.set(
      address,
      closed
    );
  }

  const turnoutStates =
    [...byAddress.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([address, closed]) =>
        Object.freeze({
          address,
          closed,
        })
      );

  return Object.freeze({
    fromBlockName:
      first.name,
    toBlockName:
      last.name,
    requestedBlocks:
      Object.freeze([
        ...requestedBlocks,
      ]),
    direction,
    blocks:
      Object.freeze(blocks),
    turnoutStates:
      Object.freeze(turnoutStates),
  });
};

const __dccDispatcherRemainingMs = deadline => {
  if (deadline === null) {
    return null;
  }

  return Math.max(
    0,
    deadline - Date.now()
  );
};

const __dccDispatcherTimeoutError = (
  fromName,
  toName
) => {
  const error =
    new Error(
      "dispatcher timeout: " +
      fromName +
      " -> " +
      toName
    );

  error.code =
    "dispatcher_timeout";

  return error;
};

const __dccDispatcherWithOneWebLock = async (
  name,
  deadline,
  callback
) => {
  const lockManager =
    self.navigator &&
    self.navigator.locks;

  if (
    !lockManager ||
    typeof lockManager.request !== "function"
  ) {
    throw new Error(
      "dispatcher: Web Locks API is unavailable. Route block locking cannot be made safe in this browser."
    );
  }

  const remaining =
    __dccDispatcherRemainingMs(
      deadline
    );

  if (remaining === 0) {
    const result =
      await lockManager.request(
        name,
        {
          mode: "exclusive",
          ifAvailable: true,
        },
        async lock => {
          if (!lock) {
            return {
              acquired: false,
            };
          }

          return {
            acquired: true,
            value:
              await callback(),
          };
        }
      );

    if (!result.acquired) {
      throw new Error(
        "dispatcher_block_locked"
      );
    }

    return result.value;
  }

  if (remaining === null) {
    return await lockManager.request(
      name,
      {
        mode: "exclusive",
      },
      callback
    );
  }

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      Math.max(
        1,
        remaining
      )
    );

  try {
    return await lockManager.request(
      name,
      {
        mode: "exclusive",
        signal:
          controller.signal,
      },
      callback
    );
  } catch (error) {
    if (
      error &&
      (
        error.name === "AbortError" ||
        controller.signal.aborted
      )
    ) {
      throw new Error(
        "dispatcher_block_lock_timeout"
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const __dccDispatcherWithBlockLocks = async (
  blocks,
  deadline,
  callback
) => {
  const ordered =
    [...blocks]
      .sort(
        (a, b) =>
          a.id - b.id
      );

  for (const block of ordered) {
    if (
      __dccDispatcherActiveBlockIds.has(
        block.id
      )
    ) {
      throw new Error(
        "dispatcher: overlapping block routes inside the same script are not allowed (block " +
        block.name +
        ")."
      );
    }
  }

  for (const block of ordered) {
    __dccDispatcherActiveBlockIds.add(
      block.id
    );
  }

  const acquireNext =
    async index => {
      if (
        index >=
        ordered.length
      ) {
        return await callback();
      }

      const block =
        ordered[index];

      return await __dccDispatcherWithOneWebLock(
        "dcc-express-dispatcher-block:" +
        String(block.id),
        deadline,
        async () =>
          await acquireNext(
            index + 1
          )
      );
    };

  try {
    return await acquireNext(0);
  } finally {
    for (const block of ordered) {
      __dccDispatcherActiveBlockIds.delete(
        block.id
      );
    }
  }
};

const __dccDispatcherBlockConflicts = (
  route,
  loco
) => {
  const conflicts = [];

  // Source is allowed to be physically occupied: that is where the train
  // starts. All following blocks must be completely free.
  for (
    let index = 1;
    index < route.blocks.length;
    ++index
  ) {
    const block =
      route.blocks[index];

    const actual =
      dcc.getBlock(
        block.name
      );

    const target =
      dcc.getBlockTargetLoco(
        block.name
      );

    const occupied =
      dcc.getSensor(
        block.sensorAddress
      );

    if (
      actual === 0 &&
      target === 0 &&
      occupied === false
    ) {
      continue;
    }

    conflicts.push(
      Object.freeze({
        type: "block",
        blockId:
          block.id,
        blockName:
          block.name,
        sensorAddress:
          block.sensorAddress,
        locoAddress:
          actual,
        targetLocoAddress:
          target,
        occupied,
        requestedLoco:
          loco,
      })
    );
  }

  return Object.freeze(
    conflicts
  );
};

const __dccDispatcherReadSourceLoco = route => {
  const source =
    route.blocks[0];

  const actual =
    dcc.getBlock(
      source.name
    );

  const target =
    dcc.getBlockTargetLoco(
      source.name
    );

  if (target !== 0) {
    throw new Error(
      'dispatcher: source block "' +
      source.name +
      '" has target loco ' +
      String(target) +
      ". Clear it before dispatching."
    );
  }

  // Reading the source sensor verifies that its configured address is present
  // in the authoritative sensor snapshot. Its ON/OFF value is intentionally
  // not used as a free check because the departing train can occupy it.
  dcc.getSensor(
    source.sensorAddress
  );

  if (
    !Number.isInteger(actual) ||
    actual < 0 ||
    actual > 10239
  ) {
    throw new Error(
      'dispatcher: source block "' +
      source.name +
      '" has an invalid locomotive value.'
    );
  }

  return actual;
};

const __dccDispatcherCheckBlocksFree = async (
  route,
  loco,
  options
) => {
  await delay(0);

  const conflicts =
    __dccDispatcherBlockConflicts(
      route,
      loco
    );

  if (conflicts.length === 0) {
    return null;
  }

  setInfo(
    "Útvonal foglalt: " +
    conflicts
      .map(item =>
        item.blockName
      )
      .join(", ")
  );

  if (options.onBlocked) {
    await options.onBlocked(
      loco,
      route.direction,
      conflicts
    );
  }

  return Object.freeze({
    status: "blocked",
    loco,
    dir:
      route.direction,
    conflicts,
  });
};

const __dccDispatcherSetTargets = async (
  route,
  loco
) => {
  for (
    let index = 1;
    index < route.blocks.length;
    ++index
  ) {
    dcc.setBlockTargetLoco(
      route.blocks[index].name,
      loco
    );
  }

  // Yield once so the optimistic block-target state and main-thread command
  // queue are both advanced before the second safety check.
  await delay(0);

  for (
    let index = 1;
    index < route.blocks.length;
    ++index
  ) {
    const block =
      route.blocks[index];

    if (
      dcc.getBlock(
        block.name
      ) !== 0 ||
      dcc.getBlockTargetLoco(
        block.name
      ) !== loco ||
      dcc.getSensor(
        block.sensorAddress
      ) !== false
    ) {
      throw new Error(
        'dispatcher: block "' +
        block.name +
        '" changed while the route was being reserved.'
      );
    }
  }
};

const __dccDispatcherClearTargets = route => {
  for (
    let index = 1;
    index < route.blocks.length;
    ++index
  ) {
    dcc.clearBlockTargetLoco(
      route.blocks[index].name
    );
  }
};

const __dccDispatcherCommitArrival = async (
  route,
  loco
) => {
  const destination =
    route.blocks[
      route.blocks.length - 1
    ];

  // Every previous block becomes completely empty: actual + target = 0.
  for (
    let index = 0;
    index < route.blocks.length - 1;
    ++index
  ) {
    dcc.clearBlock(
      route.blocks[index].name
    );
  }

  // Destination target becomes actual locomotive assignment.
  dcc.clearBlockTargetLoco(
    destination.name
  );

  dcc.setBlock(
    destination.name,
    loco
  );

  await delay(0);
};

const dispatcher = async (
  blocks,
  callback,
  rawOptions = null
) => {
  if (typeof callback !== "function") {
    throw new Error(
      "dispatcher(blocks, callback, options?): callback must be a function."
    );
  }

  const normalizedBlocks =
    __dccDispatcherNormalizeBlocks(
      blocks
    );

  const fromName =
    normalizedBlocks[0];

  const toName =
    normalizedBlocks[
      normalizedBlocks.length - 1
    ];

  const options =
    __dccDispatcherNormalizeOptions(
      rawOptions
    );

  const deadline =
    options.timeoutMs === null
      ? null
      : Date.now() +
        options.timeoutMs;

  const route =
    await __dccDispatcherFindRoute(
      normalizedBlocks
    );

  const direction =
    route.direction;

  /*
   * Read the locomotive BEFORE acquiring any route resources.
   *
   * Empty source is a normal Dispatcher branch, not a lock conflict:
   * no block lock, no target marker and no turnout lock is touched.
   */
  const loco =
    __dccDispatcherReadSourceLoco(
      route
    );

  if (loco === 0) {
    setInfo(
      "Nincs mozdony a kiinduló blokkban: " +
      fromName
    );

    if (options.onEmpty) {
      await options.onEmpty(
        direction
      );

      return Object.freeze({
        status: "empty",
        loco: 0,
        dir:
          direction,
      });
    }

    const emptyError =
      new Error(
        'dispatcher: source block "' +
        fromName +
        '" is empty.'
      );

    emptyError.code =
      "dispatcher_empty_source";

    throw emptyError;
  }

  return await __dccDispatcherWithBlockLocks(
    route.blocks,
    deadline,
    async () => {
      /*
       * Re-read after the block locks were acquired. This closes the gap
       * between the initial source lookup and route reservation.
       */
      const lockedSourceLoco =
        __dccDispatcherReadSourceLoco(
          route
        );

      if (
        lockedSourceLoco !==
        loco
      ) {
        throw new Error(
          'dispatcher: source block "' +
          fromName +
          '" changed while the route was being reserved.'
        );
      }

      const blockResult =
        await __dccDispatcherCheckBlocksFree(
          route,
          loco,
          options
        );

      if (blockResult) {
        return blockResult;
      }

      let targetsSet =
        false;

      let committed =
        false;

      try {
        await __dccDispatcherSetTargets(
          route,
          loco
        );

        targetsSet =
          true;

        const runCallbackAndCommit =
          async () => {
            await callback(
              loco,
              direction
            );

            await __dccDispatcherCommitArrival(
              route,
              loco
            );

            committed =
              true;

            setInfo(
              "Megérkezett: " +
              toName
            );
          };

        if (
          route.turnoutStates.length === 0
        ) {
          setInfo(
            "Útvonal lezárva: " +
            fromName +
            " -> " +
            toName
          );

          await runCallbackAndCommit();
        } else {
          const addresses =
            route.turnoutStates.map(
              state =>
                state.address
            );

          let turnoutBlockConflicts =
            null;

          const switchManOptions = {
            // Dispatcher is a single route-attempt. If turnout resources are
            // not available now, return "blocked" and let TaskManager/scheduler
            // retry the task later instead of parking this task indefinitely.
            timeoutMs: 0,

            onBlocked:
              async conflicts => {
                turnoutBlockConflicts =
                  conflicts;

                if (options.onBlocked) {
                  await options.onBlocked(
                    loco,
                    direction,
                    conflicts
                  );
                }
              },
          };

          setInfo(
            "Váltókörzetre vár: " +
            fromName +
            " -> " +
            toName
          );

          try {
            await switchMan(
              addresses,
              async sw => {
                setInfo(
                  "Útvonal beállítása: " +
                  fromName +
                  " -> " +
                  toName
                );

                for (
                  let index = 0;
                  index <
                    route.turnoutStates.length;
                  ++index
                ) {
                  const state =
                    route.turnoutStates[
                      index
                    ];

                  await sw.setTurnout(
                    state.address,
                    state.closed,
                    index + 1 <
                      route.turnoutStates.length
                      ? options.setDelayMs
                      : 0
                  );
                }

                setInfo(
                  "Útvonal lezárva: " +
                  fromName +
                  " -> " +
                  toName
                );

                await runCallbackAndCommit();
              },
              switchManOptions
            );
          } catch (error) {
            if (
              error &&
              error.code === "switchman_timeout" &&
              turnoutBlockConflicts
            ) {
              return Object.freeze({
                status: "blocked",
                loco,
                dir:
                  direction,
                conflicts:
                  turnoutBlockConflicts,
              });
            }

            throw error;
          }
        }

        return Object.freeze({
          status: "completed",
          loco,
          dir:
            direction,
        });
      } finally {
        /*
         * Normal success already converted target markers into final block
         * ownership. Error/abort must NOT pretend the train arrived; only the
         * dispatcher's own route targets are released.
         */
        if (
          targetsSet &&
          !committed
        ) {
          __dccDispatcherClearTargets(
            route
          );
        }
      }
    }
  );
};


// -----------------------------------------------------------------------------
// Task Manager – single-flight concurrent automation tasks.
// -----------------------------------------------------------------------------
//
// startTask("train-A1-C1", task1)
//
// - starts immediately without blocking the scheduler/main loop;
// - the same task name cannot run twice concurrently;
// - after completion/error the name becomes startable again;
// - Finishing prevents NEW tasks, while already running tasks may finish;
// - runtime finally waits for active tasks before closing script resources.

const __dccTaskManagerTasks =
  new Map();

const __dccTaskManagerNormalizeName =
  value => {
    const name =
      String(
        value ?? ""
      ).trim();

    if (!name) {
      throw new Error(
        "startTask/getTaskState: task name is required."
      );
    }

    if (name.length > 120) {
      throw new Error(
        "Task name is too long (max 120 characters)."
      );
    }

    return name;
  };

const __dccTaskManagerPublicState =
  state =>
    Object.freeze({
      name:
        state.name,
      running:
        state.running,
      status:
        state.status,
      runCount:
        state.runCount,
      startedAt:
        state.startedAt,
      finishedAt:
        state.finishedAt,
      lastResult:
        state.lastResult,
      lastError:
        state.lastError,
    });

const getTaskState =
  nameValue => {
    const name =
      __dccTaskManagerNormalizeName(
        nameValue
      );

    const state =
      __dccTaskManagerTasks.get(
        name
      );

    if (!state) {
      return Object.freeze({
        name,
        running: false,
        status: "idle",
        runCount: 0,
        startedAt: null,
        finishedAt: null,
        lastResult: null,
        lastError: null,
      });
    }

    return __dccTaskManagerPublicState(
      state
    );
  };

const isTaskRunning =
  nameValue =>
    getTaskState(
      nameValue
    ).running;

const startTask = (
  nameValue,
  taskFunction
) => {
  const name =
    __dccTaskManagerNormalizeName(
      nameValue
    );

  if (
    typeof taskFunction !==
    "function"
  ) {
    throw new Error(
      'startTask("' +
      name +
      '", fn): fn must be a function.'
    );
  }

  const existing =
    __dccTaskManagerTasks.get(
      name
    );

  if (
    existing &&
    existing.running
  ) {
    return Object.freeze({
      started: false,
      reason:
        "already-running",
      state:
        __dccTaskManagerPublicState(
          existing
        ),
    });
  }

  if (
    typeof isFinishing ===
      "function" &&
    isFinishing()
  ) {
    return Object.freeze({
      started: false,
      reason:
        "finishing",
      state:
        existing
          ? __dccTaskManagerPublicState(
              existing
            )
          : getTaskState(
              name
            ),
    });
  }

  const state =
    existing ?? {
      name,
      running: false,
      status: "idle",
      runCount: 0,
      startedAt: null,
      finishedAt: null,
      lastResult: null,
      lastError: null,
      promise: null,
    };

  state.running =
    true;

  state.status =
    "running";

  state.runCount +=
    1;

  state.startedAt =
    Date.now();

  state.finishedAt =
    null;

  state.lastResult =
    null;

  state.lastError =
    null;

  const promise =
    Promise.resolve()
      .then(
        () =>
          taskFunction()
      )
      .then(
        result => {
          state.running =
            false;

          state.status =
            "completed";

          state.finishedAt =
            Date.now();

          state.lastResult =
            result === undefined
              ? null
              : result;

          state.lastError =
            null;

          return result;
        },
        error => {
          state.running =
            false;

          state.status =
            "error";

          state.finishedAt =
            Date.now();

          state.lastResult =
            null;

          state.lastError =
            error instanceof Error
              ? error.message
              : String(error);

          // A background task must never create an unhandled rejection.
          // State retains the error for scheduler inspection.
          console.error(
            '[TaskManager] "' +
            name +
            '" failed:',
            error
          );

          return undefined;
        }
      );

  state.promise =
    promise;

  __dccTaskManagerTasks.set(
    name,
    state
  );

  return Object.freeze({
    started: true,
    reason: null,
    state:
      __dccTaskManagerPublicState(
        state
      ),
  });
};

const __dccTaskManagerWaitForAll =
  async () => {
    while (true) {
      const running =
        [
          ...__dccTaskManagerTasks
            .values(),
        ].filter(
          state =>
            state.running &&
            state.promise
        );

      if (
        running.length === 0
      ) {
        return;
      }

      await Promise.all(
        running.map(
          state =>
            state.promise
        )
      );
    }
  };

// Do not wrap the frozen dcc API in a Proxy. The worker exposes dcc as a
// frozen object with non-configurable function properties, and ECMAScript
// Proxy invariants require those properties to be returned byte-for-byte.
// Backend SwitchMan locking remains authoritative: a normal dcc.setTurnout()
// cannot move a turnout that is currently leased by a switchMan scope.
// Inside the scope use await sw.setTurnout(address, closed, delayMs?).
`;
}

export function buildClientScriptSwitchManFinally(): string {
  return `
  // Finishing semantics:
  // no new task is started, but already running tasks are allowed to finish.
  await __dccTaskManagerWaitForAll();

  try {
    __dccSwitchManSocket?.close();
  } catch {
    // Best effort connection cleanup only. Backend locks are deliberately
    // not force-released here; each switchMan scope owns its own finally.
  }
`;
}
