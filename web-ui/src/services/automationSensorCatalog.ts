import type {
  LayoutElementId,
  SerializedLayoutDto,
} from "../domain/layout/layoutDto";

export type AutomationSensorOption = {
  id: LayoutElementId;
  address: number;
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

  return (
    Number.isInteger(numeric) &&
    numeric >= min &&
    numeric <= max
  )
    ? numeric
    : null;
}

function isSignalOnlyType(
  value: unknown
): boolean {
  const type =
    String(
      value ??
      ""
    ).toLocaleLowerCase();

  return (
    type === "tracksignal" ||
    type === "tracksignal2" ||
    type === "tracksignal3" ||
    type === "tracksignal4"
  );
}

function userName(
  value: unknown
): string {
  const name =
    String(
      value ??
      ""
    ).trim();

  if (
    !name ||
    name === "element"
  ) {
    return "";
  }

  return name;
}

export function buildAutomationSensorCatalog(
  layout:
    SerializedLayoutDto
): AutomationSensorOption[] {
  const byAddress =
    new Map<
      number,
      AutomationSensorOption
    >();

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
        isSignalOnlyType(
          element.type
        )
      ) {
        continue;
      }

      const id =
        integer(
          element.id
        );

      const address =
        integer(
          element.address
        );

      if (
        id === null ||
        address === null ||
        byAddress.has(
          address
        )
      ) {
        continue;
      }

      const name =
        userName(
          element.name
        );

      byAddress.set(
        address,
        {
          id,
          address,
          name,
          label:
            name
              ? `Sensor ${address} · ${name}`
              : `Sensor ${address}`,
        }
      );
    }
  }

  return [
    ...byAddress.values(),
  ].sort(
    (
      a,
      b
    ) =>
      a.address -
      b.address
  );
}

export async function loadAutomationSensorCatalog(): Promise<AutomationSensorOption[]> {
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

  return buildAutomationSensorCatalog(
    layout
  );
}
