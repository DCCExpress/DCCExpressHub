import {
  Badge,
  Stack,
  Table,
  Text,
} from "@mantine/core";

import type {
  DebugLayoutOwner,
} from "./useRuntimeDebugState";

type Props = {
  owners: DebugLayoutOwner[];
};

export default function DebugLayoutOwnerCells({
  owners,
}: Props) {
  return (
    <>
      <Table.Td>
        {owners.length ? (
          <Stack gap={2}>
            {owners.map((owner, index) => (
              <Badge
                key={`${owner.type}:${owner.name}:${index}`}
                variant="light"
                color="blue"
                size="sm"
              >
                {owner.type}
              </Badge>
            ))}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">—</Text>
        )}
      </Table.Td>

      <Table.Td>
        {owners.length ? (
          <Stack gap={2}>
            {owners.map((owner, index) => (
              <Text
                key={`${owner.type}:${owner.name}:${index}`}
                size="sm"
              >
                {owner.name}
              </Text>
            ))}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">—</Text>
        )}
      </Table.Td>
    </>
  );
}
