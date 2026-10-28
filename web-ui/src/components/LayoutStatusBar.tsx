import { ActionIcon, Badge, Button, Card, Divider, Group, Text } from "@mantine/core";
import { IconTrain, IconUserShield, IconVolume } from "@tabler/icons-react";
import i18next from "i18next";

export type LayoutStatusBarProps = {
  wsStatus: string;
  emergencyStop: boolean;
  onEmergencyStop: () => void;
  anyTrackOverload: boolean;
  overloadedTrackNames: string;
  broadcastAudioEnabled: boolean;
  onToggleAudio: () => void;
  switchManModeEnabled: boolean;
  switchManOwnedCount: number;
  switchManModeBusy: boolean;
  onToggleSwitchMan: () => void;
  blockSelectionActive?: boolean;
  rightPanelMode?: "loco" | "property";
  onToggleRightPanel?: () => void;
  elementCount: number;
  locoCount: number;
};

export default function LayoutStatusBar(p: LayoutStatusBarProps) {
  return <Card withBorder p={5} radius="sm" className="lite-status-bar">
    <Group justify="flex-start" wrap="nowrap" gap="xs">
      <Group gap={6} wrap="nowrap" inert={p.blockSelectionActive} style={{ opacity: p.blockSelectionActive ? 0.55 : 1 }}>
        <Badge data-command-center-status-role="layout-ws" size="sm"
          variant={p.wsStatus === "connected" ? "light" : "filled"}
          color={p.wsStatus === "connected" ? "green" : "red"}
          className={p.wsStatus === "connected" ? "" : "lite-ws-alert"}
          title={p.wsStatus === "connected" ? i18next.t("ui.websocketConnected") : i18next.t("ui.websocketReconnectingAutomatically", { value1: p.wsStatus })}>
          {p.wsStatus === "connected" ? "WS" : p.wsStatus === "reconnecting" ? i18next.t("ui.wsRetry") : i18next.t("ui.wsLost")}
        </Badge>
        <Badge size="sm" variant="light" color={p.emergencyStop ? "red" : "gray"}
          onClick={p.onEmergencyStop} style={{ pointerEvents: "auto" }}
          title={i18next.t("ui.estop")} className={`lite-status-action${p.emergencyStop ? " blinkBadge" : ""}`}>
          {i18next.t("ui.estop")}
        </Badge>
        <Divider orientation="vertical"/>
        <Badge size="sm" variant={p.anyTrackOverload ? "filled" : "light"}
          color={p.anyTrackOverload ? "red" : "gray"} className={p.anyTrackOverload ? "blinkBadge" : ""}
          title={p.anyTrackOverload ? i18next.t("ui.overloadTrack", { value1: p.overloadedTrackNames }) : i18next.t("ui.noTrackOverload")}>
          {i18next.t("ui.overload")}
        </Badge>
        <Divider orientation="vertical"/>
        <ActionIcon size="sm" variant="filled" color={p.broadcastAudioEnabled ? "lime" : "dark"}
          aria-label={p.broadcastAudioEnabled ? "Disable broadcast audio on this client" : "Enable broadcast audio on this client"}
          title={p.broadcastAudioEnabled ? "Broadcast audio enabled on this client" : "Broadcast audio muted on this client"}
          onClick={p.onToggleAudio}><IconVolume size={15}/></ActionIcon>
        <Divider orientation="vertical"/>
        <ActionIcon size="sm" variant={p.switchManModeEnabled ? "filled" : "light"}
          color={p.switchManModeBusy ? "yellow" : p.switchManModeEnabled ? "teal" : "gray"}
          disabled={p.switchManModeBusy || p.wsStatus !== "connected"}
          aria-label={i18next.t("ui.switchManMode")}
          title={p.switchManModeEnabled ? i18next.t("ui.switchManModeActive", { count: p.switchManOwnedCount }) : i18next.t("ui.switchManModeInactive")}
          onClick={p.onToggleSwitchMan}><IconUserShield size={15}/></ActionIcon>
        {p.onToggleRightPanel && <>
          <Divider orientation="vertical"/>
          <ActionIcon size="sm" variant={p.rightPanelMode === "loco" ? "filled" : "light"}
            color={p.rightPanelMode === "loco" ? "green" : "gray"}
            aria-label={i18next.t("ui.toggleRightLocomotivePanel")}
            title={p.rightPanelMode === "loco" ? i18next.t("ui.rightPanelLocomotiveControl") : i18next.t("ui.rightPanelProperties")}
            onClick={p.onToggleRightPanel}><IconTrain size={15}/></ActionIcon>
        </>}
        {p.blockSelectionActive && <>
          <Divider orientation="vertical"/>
          <Badge color="lime" variant="filled" size="sm">Yellow: FROM · Lime: destination · Esc to cancel</Badge>
        </>}
      </Group>
      {p.blockSelectionActive && <Button size="compact-xs" color="red" variant="filled" onClick={p.onEmergencyStop}>{i18next.t("ui.estop")}</Button>}
      <Text size="xs" c="dimmed" truncate style={{ marginLeft: "auto" }}>
        {p.elementCount} elements · {p.locoCount} locos
      </Text>
    </Group>
  </Card>;
}
