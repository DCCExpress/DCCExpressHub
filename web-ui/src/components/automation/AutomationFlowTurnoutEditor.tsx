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
  AutomationFlowNodeData,
} from "../../domain/automationFlow";

import {
  loadAutomationTurnoutCatalog,
  type AutomationTurnoutOption,
} from "../../services/automationTurnoutCatalog";

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

export default function AutomationFlowTurnoutEditor({
  data,
  onChange,
}: Props) {
  const [
    catalog,
    setCatalog,
  ] =
    useState<
      AutomationTurnoutOption[]
    >([]);

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
          setCatalog(
            await loadAutomationTurnoutCatalog()
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
        catalog.find(
          option =>
            option.id ===
            (
              data.turnoutElementId ??
              0
            )
        ),
      [
        catalog,
        data.turnoutElementId,
      ]
    );

  useEffect(
    () => {
      if (
        catalog.length ===
          0 ||
        data.turnoutElementId
      ) {
        return;
      }

      const legacyAddress =
        data.turnoutAddress ??
        0;

      const legacy =
        catalog.find(
          option =>
            option.addresses.includes(
              legacyAddress
            )
        );

      if (!legacy) {
        return;
      }

      const state =
        legacy.states.find(
          option =>
            option.commands.length ===
              1 &&
            option.commands[0]?.closed ===
              (
                data.turnoutClosed !==
                false
              )
        ) ??
        legacy.states[0];

      if (!state) {
        return;
      }

      onChange({
        turnoutElementId:
          legacy.id,
        turnoutLabel:
          legacy.label,
        turnoutStateKey:
          state.value,
        turnoutStateLabel:
          state.label,
        turnoutCommands:
          state.commands.map(
            command => ({
              ...command,
            })
          ),
      });
    },
    [
      catalog,
      data.turnoutAddress,
      data.turnoutClosed,
      data.turnoutElementId,
      onChange,
    ]
  );

  const selectTurnout =
    (
      value:
        string |
        null
    ): void => {
      const id =
        Number(
          value ??
          0
        );

      const option =
        catalog.find(
          item =>
            item.id ===
            id
        );

      const state =
        option?.states[0];

      if (
        !option ||
        !state
      ) {
        return;
      }

      onChange({
        turnoutElementId:
          option.id,
        turnoutLabel:
          option.label,
        turnoutStateKey:
          state.value,
        turnoutStateLabel:
          state.label,
        turnoutCommands:
          state.commands.map(
            command => ({
              ...command,
            })
          ),
      });
    };

  const selectState =
    (
      value:
        string |
        null
    ): void => {
      if (!selected) {
        return;
      }

      const state =
        selected.states.find(
          item =>
            item.value ===
            value
        );

      if (!state) {
        return;
      }

      onChange({
        turnoutStateKey:
          state.value,
        turnoutStateLabel:
          state.label,
        turnoutCommands:
          state.commands.map(
            command => ({
              ...command,
            })
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
              "ui.flowTurnout",
              "Turnout"
            )
          }
          placeholder={
            t(
              "ui.flowSelectTurnout",
              "Select turnout"
            )
          }
          value={
            data.turnoutElementId
              ? String(
                  data.turnoutElementId
                )
              : null
          }
          data={
            catalog.map(
              option => ({
                value:
                  String(
                    option.id
                  ),
                label:
                  option.label,
              })
            )
          }
          searchable
          disabled={
            loading
          }
          onChange={
            selectTurnout
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
        catalog.length ===
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
                "ui.flowLoadingTurnouts",
                "Loading turnouts..."
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
        catalog.length ===
          0 && (
        <Alert
          color="yellow"
          py="xs"
        >
          {
            t(
              "ui.flowNoConfiguredTurnouts",
              "No configured turnouts were found in the layout."
            )
          }
        </Alert>
      )}

      {selected && (
        <>
          <Select
            label={
              t(
                "ui.flowTurnoutState",
                "Turnout state"
              )
            }
            value={
              data.turnoutStateKey ||
              selected.states[0]?.value ||
              null
            }
            data={
              selected.states.map(
                state => ({
                  value:
                    state.value,
                  label:
                    state.label,
                })
              )
            }
            allowDeselect={
              false
            }
            onChange={
              selectState
            }
          />

          <Text
            size="xs"
            c="dimmed"
          >
            {
              selected.addresses
                .map(
                  address =>
                    `#${address}`
                )
                .join(
                  " / "
                )
            }
            {" · "}
            {
              selected.kind ===
                "threeway"
                ? "W"
                : selected.kind ===
                    "double"
                  ? "Double"
                  : "Turnout"
            }
          </Text>
        </>
      )}
    </Stack>
  );
}
