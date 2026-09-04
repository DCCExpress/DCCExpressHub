import { Alert, Badge, Button, Card, Group, Loader, ScrollArea, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconCheck, IconRefresh, IconShieldCheck } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { loadSignalLogicRulesWs } from "@/api/signalLogicWsApi";
import AppModal from "@/components/common/AppModal";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import { inspectProjectIntegrity, type IntegrityReport } from "@/services/layoutIntegrity";
import type { Loco } from "@domain/types";

type IntegrityCheckDialogProps = {
  opened: boolean;
  onClose: () => void;
  layout: LayoutView;
  locos: Loco[];
};

export default function IntegrityCheckDialog({ opened, onClose, layout, locos }: IntegrityCheckDialogProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [report, setReport] = useState<IntegrityReport | null>(null);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const signalResult = await loadSignalLogicRulesWs();
      setReport(inspectProjectIntegrity(layout, locos, signalResult.document, signalResult.issues));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLoadError(message);
      setReport(inspectProjectIntegrity(layout, locos, null));
    } finally {
      setLoading(false);
    }
  }, [layout, locos]);

  useEffect(() => {
    if (opened) void runCheck();
  }, [opened, runCheck]);

  const errors = report?.issues.filter(issue => issue.level === "error").length ?? 0;
  const warnings = report?.issues.filter(issue => issue.level === "warning").length ?? 0;

  return (
    <AppModal opened={opened} onClose={onClose} title="Project integrity check" size="lg" centered draggable>
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <IconShieldCheck size={24} />
            <div>
              <Text fw={700}>All project references</Text>
              <Text size="sm" c="dimmed">Layout IDs, route turnouts, automatic routes, signal rules and locomotives.</Text>
            </div>
          </Group>
          <Button variant="light" leftSection={<IconRefresh size={16} />} loading={loading} onClick={() => void runCheck()}>
            Check again
          </Button>
        </Group>

        {loading && !report && <Group gap="xs"><Loader size="sm" /><Text>Checking the complete project…</Text></Group>}
        {loadError && <Alert color="red" icon={<IconAlertTriangle size={16} />}>Signal Logic could not be loaded: {loadError}</Alert>}
        {report && !loading && (
          <Alert color={errors > 0 ? "red" : warnings > 0 ? "yellow" : "green"} icon={errors > 0 ? <IconAlertTriangle size={16} /> : <IconCheck size={16} />}>
            {errors > 0
              ? `Integrity check found ${errors} error(s) and ${warnings} warning(s).`
              : warnings > 0
                ? `No broken references. ${warnings} warning(s) found.`
                : "Integrity check passed. Every checked reference is valid."}
          </Alert>
        )}

        <ScrollArea.Autosize mah="62dvh" offsetScrollbars>
          <Stack gap="xs" pr="xs">
            {report?.areas.map(area => {
              const areaErrors = area.issues.filter(issue => issue.level === "error").length;
              const areaWarnings = area.issues.filter(issue => issue.level === "warning").length;
              return (
                <Card key={area.area} withBorder p="sm">
                  <Group justify="space-between" mb={area.issues.length > 0 ? "xs" : 0}>
                    <Text fw={600}>{area.area}</Text>
                    <Group gap={5}>
                      <Badge variant="light" color="gray">{area.checked} checked</Badge>
                      {areaErrors > 0 && <Badge color="red">{areaErrors} errors</Badge>}
                      {areaWarnings > 0 && <Badge color="yellow">{areaWarnings} warnings</Badge>}
                      {area.issues.length === 0 && <Badge color="green" leftSection={<IconCheck size={11} />}>OK</Badge>}
                    </Group>
                  </Group>
                  {area.issues.length > 0 && (
                    <Stack gap={4}>
                      {area.issues.map((issue, index) => (
                        <Group key={`${issue.message}-${index}`} gap="xs" wrap="nowrap" align="flex-start">
                          <IconAlertTriangle size={15} color={issue.level === "error" ? "var(--mantine-color-red-6)" : "var(--mantine-color-yellow-6)"} style={{ flexShrink: 0, marginTop: 2 }} />
                          <Text size="sm">{issue.message}</Text>
                        </Group>
                      ))}
                    </Stack>
                  )}
                </Card>
              );
            })}
          </Stack>
        </ScrollArea.Autosize>
      </Stack>
    </AppModal>
  );
}
