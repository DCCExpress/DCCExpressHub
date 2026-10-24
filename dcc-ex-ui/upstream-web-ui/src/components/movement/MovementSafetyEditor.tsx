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

import {
  useMovementTranslation,
} from "./movementI18n";

type Props = {
  targetName:
    string | null;
  targetSensor:
    number | null;
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
  targetSensor,
  sensors,
  ignoredSensors,
  sensorCatalog,
  onIgnoredSensorsChange,
}: Props) {
  const mt =
    useMovementTranslation();

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
        {mt("movementNoNextLegSafety")}
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
          {
            mt(
              "movementSafetySensorsTo",
              {
                target:
                  targetName,
              }
            )
          }
        </Text>

        <Text
          size="xs"
          c="dimmed"
          mt={2}
        >
          {mt("movementSafetyHelp")}
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
              {mt("movementNoPhysicalSafetySensors")}
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
                            address ===
                              targetSensor &&
                            targetName !==
                              null
                              ? mt("movementSafetyTargetOccupancy", { address, target: targetName })
                              : (
                                  option?.label ??
                                  mt("movementSafetySensor", { address })
                                )
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
                              ? mt("movementSafetyRequiredOff")
                              : mt("movementSafetyIgnored")
                          }
                        </Badge>
                      </Group>

                      <Switch
                        checked={
                          checked
                        }
                        label={mt("movementCheckSensor")}
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
