import { useEffect, useState } from "react";
import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import AppModal from "../common/AppModal";
import {
  subscribeMovementStartRejections,
  type MovementStartRejection,
} from "../../services/movementEngine";

/**
 * The server is authoritative for start-time sensor checks. Show its
 * rejection reason regardless of which UI started the Movement.
 */
export default function MovementStartErrorDialog() {
  const [failure, setFailure] = useState<MovementStartRejection | null>(null);

  useEffect(() => subscribeMovementStartRejections(setFailure), []);

  return (
    <AppModal
      opened={failure !== null}
      onClose={() => setFailure(null)}
      title="Movement start blocked"
      centered
      draggable
      closeOnClickOutside={false}
      size="md"
      zIndex={1100}
    >
      {failure && (
        <Stack gap="md">
          <Alert color="red" title="Safety validation failed" icon={<IconAlertTriangle size={20} />}>
            <Text size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {failure.message}
            </Text>
          </Alert>
          <Text size="sm" fw={600}>{failure.movementName}</Text>
          <Text size="sm" c="dimmed">
            No train movement was started. Verify the named block's occupancy
            sensor address in the layout and its live state in Debug / Sensors.
            After power-on or reconnect, wait for a fresh sensor report before retrying.
          </Text>
          <Group justify="flex-end">
            <Button color="red" onClick={() => setFailure(null)}>OK</Button>
          </Group>
        </Stack>
      )}
    </AppModal>
  );
}
