export function buildClientScriptSmartDispatcherPrelude(): string {
  return `
// -----------------------------------------------------------------------------
// SmartDispatcher – rolling block reservation and automatic stop/resume.
// -----------------------------------------------------------------------------
//
// This is deliberately separate from dispatcher(). The stable dispatcher keeps
// its existing full-route reservation semantics unchanged.
//
// Example block item:
// {
//   block: "B1",
//   arrivedWhen: [
//     { sensor: 1000, state: true },
//     { sensor: 999, state: false },
//   ],
// }
//
// If arrivedWhen is omitted, the default arrival condition is:
//   current block occupancy == true AND previous block occupancy == false.
//
// run.setSpeed() stores the desired speed. If NEXT cannot be reserved the
// physical loco speed becomes 0. When clearance becomes available the desired
// speed is restored automatically.

let __dccSmartDispatcherSequence = 0;

const __dccSmartLog = (
  level,
  message,
  details = null
) => {
  const prefix =
    "[SmartDispatcher][" +
    String(level) +
    "]";

  try {
    if (details === null || details === undefined) {
      log(
        prefix,
        String(message)
      );
    } else {
      log(
        prefix,
        String(message),
        details
      );
    }
  } catch {
    // Logging must never break safety cleanup, especially during abort.
  }

  if (level === "ERROR") {
    console.error(
      prefix,
      message,
      details
    );
  } else if (level === "WARN") {
    console.warn(
      prefix,
      message,
      details
    );
  } else {
    console.info(
      prefix,
      message,
      details
    );
  }
};

const __dccSmartErrorText =
  error =>
    error instanceof Error
      ? error.message
      : String(error);

const __dccSmartTransitionName =
  transition =>
    transition.from.name +
    " -> " +
    transition.to.name;

const __dccSmartArrivalSnapshot =
  conditions =>
    conditions.map(
      item => ({
        sensor:
          item.sensor,
        expected:
          item.state,
        actual:
          dcc.getSensor(
            item.sensor
          ),
      })
    );

const __dccSmartNormalizeArrival = (value, blockName) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      'smartDispatcher: arrivedWhen for block "' +
      blockName +
      '" must be a non-empty array.'
    );
  }

  const bySensor = new Map();

  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(
        'smartDispatcher: arrivedWhen entries for block "' +
        blockName +
        '" must be objects.'
      );
    }

    const sensor =
      __dccDispatcherAsPositiveInt(
        raw.sensor !== undefined ? raw.sensor : raw.address,
        1,
        65535
      );

    if (sensor === null) {
      throw new Error(
        'smartDispatcher: invalid arrivedWhen sensor for block "' +
        blockName +
        '".'
      );
    }

    if (typeof raw.state !== "boolean") {
      throw new Error(
        "smartDispatcher: arrivedWhen state must be true or false."
      );
    }

    if (bySensor.has(sensor) && bySensor.get(sensor) !== raw.state) {
      throw new Error(
        'smartDispatcher: contradictory arrivedWhen states for sensor ' +
        String(sensor) +
        ' in block "' +
        blockName +
        '".'
      );
    }

    bySensor.set(sensor, raw.state);
  }

  return Object.freeze(
    [...bySensor.entries()].map(
      ([sensor, state]) =>
        Object.freeze({ sensor, state })
    )
  );
};

const __dccSmartNormalizeRequest = value => {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(
      "smartDispatcher(blocks, callback, options?): at least FROM and TO are required."
    );
  }

  const specs =
    value.map(raw => {
      if (typeof raw === "string" || typeof raw === "number") {
        return Object.freeze({
          name: String(raw).trim(),
          arrivedWhen: null,
        });
      }

      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(
          "smartDispatcher: block must be a name or { block, arrivedWhen }."
        );
      }

      const name =
        String(
          raw.block !== undefined
            ? raw.block
            : raw.name !== undefined
              ? raw.name
              : ""
        ).trim();

      return Object.freeze({
        name,
        arrivedWhen:
          raw.arrivedWhen === null || raw.arrivedWhen === undefined
            ? null
            : __dccSmartNormalizeArrival(raw.arrivedWhen, name || "?"),
      });
    });

  const checkpointNames =
    __dccDispatcherNormalizeBlocks(
      specs.map(item => item.name)
    );

  const specsByName = new Map();

  for (const spec of specs) {
    specsByName.set(
      spec.name.toLocaleLowerCase(),
      spec
    );
  }

  return Object.freeze({
    checkpointNames,
    specsByName,
  });
};

const __dccSmartNormalizeOptions = value => {
  if (value === null || value === undefined) {
    return Object.freeze({
      onBlocked: null,
      onEmpty: null,
      setDelayMs: 250,
      blockPollMs: 100,
    });
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "smartDispatcher: options must be an object."
    );
  }

  const onBlocked =
    value.onBlocked === null || value.onBlocked === undefined
      ? null
      : value.onBlocked;

  const onEmpty =
    value.onEmpty === null || value.onEmpty === undefined
      ? null
      : value.onEmpty;

  if (onBlocked !== null && typeof onBlocked !== "function") {
    throw new Error(
      "smartDispatcher: options.onBlocked must be a function."
    );
  }

  if (onEmpty !== null && typeof onEmpty !== "function") {
    throw new Error(
      "smartDispatcher: options.onEmpty must be a function."
    );
  }

  const setDelayMs =
    value.setDelayMs === null || value.setDelayMs === undefined
      ? 250
      : Number(value.setDelayMs);

  const blockPollMs =
    value.blockPollMs === null || value.blockPollMs === undefined
      ? 100
      : Number(value.blockPollMs);

  if (
    !Number.isFinite(setDelayMs) ||
    setDelayMs < 0 ||
    setDelayMs > 600000
  ) {
    throw new Error(
      "smartDispatcher: setDelayMs must be between 0 and 600000."
    );
  }

  if (
    !Number.isFinite(blockPollMs) ||
    blockPollMs < 25 ||
    blockPollMs > 5000
  ) {
    throw new Error(
      "smartDispatcher: blockPollMs must be between 25 and 5000."
    );
  }

  return Object.freeze({
    onBlocked,
    onEmpty,
    setDelayMs,
    blockPollMs,
  });
};

const __dccSmartBuildRoute = async request => {
  const baseRoute =
    await __dccDispatcherFindRoute(
      request.checkpointNames
    );

  if (
    !Array.isArray(
      baseRoute.blockNodeIndexes
    ) ||
    baseRoute.blockNodeIndexes.length !==
      baseRoute.blocks.length ||
    !Array.isArray(
      baseRoute.edgePath
    ) ||
    !Array.isArray(
      baseRoute.nodePath
    )
  ) {
    throw new Error(
      "smartDispatcher: exact per-transition route data is missing. Regenerate and save the route graph."
    );
  }

  const authoritativeTurnouts =
    new Map(
      baseRoute.turnoutStates.map(
        state => [
          state.address,
          state.closed,
        ]
      )
    );

  const transitions = [];

  for (
    let blockIndex = 0;
    blockIndex < baseRoute.blocks.length - 1;
    ++blockIndex
  ) {
    const from =
      baseRoute.blocks[
        blockIndex
      ];

    const to =
      baseRoute.blocks[
        blockIndex + 1
      ];

    const nodeFrom =
      baseRoute.blockNodeIndexes[
        blockIndex
      ];

    const nodeTo =
      baseRoute.blockNodeIndexes[
        blockIndex + 1
      ];

    if (
      !Number.isInteger(nodeFrom) ||
      !Number.isInteger(nodeTo) ||
      nodeFrom < 0 ||
      nodeTo < nodeFrom ||
      nodeTo >=
        baseRoute.nodePath.length
    ) {
      throw new Error(
        "smartDispatcher: invalid saved node range for " +
        from.name +
        " -> " +
        to.name +
        ". Regenerate and save the route graph."
      );
    }

    const turnouts =
      new Map();

    for (
      let edgeIndex = nodeFrom;
      edgeIndex < nodeTo;
      edgeIndex += 1
    ) {
      const edge =
        baseRoute.edgePath[
          edgeIndex
        ];

      if (!edge) {
        throw new Error(
          "smartDispatcher: missing saved edge " +
          String(edgeIndex) +
          " for " +
          from.name +
          " -> " +
          to.name +
          "."
        );
      }

      for (
        const requirement of
        edge.turnoutStates
      ) {
        const authoritative =
          authoritativeTurnouts.get(
            requirement.address
          );

        if (
          authoritative === undefined ||
          authoritative !==
            requirement.closed
        ) {
          throw new Error(
            "smartDispatcher: transition turnout #" +
            String(
              requirement.address
            ) +
            " disagrees with the authoritative route."
          );
        }

        if (
          turnouts.has(
            requirement.address
          ) &&
          turnouts.get(
            requirement.address
          ) !==
            requirement.closed
        ) {
          throw new Error(
            "smartDispatcher: contradictory turnout requirement #" +
            String(
              requirement.address
            ) +
            " inside transition " +
            from.name +
            " -> " +
            to.name +
            "."
          );
        }

        turnouts.set(
          requirement.address,
          requirement.closed
        );
      }
    }

    const turnoutStates =
      Object.freeze(
        [...turnouts.entries()]
          .sort(
            (a, b) =>
              a[0] - b[0]
          )
          .map(
            ([address, closed]) =>
              Object.freeze({
                address,
                closed,
              })
          )
      );

    const spec =
      request.specsByName.get(
        to.name.toLocaleLowerCase()
      );

    let arrivedWhen =
      spec && spec.arrivedWhen
        ? spec.arrivedWhen
        : null;

    if (!arrivedWhen) {
      if (
        from.sensorAddress ===
        to.sensorAddress
      ) {
        throw new Error(
          'smartDispatcher: adjacent blocks "' +
          from.name +
          '" and "' +
          to.name +
          '" share one occupancy sensor; configure arrivedWhen explicitly.'
        );
      }

      arrivedWhen =
        Object.freeze([
          Object.freeze({
            sensor:
              to.sensorAddress,
            state:
              true,
          }),
          Object.freeze({
            sensor:
              from.sensorAddress,
            state:
              false,
          }),
        ]);
    }

    transitions.push(
      Object.freeze({
        index:
          blockIndex,
        from,
        to,
        nodeFrom,
        nodeTo,
        arrivedWhen,
        turnoutStates,
      })
    );
  }

  const route =
    Object.freeze({
      fromBlockName:
        baseRoute.fromBlockName,
      toBlockName:
        baseRoute.toBlockName,
      requestedBlocks:
        baseRoute.requestedBlocks,
      direction:
        baseRoute.direction,
      blocks:
        baseRoute.blocks,
      transitions:
        Object.freeze(
          transitions
        ),
    });

  __dccSmartLog(
    "INFO",
    "route resolved",
    {
      requested:
        [...route.requestedBlocks],
      expanded:
        route.blocks.map(
          block =>
            block.name
        ),
      direction:
        route.direction,
      transitions:
        route.transitions.map(
          transition => ({
            from:
              transition.from.name,
            to:
              transition.to.name,
            turnoutStates:
              transition.turnoutStates.map(
                state => ({
                  address:
                    state.address,
                  closed:
                    state.closed,
                })
              ),
            arrivedWhen:
              transition.arrivedWhen.map(
                item => ({
                  sensor:
                    item.sensor,
                  state:
                    item.state,
                })
              ),
          })
        ),
    }
  );

  return route;
};

const __dccSmartBlockConflict = (block, loco) => {
  const actual = dcc.getBlock(block.name);
  const target =
    dcc.getBlockTargetLoco(block.name);
  const occupied =
    dcc.getSensor(block.sensorAddress);

  if (
    actual === 0 &&
    target === 0 &&
    occupied === false
  ) {
    return null;
  }

  return Object.freeze({
    type: "block",
    blockId: block.id,
    blockName: block.name,
    sensorAddress: block.sensorAddress,
    locoAddress: actual,
    targetLocoAddress: target,
    occupied,
    requestedLoco: loco,
  });
};

const __dccSmartTryBlockLease = async block => {
  const lockManager =
    self.navigator &&
    self.navigator.locks;

  if (
    !lockManager ||
    typeof lockManager.request !== "function"
  ) {
    throw new Error(
      "smartDispatcher: Web Locks API is unavailable."
    );
  }

  if (__dccDispatcherActiveBlockIds.has(block.id)) {
    return Object.freeze({
      acquired: false,
      conflict:
        Object.freeze({
          type: "block-lock",
          blockId: block.id,
          blockName: block.name,
        }),
    });
  }

  __dccDispatcherActiveBlockIds.add(block.id);

  let releaseHold = null;
  let resolveAcquire = null;
  let rejectAcquire = null;
  let requestError = null;

  const hold =
    new Promise(resolve => {
      releaseHold = resolve;
    });

  const acquired =
    new Promise((resolve, reject) => {
      resolveAcquire = resolve;
      rejectAcquire = reject;
    });

  const request =
    (async () => {
      try {
        await lockManager.request(
          "dcc-express-dispatcher-block:" +
            String(block.id),
          {
            mode: "exclusive",
            ifAvailable: true,
          },
          async lock => {
            if (!lock) {
              resolveAcquire(false);
              return;
            }

            resolveAcquire(true);
            await hold;
          }
        );
      } catch (error) {
        requestError = error;
        rejectAcquire(error);
      }
    })();

  let ok = false;

  try {
    ok = await acquired;
  } catch (error) {
    __dccDispatcherActiveBlockIds.delete(block.id);
    await request;
    throw error;
  }

  if (!ok) {
    __dccDispatcherActiveBlockIds.delete(block.id);
    await request;

    return Object.freeze({
      acquired: false,
      conflict:
        Object.freeze({
          type: "block-lock",
          blockId: block.id,
          blockName: block.name,
        }),
    });
  }

  let released = false;

  return Object.freeze({
    acquired: true,
    block,
    async release() {
      if (released) {
        return;
      }

      released = true;
      releaseHold();
      await request;
      __dccDispatcherActiveBlockIds.delete(block.id);

      if (requestError) {
        throw requestError;
      }
    },
  });
};

const __dccSmartTryTurnoutLease =
  async (
    states,
    setDelayMs,
    beforeChange,
    transitionName
  ) => {
    if (states.length === 0) {
      __dccSmartLog(
        "INFO",
        transitionName +
        ": no turnout lock required"
      );

      return Object.freeze({
        acquired: true,
        conflicts:
          Object.freeze([]),
        async release() {},
      });
    }

    const addresses =
      states.map(
        state =>
          state.address
      );

    const ownerId =
      __dccSwitchManOwnerBaseId +
      ":smart-dispatcher:" +
      String(
        ++__dccSmartDispatcherSequence
      );

    __dccSmartLog(
      "INFO",
      transitionName +
      ": requesting turnout lock",
      states
    );

    try {
      await __dccSwitchManRequest(
        "acquire",
        ownerId,
        {
          addresses,
          timeoutMs: 0,
        }
      );
    } catch (error) {
      if (
        error &&
        error.code ===
          "turnout_locked"
      ) {
        const raw =
          error.details &&
          Array.isArray(
            error.details.conflicts
          )
            ? error.details.conflicts
            : [];

        const conflicts =
          __dccSwitchManSafeConflicts(
            raw
          );

        __dccSmartLog(
          "WARN",
          transitionName +
          ": turnout lock blocked",
          conflicts
        );

        return Object.freeze({
          acquired: false,
          conflicts,
        });
      }

      __dccSmartLog(
        "ERROR",
        transitionName +
        ": turnout lock request failed",
        {
          error:
            __dccSmartErrorText(
              error
            ),
          states,
        }
      );

      throw error;
    }

    __dccSmartLog(
      "INFO",
      transitionName +
      ": turnout lock acquired",
      {
        ownerId,
        states,
      }
    );

    let released = false;

    const release =
      async () => {
        if (released) {
          return;
        }

        released = true;

        try {
          await __dccSwitchManRequest(
            "release",
            ownerId,
            {
              addresses,
            },
            10000
          );

          __dccSmartLog(
            "INFO",
            transitionName +
            ": turnout lock released",
            addresses
          );
        } catch (error) {
          __dccSmartLog(
            "ERROR",
            transitionName +
            ": turnout lock release failed",
            {
              addresses,
              error:
                __dccSmartErrorText(
                  error
                ),
            }
          );

          throw error;
        }
      };

    try {
      const needsChange =
        states.some(
          state =>
            dcc.getTurnout(
              state.address
            ) !==
              state.closed
        );

      if (
        needsChange &&
        typeof beforeChange ===
          "function"
      ) {
        beforeChange();
      }

      for (
        let index = 0;
        index < states.length;
        index += 1
      ) {
        const turnoutState =
          states[index];

        const current =
          dcc.getTurnout(
            turnoutState.address
          );

        if (
          current ===
            turnoutState.closed
        ) {
          __dccSmartLog(
            "INFO",
            transitionName +
            ": turnout already correct",
            {
              address:
                turnoutState.address,
              closed:
                turnoutState.closed,
            }
          );

          continue;
        }

        __dccSmartLog(
          "INFO",
          transitionName +
          ": setting turnout",
          {
            address:
              turnoutState.address,
            fromClosed:
              current,
            toClosed:
              turnoutState.closed,
          }
        );

        await __dccSwitchManRequest(
          "set",
          ownerId,
          {
            address:
              turnoutState.address,
            closed:
              turnoutState.closed,
          },
          15000
        );

        __dccSmartLog(
          "INFO",
          transitionName +
          ": turnout command accepted",
          {
            address:
              turnoutState.address,
            closed:
              turnoutState.closed,
          }
        );

        if (
          index + 1 <
            states.length &&
          setDelayMs > 0
        ) {
          await delay(
            setDelayMs
          );
        }
      }

      return Object.freeze({
        acquired: true,
        conflicts:
          Object.freeze([]),
        release,
      });
    } catch (error) {
      __dccSmartLog(
        "ERROR",
        transitionName +
        ": turnout setup failed",
        {
          error:
            __dccSmartErrorText(
              error
            ),
          states,
        }
      );

      try {
        await release();
      } catch {
        // release() already logged the failure.
      }

      throw error;
    }
  };

const __dccSmartArrivalSatisfied =
  conditions =>
    conditions.every(
      item =>
        dcc.getSensor(item.sensor) === item.state
    );

const __dccSmartApplySpeed = state => {
  const speed =
    state.motionAuthorized &&
    !state.completed &&
    !state.cancelled
      ? state.desiredSpeed
      : 0;

  if (state.physicalSpeed === speed) {
    return;
  }

  dcc.setLoco(
    state.loco,
    speed,
    state.direction
  );

  state.physicalSpeed = speed;
};

const __dccSmartFindBlockIndex = (state, value) => {
  const name = String(value ?? "").trim();
  const folded = name.toLocaleLowerCase();

  const index =
    state.route.blocks.findIndex(
      block =>
        block.name.toLocaleLowerCase() === folded
    );

  if (!name || index < 0) {
    throw new Error(
      'smartDispatcher run: block "' +
      name +
      '" is not on the selected route.'
    );
  }

  return index;
};

const __dccSmartResolveWaiters = state => {
  const pending = [];

  for (const waiter of state.waiters) {
    const reached =
      waiter.kind === "block"
        ? state.currentIndex >= waiter.index
        : (
            state.currentIndex >= waiter.index ||
            (
              state.reservation &&
              state.reservation.toIndex >= waiter.index
            )
          );

    if (reached) {
      waiter.resolve(
        state.route.blocks[waiter.index].name
      );
    } else {
      pending.push(waiter);
    }
  }

  state.waiters = pending;
};

const __dccSmartRejectWaiters = (state, error) => {
  const waiters = state.waiters;
  state.waiters = [];

  for (const waiter of waiters) {
    waiter.reject(error);
  }
};

const __dccSmartWaitForProgress =
  (state, kind, blockName) => {
    if (state.cancelled) {
      return Promise.reject(
        state.failure ||
        new Error(
          "smartDispatcher run is no longer active."
        )
      );
    }

    const index =
      __dccSmartFindBlockIndex(state, blockName);

    const reached =
      kind === "block"
        ? state.currentIndex >= index
        : (
            state.currentIndex >= index ||
            (
              state.reservation &&
              state.reservation.toIndex >= index
            )
          );

    if (reached) {
      return Promise.resolve(
        state.route.blocks[index].name
      );
    }

    return new Promise((resolve, reject) => {
      state.waiters.push({
        kind,
        index,
        resolve,
        reject,
      });
    });
  };

const __dccSmartRunApi = state =>
  Object.freeze({
    setSpeed(value) {
      if (state.cancelled) {
        throw new Error(
          "smartDispatcher run is no longer active."
        );
      }

      const speed = Number(value);

      if (
        !Number.isFinite(speed) ||
        speed < 0 ||
        speed > 126
      ) {
        throw new Error(
          "smartDispatcher run.setSpeed: speed must be between 0 and 126."
        );
      }

      state.desiredSpeed =
        state.completed
          ? 0
          : Math.round(speed);

      __dccSmartApplySpeed(state);
      return state.desiredSpeed;
    },

    stop() {
      if (state.cancelled) {
        throw new Error(
          "smartDispatcher run is no longer active."
        );
      }

      state.desiredSpeed = 0;
      __dccSmartApplySpeed(state);
      return 0;
    },

    waitForBlock(blockName) {
      return __dccSmartWaitForProgress(
        state,
        "block",
        blockName
      );
    },

    waitForClearance(blockName) {
      return __dccSmartWaitForProgress(
        state,
        "clearance",
        blockName
      );
    },

    getCurrentBlock() {
      return state.route.blocks[state.currentIndex].name;
    },

    getNextBlock() {
      const block =
        state.route.blocks[state.currentIndex + 1];

      return block ? block.name : null;
    },

    getRoute() {
      return Object.freeze(
        state.route.blocks.map(block => block.name)
      );
    },

    getDesiredSpeed() {
      return state.desiredSpeed;
    },
  });

const __dccSmartClearTarget = (block, loco) => {
  if (
    block &&
    dcc.getBlockTargetLoco(block.name) === loco
  ) {
    dcc.clearBlockTargetLoco(block.name);
  }
};

const __dccSmartReleaseReservation =
  async (state, reservation) => {
    if (!reservation) {
      return;
    }

    __dccSmartClearTarget(
      reservation.block,
      state.loco
    );

    try {
      await reservation.turnoutLease.release();
    } catch (error) {
      __dccSmartLog(
        "ERROR",
        "reservation turnout release failed",
        {
          block:
            reservation.block?.name ??
            null,
          error:
            __dccSmartErrorText(
              error
            ),
        }
      );
    }

    try {
      await reservation.blockLease.release();
    } catch (error) {
      __dccSmartLog(
        "ERROR",
        "reservation block lease release failed",
        {
          block:
            reservation.block?.name ??
            null,
          error:
            __dccSmartErrorText(
              error
            ),
        }
      );
    }
  };

const __dccSmartTryReserve =
  async (state, transition) => {
    const block =
      transition.to;

    const transitionName =
      __dccSmartTransitionName(
        transition
      );

    const conflict =
      __dccSmartBlockConflict(
        block,
        state.loco
      );

    if (conflict) {
      return Object.freeze({
        acquired: false,
        conflicts:
          Object.freeze([
            conflict,
          ]),
      });
    }

    const blockLease =
      await __dccSmartTryBlockLease(
        block
      );

    if (!blockLease.acquired) {
      return Object.freeze({
        acquired: false,
        conflicts:
          Object.freeze([
            blockLease.conflict,
          ]),
      });
    }

    let targetSet =
      false;

    try {
      const lockedConflict =
        __dccSmartBlockConflict(
          block,
          state.loco
        );

      if (lockedConflict) {
        return Object.freeze({
          acquired: false,
          conflicts:
            Object.freeze([
              lockedConflict,
            ]),
          blockLease,
        });
      }

      __dccSmartLog(
        "INFO",
        transitionName +
        ": target block is free; reserving target",
        {
          block:
            block.name,
          sensorAddress:
            block.sensorAddress,
          loco:
            state.loco,
        }
      );

      dcc.setBlockTargetLoco(
        block.name,
        state.loco
      );

      targetSet =
        true;

      await delay(0);

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
        actual !== 0 ||
        target !==
          state.loco ||
        occupied !== false
      ) {
        return Object.freeze({
          acquired: false,
          conflicts:
            Object.freeze([
              Object.freeze({
                type:
                  "block-changed",
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
                  state.loco,
              }),
            ]),
          clearTarget: true,
          blockLease,
        });
      }

      __dccSmartLog(
        "INFO",
        transitionName +
        ": target reservation confirmed",
        {
          block:
            block.name,
          targetLoco:
            target,
          occupied,
        }
      );

      const turnoutNeedsChange =
        transition.turnoutStates.some(
          item =>
            dcc.getTurnout(
              item.address
            ) !==
              item.closed
        );

      if (turnoutNeedsChange) {
        state.motionAuthorized =
          false;

        __dccSmartApplySpeed(
          state
        );
      }

      const turnoutLease =
        await __dccSmartTryTurnoutLease(
          transition.turnoutStates,
          state.options.setDelayMs,
          () => {
            state.motionAuthorized =
              false;

            __dccSmartApplySpeed(
              state
            );
          },
          transitionName
        );

      if (!turnoutLease.acquired) {
        return Object.freeze({
          acquired: false,
          conflicts:
            turnoutLease.conflicts,
          clearTarget: true,
          blockLease,
        });
      }

      return Object.freeze({
        acquired: true,
        block,
        toIndex:
          transition.index + 1,
        blockLease,
        turnoutLease,
      });
    } catch (error) {
      __dccSmartLog(
        "ERROR",
        transitionName +
        ": reservation failed",
        {
          error:
            __dccSmartErrorText(
              error
            ),
        }
      );

      if (targetSet) {
        __dccSmartClearTarget(
          block,
          state.loco
        );
      }

      try {
        await blockLease.release();
      } catch (releaseError) {
        __dccSmartLog(
          "ERROR",
          transitionName +
          ": block lease release failed after reservation error",
          {
            error:
              __dccSmartErrorText(
                releaseError
              ),
          }
        );
      }

      throw error;
    }
  };

const __dccSmartDisposeFailedAttempt =
  async (state, transition, result) => {
    if (result.clearTarget) {
      __dccSmartClearTarget(
        transition.to,
        state.loco
      );
    }

    if (result.blockLease) {
      await result.blockLease.release();
    }
  };

const __dccSmartWaitForClearance =
  async (state, transition) => {
    let notified =
      false;

    let lastConflictSignature =
      null;

    const transitionName =
      __dccSmartTransitionName(
        transition
      );

    __dccSmartLog(
      "INFO",
      transitionName +
      ": checking next block",
      {
        block:
          transition.to.name,
        sensorAddress:
          transition.to.sensorAddress,
        turnouts:
          transition.turnoutStates,
      }
    );

    while (!state.cancelled) {
      const result =
        await __dccSmartTryReserve(
          state,
          transition
        );

      if (result.acquired) {
        state.reservation =
          result;

        state.motionAuthorized =
          true;

        __dccSmartApplySpeed(
          state
        );

        __dccSmartResolveWaiters(
          state
        );

        setInfo(
          "SmartDispatcher szabad: " +
          transitionName
        );

        __dccSmartLog(
          "INFO",
          transitionName +
          ": clearance granted; movement authorized",
          {
            desiredSpeed:
              state.desiredSpeed,
            targetBlock:
              transition.to.name,
            turnoutStates:
              transition.turnoutStates,
          }
        );

        return result;
      }

      await __dccSmartDisposeFailedAttempt(
        state,
        transition,
        result
      );

      state.motionAuthorized =
        false;

      __dccSmartApplySpeed(
        state
      );

      const conflictSignature =
        JSON.stringify(
          result.conflicts
        );

      if (
        conflictSignature !==
          lastConflictSignature
      ) {
        lastConflictSignature =
          conflictSignature;

        __dccSmartLog(
          "WARN",
          transitionName +
          ": clearance blocked",
          result.conflicts
        );
      }

      if (!notified) {
        notified =
          true;

        setInfo(
          "SmartDispatcher vár: " +
          transitionName
        );

        if (
          state.options.onBlocked
        ) {
          await state.options.onBlocked(
            state.loco,
            state.direction,
            result.conflicts
          );
        }
      }

      await delay(
        state.options.blockPollMs
      );
    }

    throw (
      state.failure ||
      new Error(
        "smartDispatcher cancelled."
      )
    );
  };

const __dccSmartWaitForArrival =
  async (state, transition) => {
    const transitionName =
      __dccSmartTransitionName(
        transition
      );

    let lastArrivalSignature =
      null;

    __dccSmartLog(
      "INFO",
      transitionName +
      ": waiting for arrival",
      {
        conditions:
          __dccSmartArrivalSnapshot(
            transition.arrivedWhen
          ),
      }
    );

    while (!state.cancelled) {
      const arrivalSnapshot =
        __dccSmartArrivalSnapshot(
          transition.arrivedWhen
        );

      const arrivalSignature =
        JSON.stringify(
          arrivalSnapshot
        );

      if (
        arrivalSignature !==
          lastArrivalSignature
      ) {
        lastArrivalSignature =
          arrivalSignature;

        __dccSmartLog(
          "INFO",
          transitionName +
          ": arrival sensor state changed",
          arrivalSnapshot
        );
      }

      if (
        arrivalSnapshot.every(
          item =>
            item.actual ===
              item.expected
        )
      ) {
        __dccSmartLog(
          "INFO",
          transitionName +
          ": arrival conditions satisfied",
          arrivalSnapshot
        );

        return;
      }

      const actual =
        dcc.getBlock(
          transition.to.name
        );

      const target =
        dcc.getBlockTargetLoco(
          transition.to.name
        );

      if (
        actual !== 0 &&
        actual !== state.loco
      ) {
        state.motionAuthorized =
          false;

        __dccSmartApplySpeed(
          state
        );

        const error =
          new Error(
            'smartDispatcher: block "' +
            transition.to.name +
            '" was assigned to another locomotive during movement.'
          );

        __dccSmartLog(
          "ERROR",
          transitionName +
          ": destination block ownership changed during movement",
          {
            expectedLoco:
              state.loco,
            actualLoco:
              actual,
            targetLoco:
              target,
            sensors:
              arrivalSnapshot,
          }
        );

        throw error;
      }

      if (
        actual === 0 &&
        target !== state.loco
      ) {
        state.motionAuthorized =
          false;

        __dccSmartApplySpeed(
          state
        );

        const error =
          new Error(
            'smartDispatcher: target for block "' +
            transition.to.name +
            '" was lost during movement.'
          );

        __dccSmartLog(
          "ERROR",
          transitionName +
          ": target reservation was lost during movement",
          {
            expectedLoco:
              state.loco,
            actualLoco:
              actual,
            targetLoco:
              target,
            sensors:
              arrivalSnapshot,
          }
        );

        throw error;
      }

      await delay(
        state.options.blockPollMs
      );
    }

    throw (
      state.failure ||
      new Error(
        "smartDispatcher cancelled."
      )
    );
  };

const __dccSmartCommitArrival =
  async (
    state,
    transition,
    reservation
  ) => {
    const previousLease =
      state.currentLease;

    const transitionName =
      __dccSmartTransitionName(
        transition
      );

    __dccSmartLog(
      "INFO",
      transitionName +
      ": committing arrival",
      {
        loco:
          state.loco,
        clearBlock:
          transition.from.name,
        destination:
          transition.to.name,
      }
    );

    dcc.clearBlock(
      transition.from.name
    );

    dcc.clearBlockTargetLoco(
      transition.to.name
    );

    dcc.setBlock(
      transition.to.name,
      state.loco
    );

    await delay(0);

    const committedLoco =
      dcc.getBlock(
        transition.to.name
      );

    if (
      committedLoco !==
        state.loco
    ) {
      throw new Error(
        'smartDispatcher: destination block "' +
        transition.to.name +
        '" did not commit locomotive ' +
        String(state.loco) +
        "."
      );
    }

    state.currentIndex =
      reservation.toIndex;

    state.currentLease =
      reservation.blockLease;

    state.reservation =
      null;

    __dccSmartResolveWaiters(
      state
    );

    try {
      await reservation.turnoutLease.release();
    } catch (error) {
      __dccSmartLog(
        "ERROR",
        transitionName +
        ": turnout release failed after arrival",
        {
          error:
            __dccSmartErrorText(
              error
            ),
        }
      );
    }

    if (previousLease) {
      try {
        await previousLease.release();
      } catch (error) {
        __dccSmartLog(
          "ERROR",
          transitionName +
          ": previous block lease release failed",
          {
            error:
              __dccSmartErrorText(
                error
              ),
          }
        );
      }
    }

    __dccSmartLog(
      "INFO",
      transitionName +
      ": arrival committed; previous resources released",
      {
        currentBlock:
          transition.to.name,
        loco:
          state.loco,
      }
    );
  };

const __dccSmartMonitor =
  async state => {
    while (
      !state.cancelled &&
      state.currentIndex <
        state.route.blocks.length - 1
    ) {
      const transition =
        state.route.transitions[
          state.currentIndex
        ];

      __dccSmartLog(
        "INFO",
        "starting transition " +
        __dccSmartTransitionName(
          transition
        ),
        {
          transitionIndex:
            transition.index,
          turnoutStates:
            transition.turnoutStates,
        }
      );

      const reservation =
        await __dccSmartWaitForClearance(
          state,
          transition
        );

      if (state.cancelled) {
        await __dccSmartReleaseReservation(
          state,
          reservation
        );

        return;
      }

      await __dccSmartWaitForArrival(
        state,
        transition
      );

      if (state.cancelled) {
        return;
      }

      await __dccSmartCommitArrival(
        state,
        transition,
        reservation
      );
    }

    if (
      !state.cancelled &&
      state.currentIndex ===
        state.route.blocks.length - 1
    ) {
      state.completed =
        true;

      state.desiredSpeed =
        0;

      state.motionAuthorized =
        false;

      __dccSmartApplySpeed(
        state
      );

      __dccSmartResolveWaiters(
        state
      );

      setInfo(
        "SmartDispatcher megérkezett: " +
        state.route.toBlockName
      );

      __dccSmartLog(
        "INFO",
        "route completed",
        {
          destination:
            state.route.toBlockName,
          loco:
            state.loco,
        }
      );
    }
  };

const __dccSmartCleanup = async state => {
  state.cancelled = true;
  state.motionAuthorized = false;
  __dccSmartApplySpeed(state);

  if (state.reservation) {
    const reservation = state.reservation;
    state.reservation = null;

    await __dccSmartReleaseReservation(
      state,
      reservation
    );
  }

  if (state.currentLease) {
    const lease = state.currentLease;
    state.currentLease = null;

    try {
      await lease.release();
    } catch (error) {
      __dccSmartLog(
        "ERROR",
        "current block lease release failed during cleanup",
        {
          currentBlock:
            state.route.blocks[
              state.currentIndex
            ]?.name ??
            null,
          error:
            __dccSmartErrorText(
              error
            ),
        }
      );
    }
  }
};

const smartDispatcher = async (
  blocks,
  callback,
  rawOptions = null
) => {
  if (
    typeof callback !==
      "function"
  ) {
    throw new Error(
      "smartDispatcher(blocks, callback, options?): callback must be a function."
    );
  }

  let request;
  let options;
  let route;

  try {
    request =
      __dccSmartNormalizeRequest(
        blocks
      );

    options =
      __dccSmartNormalizeOptions(
        rawOptions
      );

    __dccSmartLog(
      "INFO",
      "starting",
      {
        requestedBlocks:
          [...request.checkpointNames],
      }
    );

    route =
      await __dccSmartBuildRoute(
        request
      );
  } catch (error) {
    __dccSmartLog(
      "ERROR",
      "route preparation failed",
      {
        error:
          __dccSmartErrorText(
            error
          ),
      }
    );

    throw error;
  }

  let loco;

  try {
    loco =
      __dccDispatcherReadSourceLoco(
        route
      );
  } catch (error) {
    __dccSmartLog(
      "ERROR",
      "source block validation failed",
      {
        source:
          route.fromBlockName,
        error:
          __dccSmartErrorText(
            error
          ),
      }
    );

    throw error;
  }

  if (loco === 0) {
    setInfo(
      "Nincs mozdony a kiinduló blokkban: " +
      route.fromBlockName
    );

    __dccSmartLog(
      "WARN",
      "source block is empty",
      {
        source:
          route.fromBlockName,
      }
    );

    if (options.onEmpty) {
      await options.onEmpty(
        route.direction
      );

      return Object.freeze({
        status:
          "empty",
        loco: 0,
        dir:
          route.direction,
      });
    }

    const error =
      new Error(
        'smartDispatcher: source block "' +
        route.fromBlockName +
        '" is empty.'
      );

    error.code =
      "smart_dispatcher_empty_source";

    throw error;
  }

  __dccSmartLog(
    "INFO",
    "source locomotive resolved",
    {
      source:
        route.fromBlockName,
      loco,
      direction:
        route.direction,
    }
  );

  const sourceLease =
    await __dccSmartTryBlockLease(
      route.blocks[0]
    );

  if (!sourceLease.acquired) {
    const conflicts =
      Object.freeze([
        sourceLease.conflict,
      ]);

    __dccSmartLog(
      "WARN",
      "source block lock is unavailable",
      conflicts
    );

    if (options.onBlocked) {
      await options.onBlocked(
        loco,
        route.direction,
        conflicts
      );
    }

    return Object.freeze({
      status:
        "blocked",
      loco,
      dir:
        route.direction,
      conflicts,
    });
  }

  const lockedLoco =
    __dccDispatcherReadSourceLoco(
      route
    );

  if (lockedLoco !== loco) {
    await sourceLease.release();

    const error =
      new Error(
        'smartDispatcher: source block "' +
        route.fromBlockName +
        '" changed while locking.'
      );

    __dccSmartLog(
      "ERROR",
      "source block changed while acquiring its lease",
      {
        source:
          route.fromBlockName,
        expectedLoco:
          loco,
        actualLoco:
          lockedLoco,
      }
    );

    throw error;
  }

  const state = {
    route,
    loco,
    direction:
      route.direction,
    options,
    currentIndex: 0,
    currentLease:
      sourceLease,
    reservation:
      null,
    desiredSpeed: 0,
    physicalSpeed:
      null,
    motionAuthorized:
      false,
    completed:
      false,
    cancelled:
      false,
    failure:
      null,
    waiters: [],
  };

  __dccSmartApplySpeed(
    state
  );

  const run =
    __dccSmartRunApi(
      state
    );

  let monitorPromise =
    null;

  let callbackPromise =
    null;

  try {
    monitorPromise =
      __dccSmartMonitor(
        state
      );

    callbackPromise =
      Promise.resolve().then(
        () =>
          callback(
            loco,
            route.direction,
            run
          )
      );

    await Promise.all([
      monitorPromise,
      callbackPromise,
    ]);

    __dccSmartLog(
      "INFO",
      "finished successfully",
      {
        loco,
        destination:
          route.toBlockName,
      }
    );

    return Object.freeze({
      status:
        "completed",
      loco,
      dir:
        route.direction,
      block:
        route.toBlockName,
    });
  } catch (error) {
    state.failure =
      error instanceof Error
        ? error
        : new Error(
            String(error)
          );

    __dccSmartLog(
      "ERROR",
      "execution failed",
      {
        error:
          state.failure.message,
        loco:
          state.loco,
        currentBlock:
          state.route.blocks[
            state.currentIndex
          ]?.name ??
          null,
        nextBlock:
          state.route.blocks[
            state.currentIndex + 1
          ]?.name ??
          null,
        desiredSpeed:
          state.desiredSpeed,
        physicalSpeed:
          state.physicalSpeed,
        motionAuthorized:
          state.motionAuthorized,
      }
    );

    state.cancelled =
      true;

    __dccSmartRejectWaiters(
      state,
      state.failure
    );

    throw error;
  } finally {
    state.cancelled =
      true;

    __dccSmartRejectWaiters(
      state,
      state.failure ||
        new Error(
          "smartDispatcher finished."
        )
    );

    await __dccSmartCleanup(
      state
    );

    if (monitorPromise) {
      monitorPromise.catch(
        () => {}
      );
    }

    if (callbackPromise) {
      callbackPromise.catch(
        () => {}
      );
    }

    __dccSmartLog(
      "INFO",
      "cleanup finished",
      {
        loco:
          state.loco,
        completed:
          state.completed,
        failed:
          Boolean(
            state.failure
          ),
      }
    );
  }
};

`;
}
