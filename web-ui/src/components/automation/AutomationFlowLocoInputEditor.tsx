import {
  ActionIcon,
  Alert,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";

import {
  IconRefresh,
} from "@tabler/icons-react";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import i18next from "i18next";

import type {
  Loco,
} from "@domain/types";

import type {
  AutomationFlowNodeData,
} from "../../domain/automationFlow";

import {
  getLocos,
} from "../../api/domainApi";

type Props = {
  data:
    AutomationFlowNodeData;
  onChange: (
    patch:
      Partial<AutomationFlowNodeData>
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

function locoLabel(
  loco: Loco
): string {
  const name =
    String(
      loco.name ??
      ""
    ).trim();

  return (
    `${name || "Loco"} (#${loco.address})`
  );
}

export default function AutomationFlowLocoInputEditor({
  data,
  onChange,
}: Props) {
  const [
    locos,
    setLocos,
  ] =
    useState<Loco[]>([]);

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState<
      string |
      null
    >(null);

  const load =
    useCallback(
      async () => {
        setLoading(
          true
        );
        setError(
          null
        );

        try {
          setLocos(
            await getLocos()
          );
        } catch (loadError) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : String(loadError)
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      []
    );

  useEffect(
    () => {
      void load();
    },
    [
      load,
    ]
  );

  const selected =
    useMemo(
      () =>
        locos.find(
          loco =>
            loco.address ===
            (
              data.locoAddress ??
              0
            )
        ),
      [
        locos,
        data.locoAddress,
      ]
    );

  useEffect(
    () => {
      if (!selected) {
        return;
      }

      const label =
        locoLabel(
          selected
        );

      if (
        data.locoLabel ===
        label
      ) {
        return;
      }

      onChange({
        locoAddress:
          selected.address,
        locoLabel:
          label,
      });
    },
    [
      selected,
      data.locoLabel,
      onChange,
    ]
  );

  const selectLoco =
    (
      value:
        string |
        null
    ): void => {
      const address =
        Number(
          value ??
          0
        );

      const loco =
        locos.find(
          item =>
            item.address ===
            address
        );

      if (!loco) {
        return;
      }

      onChange({
        locoAddress:
          loco.address,
        locoLabel:
          locoLabel(
            loco
          ),
      });
    };

  return (
    <Stack gap="sm">
      <Group
        align="flex-end"
        gap="xs"
        wrap="nowrap"
      >
        <Select
          label={
            t(
              "ui.flowLocomotive",
              "Locomotive"
            )
          }
          placeholder={
            t(
              "ui.flowSelectLocomotive",
              "Select locomotive"
            )
          }
          value={
            selected
              ? String(
                  selected.address
                )
              : null
          }
          data={
            locos.map(
              loco => ({
                value:
                  String(
                    loco.address
                  ),
                label:
                  locoLabel(
                    loco
                  ),
              })
            )
          }
          searchable
          disabled={
            loading
          }
          onChange={
            selectLoco
          }
          style={{
            flex: 1,
          }}
        />

        <Tooltip
          label={
            t(
              "ui.reload",
              "Reload"
            )
          }
        >
          <ActionIcon
            variant="light"
            mb={1}
            loading={
              loading
            }
            onClick={
              () =>
                void load()
            }
          >
            <IconRefresh
              size={16}
            />
          </ActionIcon>
        </Tooltip>
      </Group>

      {loading &&
        locos.length ===
          0 && (
        <Group gap="xs">
          <Loader
            size="xs"
          />
          <Text
            size="xs"
            c="dimmed"
          >
            {
              t(
                "ui.flowLoadingLocomotives",
                "Loading locomotives..."
              )
            }
          </Text>
        </Group>
      )}

      {error && (
        <Alert
          color="red"
          py="xs"
        >
          {error}
        </Alert>
      )}

      {!loading &&
        !error &&
        locos.length ===
          0 && (
        <Alert
          color="yellow"
          py="xs"
        >
          {
            t(
              "ui.flowNoConfiguredLocomotives",
              "No configured locomotives were found."
            )
          }
        </Alert>
      )}

      {selected && (
        <Text
          size="xs"
          c="dimmed"
        >
          {
            t(
              "ui.flowLocoEventPayloadHint",
              "Any runtime state change for this locomotive starts the connected branch. Event data is passed in payload."
            )
          }
        </Text>
      )}
    </Stack>
  );
}
