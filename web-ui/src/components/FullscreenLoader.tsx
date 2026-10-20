import { Button, Center, Loader, Overlay, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { wsApi } from "../services/wsApi";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

type FullscreenLoaderProps = {
  visible: boolean;
  text?: string;
};

export default function FullscreenLoader({
  visible,
  text,
}: FullscreenLoaderProps) {
  const { t } = useTranslation();
  const [emergencyArmed, setEmergencyArmed] =
    useState(false);

  useEffect(() => {
    if (!visible) {
      setEmergencyArmed(false);
      return;
    }

    setEmergencyArmed(false);

    // A route button opens this overlay on pointer-down. The emergency
    // action must not receive the pointer-up from that same gesture.
    let armTimer: number | null = null;

    const armAfterCurrentGesture = () => {
      // A click is synthesized immediately after pointer-up. Arm in the next
      // task so the button stays disabled for that click as well.
      if (armTimer !== null) return;
      armTimer = window.setTimeout(() => {
        armTimer = null;
        setEmergencyArmed(true);
      }, 0);
    };

    window.addEventListener(
      "pointerup",
      armAfterCurrentGesture,
      { capture: true, once: true }
    );
    window.addEventListener(
      "pointercancel",
      armAfterCurrentGesture,
      { capture: true, once: true }
    );

    // Keyboard activation has no pointer-up event.
    const fallback = window.setTimeout(
      armAfterCurrentGesture,
      750
    );

    return () => {
      window.clearTimeout(fallback);
      if (armTimer !== null) {
        window.clearTimeout(armTimer);
      }
      window.removeEventListener(
        "pointerup",
        armAfterCurrentGesture,
        true
      );
      window.removeEventListener(
        "pointercancel",
        armAfterCurrentGesture,
        true
      );
    };
  }, [visible]);

  if (!visible) return null;

  const handleEmergencyStop = () => {
    if (!emergencyArmed) return;
    wsApi.emergencyStop();
  };

  return (
    <Overlay
      fixed
      zIndex={9999}
      blur={1}
      backgroundOpacity={0.1}
    >
      <Center h="100vh">
        <Stack align="center" gap="sm" bg="#00000080" p={40}>
          <Loader size="xl" />

          <Text size="md" c="dimmed">
            {text ?? t("common.loading")}
          </Text>

          <Button
            size="md"
            color="red"
            variant="filled"
            leftSection={<IconAlertTriangle size={18} />}
            disabled={!emergencyArmed}
            onPointerDown={event => {
              event.stopPropagation();
            }}
            onClick={handleEmergencyStop}
          >
            {t("commandCenter.emergencyStop")}
          </Button>
        </Stack>
      </Center>
    </Overlay>
  );
}
