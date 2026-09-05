export type PropertyEditorType =
  | "string"
  | "number"
  | "boolean"
  | "checkbox"
  | "colorpicker"
  | "bittoggle"
  | "signal2"
  | "turnoutSelection"
  | "audiofile"
  | "audioList"
  | "routeBlockSelect"
  | "blockTypeSelect"
  | "scriptEditor"
  | "select";

export interface IEditableProperty {
  label: string;
  key: string;
  type: PropertyEditorType;
  readonly?: boolean;
  validate?: (value: any) => boolean;
  min?: number;
  max?: number;
  callback?: () => void;
  options?: Array<{
    value: string;
    label: string;
  }>;
}
