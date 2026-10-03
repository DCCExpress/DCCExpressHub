import i18next from "i18next";
import { showNotification } from "@mantine/notifications";

import { wsClient } from "./wsClient";

type SwitchManLockInfo = {
  address: number;
  ownerId: string;
  ownerName: string;
  acquiredAtMs?: number;
};

type SwitchManResponseExtra = {
  locks?: SwitchManLockInfo[];
  conflicts?: SwitchManLockInfo[];
  released?: number;
};

type SwitchManResponse = {
  requestId: string;
  action: string;
  ok: boolean;
  message?: string | null;
  extra?: SwitchManResponseExtra | null;
};

export type SwitchManModeState = {
  enabled: boolean;
  ownerId: string;
  ownedAddresses: number[];
};

export type SwitchManTurnoutCommand = {
  address: number;
  closed: boolean;
};

type Listener = (
  state: SwitchManModeState
) => void;

const OWNER_STORAGE_KEY =
  "dcc-express.switchman.owner-id";

let installed = false;
let enabled = false;
let sequence = 0;
let locks: SwitchManLockInfo[] = [];

const listeners =
  new Set<Listener>();

function newOwnerId(): string {
  const token =
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()
          .toString(16)
          .slice(2)}`;

  return `manual-switchman:${token}`;
}

function loadOwnerId(): string {
  if (
    typeof window ===
    "undefined"
  ) {
    return newOwnerId();
  }

  const stored =
    window.sessionStorage.getItem(
      OWNER_STORAGE_KEY
    );

  if (
    stored &&
    stored.startsWith(
      "manual-switchman:"
    )
  ) {
    return stored;
  }

  const next =
    newOwnerId();

  window.sessionStorage.setItem(
    OWNER_STORAGE_KEY,
    next
  );

  return next;
}

let ownerId =
  loadOwnerId();

function regenerateOwnerId(): void {
  ownerId =
    newOwnerId();

  if (
    typeof window !==
    "undefined"
  ) {
    window.sessionStorage.setItem(
      OWNER_STORAGE_KEY,
      ownerId
    );
  }

  emit();
}

function ownerName(): string {
  const suffix =
    ownerId
      .split(":")
      .pop()
      ?.slice(0, 6) ??
    "UI";

  return `Switchman ${suffix}`;
}

function normalizeLocks(
  rawLocks: unknown
): SwitchManLockInfo[] {
  if (
    !Array.isArray(
      rawLocks
    )
  ) {
    return [];
  }

  return rawLocks
    .map(raw => {
      if (
        !raw ||
        typeof raw !==
          "object"
      ) {
        return null;
      }

      const value =
        raw as Partial<SwitchManLockInfo>;

      const address =
        Number(
          value.address
        );

      if (
        !Number.isInteger(
          address
        ) ||
        address <
          1 ||
        address >
          2048 ||
        typeof value.ownerId !==
          "string"
      ) {
        return null;
      }

      return {
        address,
        ownerId:
          value.ownerId,
        ownerName:
          typeof value.ownerName ===
            "string"
            ? value.ownerName
            : value.ownerId,
        ...(
          typeof value.acquiredAtMs ===
            "number"
            ? {
                acquiredAtMs:
                  value.acquiredAtMs,
              }
            : {}
        ),
      };
    })
    .filter(
      (
        value
      ): value is SwitchManLockInfo =>
        value !== null
    );
}

function applyLocks(
  rawLocks: unknown
): void {
  locks =
    normalizeLocks(
      rawLocks
    );

  /*
   * sessionStorage keeps this browser tab's owner id across reloads.
   * If the backend still has locks for that owner, restore Switchman mode
   * instead of showing OFF while this client still owns turnouts.
   */
  if (
    !enabled &&
    locks.some(
      lock =>
        lock.ownerId ===
        ownerId
    )
  ) {
    enabled =
      true;
  }

  emit();
}

function requestId(
  action: string
): string {
  sequence +=
    1;

  return (
    `${ownerId}:${action}:` +
    `${Date.now()}:${sequence}`
  );
}

function sendSnapshot(): void {
  if (
    !wsClient.isConnected()
  ) {
    return;
  }

  wsClient.send({
    type:
      "switchManCommand",
    data: {
      requestId:
        requestId(
          "snapshot"
        ),
      action:
        "snapshot",
    },
  });
}

function install(): void {
  if (
    installed
  ) {
    return;
  }

  installed =
    true;

  wsClient.subscribeMessages(
    message => {
      const raw =
        message as unknown as {
          type?: string;
          data?: {
            action?: string;
            extra?: SwitchManResponseExtra | null;
            locks?: unknown;
          };
        };

      if (
        raw.type ===
        "switchManChanged"
      ) {
        applyLocks(
          raw.data?.locks
        );
        return;
      }

      if (
        raw.type ===
          "switchManResponse" &&
        (
          raw.data?.action ===
            "snapshot" ||
          raw.data?.action ===
            "release"
        ) &&
        raw.data?.extra?.locks
      ) {
        applyLocks(
          raw.data.extra.locks
        );
      }
    }
  );

  wsClient.subscribeStatus(
    status => {
      if (
        status ===
        "connected"
      ) {
        sendSnapshot();
      }
    }
  );

  if (
    wsClient.getStatus() ===
    "connected"
  ) {
    sendSnapshot();
  }
}

function request(
  action: string,
  values:
    Record<string, unknown> =
      {},
  timeoutMs =
    5000
): Promise<SwitchManResponse> {
  install();

  const id =
    requestId(
      action
    );

  return new Promise(
    (
      resolve,
      reject
    ) => {
      let settled =
        false;
      let timer:
        number | null =
        null;

      const finish = (
        callback:
          () => void
      ): void => {
        if (
          settled
        ) {
          return;
        }

        settled =
          true;

        if (
          timer !==
          null
        ) {
          window.clearTimeout(
            timer
          );
        }

        unsubscribe();
        callback();
      };

      const unsubscribe =
        wsClient.subscribeMessages(
          message => {
            const raw =
              message as unknown as {
                type?: string;
                data?: SwitchManResponse;
              };

            if (
              raw.type !==
                "switchManResponse" ||
              raw.data?.requestId !==
                id ||
              raw.data?.action !==
                action
            ) {
              return;
            }

            finish(
              () =>
                resolve(
                  raw.data!
                )
            );
          }
        );

      timer =
        window.setTimeout(
          () => {
            finish(
              () =>
                reject(
                  new Error(
                    i18next.t(
                      "ui.turnoutLockReleaseTimeout"
                    )
                  )
                )
            );
          },
          timeoutMs
        );

      const sent =
        wsClient.send({
          type:
            "switchManCommand",
          data: {
            requestId:
              id,
            action,
            ...values,
          },
        });

      if (
        !sent
      ) {
        finish(
          () =>
            reject(
              new Error(
                i18next.t(
                  "ui.noWebSocketConnection"
                )
              )
            )
        );
      }
    }
  );
}

function emit(): void {
  const snapshot =
    getSwitchManModeState();

  for (
    const listener of
    listeners
  ) {
    listener(
      snapshot
    );
  }
}

function operationErrorMessage(
  response:
    SwitchManResponse,
  commands:
    SwitchManTurnoutCommand[]
): string {
  if (
    response.message ===
    "turnout_locked"
  ) {
    const conflict =
      response.extra?.conflicts?.[0];

    if (
      conflict
    ) {
      return i18next.t(
        "ui.turnoutLockedByOwner",
        {
          value1:
            conflict.address,
          value2:
            conflict.ownerName,
        }
      );
    }

    return i18next.t(
      "ui.turnoutLocked"
    );
  }

  const addresses =
    commands
      .map(
        command =>
          `#${command.address}`
      )
      .join(", ");

  return i18next.t(
    "ui.switchManOperationFailed",
    {
      value1:
        addresses,
      value2:
        response.message ??
        "unknown_error",
    }
  );
}

function showOperationError(
  message: string
): void {
  showNotification({
    color:
      "red",
    title:
      i18next.t(
        "ui.switchManMode"
      ),
    message,
  });
}

export function getSwitchManModeState():
  SwitchManModeState {
  install();

  return {
    enabled,
    ownerId,
    ownedAddresses:
      locks
        .filter(
          lock =>
            lock.ownerId ===
            ownerId
        )
        .map(
          lock =>
            lock.address
        )
        .sort(
          (
            left,
            right
          ) =>
            left -
            right
        ),
  };
}

export function subscribeSwitchManModeState(
  listener:
    Listener
): () => void {
  install();

  listeners.add(
    listener
  );

  listener(
    getSwitchManModeState()
  );

  return () => {
    listeners.delete(
      listener
    );
  };
}

export function isSwitchManModeEnabled():
  boolean {
  install();

  return enabled;
}

export async function setSwitchManModeEnabled(
  value: boolean
): Promise<void> {
  install();

  if (
    value
  ) {
    if (
      !enabled
    ) {
      enabled =
        true;
      emit();
      sendSnapshot();
    }

    return;
  }

  if (
    !enabled
  ) {
    return;
  }

  const response =
    await request(
      "release",
      {
        ownerId,
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      response.message ||
      i18next.t(
        "ui.turnoutLockReleaseFailed"
      )
    );
  }

  if (
    response.extra?.locks
  ) {
    applyLocks(
      response.extra.locks
    );
  }

  enabled =
    false;
  emit();
}

export async function operateSwitchManTurnouts(
  requestedCommands:
    SwitchManTurnoutCommand[]
): Promise<boolean> {
  install();

  if (
    !enabled
  ) {
    return false;
  }

  const commandByAddress =
    new Map<
      number,
      SwitchManTurnoutCommand
    >();

  for (
    const command of
    requestedCommands
  ) {
    if (
      Number.isInteger(
        command.address
      ) &&
      command.address >=
        1 &&
      command.address <=
        2048
    ) {
      commandByAddress.set(
        command.address,
        {
          address:
            command.address,
          closed:
            Boolean(
              command.closed
            ),
        }
      );
    }
  }

  const commands =
    [
      ...commandByAddress.values(),
    ];

  if (
    commands.length ===
    0
  ) {
    return false;
  }

  const acquire =
    async (): Promise<SwitchManResponse> =>
      request(
        "acquire",
        {
          ownerId,
          ownerName:
            ownerName(),
          addresses:
            commands.map(
              command =>
                command.address
            ),
          timeoutMs:
            0,
        }
      );

  try {
    let acquired =
      await acquire();

    if (
      !acquired.ok &&
      acquired.message ===
        "switchman_owner_revoked"
    ) {
      regenerateOwnerId();
      acquired =
        await acquire();
    }

    if (
      !acquired.ok
    ) {
      showOperationError(
        operationErrorMessage(
          acquired,
          commands
        )
      );
      return false;
    }

    for (
      const command of
      commands
    ) {
      const response =
        await request(
          "set",
          {
            ownerId,
            address:
              command.address,
            closed:
              command.closed,
          }
        );

      if (
        !response.ok
      ) {
        showOperationError(
          operationErrorMessage(
            response,
            [
              command,
            ]
          )
        );
        return false;
      }
    }

    return true;
  } catch (
    error
  ) {
    showOperationError(
      error instanceof Error
        ? error.message
        : String(
            error
          )
    );
    return false;
  }
}

install();
