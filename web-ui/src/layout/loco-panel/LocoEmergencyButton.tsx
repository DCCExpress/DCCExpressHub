import { Button } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";

import { wsApi } from "../../services/wsApi";

type LocoEmergencyButtonProps = {
  emergencyStop: boolean;
  onToggle: () => void;
};

export default function LocoEmergencyButton({
  emergencyStop,
  onToggle,
}: LocoEmergencyButtonProps) {
  const handleClick = () => {
    if (emergencyStop) {
      // The backend DCC-EX wrapper treats the same emergencyStop command as
      // a safe toggle while paused: ESTOPALL first, then ESTOP_RESUME.
      wsApi.emergencyStop();
      return;
    }

    onToggle();
  };

  return (
    <Button
      size="lg"
      style={{ width: "100%" }}
      color={emergencyStop ? "red" : "gray"}
      className={emergencyStop ? "blinkBadge" : ""}
      leftSection={
        <IconAlertTriangle size={14} />
      }
      onClick={handleClick}
    >
      {emergencyStop ? "Resume" : "Emergency"}
    </Button>
  );
}
