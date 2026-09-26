import {
  useEffect,
  useState,
} from "react";

import {
  Alert,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";

import type {
  MovementAction,
  MovementBlockRule,
  MovementPage,
} from "../../domain/movement";

import {
  loadAutomationSensorCatalog,
  type AutomationSensorOption,
} from "../../services/automationSensorCatalog";

import {
  loadMovementPlan,
  type MovementPlan,
} from "../../services/movementPlan";

import MovementRouteRow from "./MovementRouteRow";

type Props = {
  page:
    MovementPage;
  onChange: (
    page:
      MovementPage
  ) => void;
};

export default function MovementRouteEditor({
  page,
  onChange,
}: Props) {
  const [
    sensorCatalog,
    setSensorCatalog,
  ] =
    useState<
      AutomationSensorOption[]
    >([]);

  const [
    plan,
    setPlan,
  ] =
    useState<
      MovementPlan |
      null
    >(
      null
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      true
    );

  const [
    loadError,
    setLoadError,
  ] =
    useState<string | null>(
      null
    );

  useEffect(
    () => {
      let disposed =
        false;

      void loadAutomationSensorCatalog()
        .then(
          sensors => {
            if (
              !disposed
            ) {
              setSensorCatalog(
                sensors
              );
            }
          }
        )
        .catch(
          error => {
            if (
              !disposed
            ) {
              setLoadError(
                error instanceof Error
                  ? error.message
                  : String(
                      error
                    )
              );
            }
          }
        );

      return () => {
        disposed =
          true;
      };
    },
    []
  );

  const routeSignature =
    [
      page.fromBlockId ??
        0,
      ...page.viaBlockIds,
      page.toBlockId ??
        0,
    ].join(
      ":"
    );

  useEffect(
    () => {
      let disposed =
        false;

      if (
        page.fromBlockId ===
          null ||
        page.toBlockId ===
          null
      ) {
        setPlan(
          null
        );

        setLoading(
          false
        );

        setLoadError(
          null
        );

        return () => {
          disposed =
            true;
        };
      }

      setLoading(
        true
      );

      setLoadError(
        null
      );

      void loadMovementPlan(
        page
      )
        .then(
          nextPlan => {
            if (
              !disposed
            ) {
              setPlan(
                nextPlan
              );
            }
          }
        )
        .catch(
          error => {
            if (
              !disposed
            ) {
              setPlan(
                null
              );

              setLoadError(
                error instanceof Error
                  ? error.message
                  : String(
                      error
                    )
              );
            }
          }
        )
        .finally(
          () => {
            if (
              !disposed
            ) {
              setLoading(
                false
              );
            }
          }
        );

      return () => {
        disposed =
          true;
      };
    },
    [
      routeSignature,
    ]
  );

  const updateRule =
    (
      rule:
        MovementBlockRule
    ): void => {
      const exists =
        page.blockRules.some(
          current =>
            current.blockId ===
            rule.blockId
        );

      onChange({
        ...page,
        blockRules:
          exists
            ? page.blockRules.map(
                current =>
                  current.blockId ===
                  rule.blockId
                    ? rule
                    : current
              )
            : [
                ...page.blockRules,
                rule,
              ],
      });
    };

  const updateActionsForResource =
    (
      resourceKey: string,
      actions:
        MovementAction[]
    ): void => {
      onChange({
        ...page,
        actions: [
          ...page.actions.filter(
            action =>
              action.resourceKey !==
              resourceKey
          ),
          ...actions,
        ],
      });
    };

  return (
    <Stack
      gap="sm"
      className="movement-route-editor"
    >
      {
        loading && (
          <Group
            gap="xs"
          >
            <Loader
              size="sm"
            />

            <Text
              size="sm"
              c="dimmed"
            >
              Building physical movement plan...
            </Text>
          </Group>
        )
      }

      {
        loadError && (
          <Alert
            color="red"
          >
            {
              loadError
            }
          </Alert>
        )
      }

      {
        plan &&
        plan.topologyVersion <
          3 && (
          <Alert
            color="yellow"
            variant="light"
          >
            Legacy route topology: generate and save the route graph once to store exact turnout passage order.
          </Alert>
        )
      }

      {
        page.fromBlockId ===
          null ||
        page.toBlockId ===
          null
          ? (
            <Alert
              color="blue"
              variant="light"
            >
              Select the route blocks in the page header.
            </Alert>
          )
          : plan && (
            <>
              <div
                className="movement-route-timeline"
              >
                {
                  plan.resources.map(
                    (
                      resource,
                      index
                    ) => {
                      const blockId =
                        resource.blockId;

                      return (
                        <MovementRouteRow
                          key={
                            `${resource.key}:${index}`
                          }
                          pageId={
                            page.id
                          }
                          resource={
                            resource
                          }
                          index={
                            index
                          }
                          isSource={
                            resource.key ===
                            `block:${page.fromBlockId}`
                          }
                          isDestination={
                            resource.key ===
                            `block:${page.toBlockId}`
                          }
                          rule={
                            blockId ===
                            null
                              ? null
                              : page.blockRules.find(
                                  rule =>
                                    rule.blockId ===
                                    blockId
                                ) ??
                                null
                          }
                          sensorCatalog={
                            sensorCatalog
                          }
                          actions={
                            page.actions.filter(
                              action =>
                                action.resourceKey ===
                                resource.key
                            )
                          }
                          onRuleChange={
                            updateRule
                          }
                          onActionsChange={
                            actions =>
                              updateActionsForResource(
                                resource.key,
                                actions
                              )
                          }
                        />
                      );
                    }
                  )
                }
              </div>
            </>
          )
      }
    </Stack>
  );
}
