import type {
  ReactNode,
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
}: CollapsiblePanelCardProps) {
  const {
    collapsed,
    toggleCollapsed,
  } =
    usePersistentCollapsedState(
      collapsedStorageKey,
      defaultCollapsed
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
          {...(
            rightSection !== undefined
              ? {
                  rightSection,
                }
              : {}
          )}
        />

        <Collapse
          in={!collapsed}
        >
          <Stack
            gap={bodyGap}
          >
            <Divider />
            {children}
          </Stack>
        </Collapse>
      </Stack>
    </Card>
  );
}
