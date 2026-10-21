import type { LayoutView } from "@/models/editor/core/LayoutView";
import type { MovementDocument, MovementPage } from "@/domain/movement";
import RoutesDialog from "@/components/RoutesDialog";

type Props = {
  opened: boolean;
  onClose: () => void;
  layout: LayoutView;
  movements: MovementDocument;
  editingMovementId: string | null;
  onMovementsChange: (document: MovementDocument) => void;
  onPersistRouteTopology?: () => Promise<void>;
  initialRoute?: Pick<MovementPage, "name" | "speed" | "routeRef"> | null;
  onSelectRoute?: (page: MovementPage) => void;
};

/** Standalone route selector for Movement New/Edit and Timetable From-To. */
export default function SelectMovementRouteDialog(props: Props) {
  return <RoutesDialog {...props} mode="movement" />;
}
