import { Button, Group } from "@mantine/core";
import {
  IconPlayerStop,
  IconPlayerTrackNext,
  IconPlayerTrackPrev,
} from "@tabler/icons-react";
type Direction = "forward" | "reverse";

type LocoDirectionControlsProps = {
  speed: number;
  direction: Direction;
  disabled?: boolean;
  onForward: () => void;
  onReverse: () => void;
  onStop: () => void;
};

export default function LocoDirectionControls({
  speed,
  direction,
  disabled = false,
  onForward,
  onReverse,
  onStop,
}: LocoDirectionControlsProps) {
  const t = (key:string) => ({ "loco.direction.reverse":"Reverse", "loco.direction.stop":"Stop", "loco.direction.forward":"Forward" } as Record<string,string>)[key] ?? key;

  return (
    <Group grow gap={4} w="100%">
      <Button
        size="md"
        variant={
          direction === "reverse"
            ? "filled"
            : "light"
        }
        disabled={disabled}
        leftSection={
          <IconPlayerTrackPrev size={14} />
        }
        onClick={onReverse}
      >
        {t("loco.direction.reverse")}
      </Button>

      <Button
        size="md"
        variant={speed > 0 ? "light" : "filled"}
        color="yellow"
        disabled={disabled}
        leftSection={
          <IconPlayerStop size={14} />
        }
        onClick={onStop}
      >
        {t("loco.direction.stop")}
      </Button>

      <Button
        size="md"
        variant={
          direction === "forward"
            ? "filled"
            : "light"
        }
        disabled={disabled}
        rightSection={
          <IconPlayerTrackNext size={14} />
        }
        onClick={onForward}
      >
        {t("loco.direction.forward")}
      </Button>
    </Group>
  );
}
