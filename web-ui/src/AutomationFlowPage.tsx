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
      standalone
      opened
      initialPageId={
        new URLSearchParams(window.location.search).get("flowPageId") || document.activePageId
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
