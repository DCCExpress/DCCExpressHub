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
  try {
    __dccSwitchManSocket?.close();
  } catch {
    // Best effort connection cleanup only. Backend locks are deliberately
    // not force-released here; each switchMan scope owns its own finally.
  }
`;
}
