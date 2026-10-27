import { useState, type ReactNode } from "react";
import { ActionIcon, Collapse, Divider, Group, Stack, Text, Tooltip } from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";

type CollapsibleGroupProps = {
  title: ReactNode;
  children: ReactNode;
  rightSection?: ReactNode;
  defaultCollapsed?: boolean;
  expandTooltip?: string;
  collapseTooltip?: string;
};

/** Reusable V1-style section with a clickable header and animated content. */
export default function CollapsibleGroup({
  title, children, rightSection, defaultCollapsed = true,
  expandTooltip = "Expand", collapseTooltip = "Collapse",
}: CollapsibleGroupProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return <Stack gap="xs">
    <Group justify="space-between" align="center" wrap="nowrap">
      <Text size="sm" fw={600}>{title}</Text>
      <Group gap="xs" wrap="nowrap">
        {rightSection}
        <Tooltip label={collapsed ? expandTooltip : collapseTooltip}>
          <ActionIcon size="sm" variant="subtle" color="gray"
            aria-label={collapsed ? expandTooltip : collapseTooltip}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(v => !v)}>
            <IconChevronDown size={16} style={{
              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
              transition: "transform 150ms ease",
            }}/>
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
    <Collapse expanded={!collapsed}>
      <Stack gap="xs"><Divider/>{children}</Stack>
    </Collapse>
  </Stack>;
}
