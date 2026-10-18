import { Box, Card, ScrollArea, SimpleGrid, Stack, Tabs, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import AppModal from './components/common/AppModal';

/**
 * Canonical IDs and ordering match the original web-ui LiteLayoutPage picker.
 * Previews below are browser-only thumbnails until TrackCanvas is ported.
 */
export type BrowserPickerItem={type:string;label:string};
export const RAILWAY_PICKER_ITEMS:BrowserPickerItem[]=[
 {type:'trackdirection',label:'Direction'},
 {type:'trackstraight',label:'Straight'},
 {type:'trackend',label:'Track end'},
 {type:'trackcorner',label:'Corner'},
 {type:'trackcurve',label:'Curve'},
 {type:'trackcrossing',label:'Crossing'},
 {type:'tracklevelcrossing',label:'Level crossing'},
 {type:'trackturnoutleft',label:'Left turnout'},
 {type:'trackturnoutright',label:'Right turnout'},
 {type:'trackturnouttwoway',label:'Y turnout'},
 {type:'trackturnouttreeway',label:'Three-way turnout'},
 {type:'trackbridge',label:'Bridge'},
 {type:'trackturnoutdouble',label:'Double turnout'},
 {type:'tracksensor',label:'Sensor'},
 {type:'trackblock',label:'Block'},
 {type:'tracksignal',label:'Signal'},
 {type:'button',label:'Output button'},
 {type:'routebutton',label:'Route'},
 {type:'audiobutton',label:'Audio button'},
 {type:'clcok',label:'Fast clock'},
 {type:'label',label:'Label'},
 {type:'emergencybutton',label:'Emergency stop'},
];
export const DECORATION_PICKER_ITEMS:BrowserPickerItem[]=[
 {type:'tree',label:'Tree'},
 {type:'bush',label:'Bush'},
 {type:'lamp',label:'Lamp'},
 {type:'stationbuilding',label:'Station building'},
 {type:'switchmanhut',label:'Guard house'},
 {type:'gardenhouse',label:'House with garden'},
];
type Props={
 opened:boolean;
 tab:'railway'|'decorations';
 onTabChange:(value:'railway'|'decorations')=>void;
 onClose:()=>void;
 onSelect:(item:BrowserPickerItem)=>void;
};
const trackTypes=new Set(['trackdirection','trackstraight','trackend','trackcorner','trackcurve','trackcrossing','tracklevelcrossing','trackturnoutleft','trackturnoutright','trackturnouttwoway','trackturnouttreeway','trackbridge','trackturnoutdouble','tracksensor','trackblock']);
function ElementThumbnail({item}:{item:BrowserPickerItem}) {
 const type=item.type;
 const line={stroke:'#b5c0ce',strokeWidth:3,fill:'none'} as const;
 const rail={stroke:'#8193a5',strokeWidth:2.4,fill:'none'} as const;
 const sleeper={stroke:'#687483',strokeWidth:3,strokeLinecap:'square' as const};
 const straight=<>
  {[10,19,28,37,46,55].map(x=><line key={x} x1={x} y1="21" x2={x} y2="43" {...sleeper}/>)}
  <path d="M3 25H61 M3 39H61" {...line}/>
 </>;
 const trackBranch=(direction:-1|1)=> <path d={direction===-1?'M5 25Q30 25 58 8 M5 39Q30 39 60 20':'M5 25Q30 25 58 44 M5 39Q30 39 60 56'} {...rail}/>;
 let graphic:ReactNode;
 switch(type){
  case 'trackstraight':graphic=straight;break;
  case 'trackdirection':graphic=<>{straight}<path d="M40 11h18m-6-5 6 5-6 5" stroke="#79d3ec" fill="none" strokeWidth="2.4"/></>;break;
  case 'trackend':graphic=<>{straight}<path d="M58 15V49" stroke="#e8b97e" strokeWidth="5"/></>;break;
  case 'trackcorner':graphic=<path d="M5 60V39Q5 14 30 14H60 M17 60V39Q17 26 30 26H60" {...line}/>;break;
  case 'trackcurve':graphic=<path d="M2 44Q31 44 59 8 M5 59Q38 56 63 22" {...line}/>;break;
  case 'trackcrossing':graphic=<><path d="M5 15L60 50 M5 28L60 63 M5 50L60 15 M5 63L60 28" {...line}/></>;break;
  case 'tracklevelcrossing':graphic=<>{straight}<rect x="22" y="7" width="20" height="53" fill="none" stroke="#da9a6c" strokeDasharray="4 3"/><path d="M25 12l14 14m0-14L25 26" stroke="#ef9d76" strokeWidth="2"/></>;break;
  case 'trackturnoutleft':graphic=<>{straight}{trackBranch(-1)}</>;break;
  case 'trackturnoutright':graphic=<>{straight}{trackBranch(1)}</>;break;
  case 'trackturnouttwoway':graphic=<><path d="M5 25Q28 25 62 7 M5 39Q28 39 62 57 M5 25V39" {...line}/></>;break;
  case 'trackturnouttreeway':graphic=<>{straight}{trackBranch(-1)}{trackBranch(1)}</>;break;
  case 'trackturnoutdouble':graphic=<>{straight}<path d="M8 9Q31 12 59 39 M8 57Q31 54 59 25" {...rail}/></>;break;
  case 'trackbridge':graphic=<>{straight}<path d="M16 14V51 M49 14V51 M16 14H49 M16 51H49" stroke="#d0a078" strokeWidth="2" fill="none"/></>;break;
  case 'tracksensor':graphic=<>{straight}<rect x="29" y="21" width="6" height="23" fill="#e7bb59"/><text x="34" y="14" textAnchor="middle" fontSize="9" fill="#e7bb59">S</text></>;break;
  case 'trackblock':graphic=<>{straight}<rect x="17" y="18" width="30" height="29" rx="2" stroke="#8bbce4" fill="none" strokeWidth="1.5"/><text x="32" y="15" fill="#a5cff0" textAnchor="middle" fontSize="9">B1</text></>;break;
  case 'tracksignal':graphic=<><path d="M32 20V56 M19 56H46" {...line}/><rect x="24" y="5" width="16" height="32" rx="7" fill="#242d35" stroke="#9aa8ba"/><circle cx="32" cy="14" r="5" fill="#db5959"/><circle cx="32" cy="27" r="5" fill="#48c57b"/></>;break;
  case 'button':graphic=<><rect x="11" y="15" width="44" height="32" rx="5" fill="#303d49" stroke="#b2c1d0"/><circle cx="33" cy="31" r="9" fill="#b7db7c"/></>;break;
  case 'routebutton':graphic=<><rect x="7" y="19" width="50" height="26" rx="5" fill="#263a42" stroke="#73cbb1"/><path d="M17 31H45m-7-7 7 7-7 7" stroke="#73cbb1" fill="none" strokeWidth="3"/></>;break;
  case 'audiobutton':graphic=<><rect x="10" y="18" width="44" height="32" rx="4" stroke="#9daab9" fill="#293643"/><path d="M23 28h6l8-7v26l-8-7h-6z M42 27q7 7 0 14" stroke="#d9c18a" fill="none" strokeWidth="2"/></>;break;
  case 'clcok':graphic=<><circle cx="32" cy="31" r="22" stroke="#9bb4c8" strokeWidth="3" fill="#25303c"/><path d="M32 13v18l11 7" stroke="#eef2f6" strokeWidth="3" fill="none"/></>;break;
  case 'label':graphic=<text x="32" y="40" textAnchor="middle" fontSize="22" fontWeight="bold" fill="#c9d4df">TXT</text>;break;
  case 'emergencybutton':graphic=<><rect x="10" y="13" width="44" height="40" rx="6" fill="#4a2629" stroke="#e47474"/><circle cx="32" cy="33" r="13" fill="#d74444"/><text x="32" y="37" fontWeight="bold" fontSize="11" textAnchor="middle" fill="white">STOP</text></>;break;
  case 'tree':graphic=<><path d="M32 29V59" stroke="#a37a4a" strokeWidth="6"/><circle cx="32" cy="23" r="19" fill="#3d865a" stroke="#9cc79e"/></>;break;
  case 'bush':graphic=<><ellipse cx="21" cy="40" rx="15" ry="13" fill="#527c48"/><ellipse cx="41" cy="38" rx="17" ry="15" fill="#3f9155"/><circle cx="32" cy="28" r="14" fill="#599e65"/></>;break;
  case 'lamp':graphic=<><path d="M32 19V59 M22 59H42" stroke="#b3b6ae" strokeWidth="3"/><path d="M23 17H41L37 26H27Z" fill="#f2dc91" stroke="#cdbf8f"/><path d="M30 13H34" stroke="#cdbf8f" strokeWidth="3"/></>;break;
  case 'stationbuilding':graphic=<><path d="M5 27L32 9 59 27" fill="#8f4e43" stroke="#e7b6a7" strokeWidth="2"/><path d="M9 27H55V57H9Z" fill="#b6a188" stroke="#e5d5b8"/><path d="M24 57V37h15v20" fill="#615247"/><path d="M14 35h9v10h-9 M43 35h8v10h-8" fill="#75a3ba"/></>;break;
  case 'switchmanhut':graphic=<><path d="M11 29L32 14 53 29" fill="#b75b3c" stroke="#e9c0a2" strokeWidth="2"/><path d="M14 29H50V55H14Z" fill="#c6b69b"/><path d="M27 38h10v17H27" fill="#554639"/><path d="M18 35h7v8h-7" fill="#669db2"/></>;break;
  case 'gardenhouse':graphic=<><rect x="3" y="42" width="58" height="17" rx="3" fill="#547a47"/><path d="M15 28L32 14 49 28" fill="#a85642" stroke="#d0ae83" strokeWidth="2"/><rect x="18" y="28" width="28" height="25" fill="#cab696"/><rect x="30" y="39" width="9" height="14" fill="#765840"/><circle cx="7" cy="42" r="7" fill="#66a05e"/></>;break;
  default:graphic=trackTypes.has(type)?straight:<circle cx="32" cy="32" r="18" fill="#5f758d"/>;
 }
 return <Box style={{width:76,height:76,border:'1px solid #666',borderRadius:4,background:'#252b35',
  display:'flex',alignItems:'center',justifyContent:'center',userSelect:'none'}}>
  <Stack gap={0} justify="center" align="center" h="100%" w="100%">
   <svg viewBox="0 0 66 64" width="55" height="52" role="img" aria-label={item.label} style={{flexShrink:0}}>
    {graphic}
   </svg>
   <Text size="xs" ta="center" fz={9} lh={1.05} lineClamp={2} px={2}>{item.label}</Text>
  </Stack>
 </Box>;
}
export default function BrowserElementPicker({opened,tab,onTabChange,onClose,onSelect}:Props){
 const renderItems=(items:BrowserPickerItem[])=> <ScrollArea h="100%" type="auto">
  <SimpleGrid cols={{base:2,sm:4}}>
   {items.map(item=><Card key={item.type} withBorder p="xs"
      style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
     <Box role="button" tabIndex={0} aria-label={'Select '+item.label} title={item.label}
      style={{cursor:'pointer',outlineOffset:3}}
      onClick={()=>onSelect(item)}
      onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(item);}}}>
      <ElementThumbnail item={item}/>
     </Box>
    </Card>)}
  </SimpleGrid>
 </ScrollArea>;
 return <AppModal opened={opened} onClose={onClose} title="Add Layout Element"
  size="lg" returnFocus={false} centered draggable
  styles={{
   content:{height:'min(620px, calc(100dvh - 32px))',display:'flex',flexDirection:'column'},
   body:{flex:1,minHeight:0,overflow:'hidden'},
  }}>
  <Tabs value={tab} onChange={value=>onTabChange(value==='decorations'?'decorations':'railway')}
   style={{height:'100%',display:'flex',flexDirection:'column'}}>
   <Tabs.List grow>
    <Tabs.Tab value="railway">Railway elements</Tabs.Tab>
    <Tabs.Tab value="decorations">Decorations</Tabs.Tab>
   </Tabs.List>
   <Tabs.Panel value="railway" pt="sm" style={{flex:1,minHeight:0}}>
    {renderItems(RAILWAY_PICKER_ITEMS)}
   </Tabs.Panel>
   <Tabs.Panel value="decorations" pt="sm" style={{flex:1,minHeight:0}}>
    {renderItems(DECORATION_PICKER_ITEMS)}
   </Tabs.Panel>
  </Tabs>
 </AppModal>;
}
