import { useCallback, useEffect, useMemo, useState } from "react";
import { wsClient } from "@/services/wsClient";

export type DebugStateValue<T> = { value: T; updatedAt: number };
export type SensorDebugState = Map<number, DebugStateValue<boolean>>;
export type TurnoutDebugState = Map<number, DebugStateValue<boolean>>;
export type BasicAccessoryDebugState = Map<number, DebugStateValue<boolean>>;
export type ExtendedAccessoryDebugState = Map<number, DebugStateValue<number>>;

function updatedMap<T>(previous: Map<number, DebugStateValue<T>>, address: number, value: T, updatedAt = Date.now()) {
  const next = new Map(previous);
  next.set(address, { value, updatedAt });
  return next;
}

export function useRuntimeDebugState(active: boolean) {
  const [sensors,setSensors]=useState<SensorDebugState>(()=>new Map());
  const [turnouts,setTurnouts]=useState<TurnoutDebugState>(()=>new Map());
  const [basicAccessories,setBasicAccessories]=useState<BasicAccessoryDebugState>(()=>new Map());
  const [extendedAccessories,setExtendedAccessories]=useState<ExtendedAccessoryDebugState>(()=>new Map());
  const [connected,setConnected]=useState(wsClient.isConnected());

  const refresh=useCallback(()=>{
    if (!wsClient.isConnected()) return;
    wsClient.send({type:"getLayoutRuntimeSnapshot",data:{}});
  },[]);

  useEffect(()=>wsClient.subscribeStatus(status=>setConnected(status==="connected")),[]);

  useEffect(()=>{
    if(!active)return;
    const u1=wsClient.on("sensorChanged",data=>setSensors(p=>updatedMap(p,data.address,data.on)));
    const u2=wsClient.on("sensorSnapshot",data=>{
      const now=Date.now();
      setSensors(previous=>{
        const next=new Map(previous);
        for(const [baseAddress,activeBits,knownBits] of data.groups){
          for(let bit=0;bit<16;bit++){
            const mask=1<<bit;
            if((knownBits&mask)===0)continue;
            next.set(baseAddress+bit,{value:(activeBits&mask)!==0,updatedAt:now});
          }
        }
        return next;
      });
    });
    const u3=wsClient.on("turnoutChanged",data=>setTurnouts(p=>updatedMap(p,data.address,data.closed)));
    const u4=wsClient.on("accessoryChanged",data=>setBasicAccessories(p=>updatedMap(p,data.address,data.active)));
    const u5=wsClient.on("signalAspectChanged",data=>setExtendedAccessories(p=>updatedMap(p,data.address,data.aspect)));
    refresh();
    return()=>{u1();u2();u3();u4();u5();};
  },[active,refresh]);

  return useMemo(()=>({sensors,turnouts,basicAccessories,extendedAccessories,refresh,connected}),[sensors,turnouts,basicAccessories,extendedAccessories,refresh,connected]);
}
