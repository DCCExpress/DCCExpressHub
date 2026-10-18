import { Card, ScrollArea, SimpleGrid, Tabs } from '@mantine/core';
import AppModal from './components/common/AppModal';
import { ELEMENT_TYPES } from './preview-webui/domain/layout/elementTypes';
import type { BaseElement } from './preview-webui/models/editor/core/BaseElement';
import ElementPreview from './preview-webui/models/editor/rendering/ElementPreviewRenderer';

import { TrackDirectionElement } from './preview-webui/models/editor/elements/TrackDirectionElement';
import { TrackStraightElement } from './preview-webui/models/editor/elements/TrackStraightElement';
import { TrackEndElement } from './preview-webui/models/editor/elements/TrackEndElement';
import { TrackCornerElement } from './preview-webui/models/editor/elements/TrackCornerElement';
import { TrackCurveElement } from './preview-webui/models/editor/elements/TrackCurveElement';
import { TrackCrossingElement } from './preview-webui/models/editor/elements/TrackCrossingElement';
import { TrackLevelCrossingElement } from './preview-webui/models/editor/elements/TrackLevelCrossingElement';
import { TrackTurnoutLeftElement } from './preview-webui/models/editor/elements/TrackTurnoutLeftElement';
import { TrackTurnoutRightElement } from './preview-webui/models/editor/elements/TrackTurnoutRightElement';
import { TrackTurnoutTwoWayElement } from './preview-webui/models/editor/elements/TrackTurnoutTwoWayElement';
import { TrackTurnoutThreeWayElement } from './preview-webui/models/editor/elements/TrackTurnoutThreeWayElement';
import TrackTurnoutDoubleElement from './preview-webui/models/editor/elements/TrackTurnoutDoubleElement';
import { TrackBridgeElement } from './preview-webui/models/editor/elements/TrackBridgeElement';
import { TrackSensorElement } from './preview-webui/models/editor/elements/TrackSensorElement';
import { BlockElement } from './preview-webui/models/editor/elements/BlockElement';
import { TrackSignalElement } from './preview-webui/models/editor/elements/TrackSignalElement';
import { ButtonElement } from './preview-webui/models/editor/elements/ButtonElement';
import { RouteButtonElement } from './preview-webui/models/editor/elements/RouteButtonElement';
import { AudioButtonElement } from './preview-webui/models/editor/elements/AudioButtonElement';
import { ClockElement } from './preview-webui/models/editor/elements/ClockElement';
import { LabelElement } from './preview-webui/models/editor/elements/LabelElement';
import { EmergencyButtonElement } from './preview-webui/models/editor/elements/EmergencyButtonElement';
import { TreeElement } from './preview-webui/models/editor/elements/TreeElement';
import { BushElement } from './preview-webui/models/editor/elements/BushElement';
import { LampElement } from './preview-webui/models/editor/elements/LampElement';
import { StationBuildingElement } from './preview-webui/models/editor/elements/StationBuildingElement';
import { SwitchmanHutElement } from './preview-webui/models/editor/elements/SwitchmanHutElement';
import { GardenHouseElement } from './preview-webui/models/editor/elements/GardenHouseElement';

// These are the original web-ui editor model instances and the original ElementPreview
// renderer. Only the localization labels and browser-only backend adapters differ.
export type BrowserPickerItem = {type:string;label:string;preview:BaseElement};
type Props={
 opened:boolean;tab:'railway'|'decorations';
 onTabChange:(tab:'railway'|'decorations')=>void;
 onClose:()=>void;onSelect:(item:BrowserPickerItem)=>void;
};
function clockPreview(){const clock=new ClockElement(0,0);clock.scale=0.35;return clock;}
function signalPreview(){return new TrackSignalElement(0,0);}
function stationPreview(){const v=new StationBuildingElement(0,0);v.size=1;return v;}
function guardPreview(){const v=new SwitchmanHutElement(0,0);v.size=1;return v;}
function gardenPreview(){const v=new GardenHouseElement(0,0);v.gardenWidth=2;v.gardenHeight=2;return v;}

export const RAILWAY_PICKER_ITEMS:BrowserPickerItem[]=[
 {type:ELEMENT_TYPES.TRACK_DIRECTION,label:'Direction',preview:new TrackDirectionElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_STRAIGHT,label:'Straight',preview:new TrackStraightElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_END,label:'Track end',preview:new TrackEndElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_CORNER,label:'Corner',preview:new TrackCornerElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_CURVE,label:'Curve',preview:new TrackCurveElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_CROSSING,label:'Crossing',preview:new TrackCrossingElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_LEVEL_CROSSING,label:'Level crossing',preview:new TrackLevelCrossingElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_TURNOUT_LEFT,label:'Left turnout',preview:new TrackTurnoutLeftElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_TURNOUT_RIGHT,label:'Right turnout',preview:new TrackTurnoutRightElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_TURNOUT_TWO_WAY,label:'Y turnout',preview:new TrackTurnoutTwoWayElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_TURNOUT_THREE_WAY,label:'Three-way turnout',preview:new TrackTurnoutThreeWayElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_BRIDGE,label:'Bridge',preview:new TrackBridgeElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_TURNOUT_DOUBLE,label:'Double turnout',preview:new TrackTurnoutDoubleElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_SENSOR,label:'Sensor',preview:new TrackSensorElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_BLOCK,label:'Block',preview:new BlockElement(0,0)},
 {type:ELEMENT_TYPES.TRACK_SIGNAL,label:'Signal',preview:signalPreview()},
 {type:ELEMENT_TYPES.BUTTON,label:'Output button',preview:new ButtonElement(0,0)},
 {type:ELEMENT_TYPES.BUTTON_ROUTE,label:'Route',preview:new RouteButtonElement(0,0)},
 {type:ELEMENT_TYPES.BUTTON_AUDIO,label:'Audio button',preview:new AudioButtonElement(0,0)},
 {type:ELEMENT_TYPES.CLOCK,label:'Fast clock',preview:clockPreview()},
 {type:ELEMENT_TYPES.LABEL,label:'Label',preview:new LabelElement(0,0)},
 {type:ELEMENT_TYPES.BUTTON_EMERGENCY,label:'Emergency stop',preview:new EmergencyButtonElement(0,0)}
];
export const DECORATION_PICKER_ITEMS:BrowserPickerItem[]=[
 {type:ELEMENT_TYPES.TREE,label:'Tree',preview:new TreeElement(0,0)},
 {type:ELEMENT_TYPES.BUSH,label:'Bush',preview:new BushElement(0,0)},
 {type:ELEMENT_TYPES.LAMP,label:'Lamp',preview:new LampElement(0,0)},
 {type:ELEMENT_TYPES.STATION_BUILDING,label:'Station building',preview:stationPreview()},
 {type:ELEMENT_TYPES.SWITCHMAN_HUT,label:'Guard house',preview:guardPreview()},
 {type:ELEMENT_TYPES.GARDEN_HOUSE,label:'House with garden',preview:gardenPreview()},
];

export default function BrowserElementPicker({opened,tab,onTabChange,onClose,onSelect}:Props){
 const render=(items:BrowserPickerItem[])=><ScrollArea h="100%" type="auto">
  <SimpleGrid cols={{base:2,sm:4}}>
   {items.map(item=><Card key={item.type} withBorder p="xs" style={{
     display:'flex',alignItems:'center',justifyContent:'center'
   }}>
    <ElementPreview element={item.preview} label={item.label} width={54} height={54}
       translateX={4} translateY={10} onClick={()=>onSelect(item)}/>
   </Card>)}
  </SimpleGrid>
 </ScrollArea>;
 return <AppModal opened={opened} onClose={onClose} title="Add Layout Element"
    size="lg" returnFocus={false} centered draggable
    styles={{content:{height:'min(620px, calc(100dvh - 32px))',display:'flex',flexDirection:'column'},
             body:{flex:1,minHeight:0,overflow:'hidden'}}}>
   <Tabs value={tab} onChange={value=>onTabChange(value==='decorations'?'decorations':'railway')}
     style={{height:'100%',display:'flex',flexDirection:'column'}}>
    <Tabs.List grow>
     <Tabs.Tab value="railway">Railway elements</Tabs.Tab>
     <Tabs.Tab value="decorations">Decorations</Tabs.Tab>
    </Tabs.List>
    <Tabs.Panel value="railway" pt="sm" style={{flex:1,minHeight:0}}>{render(RAILWAY_PICKER_ITEMS)}</Tabs.Panel>
    <Tabs.Panel value="decorations" pt="sm" style={{flex:1,minHeight:0}}>{render(DECORATION_PICKER_ITEMS)}</Tabs.Panel>
   </Tabs>
 </AppModal>;
}
