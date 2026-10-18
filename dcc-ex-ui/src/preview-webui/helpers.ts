export const generateId=()=>crypto.randomUUID();
export const errorToString=(error:unknown)=>error instanceof Error?error.message:String(error);
export const showErrorMessage=(_title:string,_detail?:string)=>{};
export const showWarningMessage=(_title:string,_detail?:string)=>{};
