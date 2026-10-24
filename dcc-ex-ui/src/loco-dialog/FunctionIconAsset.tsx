import { Text } from '@mantine/core';
import { getBuiltinFunctionIcon } from './FunctionIconRegistry';
import type { LocoFunction } from '../storage';
export default function FunctionIconAsset({fn,size=20}:{fn?:Pick<LocoFunction,'icon'|'iconTintMode'|'iconColor'>;size?:number;preview?:boolean}) {
 const icon=fn?.icon??'';
 const Icon=getBuiltinFunctionIcon(icon);
 if(Icon)return <Icon size={size} color={fn?.iconTintMode==='tint'?fn.iconColor:undefined}/>;
 if(icon)return <Text span fz={size} lh={1}>{icon}</Text>;
 return null;
}
