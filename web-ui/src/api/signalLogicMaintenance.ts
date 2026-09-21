const API_PATH="/api/signal-logic";

/*
 * Signal automation is address-authoritative.
 *
 * IMPORTANT:
 * Layout element IDs are editor identities only. This module deliberately
 * contains no delete-by-layout-ID operation. An integrity check must never
 * destroy automation merely because a layout element was recreated and got a
 * new ID.
 */

async function loadRawSignalLogic():Promise<string>{
  const response=await fetch(API_PATH,{method:"GET",cache:"no-store"});
  if(response.status===404)return "";
  if(!response.ok)throw new Error((await response.text()).trim()||"The signal automation file could not be loaded.");
  return response.text();
}

async function saveRawSignalLogic(content:string):Promise<void>{
  const response=await fetch(API_PATH,{method:"POST",headers:{"Content-Type":"application/x-ndjson"},body:content});
  if(!response.ok)throw new Error((await response.text()).trim()||"The signal automation file could not be saved.");
}

function parseObjectLine(rawLine:string):Record<string,unknown>|null{
  const line=rawLine.trim();if(!line)return null;
  try{const p=JSON.parse(line) as unknown;return typeof p==="object"&&p!==null&&!Array.isArray(p)?p as Record<string,unknown>:null;}catch{return null;}
}

export async function deleteSignalAutomationByAddress(signalAddress:number):Promise<boolean>{
  if(!Number.isInteger(signalAddress)||signalAddress<1||signalAddress>0xffff)throw new Error(`Invalid signal address ${signalAddress}.`);
  const content=await loadRawSignalLogic();if(!content)return false;
  const out:string[]=[];let removed=false;
  for(const raw of content.split(/\r?\n/u)){
    const row=parseObjectLine(raw);
    if(row?.kind==="signal"&&Number(row.address)===signalAddress){removed=true;continue;}
    if(raw.trim())out.push(raw);
  }
  if(!removed)return false;
  await saveRawSignalLogic(out.length?out.join("\n")+"\n":"");
  return true;
}

/*
 * Kept only as a hard failure for stale callers. We prefer a loud error over
 * silently deleting the wrong physical automation by an unstable layout ID.
 */
export async function deleteSignalAutomationById(signalId:number):Promise<boolean>{
  throw new Error(
    `Refusing to delete signal automation by layout ID ${signalId}. `+
    "Signal automation is address-authoritative; reopen Signal Logic and delete it by physical DCC address."
  );
}

export async function deleteAutomationReference(
  referenceType:"sensor"|"turnout",
  elementId:number
):Promise<number>{
  throw new Error(
    `Refusing to delete ${referenceType} automation by layout ID ${elementId}. `+
    "Conditions are address-authoritative and must be edited by physical address."
  );
}
