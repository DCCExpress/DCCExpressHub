import { showNotification } from "@mantine/notifications";
import i18next from "i18next";
import { useTranslation } from "react-i18next";

import type { Loco } from "@domain/types";
import type { BlockElement } from "../../models/editor/elements/BlockElement";
import {
  clearOptimisticBlockTargetLoco,
} from "../../services/blockTargetLocoRuntime";
import { wsApi } from "../../services/wsApi";
import LocoPicker from "../loco/LocoPicker";

export type TrackCanvasBlockLocoPickerProps = {
  opened: boolean;
  locos: Loco[];
  selectedBlock: BlockElement | null;
  onClose: () => void;
};

function showDisconnectedNotification(): void {
  showNotification({
    color: "red",
    title: "WebSocket",
    message: i18next.t(
      "ui.wsLost"
    ),
  });
}

export function TrackCanvasBlockLocoPicker({
  opened,
  locos,
  selectedBlock,
  onClose,
}: TrackCanvasBlockLocoPickerProps) {
  useTranslation();

  const selectedLocoId =
    selectedBlock?.locoAddress
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
          ? i18next.t(
              "ui.block",
              {
                value1:
                  selectedBlock.name,
              }
            )
          : i18next.t(
              "ui.assignLocomotiveToBlock"
            )
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
         * Do not destroy the local visual target state until the command is
         * actually queued to the WebSocket. Previously the picker closed even
         * when wsClient.send() returned false, which made a failed assignment
         * look like a successful click.
         */
        const sent =
          wsApi.setBlock(
            blockId,
            loco.id,
            loco.address
          );

        if (!sent) {
          showDisconnectedNotification();
          return;
        }

        /*
         * A manual locomotive assignment replaces every temporary target state
         * for this block.
         */
        clearOptimisticBlockTargetLoco(
          blockId
        );

        selectedBlock.runtimeTransitLocoAddress =
          0;

        /*
         * The Hub's blockStateChanged broadcast is authoritative. Request a
         * snapshot as well so a missed/delayed broadcast cannot leave the
         * canvas stale. WebSocket frames are ordered, therefore getBlocks is
         * processed after the setBlock command.
         */
        wsApi.getBlocks();

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
         * null means EMPTY THIS BLOCK unconditionally. Do not depend on a
         * possibly stale locally resolved locoId.
         */
        const sent =
          wsApi.setBlockRemove(
            blockId,
            null
          );

        if (!sent) {
          showDisconnectedNotification();
          return;
        }

        clearOptimisticBlockTargetLoco(
          blockId
        );

        selectedBlock.locoAddress =
          0;

        selectedBlock.runtimeTransitLocoAddress =
          0;

        /*
         * Ask the Hub for its final authoritative state. This also corrects
         * the optimistic local clear if the Hub rejects the operation.
         */
        wsApi.getBlocks();

        onClose();
      }}
    />
  );
}
