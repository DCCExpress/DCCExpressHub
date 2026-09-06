import {
  wsClient,
} from "./wsClient";

export const BLOCK_TARGET_LOCO_PREFIX =
  "__dcc_target_loco__:";

type BlockStateSnapshot =
  Record<
    string,
    {
      blockId?: string;
      locoId?: string | null;
      locoAddress?: number;
    }
  >;

export type BlockTargetLocoState = {
  blockId: string;
  locoAddress: number;
  ownerId: string;
  marker: string;
};

const targets =
  new Map<string, BlockTargetLocoState>();

let installed =
  false;

export function createBlockTargetLocoMarker(
  locoAddress: number,
  ownerId: string
): string {
  return (
    `${BLOCK_TARGET_LOCO_PREFIX}` +
    `${locoAddress}:` +
    encodeURIComponent(ownerId)
  );
}

export function parseBlockTargetLocoMarker(
  value: unknown
): BlockTargetLocoState | null {
  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  if (
    !value.startsWith(
      BLOCK_TARGET_LOCO_PREFIX
    )
  ) {
    return null;
  }

  const payload =
    value.slice(
      BLOCK_TARGET_LOCO_PREFIX.length
    );

  const separator =
    payload.indexOf(":");

  if (
    separator <= 0
  ) {
    return null;
  }

  const address =
    Number(
      payload.slice(
        0,
        separator
      )
    );

  if (
    !Number.isInteger(
      address
    ) ||
    address < 1 ||
    address > 10239
  ) {
    return null;
  }

  let ownerId =
    payload.slice(
      separator + 1
    );

  try {
    ownerId =
      decodeURIComponent(
        ownerId
      );
  } catch {
    // Keep raw owner text if an older marker used no URI encoding.
  }

  return {
    blockId: "",
    locoAddress:
      address,
    ownerId,
    marker:
      value,
  };
}

function applySnapshot(
  data: BlockStateSnapshot
): void {
  const next =
    new Map<string, BlockTargetLocoState>();

  for (
    const [
      key,
      state,
    ] of Object.entries(
      data
    )
  ) {
    const blockId =
      String(
        state?.blockId ??
        key
      );

    const target =
      parseBlockTargetLocoMarker(
        state?.locoId
      );

    if (!target) {
      continue;
    }

    next.set(
      blockId,
      {
        ...target,
        blockId,
      }
    );
  }

  targets.clear();

  for (
    const [
      blockId,
      target,
    ] of next
  ) {
    targets.set(
      blockId,
      target
    );
  }
}

export function installBlockTargetLocoRuntime(): void {
  if (
    installed
  ) {
    return;
  }

  installed =
    true;

  wsClient.on<BlockStateSnapshot>(
    "blockStateChanged",
    (data: BlockStateSnapshot) => {
      applySnapshot(
        data
      );
    }
  );
}

export function getBlockTargetLocoAddress(
  blockId: string | number
): number {
  return (
    targets.get(
      String(blockId)
    )?.locoAddress ??
    0
  );
}

export function getBlockTargetLocoMarker(
  blockId: string | number
): string | null {
  return (
    targets.get(
      String(blockId)
    )?.marker ??
    null
  );
}

export function setOptimisticBlockTargetLoco(
  blockId: string | number,
  locoAddress: number,
  ownerId: string,
  marker: string
): void {
  targets.set(
    String(blockId),
    {
      blockId:
        String(blockId),
      locoAddress,
      ownerId,
      marker,
    }
  );
}

export function clearOptimisticBlockTargetLoco(
  blockId: string | number,
  expectedMarker?: string | null
): void {
  const key =
    String(blockId);

  if (
    expectedMarker
  ) {
    const current =
      targets.get(
        key
      );

    if (
      current &&
      current.marker !==
        expectedMarker
    ) {
      return;
    }
  }

  targets.delete(
    key
  );
}

export function getBlockTargetLocoSnapshot():
  Record<string, number> {
  const result:
    Record<string, number> = {};

  for (
    const [
      blockId,
      target,
    ] of targets
  ) {
    result[blockId] =
      target.locoAddress;
  }

  return result;
}
