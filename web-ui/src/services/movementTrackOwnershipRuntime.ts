type Listener =
  () => void;

const ownersByElementId =
  new Map<
    number,
    string
  >();

const elementsByOwnerId =
  new Map<
    string,
    Set<number>
  >();

const listeners =
  new Set<
    Listener
  >();

function emit(): void {
  for (
    const listener of
    listeners
  ) {
    listener();
  }
}

export function setMovementTrackOwnership(
  ownerId: string,
  elementIds:
    readonly number[]
): void {
  clearMovementTrackOwnership(
    ownerId,
    false
  );

  const owned =
    new Set<number>();

  for (
    const rawId of
    elementIds
  ) {
    const elementId =
      Math.trunc(
        Number(
          rawId
        )
      );

    if (
      !Number.isInteger(
        elementId
      ) ||
      elementId <= 0
    ) {
      continue;
    }

    ownersByElementId.set(
      elementId,
      ownerId
    );

    owned.add(
      elementId
    );
  }

  if (
    owned.size >
      0
  ) {
    elementsByOwnerId.set(
      ownerId,
      owned
    );
  }

  emit();
}

export function clearMovementTrackOwnership(
  ownerId: string,
  notify = true
): void {
  const owned =
    elementsByOwnerId.get(
      ownerId
    );

  if (
    !owned
  ) {
    return;
  }

  for (
    const elementId of
    owned
  ) {
    if (
      ownersByElementId.get(
        elementId
      ) ===
        ownerId
    ) {
      ownersByElementId.delete(
        elementId
      );
    }
  }

  elementsByOwnerId.delete(
    ownerId
  );

  if (
    notify
  ) {
    emit();
  }
}

export function isMovementTrackOwned(
  elementId: number
): boolean {
  return ownersByElementId.has(
    elementId
  );
}

export function subscribeMovementTrackOwnership(
  listener:
    Listener
): () => void {
  listeners.add(
    listener
  );

  return () => {
    listeners.delete(
      listener
    );
  };
}
