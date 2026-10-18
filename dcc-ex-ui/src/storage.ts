export interface FunctionBinding {id:number;name:string;}
export interface LocoFunction { bindingId?:number|null; id:string; number:number; name:string; icon:string; momentary:boolean; showOnLocoCard:boolean; startupActive:boolean; iconTintMode?:'original'|'tint'; iconColor?:string; }
export type LocoActionHook='beforeStart'|'afterStart'|'beforeStop'|'afterStop';
export type LocoAction={id:string;type:'setFunction'|'momentaryFunction'|'wait';functionNumber:number;active:boolean;ms:number};
export interface Loco {
 id:string;address:number;name:string;manufacturer:string;notes:string;image?:Blob;
 active?:boolean;maxSpeed?:number;cruisingSpeed?:number;invert?:boolean;length?:number;
 locomotiveLengthMm?:number;wagonsLengthMm?:number;trainConsistMode?:'pull'|'push';
 trainType?:'passenger'|'freight'|'mixed'|'maintenance'|'other';
 occupancyDetectionPosition?:'forward'|'reverse'|'both';trainDetectionOffsetMm?:number;
 trainClearanceMarginMm?:number;entireTrainDetectable?:boolean;
 functions?:LocoFunction[];actions?:Partial<Record<LocoActionHook,LocoAction[]>>;
 odometerKm?:number;operatingHours?:number;lastRunAt?:string;
 counterSettings?:{maxScaleSpeedKmh:number};decoderProfile?:{cvValues:Record<string,number>;readAt?:string;source:'service'};
}
export type ElementKind = 'straight'|'curve'|'turnout'|'signal'|'station'|'block'|'text';
export interface TrackElement { id:number|string; type?:string; kind?:ElementKind; x:number; y:number; angle?:number; rotation?:number; label?:string; name?:string; address?:number; [key:string]:unknown; }
export interface Project { version:1; elements:TrackElement[]; locos:Loco[]; functionBindings?:FunctionBinding[]; }
const DB='dcc-ex-ui'; const STORE='projects'; const KEY='current';
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function loadProject():Promise<Project>{const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const r=tx.objectStore(STORE).get(KEY);r.onsuccess=()=>resolve(r.result ?? {version:1,elements:[],locos:[]});r.onerror=()=>reject(r.error);});}finally{db.close();}}
export async function saveProject(project:Project):Promise<void>{const db=await open();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(project,KEY);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
function blobToDataURL(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
export async function exportProject(project:Project):Promise<void>{const locos=await Promise.all(project.locos.map(async loco=>({...loco,image:loco.image?await blobToDataURL(loco.image):undefined})));const data=JSON.stringify({...project,locos},null,2);const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='DCCExpressHub-alpha7.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
export async function importProject(file:File):Promise<Project>{const data:unknown=JSON.parse(await file.text());if(!data||typeof data!=='object'||!('version' in data)||data.version!==1||!('elements' in data)||!Array.isArray(data.elements)||!('locos' in data)||!Array.isArray(data.locos))throw new Error('Invalid or unsupported project');const input=data as Omit<Project,'locos'> & {locos:(Omit<Loco,'image'>&{image?:string|Blob})[]};const locos=await Promise.all(input.locos.map(async loco=>{let image:Blob|undefined;if(typeof loco.image==='string'&&loco.image.startsWith('data:image/')){const result=await fetch(loco.image);image=await result.blob();}else if(loco.image instanceof Blob) image=loco.image;return {...loco,image};}));return {version:1,elements:input.elements,locos,functionBindings:Array.isArray(input.functionBindings)?input.functionBindings:[]};}
