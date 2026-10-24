import { Select } from "@mantine/core";
import { originalText } from "./originalText";

import { BLOCK_TYPES } from "../preview-webui/domain/layout/elementTypes";
import type { BaseElement } from "../preview-webui/models/editor/core/BaseElement";
import type { IEditableProperty } from "../preview-webui/models/editor/elements/PropertyDescriptor";
type PropertyChangeHandler=(prop:IEditableProperty,value:unknown)=>void;

type BlockTypeSelectPropertyEditorProps = {
  prop: IEditableProperty;
  selectedElement: BaseElement;
  onChange: PropertyChangeHandler;
};

export default function BlockTypeSelectPropertyEditor({
  prop,
  selectedElement,
  onChange,
}: BlockTypeSelectPropertyEditorProps) {
  const t=originalText;

  return (
    <Select
      label={prop.label}
      placeholder={t("block.typePlaceholder")}
      data={[
        {
          value: BLOCK_TYPES.NORMAL,
          label: t("block.types.normal"),
        },
        {
          value: BLOCK_TYPES.STATION,
          label: t("block.types.station"),
        },
        {
          value: BLOCK_TYPES.TERMINAL,
          label: t("block.types.terminal"),
        },
        {
          value: BLOCK_TYPES.STAGING,
          label: t("block.types.staging"),
        },
        {
          value: BLOCK_TYPES.SIDING,
          label: t("block.types.siding"),
        },
        {
          value: BLOCK_TYPES.YARD,
          label: t("block.types.yard"),
        },
      ]}
      value={(selectedElement as any)[prop.key] ?? null}
      onChange={(value: string | null) =>
        onChange(prop, value ?? BLOCK_TYPES.NORMAL)
      }
      searchable={false}
      clearable={false}
      disabled={prop.readonly === true}
    />
  );
}
