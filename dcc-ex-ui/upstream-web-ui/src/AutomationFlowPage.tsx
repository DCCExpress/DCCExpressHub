import type {
  AutomationFlowDocument,
} from "./domain/automationFlow";

import AutomationFlowDialog from "./components/automation/AutomationFlowDialog";

type AutomationFlowPageProps = {
  document:
    AutomationFlowDocument;
  onDocumentChange: (
    document:
      AutomationFlowDocument
  ) => void;
  onBack: () => void;
};

export default function AutomationFlowPage({
  document,
  onDocumentChange,
  onBack,
}: AutomationFlowPageProps) {
  return (
    <AutomationFlowDialog
      opened
      initialPageId={
        document.activePageId
      }
      onSaved={
        onDocumentChange
      }
      onClose={
        onBack
      }
    />
  );
}
