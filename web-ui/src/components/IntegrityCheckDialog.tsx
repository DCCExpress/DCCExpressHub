import { useTranslation } from "react-i18next";
import i18next from "i18next";
import { Alert,Badge,Button,Card,Group,Loader,ScrollArea,Stack,Text } from "@mantine/core";
import { IconAlertTriangle,IconCheck,IconRefresh,IconShieldCheck } from "@tabler/icons-react";
import { useCallback,useEffect,useState } from "react";
import { loadSignalLogicRulesWs } from "@/api/signalLogicWsApi";
import AppModal from "@/components/common/AppModal";
import type { LayoutView } from "@/models/editor/core/LayoutView";
import { inspectProjectIntegrity,type IntegrityReport } from "@/services/layoutIntegrity";
import type { Loco } from "@domain/types";

type Props={opened:boolean;onClose:()=>void;layout:LayoutView;locos:Loco[]};

export default function IntegrityCheckDialog({opened,onClose,layout,locos}:Props){
  useTranslation();
  const [loading,setLoading]=useState(false);
  const [loadError,setLoadError]=useState<string|null>(null);
  const [report,setReport]=useState<IntegrityReport|null>(null);

  const runCheck=useCallback(async()=>{
    setLoading(true);setLoadError(null);
    try{
      const signalResult=await loadSignalLogicRulesWs();
      setReport(inspectProjectIntegrity(layout,locos,signalResult.document,signalResult.issues));
    }catch(error){
      setLoadError(error instanceof Error?error.message:String(error));
      setReport(inspectProjectIntegrity(layout,locos,null));
    }finally{setLoading(false);}
  },[layout,locos]);

  useEffect(()=>{if(opened)void runCheck();},[opened,runCheck]);

  const errors=report?.issues.filter(x=>x.level==="error").length??0;
  const warnings=report?.issues.filter(x=>x.level==="warning").length??0;

  return <AppModal opened={opened} onClose={onClose} title={i18next.t("ui.projectIntegrityCheck")} size="lg" centered draggable>
    <Stack gap="sm">
      <Group justify="space-between">
        <Group gap="xs"><IconShieldCheck size={24}/><div>
          <Text fw={700}>{i18next.t("ui.allProjectReferences")}</Text>
          <Text size="sm" c="dimmed">Signal automation is never auto-deleted because of a changed layout ID.</Text>
        </div></Group>
        <Button variant="light" leftSection={<IconRefresh size={16}/>} loading={loading} onClick={()=>void runCheck()}>{i18next.t("ui.checkAgain")}</Button>
      </Group>
      {loading&&!report&&<Group gap="xs"><Loader size="sm"/><Text>{i18next.t("ui.checkingTheCompleteProject")}</Text></Group>}
      {loadError&&<Alert color="red" icon={<IconAlertTriangle size={16}/>}>{loadError}</Alert>}
      {report&&!loading&&<Alert color={errors>0?"red":warnings>0?"yellow":"green"} icon={errors>0?<IconAlertTriangle size={16}/>:<IconCheck size={16}/>}>
        {errors>0?i18next.t("ui.integrityCheckFoundErrorSAndWarningS",{value1:errors,value2:warnings})
          :warnings>0?i18next.t("ui.noBrokenReferencesWarningSFound",{value1:warnings})
          :i18next.t("ui.integrityCheckPassedEveryCheckedReferenceIsValid")}
      </Alert>}
      {/* <Alert color="blue" variant="light">
        Signal Logic cleanup is non-destructive: a missing/recreated layout ID is not a reason to delete physical signal, turnout or sensor automation.
      </Alert> */}
      <ScrollArea.Autosize mah="62dvh" offsetScrollbars><Stack gap="xs" pr="xs">
        {report?.areas.map(area=><Card key={area.area} withBorder p="sm">
          <Group justify="space-between" mb={area.issues.length?"xs":0}>
            <Text fw={600}>{area.area}</Text>
            <Group gap={5}><Badge variant="light" color="gray">{area.summary??`${area.checked} ${i18next.t("ui.checked")}`}</Badge>
              {!area.issues.length&&<Badge color="green" leftSection={<IconCheck size={11}/>}>OK</Badge>}
            </Group>
          </Group>
          {!!area.issues.length&&<Stack gap={4}>{area.issues.map((issue,index)=><Group key={`${issue.message}-${index}`} gap="xs" wrap="nowrap" align="flex-start">
            <IconAlertTriangle size={15} color={issue.level==="error"?"var(--mantine-color-red-6)":"var(--mantine-color-yellow-6)"} style={{flexShrink:0,marginTop:2}}/>
            <Text size="sm" style={{wordBreak:"break-word"}}>{issue.message}</Text>
          </Group>)}</Stack>}
        </Card>)}
      </Stack></ScrollArea.Autosize>
    </Stack>
  </AppModal>;
}
