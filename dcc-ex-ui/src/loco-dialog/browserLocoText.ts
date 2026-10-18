const texts:Record<string,string>={
 'locodialog.loco_functions':'Locomotive functions',
 'locodialog.functionname':'Name',
 'locodialog.function_startup_tooltip':'Turn on automatically when connecting to a locomotive',
 'locodialog.function_startup':'On connect',
 'locodialog.function_momentary':'Momentary',
 'locodialog.function_test':'Test',
 'locodialog.function_startup_unavailable_momentary':'Unavailable for momentary functions',
 'locodialog.functions_empty':'No locomotive functions',
 'ui.functionBinding':'Function binding',
 'ui.functionBindings':'Function bindings',
 'ui.functionBindingHint':'Choose an existing binding or add a new one.',
 'ui.functionBindingAdd':'Add binding',
 'ui.functionBindingInvalid':'Each binding must have a unique ID and a name.',
 'ui.icon':'Icon',
 'common.cancel':'Cancel',
};
export function browserLocoText(key:string):string{return texts[key]??key;}
