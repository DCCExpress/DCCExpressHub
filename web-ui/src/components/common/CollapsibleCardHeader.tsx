import type {
  ReactNode,
} from "react";

import {
  ActionIcon,
  Group,
  Text,
  Tooltip,
} from "@mantine/core";

import {
  IconChevronDown,
} from "@tabler/icons-react";

type CollapsibleCardHeaderProps = {
  title: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  expandTooltip: string;
  collapseTooltip: string;
  rightSection?: ReactNode;
  clickableHeader?: boolean;
  className?: string;
};

export default function CollapsibleCardHeader({
  title,
  collapsed,
  onToggle,
  expandTooltip,
  collapseTooltip,
  rightSection,
  clickableHeader = false,
  className,
}: CollapsibleCardHeaderProps) {
  return (
    <Group
      justify="space-between"
      align="center"
      wrap="nowrap"
      className={
        className
      }
      role={
        clickableHeader
          ? "button"
          : undefined
      }
      tabIndex={
        clickableHeader
          ? 0
          : undefined
      }
      aria-expanded={
        clickableHeader
          ? !collapsed
          : undefined
      }
      onClick={
        clickableHeader
          ? onToggle
          : undefined
      }
      onKeyDown={
        clickableHeader
          ? event => {
              if (
                event.key !==
                  "Enter" &&
                event.key !==
                  " "
              ) {
                return;
              }

              event.preventDefault();
              onToggle();
            }
          : undefined
      }
    >
      {typeof title === "string" ? (
        <Text
          size="sm"
          fw={700}
        >
          {title}
        </Text>
      ) : (
        title
      )}

      <Group
        gap="xs"
        wrap="nowrap"
      >
        {rightSection}

        <Tooltip
          label={
            collapsed
              ? expandTooltip
              : collapseTooltip
          }
        >
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            onClick={
              event => {
                if (
                  clickableHeader
                ) {
                  event.stopPropagation();
                }

                onToggle();
              }
            }
          >
            <IconChevronDown
              size={16}
              style={{
                transform:
                  collapsed
                    ? "rotate(-90deg)"
                    : "rotate(0deg)",
                transition:
                  "transform 150ms ease",
              }}
            />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
