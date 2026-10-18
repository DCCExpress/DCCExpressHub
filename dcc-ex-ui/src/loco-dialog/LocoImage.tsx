import { useEffect, useState } from "react";
import { Card } from "@mantine/core";
import { IconTrain } from "@tabler/icons-react";


type LocoImageProps = {
  locoId?: string;
  image?: Blob | undefined;
  name?: string | undefined;
  width?: number;
  height?: number;
  clickable?: boolean;
  onClick?: (() => void) | undefined;
};

export default function LocoImage({
  locoId = "",
  image,
  name,
  width = 120,
  height = 90,
  clickable = false,
  onClick,
}: LocoImageProps) {
  const [source,setSource]=useState<string>();
  const [mirrored,setMirrored]=useState(()=>{
    try{return localStorage.getItem('dcc-ex-ui.imageMirror.'+locoId)==='true';}catch{return false;}
  });
  useEffect(()=>{
    if(!image){setSource(undefined);return;}
    const url=URL.createObjectURL(image);setSource(url);
    return()=>URL.revokeObjectURL(url);
  },[image]);
  useEffect(()=>{
    const listener=(e:Event)=>{
      const detail=(e as CustomEvent<{id:string;mirrored:boolean}>).detail;
      if(detail?.id===locoId)setMirrored(detail.mirrored);
    };
    window.addEventListener('dcc-ex-ui:loco-image-mirror',listener);
    return()=>window.removeEventListener('dcc-ex-ui:loco-image-mirror',listener);
  },[locoId]);

  return (
    <Card
      
      radius="sm"
      p={0}
      style={{
        height,
        maxWidth: width,
        width: "auto",
        overflow: "hidden",
        cursor: clickable ? "pointer" : "default",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }} onClick={onClick}
    >
      {source ? (
        <img
          src={source}
          alt={name || "Locomotive"}
          style={{
            height: "100%",
            width: "auto",
            maxWidth: "100%",
            objectFit: "contain",
            display: "block",
            transform: mirrored ? "scaleX(-1)" : undefined,
          }}
        />
      ) : (
        <IconTrain size={Math.min(width, height) * 0.35} />
      )}
    </Card>
  );
}

export function setLocoImageMirrored(id:string,mirrored:boolean){
  try{localStorage.setItem('dcc-ex-ui.imageMirror.'+id,String(mirrored));}catch{/* optional */}
  window.dispatchEvent(new CustomEvent('dcc-ex-ui:loco-image-mirror',{detail:{id,mirrored}}));
}
