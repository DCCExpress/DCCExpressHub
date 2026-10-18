// Read-only translation adapter for the upstream preview models. No runtime service access.
const i18next={t:(key:string)=>key, language:'en',isInitialized:true};
export default i18next;
