// Offline render-only adapter. Picker thumbnails never access a command station.
const noop=()=>{};
export const wsClient={on:(_event:string,_cb:(data:any)=>void)=>noop,subscribeStatus:(_cb:(state:any)=>void)=>noop,
 subscribeMessages:(_cb:(data:any)=>void)=>noop,getLatestLocoState:(_address:number)=>undefined,
 getLatestSensorState:(_address:number)=>undefined,getLatestAccessoryState:(_address:number)=>undefined,
 send:(_message:unknown)=>false};
