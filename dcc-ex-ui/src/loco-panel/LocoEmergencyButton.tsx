import { Button } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";


type LocoEmergencyButtonProps = {
  emergencyStop: boolean;
  onToggle: () => void;
};

export default function LocoEmergencyButton({
  emergencyStop,
  onToggle,
}: LocoEmergencyButtonProps) {
  const handleClick = onToggle;

  return (
    <Button
      size="lg"
      style={{ width: "100%" }}
      color={emergencyStop ? "green" : "red"}
      variant={emergencyStop ? "light" : "filled"}
      title={emergencyStop ? "Release E-STOP at zero speed; no train restarts automatically" : "Emergency stop all locomotives without switching track power off"}
      className={emergencyStop ? "blinkBadge" : ""}
      leftSection={
        <IconAlertTriangle size={14} />
      }
      onClick={handleClick}
    >
      {emergencyStop ? "Resume" : "EMERGENCY STOP"}
    </Button>
  );
}
