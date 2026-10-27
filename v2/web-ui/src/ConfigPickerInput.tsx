import { ActionIcon, TextInput, type TextInputProps } from "@mantine/core";
import { IconDots } from "@tabler/icons-react";

type ConfigPickerInputProps = Omit<TextInputProps, "rightSection" | "readOnly" | "onClick"> & {
  onOpen: () => void;
  buttonLabel?: string;
};

export default function ConfigPickerInput({ onOpen, buttonLabel = "Configure", disabled, ...props }: ConfigPickerInputProps) {
  return (
    <TextInput {...props} readOnly disabled={disabled}
      rightSectionWidth={35}
      rightSection={
        <ActionIcon size="sm" variant="subtle" color="blue"
          disabled={disabled} aria-label={buttonLabel} title={buttonLabel}
          onClick={onOpen}>
          <IconDots size={18}/>
        </ActionIcon>
      }
      styles={{ input: { cursor: "default", paddingRight: 38 } }}
    />
  );
}
