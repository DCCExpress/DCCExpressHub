import type { Loco } from "@domain/types";
import type { BlockElementView } from "../../models/editor/elements/BlockElementView";
import {
  clearOptimisticBlockTargetLoco,
} from "../../services/blockTargetLocoRuntime";
import { wsApi } from "../../services/wsApi";
import LocoPicker from "../loco/LocoPicker";

export type TrackCanvasBlockLocoPickerProps = {
  opened: boolean;
  locos: Loco[];
  selectedBlock: BlockElementView | null;
  onClose: () => void;
};

export function TrackCanvasBlockLocoPicker({
  opened,
  locos,
  selectedBlock,
  onClose,
}: TrackCanvasBlockLocoPickerProps) {
  const selectedLocoId = selectedBlock?.locoAddress
    ? locos.find(
        loco =>
          loco.address ===
          selectedBlock.locoAddress
      )?.id || ""
    : "";

  return (
    <LocoPicker
      opened={opened}
      locos={locos}
      selectedLocoId={selectedLocoId}
      title={
        selectedBlock?.name &&
        selectedBlock.name !== "element"
          ? `Block: ${selectedBlock.name}`
          : "Assign locomotive to block"
      }
      onClose={onClose}
      onSelect={loco => {
        if (!selectedBlock) {
          return;
        }

        const blockId =
          String(
            selectedBlock.id
          );

        /*
         * A manual locomotive assignment replaces every temporary target
         * state for this block.
         */
        clearOptimisticBlockTargetLoco(
          blockId
        );

        selectedBlock.runtimeTransitLocoAddress =
          0;

        // WS compatibility boundary remains a decimal string. The layout model
        // itself keeps a numeric uint16-style ID.
        wsApi.setBlock(
          blockId,
          loco.id,
          loco.address
        );

        onClose();
      }}
      onRemoveLoco={() => {
        if (!selectedBlock) {
          return;
        }

        const blockId =
          String(
            selectedBlock.id
          );

        /*
         * Manual "remove locomotive" means EMPTY THIS BLOCK.
         *
         * Do not send a resolved locoId here. The picker can be opened while
         * the local locomotive list and Hub runtime snapshot are briefly out
         * of sync, and then the resolved ID may be empty/stale.
         *
         * null tells the Hub to clear the block unconditionally. This also
         * clears a target-loco marker if that is what remained in the central
         * block runtime.
         */
        wsApi.setBlockRemove(
          blockId,
          null
        );

        /*
         * Also clear the browser-side target cache immediately. The Hub's
         * following blockStateChanged broadcast remains authoritative and
         * synchronizes every connected client.
         */
        clearOptimisticBlockTargetLoco(
          blockId
        );

        selectedBlock.locoAddress =
          0;

        selectedBlock.runtimeTransitLocoAddress =
          0;

        onClose();
      }}
    />
  );
}
