import type {
  LayoutElementId,
  SerializedLayoutDto,
} from "../domain/layout/layoutDto";

export type AutomationBlockOption = {
  id: LayoutElementId;
  name: string;
  label: string;
};

function integer(
  value: unknown,
  min = 1,
  max = 65535
): number | null {
  const numeric =
    Number(value);

  return Number.isInteger(
    numeric
  ) &&
    numeric >= min &&
    numeric <= max
    ? numeric
    : null;
}

function blockName(
  value: unknown,
  id: number
): string {
  const name =
    String(
      value ??
      ""
    ).trim();

  return (
    name ||
    `Block ${id}`
  );
}

export function buildAutomationBlockCatalog(
  layout:
    SerializedLayoutDto
): AutomationBlockOption[] {
  const result:
    AutomationBlockOption[] =
    [];

  for (
    const layer of
    layout.layers ??
    []
  ) {
    for (
      const element of
      layer.elements ??
      []
    ) {
      if (
        element.type !==
        "trackblock"
      ) {
        continue;
      }

      const id =
        integer(
          element.id
        );

      if (
        id === null
      ) {
        continue;
      }

      const name =
        blockName(
          element.name,
          id
        );

      result.push({
        id,
        name,
        label:
          `${name} (ID #${id})`,
      });
    }
  }

  return result.sort(
    (
      a,
      b
    ) =>
      a.name.localeCompare(
        b.name,
        undefined,
        {
          numeric: true,
          sensitivity:
            "base",
        }
      )
  );
}

export async function loadAutomationBlockCatalog(): Promise<AutomationBlockOption[]> {
  const response =
    await fetch(
      "/api/layout",
      {
        cache:
          "no-store",
      }
    );

  if (!response.ok) {
    throw new Error(
      `Layout could not be loaded (${response.status}).`
    );
  }

  const layout =
    await response.json() as
      SerializedLayoutDto;

  return buildAutomationBlockCatalog(
    layout
  );
}
