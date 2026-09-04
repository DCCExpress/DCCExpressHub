import type { Loco } from "@domain/types";
import type { BlockElementView } from "../../models/editor/elements/BlockElementView";
import { wsApi } from "../../services/wsApi";
import LocoPicker from "../loco/LocoPicker";

export type TrackCanvasBlockLocoPickerProps = {
  opened: boolean;
  locos: Loco[];
  selectedBlock: BlockElementView | null;
  onClose: () => void;
};

export function TrackCanvasBlockLocoPicker({ opened, locos, selectedBlock, onClose }: TrackCanvasBlockLocoPickerProps) {
  const selectedLocoId = selectedBlock?.locoAddress
    ? locos.find(loco => loco.address === selectedBlock.locoAddress)?.id || ""
    : "";

  return (
    <LocoPicker
      opened={opened}
      locos={locos}
      selectedLocoId={selectedLocoId}
      title={selectedBlock?.name && selectedBlock.name !== "element"
        ? `Block: ${selectedBlock.name}`
        : "Assign locomotive to block"}
      onClose={onClose}
      onSelect={loco => {
        if (!selectedBlock) return;
        // WS compatibility boundary remains a decimal string. The layout model
        // itself keeps a numeric uint16-style ID.
        wsApi.setBlock(String(selectedBlock.id), loco.id, loco.address);
        onClose();
      }}
      onRemoveLoco={() => {
        if (!selectedBlock) return;
        const locoId = locos.find(loco => loco.address === selectedBlock.locoAddress)?.id || "";
        wsApi.setBlockRemove(String(selectedBlock.id), locoId);
        onClose();
      }}
    />
  );
}
