import { useMemo } from "react";
import { Button, Group, Stack, Text } from "@mantine/core";
import AppModal from "@/components/common/AppModal";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import { ensureClientRouteGraph } from "@/services/clientRouteGraphCache";
import StationRoutesTab from "./StationRoutesTab";

type Props = {
  layout: LayoutView;
  editingRouteId: string | null;
  onClose: () => void;
  onSave: () => Promise<void>;
  onChanged: () => void;
};

/**
 * Standalone Station Route editor owned by the Movement / Station Routes tab.
 * Route Network no longer contains a nested station-route editor.
 */
export default function StationRouteEditorDialog({
  layout, editingRouteId, onClose, onSave, onChanged,
}: Props) {
  const result = useMemo(() => {
    if (editingRouteId === null) return null;
    try {
      return { graph: ensureClientRouteGraph(layout).result.graph, error: null };
    } catch (cause) {
      return {
        graph: null,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }, [layout, editingRouteId]);

  return (
    <>
      {result?.graph && (
        <StationRoutesTab
          layout={layout}
          graph={result.graph}
          editingRouteId={editingRouteId}
          editorOnly
          onSave={onSave}
          onChanged={onChanged}
          onDismiss={onClose}
        />
      )}
      <AppModal opened={editingRouteId !== null && !!result?.error}
        onClose={onClose} title="Station Route Editor" centered draggable size="sm">
        <Stack gap="sm">
          <Text size="sm" c="red">{result?.error}</Text>
          <Group justify="flex-end"><Button onClick={onClose}>Close</Button></Group>
        </Stack>
      </AppModal>
    </>
  );
}
