import { Card, ScrollArea, SimpleGrid } from "@mantine/core";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type {
  Loco,
} from "@domain/types";
import LocoFunctionButton from "./LocoFunctionButton";

type LocoFunctionGridProps = {
  loco: Loco;
  activeFunctions: Record<number, boolean>;
  disabled?: boolean;
  fitHeight?: boolean;
  onActiveFunctionsChange: Dispatch<
    SetStateAction<Record<number, boolean>>
  >;
};

export default function LocoFunctionGrid({
  loco,
  activeFunctions,
  disabled = false,
  fitHeight = false,
  onActiveFunctionsChange,
}: LocoFunctionGridProps) {
  const functionGap = 3;
  const functionPadding = 3;
  const buttons = Array.from({ length: 29 }, (_, index) => {
    const fn = loco.functions.find(item => item.number === index);
    return <LocoFunctionButton key={index} address={loco.address} fnNumber={index}
      fn={fn} active={!!activeFunctions[index]} activeFunctions={activeFunctions}
      disabled={disabled} onActiveFunctionsChange={onActiveFunctionsChange}
      fitHeight={fitHeight} />;
  });

  if (fitHeight) return (
    <Card withBorder radius="sm" p={functionPadding} style={{ flex: "1 1 0", height: "100%", minHeight: 0, overflow: "hidden" }}>
      <div className="tablet-loco-functions-grid" style={{ display: "grid", height: "100%", minHeight: 0,
        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        gridTemplateRows: "repeat(6, minmax(0, 1fr))", gap: functionGap }}>
        {buttons}
      </div>
    </Card>
  );

  return (
    <Card
      withBorder
      radius="sm"
      p={functionPadding}
      style={{
        flex: 1,
        minHeight: 0,
      }}
    >
      <ScrollArea
        style={{ height: "100%", minHeight: 0 }}
        type="auto"
      >
          <SimpleGrid
            cols={5}
            spacing={functionGap}
            verticalSpacing={functionGap}
          >
            {buttons}
          </SimpleGrid>
      </ScrollArea>
    </Card>
  );
}
