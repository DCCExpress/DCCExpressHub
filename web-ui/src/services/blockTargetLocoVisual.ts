import {
  BlockElementView,
} from "@/models/editor/elements/BlockElementView";

import type {
  DrawOptions,
} from "@/models/editor/types/EditorTypes";

import {
  getBlockTargetLocoAddress,
  installBlockTargetLocoRuntime,
} from "./blockTargetLocoRuntime";

let installed =
  false;

export function installBlockTargetLocoVisual(): void {
  if (
    installed
  ) {
    return;
  }

  installed =
    true;

  installBlockTargetLocoRuntime();

  const originalDraw =
    BlockElementView.prototype.draw;

  BlockElementView.prototype.draw =
    function (
      this: BlockElementView,
      ctx: CanvasRenderingContext2D,
      options?: DrawOptions
    ): void {
      const previousTransit =
        this.runtimeTransitLocoAddress;

      const targetAddress =
        getBlockTargetLocoAddress(
          this.id
        );

      /*
       * Reuse the block renderer's existing yellow "in transit" state.
       * Real occupancy always wins and remains red.
       */
      if (
        this.locoAddress <= 0 &&
        targetAddress > 0
      ) {
        this.runtimeTransitLocoAddress =
          targetAddress;
      }

      try {
        originalDraw.call(
          this,
          ctx,
          options
        );
      } finally {
        this.runtimeTransitLocoAddress =
          previousTransit;
      }
    };
}
