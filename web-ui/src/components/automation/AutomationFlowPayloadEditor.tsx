import {
  Alert,
  Select,
  Stack,
  TextInput,
  Textarea,
} from "@mantine/core";

import i18next from "i18next";

import type {
  AutomationFlowNodeData,
} from "../../domain/automationFlow";

type TriggerPayloadType =
  NonNullable<
    AutomationFlowNodeData["triggerPayloadType"]
  >;

type Props = {
  type: TriggerPayloadType;
  value: string;
  onChange: (
    patch: Pick<
      AutomationFlowNodeData,
      | "triggerPayloadType"
      | "triggerPayloadValue"
    >
  ) => void;
};

function t(
  key: string,
  fallback: string
): string {
  return i18next.t(
    key,
    {
      defaultValue:
        fallback,
    }
  );
}

function jsonError(
  value: string
): string | null {
  try {
    JSON.parse(
      value
    );
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : String(error);
  }
}

export default function AutomationFlowPayloadEditor({
  type,
  value,
  onChange,
}: Props) {
  const error =
    type === "json"
      ? jsonError(
          value
        )
      : null;

  const changeType =
    (
      next:
        string |
        null
    ): void => {
      const normalized:
        TriggerPayloadType =
        next === "string" ||
        next === "number" ||
        next === "boolean" ||
        next === "null" ||
        next === "timestamp"
          ? next
          : "json";

      let nextValue =
        value;

      if (
        normalized ===
          "json" &&
        !nextValue.trim()
      ) {
        nextValue =
          "{}";
      }

      if (
        normalized ===
          "boolean" &&
        nextValue !==
          "true" &&
        nextValue !==
          "false"
      ) {
        nextValue =
          "true";
      }

      onChange({
        triggerPayloadType:
          normalized,
        triggerPayloadValue:
          nextValue,
      });
    };

  return (
    <Stack gap="xs">
      <Select
        label={
          t(
            "ui.flowPayloadType",
            "Payload type"
          )
        }
        value={
          type
        }
        data={[
          {
            value:
              "json",
            label:
              "JSON",
          },
          {
            value:
              "string",
            label:
              t(
                "ui.flowPayloadString",
                "String"
              ),
          },
          {
            value:
              "number",
            label:
              t(
                "ui.flowPayloadNumber",
                "Number"
              ),
          },
          {
            value:
              "boolean",
            label:
              t(
                "ui.flowPayloadBoolean",
                "Boolean"
              ),
          },
          {
            value:
              "null",
            label:
              "null",
          },
          {
            value:
              "timestamp",
            label:
              t(
                "ui.flowPayloadTimestamp",
                "Timestamp"
              ),
          },
        ]}
        allowDeselect={
          false
        }
        onChange={
          changeType
        }
      />

      {type ===
        "json" && (
        <>
          <Textarea
            label="payload"
            description={
              t(
                "ui.flowPayloadJsonDescription",
                "JSON value passed to every downstream node."
              )
            }
            value={
              value
            }
            autosize
            minRows={5}
            maxRows={14}
            {...(
              error
                ? {
                    error,
                  }
                : {}
            )}
            styles={{
              input: {
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              },
            }}
            onChange={
              event =>
                onChange({
                  triggerPayloadType:
                    type,
                  triggerPayloadValue:
                    event.currentTarget
                      .value,
                })
            }
          />

          {!error && (
            <Alert
              color="teal"
              py="xs"
            >
              {
                t(
                  "ui.flowPayloadPassThrough",
                  "This payload is passed unchanged to the next node."
                )
              }
            </Alert>
          )}
        </>
      )}

      {type ===
        "string" && (
        <TextInput
          label="payload"
          value={
            value
          }
          onChange={
            event =>
              onChange({
                triggerPayloadType:
                  type,
                triggerPayloadValue:
                  event.currentTarget
                    .value,
              })
          }
        />
      )}

      {type ===
        "number" && (
        <TextInput
          label="payload"
          value={
            value
          }
          inputMode="decimal"
          onChange={
            event =>
              onChange({
                triggerPayloadType:
                  type,
                triggerPayloadValue:
                  event.currentTarget
                    .value,
              })
          }
        />
      )}

      {type ===
        "boolean" && (
        <Select
          label="payload"
          value={
            value ===
            "false"
              ? "false"
              : "true"
          }
          data={[
            {
              value:
                "true",
              label:
                "true",
            },
            {
              value:
                "false",
              label:
                "false",
            },
          ]}
          allowDeselect={
            false
          }
          onChange={
            next =>
              onChange({
                triggerPayloadType:
                  type,
                triggerPayloadValue:
                  next ===
                  "false"
                    ? "false"
                    : "true",
              })
          }
        />
      )}

      {(type ===
        "null" ||
        type ===
          "timestamp") && (
        <Alert
          color="blue"
          py="xs"
        >
          {
            type ===
            "timestamp"
              ? t(
                  "ui.flowPayloadTimestampDescription",
                  "payload will be Date.now() for each trigger."
                )
              : t(
                  "ui.flowPayloadNullDescription",
                  "payload will be null."
                )
          }
        </Alert>
      )}
    </Stack>
  );
}
