import {
  useEffect,
  type ReactNode,
} from "react";

import {
  Card,
  Collapse,
  Divider,
  Stack,
} from "@mantine/core";

import {
  usePersistentCollapsedState,
} from "../../hooks/usePersistentCollapsedState";

import CollapsibleCardHeader from "./CollapsibleCardHeader";

export type CollapsiblePanelCardProps = {
  title: ReactNode;
  collapsedStorageKey: string;
  expandTooltip: string;
  collapseTooltip: string;
  rightSection?: ReactNode;
  children: ReactNode;
  bodyGap?: string | number;
  cardPadding?: string | number;
  defaultCollapsed?: boolean;
  clickableHeader?: boolean;
  headerClassName?: string;
  bodyClassName?: string;
  collapseCommand?: {
    collapsed: boolean;
    revision: number;
  };
};

export default function CollapsiblePanelCard({
  title,
  collapsedStorageKey,
  expandTooltip,
  collapseTooltip,
  rightSection,
  children,
  bodyGap = "xs",
  cardPadding = "xs",
  defaultCollapsed = false,
  clickableHeader = false,
  headerClassName,
  bodyClassName,
  collapseCommand,
}: CollapsiblePanelCardProps) {
  const {
    collapsed,
    setCollapsed,
    toggleCollapsed,
  } =
    usePersistentCollapsedState(
      collapsedStorageKey,
      defaultCollapsed
    );

  useEffect(
    () => {
      if (
        collapseCommand ===
        undefined
      ) {
        return;
      }

      setCollapsed(
        collapseCommand.collapsed
      );
    },
    [
      collapseCommand,
      setCollapsed,
    ]
  );

  return (
    <Card
      withBorder
      radius="md"
      p={cardPadding}
    >
      <Stack gap="xs">
        <CollapsibleCardHeader
          title={title}
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          expandTooltip={expandTooltip}
          collapseTooltip={collapseTooltip}
          clickableHeader={
            clickableHeader
          }
          {...(
            headerClassName !== undefined
              ? {
                  className:
                    headerClassName,
                }
              : {}
          )}
          {...(
            rightSection !== undefined
              ? {
                  rightSection,
                }
              : {}
          )}
        />

        <Collapse
          expanded={!collapsed}
        >
          <Stack
            gap={bodyGap}
            {...(
              bodyClassName !== undefined
                ? {
                    className:
                      bodyClassName,
                  }
                : {}
            )}
          >
            <Divider />
            {children}
          </Stack>
        </Collapse>
      </Stack>
    </Card>
  );
}
