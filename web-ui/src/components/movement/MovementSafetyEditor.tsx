import {
  Badge,
  Card,
  Group,
  Stack,
  Switch,
  Text,
} from "@mantine/core";

import type {
  AutomationSensorOption,
} from "../../services/automationSensorCatalog";

type Props = {
  targetName:
    string | null;
  sensors:
    number[];
  ignoredSensors:
    number[];
  sensorCatalog:
    AutomationSensorOption[];
  onIgnoredSensorsChange: (
    sensors:
      number[]
  ) => void;
};

export default function MovementSafetyEditor({
  targetName,
  sensors,
  ignoredSensors,
  sensorCatalog,
  onIgnoredSensorsChange,
}: Props) {
  const ignored =
    new Set(
      ignoredSensors
    );

  const setChecked =
    (
      address: number,
      checked: boolean
    ): void => {
      const next =
        new Set(
          ignoredSensors
        );

      if (checked) {
        next.delete(
          address
        );
      } else {
        next.add(
          address
        );
      }

      onIgnoredSensorsChange(
        [
          ...next,
        ].sort(
          (
            left,
            right
          ) =>
            left -
            right
        )
      );
    };

  if (
    targetName ===
      null
  ) {
    return (
      <Text
        size="sm"
        c="dimmed"
      >
        This resource has no next movement leg, so there are no departure safety sensors to configure.
      </Text>
    );
  }

  return (
    <Stack
      gap="sm"
    >
      <div>
        <Text
          size="sm"
          fw={700}
        >
          Safety sensors → {
            targetName
          }
        </Text>

        <Text
          size="xs"
          c="dimmed"
          mt={2}
        >
          Checked sensors must be known and OFF before this movement leg may start. Disable Check sensor only for detectors that are intentionally allowed to remain occupied by this train.
        </Text>
      </div>

      {
        sensors.length ===
          0
          ? (
            <Text
              size="sm"
              c="dimmed"
            >
              No physical safety sensors are used for this leg.
            </Text>
          )
          : sensors.map(
              address => {
                const option =
                  sensorCatalog.find(
                    sensor =>
                      sensor.address ===
                        address
                  );

                const checked =
                  !ignored.has(
                    address
                  );

                return (
                  <Card
                    key={
                      address
                    }
                    withBorder
                    p="sm"
                  >
                    <Group
                      justify="space-between"
                      align="center"
                      wrap="wrap"
                      gap="sm"
                    >
                      <Group
                        gap="xs"
                        wrap="wrap"
                      >
                        <Text
                          size="sm"
                          fw={700}
                        >
                          {
                            option?.label ??
                            `Sensor ${address}`
                          }
                        </Text>

                        <Badge
                          size="sm"
                          variant="light"
                          color={
                            checked
                              ? "teal"
                              : "gray"
                          }
                        >
                          {
                            checked
                              ? "REQUIRED OFF"
                              : "IGNORED"
                          }
                        </Badge>
                      </Group>

                      <Switch
                        checked={
                          checked
                        }
                        label="Check sensor"
                        onChange={
                          event =>
                            setChecked(
                              address,
                              event.currentTarget.checked
                            )
                        }
                      />
                    </Group>
                  </Card>
                );
              }
            )
      }
    </Stack>
  );
}
