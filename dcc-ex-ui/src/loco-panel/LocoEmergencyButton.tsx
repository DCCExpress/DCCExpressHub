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
      color={emergencyStop ? "red" : "gray"}
      title={emergencyStop
        ? "E-STOP sent. Resume with all locomotives at zero, or drive a locomotive manually."
        : "Emergency stop all locomotives without switching track power off"}
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
