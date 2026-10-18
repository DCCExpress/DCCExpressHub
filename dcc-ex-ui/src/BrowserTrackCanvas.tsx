import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import type { TrackElement } from './storage';
import type { BrowserPickerItem } from './BrowserElementPicker';
import type { BaseElement } from './preview-webui/models/editor/core/BaseElement';
import { drawScene } from './preview-webui/track-canvas/trackCanvasDraw';
import { screenToGrid, getCenteredElementGridAnchor } from './preview-webui/track-canvas/trackCanvasGeometry';
import type { ViewState, SelectionRect, DoubleTurnoutPopoverState } from './preview-webui/track-canvas/TrackCanvas.types';
import { TrackTurnoutElement } from './preview-webui/models/editor/elements/TrackTurnoutElement';
import { EmergencyButtonElement } from './preview-webui/models/editor/elements/EmergencyButtonElement';
import TrackTurnoutDoubleElement from './preview-webui/models/editor/elements/TrackTurnoutDoubleElement';
import { TrackTurnoutThreeWayElement } from './preview-webui/models/editor/elements/TrackTurnoutThreeWayElement';
import { TrackCanvasDoubleTurnoutPopover } from './track-canvas/TrackCanvasDoubleTurnoutPopover';
import { RAILWAY_PICKER_ITEMS, DECORATION_PICKER_ITEMS } from './BrowserElementPicker';
import { ELEMENT_TYPES, type ElementType } from './preview-webui/domain/layout/elementTypes';
import { loadSavedViewState, saveViewState } from './preview-webui/track-canvas/trackCanvasViewStorage';
import { getBridgePlacement } from './preview-webui/track-canvas/bridgePlacement';
import type { BrowserVisibility } from './property-panel/VisibilitySettings';
import { fitLayoutToView } from './preview-webui/track-canvas/trackCanvasLayoutBounds';
import { wsClient } from './preview-webui/services/wsClient';
import { getTrackCanvasCursor } from './preview-webui/track-canvas/trackCanvasCursor';

type BrowserTool='cursor'|'draw';
type Props={
 elements:TrackElement[];onElementsChange:(elements:TrackElement[])=>void;
 connected:boolean;onEmergencyStop:()=>void;
 editMode:boolean;tool:BrowserTool;drawingElement:BrowserPickerItem|null;
 onToolChange:(tool:BrowserTool)=>void;fitCounter?:number;deleteCounter?:number;
 onSelectionChange?:(selected:TrackElement|null)=>void;
 onSelectionCountChange?:(count:number)=>void;visibility:BrowserVisibility;
 onSave?:()=>void;onToggleEditMode?:()=>void;
};
type GridPoint={x:number;y:number};
type Moving={id:number;x:number;y:number};
type Gesture={
 kind:'pan'|'move'|'select';pointerId:number;startX:number;startY:number;
 startGrid:GridPoint;offsetX:number;offsetY:number;moving:Moving[];dirty:boolean;additive:boolean;
};
const gridSize=40;
const VIEW_KEY='dcc-ex-ui.layout.canvas.view';
const pickers=[...RAILWAY_PICKER_ITEMS,...DECORATION_PICKER_ITEMS];
const byType=new Map(pickers.map(item=>[item.type,item]));
const oldKinds:Record<string,string>={straight:ELEMENT_TYPES.TRACK_STRAIGHT,curve:ELEMENT_TYPES.TRACK_CURVE,
 turnout:ELEMENT_TYPES.TRACK_TURNOUT_LEFT,signal:ELEMENT_TYPES.TRACK_SIGNAL,
 station:ELEMENT_TYPES.STATION_BUILDING,block:ELEMENT_TYPES.TRACK_BLOCK,text:ELEMENT_TYPES.LABEL};
function cloneJson(data:TrackElement):TrackElement {
 return JSON.parse(JSON.stringify(data)) as TrackElement;
}
export function restoreBrowserElement(item:TrackElement,index:number):BaseElement|null{
 const dto=item as TrackElement&{kind?:string;rotation?:number;angle?:number;label?:string};
 const spec=byType.get(dto.type??oldKinds[dto.kind??'']??'');
 if(!spec)return null;
 const ctor=spec.preview.constructor as unknown as {
  new(x:number,y:number):BaseElement;fromJSON?:(json:unknown)=>BaseElement
 };
 try{
  // Use the original web-ui deserializer wherever available.
  let result:BaseElement;
  if(dto.type&&typeof ctor.fromJSON==='function'){
   try{result=ctor.fromJSON(dto);}catch{result=new ctor(dto.x,dto.y);Object.assign(result,dto);}
  }else{
   result=new ctor(dto.x,dto.y);
   Object.assign(result,dto);
  }
  if(!dto.type&&dto.label)result.name=dto.label;
  const id=Number(item.id);
  result.id=Number.isInteger(id)&&id>0&&id<=65535?id:index+1;
  // Original web-ui serializes turnout configuration but not physical runtime state.
  // Preserve it across browser project updates so a click actually changes the drawing.
  const stateFields=['turnoutClosed','turnout1Closed','turnout2Closed'] as const;
  for(const field of stateFields){
   const value=(dto as Record<string,unknown>)[field];
   if(typeof value==='boolean'&&field in result){
    (result as unknown as Record<string,unknown>)[field]=value;
   }
  }
  result.selected=false;result.marked=false;
  return result;
 }catch(error){console.warn('Cannot load web-ui editor element',item,error);return null;}
}
const serialize=(model:BaseElement):TrackElement=>{
 const dto=model.toJSON() as unknown as TrackElement;
 if(model instanceof TrackTurnoutDoubleElement || model instanceof TrackTurnoutThreeWayElement){
  return {...dto,turnout1Closed:model.turnout1Closed,turnout2Closed:model.turnout2Closed};
 }
 if(model instanceof TrackTurnoutElement)return {...dto,turnoutClosed:model.turnoutClosed};
 return dto;
};
function copyModel(model:BaseElement):BaseElement{
 const dto=cloneJson(serialize(model));
 const copy=restoreBrowserElement(dto,0);
 if(!copy)throw new Error('Cannot clone layout element');
 copy.id=0;copy.selected=false;copy.marked=false;
 return copy;
}
const rectsIntersect=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>
 a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const intersects=(a:BaseElement,b:BaseElement)=>
 rectsIntersect(a.type===ELEMENT_TYPES.TRACK_BLOCK&&b.type===ELEMENT_TYPES.TRACK_BLOCK?a.getBounds():a.getCollisionBounds(),
  a.type===ELEMENT_TYPES.TRACK_BLOCK&&b.type===ELEMENT_TYPES.TRACK_BLOCK?b.getBounds():b.getCollisionBounds());
const isButton=(m:BaseElement)=>
 m.layerName==='buttons'||[ELEMENT_TYPES.BUTTON,ELEMENT_TYPES.BUTTON_ROUTE,ELEMENT_TYPES.BUTTON_AUDIO,ELEMENT_TYPES.BUTTON_EMERGENCY].includes(m.type as typeof ELEMENT_TYPES.BUTTON);
const allocateId=(models:BaseElement[])=>{
 const used=new Set(models.map(m=>m.id));
 for(let id=1;id<=65535;id++)if(!used.has(id))return id;
 throw new Error('Layout is full (65535 IDs)');
};
export default function BrowserTrackCanvas({elements,onElementsChange,connected,onEmergencyStop,editMode,tool,drawingElement,onToolChange,
 fitCounter,deleteCounter,onSelectionChange,onSelectionCountChange,visibility,onSave,onToggleEditMode}:Props){
 const canvasRef=useRef<HTMLCanvasElement>(null);
 const holderRef=useRef<HTMLDivElement>(null);
 const selectedIds=useRef(new Set<number>());
 const [turnoutPopover,setTurnoutPopover]=useState<DoubleTurnoutPopoverState>({opened:false,x:0,y:0,turnout:null});
 const models=useMemo(()=>{
  const restored=elements.map(restoreBrowserElement).filter((v):v is BaseElement=>v!==null);
  const present=new Set(restored.map(m=>m.id));
  selectedIds.current=new Set([...selectedIds.current].filter(id=>present.has(id)));
  for(const model of restored)model.selected=selectedIds.current.has(model.id);
  return restored;
 },[elements]);
 const modelsRef=useRef(models);modelsRef.current=models;
 const cursorRef=useRef<BaseElement|null>(null);
 const clipboardRef=useRef<TrackElement|null>(null);
 const gesture=useRef<Gesture|null>(null);
 const view=useRef<ViewState>(loadSavedViewState(VIEW_KEY));
 const hover=useRef<GridPoint|null>(null);
 const mouseGrid=useRef<GridPoint>({x:0,y:0});
 const pointerInside=useRef(false);
 const selectRect=useRef<SelectionRect|null>(null);
 const undoStack=useRef<TrackElement[][]>([]);
 const redoStack=useRef<TrackElement[][]>([]);
 const [canvasSize,setCanvasSize]=useState({width:1,height:1});
 const [drawTick,setDrawTick]=useState(0);
 const redraw=useCallback(()=>setDrawTick(n=>n+1),[]);
 const [message,setMessage]=useState('');
 const [pointerCursor,setPointerCursor]=useState('default');
 const [panActive,setPanActive]=useState(false);
 // Sensor and disconnect events update the original shared occupancy cache.
 // Repaint without changing the editor project or writing runtime state to IndexedDB.
 useEffect(()=>{
  const unsubscribeChange=wsClient.on('sensorChanged',redraw);
  const unsubscribeSnapshot=wsClient.on('sensorSnapshot',redraw);
  const unsubscribeStatus=wsClient.subscribeStatus(()=>redraw());
  return()=>{unsubscribeChange();unsubscribeSnapshot();unsubscribeStatus();};
 },[redraw]);

 // Original TrackCanvas leaves no editable selection or ghost cursor in runtime mode.
 useEffect(()=>{
  if(editMode)return;
  setTurnoutPopover({opened:false,x:0,y:0,turnout:null});
  selectedIds.current.clear();
  for(const model of modelsRef.current){model.selected=false;model.marked=false;}
  cursorRef.current=null;
  hover.current=null;
  selectRect.current=null;
  gesture.current=null;
  setPanActive(false);
  onSelectionChange?.(null);
  onSelectionCountChange?.(0);
  redraw();
 },[editMode,onSelectionChange,onSelectionCountChange,redraw]);
 const modelsNow=()=>modelsRef.current;
 const selected=()=>modelsNow().filter(m=>selectedIds.current.has(m.id));
 const notifySelection=()=>{
  const one=selected();onSelectionChange?.(one.length===1?serialize(one[0]!):null);
  onSelectionCountChange?.(one.length);
  redraw();
 };
 const selectIds=(ids:Iterable<number>)=>{
  selectedIds.current=new Set(ids);
  for(const m of modelsNow())m.selected=selectedIds.current.has(m.id);
  notifySelection();
 };
 const saveHistory=()=>{
  undoStack.current.push(modelsNow().map(serialize).map(cloneJson));
  if(undoStack.current.length>60)undoStack.current.shift();
  redoStack.current=[];
 };
 const publish=()=>{
  onElementsChange(modelsNow().map(serialize));
  notifySelection();
 };
 const replaceHistory=(direction:'undo'|'redo')=>{
  const source=direction==='undo'?undoStack.current:redoStack.current;
  const destination=direction==='undo'?redoStack.current:undoStack.current;
  const snapshot=source.pop();if(!snapshot)return;
  destination.push(modelsNow().map(serialize).map(cloneJson));
  selectedIds.current.clear();
  modelsRef.current=snapshot.map(restoreBrowserElement).filter((e):e is BaseElement=>e!==null);
  onSelectionChange?.(null);
  onSelectionCountChange?.(0);
  publish();
 };
 const canPlace=(element:BaseElement,x:number,y:number,ignored=new Set<number>())=>{
  const prevX=element.x,prevY=element.y;
  element.x=x;element.y=y;
  try{
   if(element.type===ELEMENT_TYPES.TRACK_BRIDGE){
    return getBridgePlacement({track:{elements:modelsNow().filter(m=>m.layerName==='track')}},
      x,y,element.rotation,element.id).valid;
   }
   return !modelsNow().some(other=>other!==element&&!ignored.has(other.id)&&
    other.layerName===element.layerName&&intersects(element,other));
  }finally{element.x=prevX;element.y=prevY;}
 };
 const fit=useCallback(()=>{
  const node=holderRef.current;if(!node)return;
  const width=node.clientWidth,height=node.clientHeight;
  if(width<=0||height<=0)return;
  const elements=modelsRef.current.filter(m=>m.visible);
  if(!elements.length){
   view.current={scale:1,offsetX:Math.round(width/2),offsetY:Math.round(height/2)};
  }else{
   // The exact original web-ui TrackCanvas fitLayoutToView algorithm.
   const layout={gridSize,track:{elements},sensors:{elements:[]},signals:{elements:[]},
    blocks:{elements:[]},buildings:{elements:[]},buttons:{elements:[]}};
   fitLayoutToView(layout as never,view.current,width,height);
  }
  saveViewState(view.current,VIEW_KEY);
  redraw();
 },[redraw]);
 useEffect(()=>{
  const node=holderRef.current;if(!node)return;
  const resize=()=>setCanvasSize({width:Math.max(1,Math.round(node.clientWidth)),
   height:Math.max(1,Math.round(node.clientHeight))});
  const observer=new ResizeObserver(resize);observer.observe(node);resize();
  return()=>observer.disconnect();
 },[]);
 const fittedOnce=useRef(false);
 useEffect(()=>{
  if(!fittedOnce.current){
   fittedOnce.current=true;
   try{if(!localStorage.getItem(VIEW_KEY))fit();}catch{fit();}
  }else{fit();}
 },[fitCounter,fit]);
 useEffect(()=>{
  if(!drawingElement)return;
  const ctor=drawingElement.preview.constructor as unknown as new(x:number,y:number)=>BaseElement;
  cursorRef.current=new ctor(0,0);
  redraw();
 },[drawingElement,redraw]);
 const lastDelete=useRef(deleteCounter);
 useEffect(()=>{
  if(deleteCounter===undefined||deleteCounter===lastDelete.current)return;
  lastDelete.current=deleteCounter;
  const targets=selected().filter(m=>!m.locked);
  if(!targets.length)return;
  saveHistory();const ids=new Set(targets.map(m=>m.id));
  modelsRef.current=modelsNow().filter(m=>!ids.has(m.id));
  selectIds([]);publish();
 },[deleteCounter]);
 useEffect(()=>{
  const canvas=canvasRef.current;if(!canvas)return;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  // These are the exact original upstream drawScene + element.draw methods.
  const layout={gridSize,draw:(context:CanvasRenderingContext2D,options:unknown)=>{
   for(const model of modelsNow()){
    try{
     if(model.visible&&(visibility.showBuildings||model.layerName!=='buildings')){
      model.draw(context,options as never);
      // Original BaseElement.drawSelection paints the editor's red outline.
      // Apply it to every selected model, not just the first one.
      if(editMode&&tool==='cursor'&&selectedIds.current.has(model.id)){
       model.selected=true;
       model.drawSelection(context);
      }
     }
    }catch(err){console.error('Element drawing failed',model.type,err);}
   }
  }};
  drawScene(ctx,canvasSize.width,canvasSize.height,editMode,'dark',view.current,
   mouseGrid.current,{mode:tool,elementType:(cursorRef.current?.type??drawingElement?.type??ELEMENT_TYPES.GENERAL) as ElementType},
   hover.current,editMode&&tool==='draw'&&pointerInside.current?cursorRef.current:null,
   layout as never,visibility as never,
   undefined,selected()[0],selectRect.current,false,[]);
 },[canvasSize,drawTick,elements,editMode,tool,drawingElement,visibility]);
 const local=(event:PointerEvent<HTMLCanvasElement>):GridPoint=>{
  const rect=event.currentTarget.getBoundingClientRect();
  return {x:event.clientX-rect.left,y:event.clientY-rect.top};
 };
 const grid=(p:GridPoint)=>screenToGrid(p.x,p.y,view.current,gridSize);
 const hit=(g:GridPoint)=>{
  // As in upstream hit testing, buttons win over overlapping track.
  const all=modelsNow().filter(m=>m.visible&&(visibility.showBuildings||m.layerName!=='buildings'));
  const buttons=all.filter(isButton).reverse().find(m=>m.hitTest(g.x,g.y));
  return buttons??all.reverse().find(m=>m.hitTest(g.x,g.y))??null;
 };
 const onPointerDown=(event:PointerEvent<HTMLCanvasElement>)=>{
  if(event.button!==0&&event.button!==2)return;
  event.currentTarget.focus();
  const p=local(event),g=grid(p);
  // Original desktop behavior: only the right mouse button pans the layout.
  // Left-click in runtime mode operates an element; empty space does nothing.
  if(!editMode && event.button===0){
   const target=hit(g);
   if(target instanceof EmergencyButtonElement){
    if(connected)onEmergencyStop();
    else setMessage('Connect to DCC-EX before using E-STOP.');
    return;
   }
   const multi=target instanceof TrackTurnoutDoubleElement||target instanceof TrackTurnoutThreeWayElement;
   const single=target instanceof TrackTurnoutElement;
   if(multi||single){
    if(!connected){setMessage('Connect to DCC-EX before operating a turnout.');return;}
    if(!target.enabled||target.locked){setMessage('Turnout is disabled or locked.');return;}
    const addresses=multi?[target.turnout1Address,target.turnout2Address]:[target.turnoutAddress];
    if(addresses.some(address=>!Number.isInteger(address)||address<=0)){
     setMessage('Set the turnout accessory address in Edit mode first.');return;
    }
    setMessage('');
    if(multi){
     setTurnoutPopover({opened:true,x:event.clientX,y:event.clientY,turnout:target});
    }else if(single){
     target.toggle();
     publish();
    }
    return;
   }
  }
  if(event.button===2 || event.pointerType==='touch'){
   event.preventDefault();
   setPanActive(true);
   event.currentTarget.setPointerCapture(event.pointerId);
   gesture.current={kind:'pan',pointerId:event.pointerId,startX:p.x,startY:p.y,startGrid:g,
    offsetX:view.current.offsetX,offsetY:view.current.offsetY,moving:[],dirty:false,additive:false};
   return;
  }
  if(!editMode)return;
  event.currentTarget.setPointerCapture(event.pointerId);
  if(tool==='draw'&&cursorRef.current){
   const model=cursorRef.current,anchor=getCenteredElementGridAnchor(model,g);
   if(!canPlace(model,anchor.x,anchor.y)){
    setMessage('Another element occupies this layer.');redraw();return;
   }
   saveHistory();const placed=copyModel(model);
   placed.id=allocateId(modelsNow());placed.x=anchor.x;placed.y=anchor.y;
   if(placed.type===ELEMENT_TYPES.TRACK_BRIDGE){
    const bridge=getBridgePlacement({track:{elements:modelsNow().filter(m=>m.layerName==='track')}},
      anchor.x,anchor.y,placed.rotation);
    if(!bridge.valid)return;
    placed.rotation=bridge.rotation;
   }
   modelsRef.current=[...modelsNow(),placed];
   // Like original web-ui: keep the current drawing tool for repeated placement.
   publish();setMessage('');return;
  }
  if(tool!=='cursor')return;
  const elem=hit(g);
  const additive=event.ctrlKey||event.metaKey;
  if(elem){
   if(additive){
    const ids=new Set(selectedIds.current);
    if(ids.has(elem.id))ids.delete(elem.id);else ids.add(elem.id);
    selectIds(ids);return;
   }
   if(!selectedIds.current.has(elem.id))selectIds([elem.id]);
   const moving=selected().filter(m=>!m.locked).map(m=>({id:m.id,x:m.x,y:m.y}));
   gesture.current={kind:'move',pointerId:event.pointerId,startX:p.x,startY:p.y,startGrid:g,
    offsetX:0,offsetY:0,moving,dirty:false,additive:false};
   return;
  }
  if(!additive)selectIds([]);
  selectRect.current={startGridX:g.x,startGridY:g.y,endGridX:g.x,endGridY:g.y};
  gesture.current={kind:'select',pointerId:event.pointerId,startX:p.x,startY:p.y,startGrid:g,
   offsetX:0,offsetY:0,moving:[],dirty:false,additive};
  redraw();
 };
 const onPointerMove=(event:PointerEvent<HTMLCanvasElement>)=>{
  const p=local(event),g=grid(p),d=gesture.current;
  pointerInside.current=true;
  mouseGrid.current=g;
  if(editMode&&tool==='draw'&&cursorRef.current){
   const position=getCenteredElementGridAnchor(cursorRef.current,g);
   hover.current=canPlace(cursorRef.current,position.x,position.y)?null:position;
  }else{hover.current=null;}
  if(!editMode){
   const nextCursor=getTrackCanvasCursor(false,{mode:'cursor',elementType:ELEMENT_TYPES.GENERAL},hit(g));
   setPointerCursor(nextCursor);
  }
  if(!d||d.pointerId!==event.pointerId){redraw();return;}
  if(d.kind==='pan'){
   view.current={...view.current,offsetX:d.offsetX+p.x-d.startX,
    offsetY:d.offsetY+p.y-d.startY};saveViewState(view.current,VIEW_KEY);redraw();return;
  }
  if(d.kind==='select'){
   selectRect.current={startGridX:d.startGrid.x,startGridY:d.startGrid.y,endGridX:g.x,endGridY:g.y};
   redraw();return;
  }
  const dx=g.x-d.startGrid.x,dy=g.y-d.startGrid.y;
  if(!dx&&!dy&&!d.dirty)return;
  const movingIds=new Set(d.moving.map(item=>item.id));
  for(const item of d.moving){
   const model=modelsNow().find(m=>m.id===item.id);if(!model)continue;
   if(!canPlace(model,item.x+dx,item.y+dy,movingIds)){setMessage('Occupied position');redraw();return;}
  }
  if(!d.dirty){saveHistory();d.dirty=true;}
  for(const item of d.moving){
   const model=modelsNow().find(m=>m.id===item.id);if(!model)continue;
   model.x=item.x+dx;model.y=item.y+dy;
  }
  setMessage('');redraw();
 };
 const onPointerEnd=(event:PointerEvent<HTMLCanvasElement>)=>{
  const d=gesture.current;if(!d||d.pointerId!==event.pointerId)return;
  gesture.current=null;
  if(d.kind==='pan'){
   setPanActive(false);
   saveViewState(view.current,VIEW_KEY);
  }
  if(d.kind==='select'&&selectRect.current){
   const r=selectRect.current;selectRect.current=null;
   const left=Math.min(r.startGridX,r.endGridX),right=Math.max(r.startGridX,r.endGridX);
   const top=Math.min(r.startGridY,r.endGridY),bottom=Math.max(r.startGridY,r.endGridY);
   const ids=d.additive?new Set(selectedIds.current):new Set<number>();
   for(const m of modelsNow()){
    if(!m.visible)continue;
    const b=m.getBounds();
    if(b.x<=right&&b.x+b.width-1>=left&&b.y<=bottom&&b.y+b.height-1>=top)ids.add(m.id);
   }
   selectIds(ids);redraw();return;
  }
  if(d.kind==='move'&&d.dirty)publish();else redraw();
 };
 const onWheel=(event:WheelEvent<HTMLCanvasElement>)=>{
  event.preventDefault();const p=local(event as unknown as PointerEvent<HTMLCanvasElement>);
  const old=view.current;
  const scale=Math.max(.2,Math.min(4,old.scale*(event.deltaY<0?1.13:1/1.13)));
  view.current={scale,offsetX:p.x-(p.x-old.offsetX)*scale/old.scale,
   offsetY:p.y-(p.y-old.offsetY)*scale/old.scale};saveViewState(view.current,VIEW_KEY);redraw();
 };
 useEffect(()=>{
  const keyDown=(event:KeyboardEvent)=>{
   if(document.activeElement!==canvasRef.current)return;
   const plainKey=event.key.toLowerCase();
   if((event.ctrlKey||event.metaKey)&&plainKey==='s'){event.preventDefault();onSave?.();return;}
   if(plainKey==='e'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();onToggleEditMode?.();return;}
   if(plainKey==='f'){event.preventDefault();fit();return;}
   if(!editMode)return;
   const ctrl=event.ctrlKey||event.metaKey;
   const key=event.key.toLowerCase();
   if((event.key==='Escape'||key==='escape')){
    selectIds([]);cursorRef.current=null;onToolChange('cursor');event.preventDefault();return;
   }
   if(ctrl&&key==='z'){event.preventDefault();replaceHistory(event.shiftKey?'redo':'undo');return;}
   if(ctrl&&key==='y'){event.preventDefault();replaceHistory('redo');return;}
   if(ctrl&&key==='c'){
    const only=selected();if(only.length!==1)return;
    event.preventDefault();clipboardRef.current=cloneJson(serialize(only[0]!));
    cursorRef.current=copyModel(only[0]!);
    onToolChange('draw');redraw();return;
   }
   if(ctrl&&key==='v'){
    if(!clipboardRef.current)return;
    event.preventDefault();
    const copied=restoreBrowserElement(clipboardRef.current,0);
    if(!copied)return;
    cursorRef.current=copyModel(copied);onToolChange('draw');redraw();return;
   }
   if(key==='r'&&!ctrl){
    if(tool==='draw'&&cursorRef.current){
     event.preventDefault();cursorRef.current.rotateRight();redraw();return;
    }
    const targets=selected().filter(m=>!m.locked);
    if(!targets.length)return;
    event.preventDefault();saveHistory();
    for(const model of targets)model.rotateRight();
    publish();return;
   }
   if(event.key==='Delete'||event.key==='Backspace'){
    const ids=new Set(selected().filter(m=>!m.locked).map(m=>m.id));
    if(!ids.size)return;
    event.preventDefault();saveHistory();
    modelsRef.current=modelsNow().filter(m=>!ids.has(m.id));
    selectIds([]);publish();
   }
  };
  window.addEventListener('keydown',keyDown);
  return()=>window.removeEventListener('keydown',keyDown);
 },[editMode,tool,onToolChange,onElementsChange,fit,onSave,onToggleEditMode]);
 return <div ref={holderRef} className="browser-track-canvas" style={{
  position:'relative',width:'100%',height:'100%',minWidth:0,minHeight:0,overflow:'hidden',background:'#313131'
 }}>
  <canvas ref={canvasRef} tabIndex={0} width={canvasSize.width} height={canvasSize.height}
   onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd}
   onPointerCancel={onPointerEnd} onPointerLeave={()=>{pointerInside.current=false;setPointerCursor('default');if(!gesture.current)hover.current=null;redraw();}}
   onWheel={onWheel} onContextMenu={event=>event.preventDefault()}
   style={{width:'100%',height:'100%',display:'block',touchAction:'none',
    outline:'none',cursor:panActive?'grabbing':editMode?tool==='draw'?'crosshair':'default':pointerCursor}}/>
  <TrackCanvasDoubleTurnoutPopover state={turnoutPopover}
   onClose={()=>setTurnoutPopover({opened:false,x:0,y:0,turnout:null})}
   onChanged={()=>{publish();setMessage('');}}/>
  {message&&<div role="status" style={{position:'absolute',left:10,bottom:10,
    background:'rgba(30,22,20,.85)',color:'#ffd0a0',fontSize:12,padding:'3px 7px',
    borderRadius:4,pointerEvents:'none'}}>{message}</div>}
 </div>;
}
