// Browser-only runtime event adapter for the original web-ui editor models.
// Commands remain on App's real DCC-EX WebSocket; this module only distributes feedback.
type SensorChange={address:number;on:boolean};
type SensorSnapshot={groups:Array<[number,number,number]>};
type Listener=(data:any)=>void;
const listeners=new Map<string,Set<Listener>>();
let status='disconnected';
const statuses=new Set<(state:string)=>void>();
function emit(event:string,payload:unknown){for(const fn of listeners.get(event)??[]){try{fn(payload);}catch(error){console.error('DCC-EX feedback subscriber error',error);}}}
export function publishSensorFeedback(address:number,on:boolean){
 if(!Number.isInteger(address)||address<=0||address>65535)return;
 emit('sensorChanged',{address,on} satisfies SensorChange);
}
export function publishSensorSnapshot(groups:SensorSnapshot['groups']){
 emit('sensorSnapshot',{groups} satisfies SensorSnapshot);
}
export function publishConnectionStatus(next:string){
 status=next;
 for(const fn of statuses){try{fn(next);}catch(error){console.error('DCC-EX connection listener error',error);}}
}
export const wsClient={
 on:(event:string,callback:Listener)=>{
  let group=listeners.get(event);if(!group){group=new Set();listeners.set(event,group);}group.add(callback);
  return()=>{group?.delete(callback);};
 },
 subscribeStatus:(callback:(state:string)=>void)=>{statuses.add(callback);callback(status);return()=>statuses.delete(callback);},
 subscribeMessages:(_callback:(data:unknown)=>void)=>()=>{},
 getLatestLocoState:(_address:number)=>undefined,
 getLatestSensorState:(_address:number)=>undefined,
 getLatestAccessoryState:(_address:number)=>undefined,
 send:(_message:unknown)=>false,
};
