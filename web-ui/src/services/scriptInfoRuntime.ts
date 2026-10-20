export type SharedScriptInfo = {
  executionId: string;
  ownerId: string;
  message: string;
};

type ScriptInfoListener = (
  message: string | null
) => void;

const infos =
  new Map<string, SharedScriptInfo>();

const listeners =
  new Map<
    string,
    Set<ScriptInfoListener>
  >();

let installed =
  false;

let source:
  EventSource | null = null;

function emit(
  executionId: string
): void {
  const value =
    infos.get(
      executionId
    )?.message ??
    null;

  for (
    const listener of
    listeners.get(
      executionId
    ) ?? []
  ) {
    listener(
      value
    );
  }
}

function applyChanged(
  value: unknown
): void {
  if (
    typeof value !==
      "object" ||
    value === null
  ) {
    return;
  }

  const item =
    value as Partial<SharedScriptInfo>;

  if (
    typeof item.executionId !==
      "string" ||
    typeof item.ownerId !==
      "string" ||
    typeof item.message !==
      "string"
  ) {
    return;
  }

  if (
    item.message
  ) {
    infos.set(
      item.executionId,
      {
        executionId:
          item.executionId,
        ownerId:
          item.ownerId,
        message:
          item.message,
      }
    );
  } else {
    infos.delete(
      item.executionId
    );
  }

  emit(
    item.executionId
  );
}

function applySnapshot(
  value: unknown
): void {
  if (
    typeof value !==
      "object" ||
    value === null
  ) {
    return;
  }

  const rawItems =
    (
      value as {
        items?: unknown;
      }
    ).items;

  if (
    !Array.isArray(
      rawItems
    )
  ) {
    return;
  }

  const previousIds =
    new Set(
      infos.keys()
    );

  infos.clear();

  for (
    const raw of
    rawItems
  ) {
    if (
      typeof raw !==
        "object" ||
      raw === null
    ) {
      continue;
    }

    const item =
      raw as Partial<SharedScriptInfo>;

    if (
      typeof item.executionId !==
        "string" ||
      typeof item.ownerId !==
        "string" ||
      typeof item.message !==
        "string" ||
      !item.message
    ) {
      continue;
    }

    infos.set(
      item.executionId,
      {
        executionId:
          item.executionId,
        ownerId:
          item.ownerId,
        message:
          item.message,
      }
    );

    previousIds.add(
      item.executionId
    );
  }

  for (
    const executionId of
    previousIds
  ) {
    emit(
      executionId
    );
  }
}

function parseEvent(
  event: MessageEvent<string>
): unknown {
  try {
    return JSON.parse(
      event.data
    ) as unknown;
  } catch {
    return null;
  }
}

export function installScriptInfoRuntime(): void {
  if (
    installed
  ) {
    return;
  }

  installed =
    true;

  source =
    new EventSource(
      "/api/script-info/events"
    );

  source.addEventListener(
    "snapshot",
    event => {
      applySnapshot(
        parseEvent(
          event as MessageEvent<string>
        )
      );
    }
  );

  source.addEventListener(
    "changed",
    event => {
      applyChanged(
        parseEvent(
          event as MessageEvent<string>
        )
      );
    }
  );

  source.onerror =
    () => {
      // EventSource reconnects automatically.
    };
}

export function getSharedScriptInfo(
  executionId: string
): string | null {
  installScriptInfoRuntime();

  return (
    infos.get(
      executionId
    )?.message ??
    null
  );
}

export function subscribeSharedScriptInfo(
  executionId: string,
  listener: ScriptInfoListener
): () => void {
  installScriptInfoRuntime();

  let set =
    listeners.get(
      executionId
    );

  if (!set) {
    set =
      new Set();

    listeners.set(
      executionId,
      set
    );
  }

  set.add(
    listener
  );

  listener(
    getSharedScriptInfo(
      executionId
    )
  );

  return () => {
    set?.delete(
      listener
    );

    if (
      set?.size === 0
    ) {
      listeners.delete(
        executionId
      );
    }
  };
}

async function postInfo(
  executionId: string,
  ownerId: string,
  message: string,
  force = false
): Promise<void> {
  const response =
    await fetch(
      "/api/script-info",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body:
          JSON.stringify({
            executionId,
            ownerId,
            message,
            force,
          }),
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Script info update failed: HTTP ${response.status}`
    );
  }
}

export function setSharedScriptInfo(
  executionId: string,
  ownerId: string,
  message: string
): void {
  const normalized =
    String(message);

  if (
    normalized
  ) {
    infos.set(
      executionId,
      {
        executionId,
        ownerId,
        message:
          normalized,
      }
    );
  } else {
    infos.delete(
      executionId
    );
  }

  emit(
    executionId
  );

  void postInfo(
    executionId,
    ownerId,
    normalized
  ).catch(
    error => {
      console.warn(
        "[ScriptInfo] update failed:",
        error
      );
    }
  );
}

export function clearSharedScriptInfo(
  executionId: string,
  ownerId: string
): void {
  const current =
    infos.get(
      executionId
    );

  if (
    !current ||
    current.ownerId ===
      ownerId
  ) {
    infos.delete(
      executionId
    );

    emit(
      executionId
    );
  }

  void postInfo(
    executionId,
    ownerId,
    ""
  ).catch(
    error => {
      console.warn(
        "[ScriptInfo] clear failed:",
        error
      );
    }
  );
}

export function claimSharedScriptInfo(
  executionId: string,
  ownerId: string
): void {
  infos.delete(
    executionId
  );

  emit(
    executionId
  );

  void postInfo(
    executionId,
    ownerId,
    "",
    true
  ).catch(
    error => {
      console.warn(
        "[ScriptInfo] claim failed:",
        error
      );
    }
  );
}
