import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import type { TrackElement } from './storage';
import type { BrowserPickerItem } from './BrowserElementPicker';
import type { BaseElement } from './preview-webui/models/editor/core/BaseElement';
import { drawScene } from './preview-webui/track-canvas/trackCanvasDraw';
import { screenToGrid, getCenteredElementGridAnchor } from './preview-webui/track-canvas/trackCanvasGeometry';
import type { ViewState } from './preview-webui/track-canvas/TrackCanvas.types';
import { RAILWAY_PICKER_ITEMS, DECORATION_PICKER_ITEMS } from './BrowserElementPicker';

type BrowserTool='cursor'|'draw';
type Props={
 elements:TrackElement[];
 onElementsChange:(elements:TrackElement[])=>void;
 editMode:boolean;
 tool:BrowserTool;
 drawingElement:BrowserPickerItem|null;
 onToolChange:(tool:BrowserTool)=>void;
 fitCounter?:number;
 onSelectionChange?:(selected:TrackElement|null)=>void;
};
type Gesture={
 kind:'move'|'pan';
 pointerId:number; originClientX:number;originClientY:number;
 originalX:number;originalY:number; moved:boolean; elementId?:number;
};
const gridSize=40;
const pickerItems=[...RAILWAY_PICKER_ITEMS,...DECORATION_PICKER_ITEMS];
const pickerByType=new Map(pickerItems.map(item=>[item.type,item]));
const legacyKindMap:Record<string,string>={
 straight:'trackstraight',curve:'trackcurve',turnout:'trackturnoutleft',
 signal:'tracksignal',station:'stationbuilding',block:'trackblock',text:'label'
};
type ItemDto=TrackElement&{type?:string;rotation?:number;angle?:number;kind?:string;name?:string};
function resolveType(item:ItemDto):string {
 return item.type ?? (item.kind ? legacyKindMap[item.kind]??'' : '');
}
function restoreOne(item:TrackElement,ordinal:number):BaseElement|null {
 const data=item as ItemDto;
 const picker=pickerByType.get(resolveType(data));
 if(!picker)return null;
 const prototype=picker.preview;
 const ctor=prototype.constructor as new(x:number,y:number)=>BaseElement;
 const x=Number.isFinite(data.x)?data.x:0;
 const y=Number.isFinite(data.y)?data.y:0;
 try{
  const element=new ctor(x,y);
  Object.assign(element,data);
  // The upstream BaseElement uses numeric uint16 IDs (0 is unassigned).
  const persistedId=Number(data.id);
  element.id=Number.isInteger(persistedId)&&persistedId>0&&persistedId<=65535?persistedId:ordinal+1;
  element.x=x;element.y=y;
  if(data.rotation===undefined&&typeof data.angle==='number')element.rotation=data.angle;
  element.selected=false;
  return element;
 }catch(error){console.warn('Cannot restore original editor element:',data.type,error);return null;}
}
function serializeOne(element:BaseElement):TrackElement {
 // The original editor model owns the serialized DTO. Never flatten into a
 // custom SVG or lose original turnout, signal or decoration attributes.
 return element.toJSON() as unknown as TrackElement;
}
function newElement(item:BrowserPickerItem,x:number,y:number,id:number):BaseElement {
 const ctor=item.preview.constructor as new(x:number,y:number)=>BaseElement;
 const element=new ctor(x,y);
 element.id=id;
 element.x=x;element.y=y;
 element.selected=false;
 return element;
}
function nextNumericId(elements:BaseElement[]):number {
 const ids=new Set(elements.map(e=>e.id));
 for(let id=1;id<=65535;id++)if(!ids.has(id))return id;
 throw new Error('The layout reached the 65535-element ID limit');
}
export default function BrowserTrackCanvas({elements,onElementsChange,editMode,tool,drawingElement,onToolChange,fitCounter,onSelectionChange}:Props){
 const canvasRef=useRef<HTMLCanvasElement>(null);
 const parentRef=useRef<HTMLDivElement>(null);
 const models=useMemo(()=>elements.map(restoreOne).filter((e):e is BaseElement=>e!==null),[elements]);
 const modelsRef=useRef(models);modelsRef.current=models;
 const gesture=useRef<Gesture|null>(null);
 const view=useRef<ViewState>({scale:1,offsetX:0,offsetY:0});
 const hovered=useRef<{x:number;y:number}|null>(null);
 const selectedId=useRef<number|null>(null);
 const [canvasSize,setCanvasSize]=useState({width:0,height:0});
 const [cursor,setCursor]=useState<{x:number;y:number}|null>(null);
 const [renderVersion,setRenderVersion]=useState(0);
 const redraw=useCallback(()=>setRenderVersion(x=>x+1),[]);
 const selectedModel=()=>modelsRef.current.find(m=>m.id===selectedId.current)??null;
 const publishSelection=(element:BaseElement|null)=>{
  selectedId.current=element?.id??null;
  for(const model of modelsRef.current)model.selected=model===element;
  onSelectionChange?.(element?serializeOne(element):null);
  redraw();
 };
 const publish=()=>{
  const data=modelsRef.current.map(serializeOne);
  onElementsChange(data);
  redraw();
 };
 const fit=useCallback(()=>{
  const holder=parentRef.current;if(!holder)return;
  const width=holder.clientWidth,height=holder.clientHeight;
  const modelsNow=modelsRef.current;
  if(!modelsNow.length){view.current={scale:1,offsetX:Math.round(width/2)-80,offsetY:Math.round(height/2)-80};redraw();return;}
  const bounds=modelsNow.map(e=>e.getBounds());
  const left=Math.min(...bounds.map(b=>b.x))*gridSize;
  const top=Math.min(...bounds.map(b=>b.y))*gridSize;
  const right=Math.max(...bounds.map(b=>b.x+b.width))*gridSize;
  const bottom=Math.max(...bounds.map(b=>b.y+b.height))*gridSize;
  const scale=Math.max(.2,Math.min(3,Math.min((width-60)/Math.max(40,right-left),(height-60)/Math.max(40,bottom-top))));
  view.current={scale,offsetX:(width-(left+right)*scale)/2,offsetY:(height-(top+bottom)*scale)/2};
  redraw();
 },[redraw]);
 useEffect(()=>{
  const parent=parentRef.current;if(!parent)return;
  const observe=new ResizeObserver(()=>{
   const w=Math.max(1,Math.round(parent.clientWidth));const h=Math.max(1,Math.round(parent.clientHeight));
   setCanvasSize({width:w,height:h});
  });observe.observe(parent);
  setCanvasSize({width:Math.max(1,parent.clientWidth),height:Math.max(1,parent.clientHeight)});
  return()=>observe.disconnect();
 },[]);
 useEffect(()=>{if(fitCounter!==undefined)fit();},[fitCounter,fit]);
 useEffect(()=>{
  const canvas=canvasRef.current;if(!canvas||!canvasSize.width||!canvasSize.height)return;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const selected=selectedModel();
  const currentCursor=editMode&&tool==='draw'&&drawingElement
   ? newElement(drawingElement,cursor?.x??0,cursor?.y??0,0)
   : null;
  const layout={
   gridSize,
   draw:(context:CanvasRenderingContext2D,options:unknown)=>{
    for(const model of modelsRef.current){
     try{if(model.visible!==false)model.draw(context,options as never);}
     catch(error){console.error('Original track element draw error',model.type,model.id,error);}
    }
   },
  };
  drawScene(ctx,canvasSize.width,canvasSize.height,editMode,'dark',
   view.current,hovered.current??{x:0,y:0},
   {mode:tool,elementType:drawingElement?.type??'general'},
   hovered.current,currentCursor,layout as never,{
    showGrid:true,showOccupacySensorAddress:false,showSensorAddress:false,
    showSignalAddress:false,showTurnoutAddress:false,showSegments:false,
    showBlockNames:true,showBuildings:true
   } as never,undefined,selected??undefined,null,false,[]);
 },[canvasSize,renderVersion,elements,editMode,tool,drawingElement,cursor]);
 const localPoint=(event:PointerEvent<HTMLCanvasElement>)=>{
  const rect=event.currentTarget.getBoundingClientRect();
  return {x:event.clientX-rect.left,y:event.clientY-rect.top};
 };
 const hit=(g:{x:number;y:number}):BaseElement|null=>{
  for(let i=modelsRef.current.length-1;i>=0;i--){
   const element=modelsRef.current[i];
   if(element.visible!==false&&element.hitTest(g.x,g.y))return element;
  }
  return null;
 };
 const onPointerDown=(event:PointerEvent<HTMLCanvasElement>)=>{
  if(event.button!==0&&event.button!==1)return;
  event.currentTarget.setPointerCapture(event.pointerId);
  const p=localPoint(event);
  const g=screenToGrid(p.x,p.y,view.current,gridSize);
  if(event.button===0&&editMode&&tool==='draw'&&drawingElement){
   const instance=newElement(drawingElement,0,0,nextNumericId(modelsRef.current));
   const centered=getCenteredElementGridAnchor(instance,g);
   instance.x=centered.x;instance.y=centered.y;
   modelsRef.current.push(instance);
   publishSelection(instance);
   publish();
   return;
  }
  const element=event.button===0&&editMode&&tool==='cursor'?hit(g):null;
  if(element){
   publishSelection(element);
   gesture.current={kind:'move',pointerId:event.pointerId,originClientX:p.x,originClientY:p.y,
    originalX:element.x,originalY:element.y,moved:false,elementId:element.id};
  }else{
   if(editMode&&event.button===0)publishSelection(null);
   gesture.current={kind:'pan',pointerId:event.pointerId,originClientX:p.x,originClientY:p.y,
    originalX:view.current.offsetX,originalY:view.current.offsetY,moved:false};
  }
 };
 const onPointerMove=(event:PointerEvent<HTMLCanvasElement>)=>{
  const p=localPoint(event);const g=screenToGrid(p.x,p.y,view.current,gridSize);
  if(!hovered.current||hovered.current.x!==g.x||hovered.current.y!==g.y){
   hovered.current=g;setCursor(g);
  }
  const d=gesture.current;if(!d||d.pointerId!==event.pointerId)return;
  if(d.kind==='pan'){
   view.current={...view.current,offsetX:d.originalX+p.x-d.originClientX,offsetY:d.originalY+p.y-d.originClientY};
   redraw();
  }else{
   const element=modelsRef.current.find(e=>e.id===d.elementId);
   if(!element||element.locked)return;
   const dx=Math.round((p.x-d.originClientX)/(gridSize*view.current.scale));
   const dy=Math.round((p.y-d.originClientY)/(gridSize*view.current.scale));
   if(element.x!==d.originalX+dx||element.y!==d.originalY+dy){
    element.x=d.originalX+dx;element.y=d.originalY+dy;d.moved=true;redraw();
   }
  }
 };
 const onPointerUp=(event:PointerEvent<HTMLCanvasElement>)=>{
  const d=gesture.current;if(!d||d.pointerId!==event.pointerId)return;
  gesture.current=null;
  if(d.kind==='move'&&d.moved)publish();
 };
 const onWheel=(event:WheelEvent<HTMLCanvasElement>)=>{
  event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();
  const x=event.clientX-rect.left,y=event.clientY-rect.top;
  const old=view.current;const scale=Math.max(.2,Math.min(4,old.scale*(event.deltaY<0?1.13:1/1.13)));
  view.current={scale,offsetX:x-(x-old.offsetX)*scale/old.scale,offsetY:y-(y-old.offsetY)*scale/old.scale};
  redraw();
 };
 useEffect(()=>{
  const onKey=(event:KeyboardEvent)=>{
   if(!editMode||event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement)return;
   const selected=selectedModel();
   if(event.key==='Escape'){publishSelection(null);onToolChange('cursor');event.preventDefault();}
   if(!selected)return;
   if(event.key==='Delete'&&!selected.locked){
    modelsRef.current=modelsRef.current.filter(m=>m.id!==selected.id);
    publishSelection(null);publish();event.preventDefault();
   }
   if(event.key.toLowerCase()==='r'&&!selected.locked){
    selected.rotateRight();publish();event.preventDefault();
   }
  };
  window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
 },[editMode,onToolChange,onElementsChange]);
 const rotateSelected=()=>{
  const selected=selectedModel();if(!selected||selected.locked)return;
  selected.rotateRight();publish();
 };
 const deleteSelected=()=>{
  const selected=selectedModel();if(!selected||selected.locked)return;
  modelsRef.current=modelsRef.current.filter(m=>m.id!==selected.id);
  publishSelection(null);publish();
 };
 return <div ref={parentRef} className="browser-track-canvas" style={{
   position:'relative',width:'100%',height:'100%',minWidth:0,minHeight:0,overflow:'hidden',
   background:'#313131'
 }}>
  <canvas ref={canvasRef} width={canvasSize.width} height={canvasSize.height}
   onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
   onPointerCancel={onPointerUp} onPointerLeave={()=>{hovered.current=null;setCursor(null);}}
   onWheel={onWheel} onContextMenu={event=>event.preventDefault()}
   style={{width:'100%',height:'100%',display:'block',touchAction:'none',
    cursor:editMode?(tool==='draw'?'crosshair':'default'):'grab'}}/>
  <div style={{position:'absolute',right:8,top:8,display:'flex',gap:5}}>
   <button type="button" title="Fit layout" onClick={fit}>Fit</button>
   {editMode&&selectedModel()&&<>
    <button type="button" title="Rotate selection (R)" onClick={rotateSelected}>Rotate</button>
    <button type="button" title="Delete selection (Del)" onClick={deleteSelected}>Delete</button>
   </>}
  </div>
 </div>;
}
