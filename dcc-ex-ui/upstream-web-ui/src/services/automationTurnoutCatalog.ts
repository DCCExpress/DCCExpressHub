import type {
  LayoutElementId,
  SerializedLayoutDto,
  SerializedLayoutElementDto,
} from "../domain/layout/layoutDto";

export type AutomationTurnoutCommand = {
  address: number;
  closed: boolean;
};

export type AutomationTurnoutStateOption = {
  value: string;
  label: string;
  commands: AutomationTurnoutCommand[];
};

export type AutomationTurnoutOption = {
  id: LayoutElementId;
  label: string;
  name: string;
  kind:
    | "single"
    | "double"
    | "threeway";
  addresses: number[];
  states: AutomationTurnoutStateOption[];
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

function bool(
  value: unknown,
  fallback: boolean
): boolean {
  return typeof value ===
    "boolean"
    ? value
    : fallback;
}

function elementName(
  element:
    SerializedLayoutElementDto,
  fallback: string
): string {
  const name =
    String(
      element.name ??
      ""
    ).trim();

  if (
    !name ||
    name === "element" ||
    name
      .toLowerCase()
      .startsWith(
        "trackturnout"
      )
  ) {
    return fallback;
  }

  return name;
}

function semanticClosed(
  physical: boolean,
  closedValue: boolean
): boolean {
  return (
    physical ===
    closedValue
  );
}

function addressLabel(
  addresses: number[]
): string {
  return addresses
    .map(
      address =>
        `#${address}`
    )
    .join("/");
}

function singleTurnout(
  element:
    SerializedLayoutElementDto,
  id: LayoutElementId
): AutomationTurnoutOption | null {
  const address =
    integer(
      element.turnoutAddress,
      1,
      32767
    );

  if (
    address === null
  ) {
    return null;
  }

  const name =
    elementName(
      element,
      "Turnout"
    );

  return {
    id,
    label:
      `${name} (${addressLabel([address])})`,
    name,
    kind:
      "single",
    addresses: [
      address,
    ],
    states: [
      {
        value:
          "closed",
        label:
          "Closed",
        commands: [
          {
            address,
            closed:
              true,
          },
        ],
      },
      {
        value:
          "thrown",
        label:
          "Thrown",
        commands: [
          {
            address,
            closed:
              false,
          },
        ],
      },
    ],
  };
}

function doubleTurnout(
  element:
    SerializedLayoutElementDto,
  id: LayoutElementId
): AutomationTurnoutOption | null {
  const address1 =
    integer(
      element.turnout1Address,
      1,
      32767
    );

  const address2 =
    integer(
      element.turnout2Address,
      1,
      32767
    );

  if (
    address1 === null ||
    address2 === null
  ) {
    return null;
  }

  const closed1 =
    bool(
      element.turnout1ClosedValue,
      true
    );

  const closed2 =
    bool(
      element.turnout2ClosedValue,
      true
    );

  const name =
    elementName(
      element,
      "Double turnout"
    );

  const state =
    (
      value: string,
      label: string,
      firstPhysical: boolean,
      secondPhysical: boolean
    ): AutomationTurnoutStateOption => ({
      value,
      label,
      commands: [
        {
          address:
            address1,
          closed:
            semanticClosed(
              firstPhysical,
              closed1
            ),
        },
        {
          address:
            address2,
          closed:
            semanticClosed(
              secondPhysical,
              closed2
            ),
        },
      ],
    });

  return {
    id,
    label:
      `${name} (${addressLabel([address1, address2])})`,
    name,
    kind:
      "double",
    addresses: [
      address1,
      address2,
    ],
    states: [
      state(
        "oo",
        "O-O",
        bool(
          element.ooMotor1Value,
          !closed1
        ),
        bool(
          element.ooMotor2Value,
          !closed2
        )
      ),
      state(
        "oc",
        "O-C",
        bool(
          element.ocMotor1Value,
          !closed1
        ),
        bool(
          element.ocMotor2Value,
          closed2
        )
      ),
      state(
        "co",
        "C-O",
        bool(
          element.coMotor1Value,
          closed1
        ),
        bool(
          element.coMotor2Value,
          !closed2
        )
      ),
      state(
        "cc",
        "C-C",
        bool(
          element.ccMotor1Value,
          closed1
        ),
        bool(
          element.ccMotor2Value,
          closed2
        )
      ),
    ],
  };
}

function threeWayTurnout(
  element:
    SerializedLayoutElementDto,
  id: LayoutElementId
): AutomationTurnoutOption | null {
  const address1 =
    integer(
      element.turnout1Address,
      1,
      32767
    );

  const address2 =
    integer(
      element.turnout2Address,
      1,
      32767
    );

  if (
    address1 === null ||
    address2 === null
  ) {
    return null;
  }

  const closed1 =
    bool(
      element.turnout1ClosedValue,
      true
    );

  const closed2 =
    bool(
      element.turnout2ClosedValue,
      true
    );

  const name =
    elementName(
      element,
      "W turnout"
    );

  const state =
    (
      value: string,
      label: string,
      firstPhysical: boolean,
      secondPhysical: boolean
    ): AutomationTurnoutStateOption => ({
      value,
      label,
      commands: [
        {
          address:
            address1,
          closed:
            semanticClosed(
              firstPhysical,
              closed1
            ),
        },
        {
          address:
            address2,
          closed:
            semanticClosed(
              secondPhysical,
              closed2
            ),
        },
      ],
    });

  return {
    id,
    label:
      `${name} (${addressLabel([address1, address2])})`,
    name,
    kind:
      "threeway",
    addresses: [
      address1,
      address2,
    ],
    states: [
      state(
        "left",
        "Left",
        bool(
          element.leftMotor1Value,
          true
        ),
        bool(
          element.leftMotor2Value,
          false
        )
      ),
      state(
        "straight",
        "Straight",
        bool(
          element.straightMotor1Value,
          false
        ),
        bool(
          element.straightMotor2Value,
          false
        )
      ),
      state(
        "right",
        "Right",
        bool(
          element.rightMotor1Value,
          false
        ),
        bool(
          element.rightMotor2Value,
          true
        )
      ),
    ],
  };
}

export function buildAutomationTurnoutCatalog(
  layout:
    SerializedLayoutDto
): AutomationTurnoutOption[] {
  const result:
    AutomationTurnoutOption[] =
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
      const id =
        integer(
          element.id,
          1,
          65535
        );

      if (
        id === null
      ) {
        continue;
      }

      const type =
        String(
          element.type ??
          ""
        );

      let option:
        AutomationTurnoutOption |
        null =
        null;

      if (
        type ===
        "trackturnoutdouble"
      ) {
        option =
          doubleTurnout(
            element,
            id
          );
      } else if (
        type ===
        "trackturnouttreeway"
      ) {
        option =
          threeWayTurnout(
            element,
            id
          );
      } else if (
        type ===
          "trackturnoutleft" ||
        type ===
          "trackturnoutright" ||
        type ===
          "trackturnouttwoway"
      ) {
        option =
          singleTurnout(
            element,
            id
          );
      }

      if (option) {
        result.push(
          option
        );
      }
    }
  }

  return result.sort(
    (
      a,
      b
    ) =>
      (
        a.addresses[0] ??
        0
      ) -
      (
        b.addresses[0] ??
        0
      )
  );
}

export async function loadAutomationTurnoutCatalog(): Promise<AutomationTurnoutOption[]> {
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

  return buildAutomationTurnoutCatalog(
    layout
  );
}
