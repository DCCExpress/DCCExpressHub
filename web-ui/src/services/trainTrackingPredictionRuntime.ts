export type TrainTrackingPrediction = {
  blockId: number;
  blockName: string | null;
  locoAddress: number;
};

type Listener = () => void;

const predictionsByBlock =
  new Map<number, TrainTrackingPrediction>();

const listeners =
  new Set<Listener>();

function emit(): void {
  for (
    const listener of
    listeners
  ) {
    listener();
  }
}

export function replaceTrainTrackingPredictions(
  predictions:
    TrainTrackingPrediction[]
): void {
  const next =
    new Map<number, TrainTrackingPrediction>();

  for (
    const prediction of
    predictions
  ) {
    if (
      !Number.isInteger(
        prediction.blockId
      ) ||
      prediction.blockId <=
        0 ||
      !Number.isInteger(
        prediction.locoAddress
      ) ||
      prediction.locoAddress <=
        0
    ) {
      continue;
    }

    /*
     * Do not guess if two locomotives predict the same block. Removing the
     * visual marker is safer than showing an arbitrary winner.
     */
    if (
      next.has(
        prediction.blockId
      )
    ) {
      next.delete(
        prediction.blockId
      );

      continue;
    }

    next.set(
      prediction.blockId,
      {
        ...prediction,
      }
    );
  }

  let changed =
    predictionsByBlock.size !==
      next.size;

  if (!changed) {
    for (
      const [
        blockId,
        prediction,
      ] of next
    ) {
      const current =
        predictionsByBlock.get(
          blockId
        );

      if (
        !current ||
        current.locoAddress !==
          prediction.locoAddress ||
        current.blockName !==
          prediction.blockName
      ) {
        changed =
          true;

        break;
      }
    }
  }

  if (!changed) {
    return;
  }

  predictionsByBlock.clear();

  for (
    const [
      blockId,
      prediction,
    ] of next
  ) {
    predictionsByBlock.set(
      blockId,
      prediction
    );
  }

  emit();
}

export function clearTrainTrackingPredictions(): void {
  if (
    predictionsByBlock.size ===
      0
  ) {
    return;
  }

  predictionsByBlock.clear();
  emit();
}

export function getTrainTrackingPredictionForBlock(
  blockId: number
): TrainTrackingPrediction | null {
  const prediction =
    predictionsByBlock.get(
      blockId
    );

  return prediction
    ? {
        ...prediction,
      }
    : null;
}

export function hasTrainTrackingPredictions(): boolean {
  return (
    predictionsByBlock.size >
    0
  );
}

export function subscribeTrainTrackingPredictions(
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
