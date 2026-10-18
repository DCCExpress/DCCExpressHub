import { Card, Checkbox, Group, Stack, Text } from "@mantine/core";
import { originalText } from "./originalText";


export type BrowserVisibility = {
 showOccupacySensorAddress:boolean;showSensorAddress:boolean;showTurnoutAddress:boolean;
 showSignalAddress:boolean;showSegments:boolean;showBlockNames:boolean;
 showBuildings:boolean;showGrid:boolean;
};
export const defaultBrowserVisibility:BrowserVisibility={
 showOccupacySensorAddress:false,showSensorAddress:false,showTurnoutAddress:false,
 showSignalAddress:false,showSegments:false,showBlockNames:false,showBuildings:true,showGrid:true
};
export function loadBrowserVisibility():BrowserVisibility{
 try{return {...defaultBrowserVisibility,...JSON.parse(localStorage.getItem('dcc-ex-ui.layout.visibility')||'{}')};}
 catch{return {...defaultBrowserVisibility};}
}

type VisibilitySettingsProps={
 title?:string;settings:BrowserVisibility;updateSettings:(patch:Partial<BrowserVisibility>)=>void;
};

export default function VisibilitySettings({title,settings,updateSettings}: VisibilitySettingsProps) {
  const t=originalText;

  return (
    <Card withBorder p="xs">
      <Stack gap={6}>
        <Group mb={2}>
          <Text fw={500}>{title ?? t("visibility.title")}</Text>
        </Group>

        <Checkbox
          mb={4}
          label={t("visibility.showOccupancyAddress")}
          checked={settings.showOccupacySensorAddress}
          onChange={(e) =>
            updateSettings({
              showOccupacySensorAddress: e.currentTarget.checked,
            })
          }
        />

        <Checkbox
          mb={4}
          label={t("visibility.showSensorAddress")}
          checked={settings.showSensorAddress}
          onChange={(e) =>
            updateSettings({
              showSensorAddress: e.currentTarget.checked,
            })
          }
        />

        <Checkbox
          mb={4}
          label={t("visibility.showTurnoutAddress")}
          checked={settings.showTurnoutAddress}
          onChange={(e) =>
            updateSettings({
              showTurnoutAddress: e.currentTarget.checked,
            })
          }
        />

        <Checkbox
          mb={4}
          label={t("visibility.showSignalAddress")}
          checked={settings.showSignalAddress}
          onChange={(e) =>
            updateSettings({
              showSignalAddress: e.currentTarget.checked,
            })
          }
        />

        <Checkbox
          mb={4}
          label={t("visibility.showSegments")}
          checked={settings.showSegments}
          onChange={(e) =>
            updateSettings({
              showSegments: e.currentTarget.checked,
            })
          }
        />
        <Checkbox
          mb={4}
          label={t("visibility.showBlockNames")}
          checked={settings.showBlockNames}
          onChange={(e) =>
            updateSettings({
              showBlockNames: e.currentTarget.checked,
            })
          }
        />
        <Checkbox
          mb={4}
          label={t("visibility.showBuildings")}
          checked={settings.showBuildings}
          onChange={(e) =>
            updateSettings({
              showBuildings: e.currentTarget.checked,
            })
          }
        />
        <Checkbox
          mb={4}
          label={t("visibility.showGrid")}
          checked={settings.showGrid}
          onChange={(e) =>
            updateSettings({
              showGrid: e.currentTarget.checked,
            })
          }
        />
      </Stack>
    </Card>
  );
}
