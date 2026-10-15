import { showNotification } from "@mantine/notifications";
import i18next from "i18next";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { ActionIcon, Box, Group, Popover, Tooltip } from "@mantine/core";
import { IconRoute, IconTrash, IconTrain } from "@tabler/icons-react";

import type { Loco } from "@domain/types";
import type { BlockElement } from "../../models/editor/elements/BlockElement";
import {
  clearOptimisticBlockTargetLoco,
  getBlockTargetLocoAddress,
} from "../../services/blockTargetLocoRuntime";
import { wsApi } from "../../services/wsApi";
import LocoPicker from "../loco/LocoPicker";

export type TrackCanvasBlockLocoPickerProps = {
  opened: boolean;
  locos: Loco[];
  selectedBlock: BlockElement | null;
  onClose: () => void;
  onBeginBlockSelection?: (loco: Loco) => void;
  blockSelectionActive?: boolean;
  popupX?: number;
  popupY?: number;
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
  onBeginBlockSelection,
  blockSelectionActive = false,
  popupX = 0,
  popupY = 0,
}: TrackCanvasBlockLocoPickerProps) {
  useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => { if (opened) setPickerOpen(false); }, [opened, selectedBlock?.id]);

  /*
   * Actual and target locomotive state are separate.
   *
   * The old picker looked only at selectedBlock.locoAddress. Therefore a
   * target-only block appeared as "empty" to LocoPicker and its Remove button
   * was disabled.
   */
  const targetLocoAddress =
    selectedBlock
      ? getBlockTargetLocoAddress(
          selectedBlock.id
        )
      : 0;

  /*
   * Prefer the real/actual locomotive. If the block has no actual locomotive
   * but does have a target, highlight that target in the list.
   */
  const selectedLocoAddress =
    selectedBlock?.locoAddress &&
    selectedBlock.locoAddress > 0
      ? selectedBlock.locoAddress
      : targetLocoAddress;

  const selectedLocoId =
    selectedLocoAddress > 0
      ? locos.find(
          loco =>
            loco.address ===
            selectedLocoAddress
        )?.id || ""
      : "";

  /*
   * runtimeTransitLocoAddress is included as a visual/runtime fallback. The
   * authoritative target marker normally comes from blockTargetLocoRuntime.
   */
  const canRemoveLoco =
    Boolean(
      selectedBlock &&
      (
        selectedBlock.locoAddress > 0 ||
        targetLocoAddress > 0 ||
        selectedBlock.runtimeTransitLocoAddress > 0
      )
    );

  const removeBlockLoco = () => {
    if (!selectedBlock || !canRemoveLoco) return;
    const blockId = String(selectedBlock.id);
    if (!wsApi.setBlockRemove(blockId, null)) {
      showDisconnectedNotification();
      return;
    }
    clearOptimisticBlockTargetLoco(blockId);
    selectedBlock.locoAddress = 0;
    selectedBlock.runtimeTransitLocoAddress = 0;
    wsApi.getBlocks();
    onClose();
  };

  const routeLoco = locos.find(loco => loco.address === selectedBlock?.locoAddress);
  return (
    <>
    <Popover opened={opened && !pickerOpen && !blockSelectionActive} onChange={value => { if (!value) onClose(); }}
      withinPortal withArrow shadow="xl" zIndex={2100} position="bottom" offset={14} closeOnClickOutside closeOnEscape>
      <Popover.Target>
        <Box style={{ position: "fixed", left: popupX, top: popupY, width: 0, height: 0, pointerEvents: "none" }}/>
      </Popover.Target>
      <Popover.Dropdown p={6} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        <Group gap={5} wrap="nowrap">
          <Tooltip label="Remove locomotive from block">
            <ActionIcon color="red" variant="light" size="lg" disabled={!canRemoveLoco}
              aria-label="Remove locomotive" onClick={removeBlockLoco}><IconTrash size={20}/></ActionIcon>
          </Tooltip>
          <Tooltip label="Select locomotive">
            <ActionIcon color="blue" variant="light" size="lg" aria-label="Select locomotive"
              onClick={() => setPickerOpen(true)}><IconTrain size={20}/></ActionIcon>
          </Tooltip>
          <Tooltip label="Drive to Block">
            <ActionIcon color="teal" variant="light" size="lg" aria-label="Drive to Block"
              disabled={!routeLoco || !onBeginBlockSelection}
              onClick={() => { if (routeLoco && onBeginBlockSelection) { onBeginBlockSelection(routeLoco); onClose(); } }}>
              <IconRoute size={20}/>
            </ActionIcon>
          </Tooltip>
        </Group>
      </Popover.Dropdown>
    </Popover>
    <LocoPicker
      opened={opened && pickerOpen && !blockSelectionActive}
      locos={locos}
      selectedLocoId={selectedLocoId}
      title={
        selectedBlock?.name && selectedBlock.name !== "element"
          ? i18next.t("ui.block", { value1: selectedBlock.name })
          : i18next.t("ui.assignLocomotiveToBlock")
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
    />
    </>
  );
}
