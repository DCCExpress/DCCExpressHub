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
  /*
   * SAFETY RULE:
   *
   * The normal Dispatcher is the authoritative route selector. It already
   * resolves exactly one persisted physical route and validates its complete
   * logical turnout requirement set.
   *
   * SmartDispatcher must NOT reconstruct turnout states again from individual
   * graph edges. A second reconstruction can select a different edge variant
   * or lose a route requirement, which is unacceptable before authorizing
   * train movement.
   *
   * Until route topology persists explicit per-block-transition turnout
   * requirements, every rolling transition uses the authoritative complete
   * turnout state set from the selected Dispatcher route. This may lock/set
   * more turnouts than strictly necessary for a single transition, but it
   * fails safe and guarantees the same physical route as dispatcher().
   */
  const baseRoute =
    await __dccDispatcherFindRoute(
      request.checkpointNames
    );

  const authoritativeTurnouts =
    Object.freeze(
      baseRoute.turnoutStates.map(
        state =>
          Object.freeze({
            address:
              state.address,
            closed:
              state.closed,
          })
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
        arrivedWhen,
        turnoutStates:
          authoritativeTurnouts,
      })
    );
  }

  return Object.freeze({
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
  async (states, setDelayMs, beforeChange) => {
    if (states.length === 0) {
      return Object.freeze({
        acquired: true,
        conflicts: Object.freeze([]),
        async release() {},
      });
    }

    const addresses =
      states.map(state => state.address);

    const ownerId =
      __dccSwitchManOwnerBaseId +
      ":smart-dispatcher:" +
      String(++__dccSmartDispatcherSequence);

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
      if (error && error.code === "turnout_locked") {
        const raw =
          error.details &&
          Array.isArray(error.details.conflicts)
            ? error.details.conflicts
            : [];

        return Object.freeze({
          acquired: false,
          conflicts:
            __dccSwitchManSafeConflicts(raw),
        });
      }

      throw error;
    }

    let released = false;

    const release =
      async () => {
        if (released) {
          return;
        }

        released = true;

        await __dccSwitchManRequest(
          "release",
          ownerId,
          { addresses },
          10000
        );
      };

    try {
      console.info(
        "[SmartDispatcher] authoritative turnout plan",
        states.map(
          state => ({
            address:
              state.address,
            closed:
              state.closed,
          })
        )
      );

      const needsChange =
        states.some(
          state =>
            dcc.getTurnout(state.address) !== state.closed
        );

      if (
        needsChange &&
        typeof beforeChange === "function"
      ) {
        beforeChange();
      }

      for (
        let index = 0;
        index < states.length;
        ++index
      ) {
        const state = states[index];

        if (dcc.getTurnout(state.address) === state.closed) {
          continue;
        }

        await __dccSwitchManRequest(
          "set",
          ownerId,
          {
            address: state.address,
            closed: state.closed,
          },
          15000
        );

        if (
          index + 1 < states.length &&
          setDelayMs > 0
        ) {
          await delay(setDelayMs);
        }
      }

      return Object.freeze({
        acquired: true,
        conflicts: Object.freeze([]),
        release,
      });
    } catch (error) {
      try {
        await release();
      } catch (releaseError) {
        console.error(
          "[SmartDispatcher] turnout release failed after setup error",
          releaseError
        );
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
      console.error(
        "[SmartDispatcher] turnout release failed",
        error
      );
    }

    try {
      await reservation.blockLease.release();
    } catch (error) {
      console.error(
        "[SmartDispatcher] block release failed",
        error
      );
    }
  };

const __dccSmartTryReserve =
  async (state, transition) => {
    const block = transition.to;
    const conflict =
      __dccSmartBlockConflict(block, state.loco);

    if (conflict) {
      return Object.freeze({
        acquired: false,
        conflicts: Object.freeze([conflict]),
      });
    }

    const blockLease =
      await __dccSmartTryBlockLease(block);

    if (!blockLease.acquired) {
      return Object.freeze({
        acquired: false,
        conflicts:
          Object.freeze([blockLease.conflict]),
      });
    }

    let targetSet = false;

    try {
      const lockedConflict =
        __dccSmartBlockConflict(block, state.loco);

      if (lockedConflict) {
        return Object.freeze({
          acquired: false,
          conflicts:
            Object.freeze([lockedConflict]),
          blockLease,
        });
      }

      dcc.setBlockTargetLoco(block.name, state.loco);
      targetSet = true;
      await delay(0);

      if (
        dcc.getBlock(block.name) !== 0 ||
        dcc.getBlockTargetLoco(block.name) !== state.loco ||
        dcc.getSensor(block.sensorAddress) !== false
      ) {
        return Object.freeze({
          acquired: false,
          conflicts:
            Object.freeze([
              Object.freeze({
                type: "block-changed",
                blockId: block.id,
                blockName: block.name,
              }),
            ]),
          clearTarget: true,
          blockLease,
        });
      }

      const turnoutNeedsChange =
        transition.turnoutStates.some(
          item =>
            dcc.getTurnout(item.address) !== item.closed
        );

      if (turnoutNeedsChange) {
        state.motionAuthorized = false;
        __dccSmartApplySpeed(state);
      }

      const turnoutLease =
        await __dccSmartTryTurnoutLease(
          transition.turnoutStates,
          state.options.setDelayMs,
          () => {
            state.motionAuthorized = false;
            __dccSmartApplySpeed(state);
          }
        );

      if (!turnoutLease.acquired) {
        return Object.freeze({
          acquired: false,
          conflicts: turnoutLease.conflicts,
          clearTarget: true,
          blockLease,
        });
      }

      return Object.freeze({
        acquired: true,
        block,
        toIndex: transition.index + 1,
        blockLease,
        turnoutLease,
      });
    } catch (error) {
      if (targetSet) {
        __dccSmartClearTarget(block, state.loco);
      }

      try {
        await blockLease.release();
      } catch (releaseError) {
        console.error(
          "[SmartDispatcher] block release failed after reservation error",
          releaseError
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
    let notified = false;

    while (!state.cancelled) {
      const result =
        await __dccSmartTryReserve(
          state,
          transition
        );

      if (result.acquired) {
        state.reservation = result;
        state.motionAuthorized = true;
        __dccSmartApplySpeed(state);
        __dccSmartResolveWaiters(state);

        setInfo(
          "SmartDispatcher szabad: " +
          transition.from.name +
          " -> " +
          transition.to.name
        );

        return result;
      }

      await __dccSmartDisposeFailedAttempt(
        state,
        transition,
        result
      );

      state.motionAuthorized = false;
      __dccSmartApplySpeed(state);

      if (!notified) {
        notified = true;

        setInfo(
          "SmartDispatcher vár: " +
          transition.from.name +
          " -> " +
          transition.to.name
        );

        if (state.options.onBlocked) {
          await state.options.onBlocked(
            state.loco,
            state.direction,
            result.conflicts
          );
        }
      }

      await delay(state.options.blockPollMs);
    }

    throw (
      state.failure ||
      new Error("smartDispatcher cancelled.")
    );
  };

const __dccSmartWaitForArrival =
  async (state, transition) => {
    while (!state.cancelled) {
      if (
        __dccSmartArrivalSatisfied(
          transition.arrivedWhen
        )
      ) {
        return;
      }

      const actual =
        dcc.getBlock(transition.to.name);
      const target =
        dcc.getBlockTargetLoco(
          transition.to.name
        );

      if (
        actual !== 0 &&
        actual !== state.loco
      ) {
        state.motionAuthorized = false;
        __dccSmartApplySpeed(state);

        throw new Error(
          'smartDispatcher: block "' +
          transition.to.name +
          '" was assigned to another locomotive during movement.'
        );
      }

      if (
        actual === 0 &&
        target !== state.loco
      ) {
        state.motionAuthorized = false;
        __dccSmartApplySpeed(state);

        throw new Error(
          'smartDispatcher: target for block "' +
          transition.to.name +
          '" was lost during movement.'
        );
      }

      await delay(state.options.blockPollMs);
    }

    throw (
      state.failure ||
      new Error("smartDispatcher cancelled.")
    );
  };

const __dccSmartCommitArrival =
  async (state, transition, reservation) => {
    const previousLease = state.currentLease;

    dcc.clearBlock(transition.from.name);
    dcc.clearBlockTargetLoco(transition.to.name);
    dcc.setBlock(transition.to.name, state.loco);
    await delay(0);

    state.currentIndex = reservation.toIndex;
    state.currentLease = reservation.blockLease;
    state.reservation = null;

    __dccSmartResolveWaiters(state);

    try {
      await reservation.turnoutLease.release();
    } catch (error) {
      console.error(
        "[SmartDispatcher] turnout release failed after arrival",
        error
      );
    }

    if (previousLease) {
      try {
        await previousLease.release();
      } catch (error) {
        console.error(
          "[SmartDispatcher] previous block release failed",
          error
        );
      }
    }
  };

const __dccSmartMonitor = async state => {
  while (
    !state.cancelled &&
    state.currentIndex < state.route.blocks.length - 1
  ) {
    const transition =
      state.route.transitions[state.currentIndex];

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
    state.currentIndex === state.route.blocks.length - 1
  ) {
    state.completed = true;
    state.desiredSpeed = 0;
    state.motionAuthorized = false;
    __dccSmartApplySpeed(state);
    __dccSmartResolveWaiters(state);

    setInfo(
      "SmartDispatcher megérkezett: " +
      state.route.toBlockName
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
      console.error(
        "[SmartDispatcher] current block release failed",
        error
      );
    }
  }
};

const smartDispatcher = async (
  blocks,
  callback,
  rawOptions = null
) => {
  if (typeof callback !== "function") {
    throw new Error(
      "smartDispatcher(blocks, callback, options?): callback must be a function."
    );
  }

  const request =
    __dccSmartNormalizeRequest(blocks);
  const options =
    __dccSmartNormalizeOptions(rawOptions);
  const route =
    await __dccSmartBuildRoute(request);

  const loco =
    __dccDispatcherReadSourceLoco(route);

  if (loco === 0) {
    setInfo(
      "Nincs mozdony a kiinduló blokkban: " +
      route.fromBlockName
    );

    if (options.onEmpty) {
      await options.onEmpty(route.direction);

      return Object.freeze({
        status: "empty",
        loco: 0,
        dir: route.direction,
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

  const sourceLease =
    await __dccSmartTryBlockLease(
      route.blocks[0]
    );

  if (!sourceLease.acquired) {
    const conflicts =
      Object.freeze([sourceLease.conflict]);

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
      dir: route.direction,
      conflicts,
    });
  }

  const lockedLoco =
    __dccDispatcherReadSourceLoco(route);

  if (lockedLoco !== loco) {
    await sourceLease.release();

    throw new Error(
      'smartDispatcher: source block "' +
      route.fromBlockName +
      '" changed while locking.'
    );
  }

  const state = {
    route,
    loco,
    direction: route.direction,
    options,
    currentIndex: 0,
    currentLease: sourceLease,
    reservation: null,
    desiredSpeed: 0,
    physicalSpeed: null,
    motionAuthorized: false,
    completed: false,
    cancelled: false,
    failure: null,
    waiters: [],
  };

  __dccSmartApplySpeed(state);

  const run =
    __dccSmartRunApi(state);

  let monitorPromise = null;
  let callbackPromise = null;

  try {
    monitorPromise =
      __dccSmartMonitor(state);

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

    return Object.freeze({
      status: "completed",
      loco,
      dir: route.direction,
      block: route.toBlockName,
    });
  } catch (error) {
    state.failure =
      error instanceof Error
        ? error
        : new Error(String(error));

    state.cancelled = true;
    __dccSmartRejectWaiters(
      state,
      state.failure
    );

    throw error;
  } finally {
    state.cancelled = true;

    __dccSmartRejectWaiters(
      state,
      state.failure ||
        new Error(
          "smartDispatcher finished."
        )
    );

    await __dccSmartCleanup(state);

    if (monitorPromise) {
      monitorPromise.catch(() => {});
    }

    if (callbackPromise) {
      callbackPromise.catch(() => {});
    }
  }
};
`;
}
