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
  loadAutomationBlockCatalog,
  type AutomationBlockOption,
} from "../../services/automationBlockCatalog";

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

export default function AutomationFlowBlockEditor({
  data,
  onChange,
}: Props) {
  const [
    catalog,
    setCatalog,
  ] =
    useState<
      AutomationBlockOption[]
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
            await loadAutomationBlockCatalog()
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
      () => {
        const byId =
          catalog.find(
            option =>
              option.id ===
              (
                data.blockElementId ??
                0
              )
          );

        if (byId) {
          return byId;
        }

        const name =
          String(
            data.blockName ??
            ""
          ).trim();

        if (!name) {
          return undefined;
        }

        return catalog.find(
          option =>
            option.name ===
            name
        ) ??
          catalog.find(
            option =>
              option.name.toLocaleLowerCase() ===
              name.toLocaleLowerCase()
          );
      },
      [
        catalog,
        data.blockElementId,
        data.blockName,
      ]
    );

  useEffect(
    () => {
      if (!selected) {
        return;
      }

      if (
        data.blockElementId ===
          selected.id &&
        data.blockLabel ===
          selected.label &&
        data.blockName ===
          selected.name
      ) {
        return;
      }

      onChange({
        blockElementId:
          selected.id,
        blockLabel:
          selected.label,
        blockName:
          selected.name,
      });
    },
    [
      selected,
      data.blockElementId,
      data.blockLabel,
      data.blockName,
      onChange,
    ]
  );

  const selectBlock =
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

      if (!option) {
        return;
      }

      onChange({
        blockElementId:
          option.id,
        blockLabel:
          option.label,
        blockName:
          option.name,
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
              "ui.flowBlock",
              "Block"
            )
          }
          placeholder={
            t(
              "ui.flowSelectBlock",
              "Select block"
            )
          }
          value={
            selected
              ? String(
                  selected.id
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
            selectBlock
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
                "ui.flowLoadingBlocks",
                "Loading blocks..."
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
              "ui.flowNoConfiguredBlocks",
              "No blocks were found in the layout."
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
            selected.name
          }
          {" · ID #"}
          {
            selected.id
          }
        </Text>
      )}
    </Stack>
  );
}
