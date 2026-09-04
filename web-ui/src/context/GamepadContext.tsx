import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export const GAMEPAD_ACTION_OPTIONS = [
  { value: "speedUp", label: "Speed +" },
  { value: "speedDown", label: "Speed −" },
  { value: "forward", label: "Forward" },
  { value: "reverse", label: "Reverse" },
  { value: "stop", label: "Stop" },
  { value: "emergency", label: "Emergency stop" },
  { value: "function0", label: "Function F0" },
  { value: "function1", label: "Function F1" },
  { value: "function2", label: "Function F2" },
  { value: "function3", label: "Function F3" },
] as const;

export type GamepadAction =
  typeof GAMEPAD_ACTION_OPTIONS[number]["value"];

export type GamepadMapping = Partial<
  Record<GamepadAction, number>
>;

export type GamepadDeviceInfo = {
  index: number;
  id: string;
  mapping: string;
  buttonCount: number;
  axisCount: number;
};

type ActionListener = () => void;

type GamepadContextValue = {
  connected: boolean;
  gamepadId: string | null;
  gamepads: GamepadDeviceInfo[];
  selectedGamepadIndex: number | null;
  selectGamepad: (index: number) => void;
  mapping: GamepadMapping;
  setButtonAction: (
    button: number,
    action: GamepadAction | null
  ) => void;
  resetMapping: () => void;
  subscribe: (
    action: GamepadAction,
    callback: ActionListener
  ) => () => void;
};

const STORAGE_KEY =
  "dcc-express-lite.gamepad-mapping.v1";
const DEVICE_STORAGE_KEY =
  "dcc-express-lite.selected-gamepad.v1";

type SavedGamepadSelection = {
  id: string;
  index: number;
};

const DEFAULT_MAPPING: GamepadMapping = {
  speedUp: 12,
  speedDown: 13,
  forward: 15,
  reverse: 14,
  function0: 0,
  function1: 1,
  function2: 2,
  function3: 3,
  stop: 9,
  emergency: 8,
};

const ACTIONS = GAMEPAD_ACTION_OPTIONS.map(
  option => option.value
);

function isGamepadAction(
  value: string
): value is GamepadAction {
  return ACTIONS.some(action => action === value);
}

function normalizeMapping(
  value: unknown
): GamepadMapping | null {
  if (!value || typeof value !== "object") return null;

  const source = value as Record<string, unknown>;
  const result: GamepadMapping = {};
  const usedButtons = new Set<number>();

  for (const [action, button] of Object.entries(source)) {
    if (
      !isGamepadAction(action) ||
      !Number.isInteger(button) ||
      (button as number) < 0 ||
      usedButtons.has(button as number)
    ) {
      continue;
    }

    result[action] = button as number;
    usedButtons.add(button as number);
  }

  return result;
}

function loadMapping(): GamepadMapping {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MAPPING };

    return normalizeMapping(JSON.parse(raw)) ??
      { ...DEFAULT_MAPPING };
  } catch {
    return { ...DEFAULT_MAPPING };
  }
}

function loadSavedGamepad(): SavedGamepadSelection | null {
  try {
    const raw = window.localStorage.getItem(
      DEVICE_STORAGE_KEY
    );
    if (!raw) return null;

    const value = JSON.parse(raw) as
      Partial<SavedGamepadSelection>;

    if (
      typeof value.id !== "string" ||
      !Number.isInteger(value.index) ||
      (value.index as number) < 0
    ) {
      return null;
    }

    return {
      id: value.id,
      index: value.index as number,
    };
  } catch {
    return null;
  }
}

const GamepadContext =
  createContext<GamepadContextValue | null>(null);

export function GamepadProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [mapping, setMapping] =
    useState<GamepadMapping>(loadMapping);
  const [connected, setConnected] = useState(false);
  const [gamepadId, setGamepadId] =
    useState<string | null>(null);
  const [gamepads, setGamepads] =
    useState<GamepadDeviceInfo[]>([]);
  const [selectedGamepadIndex, setSelectedGamepadIndex] =
    useState<number | null>(null);
  const selectedGamepadIndexRef =
    useRef<number | null>(null);
  const savedGamepadRef = useRef<SavedGamepadSelection | null>(
    loadSavedGamepad()
  );
  const gamepadListSignatureRef = useRef("");
  const previousButtonsRef = useRef<boolean[]>([]);
  const suppressNextInputRef = useRef(false);
  const listenersRef = useRef<
    Map<GamepadAction, Set<ActionListener>>
  >(new Map());
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(mapping)
      );
    } catch {
      // Storage failure must not disable gamepad control.
    }
  }, [mapping]);

  const subscribe = useCallback(
    (action: GamepadAction, callback: ActionListener) => {
      let listeners = listenersRef.current.get(action);

      if (!listeners) {
        listeners = new Set<ActionListener>();
        listenersRef.current.set(action, listeners);
      }

      listeners.add(callback);

      return () => {
        listeners?.delete(callback);
        if (listeners?.size === 0) {
          listenersRef.current.delete(action);
        }
      };
    },
    []
  );

  const emit = useCallback((action: GamepadAction) => {
    listenersRef.current
      .get(action)
      ?.forEach(listener => listener());
  }, []);

  const setButtonAction = useCallback(
    (button: number, action: GamepadAction | null) => {
      if (!Number.isInteger(button) || button < 0) return;

      setMapping(current => {
        const next = { ...current };

        for (const actionName of ACTIONS) {
          if (next[actionName] === button) {
            delete next[actionName];
          }
        }

        if (action) next[action] = button;
        return next;
      });
    },
    []
  );

  const resetMapping = useCallback(() => {
    setMapping({ ...DEFAULT_MAPPING });
  }, []);

  const rememberGamepad = useCallback((gamepad: Gamepad) => {
    const selection: SavedGamepadSelection = {
      id: gamepad.id,
      index: gamepad.index,
    };

    savedGamepadRef.current = selection;
    selectedGamepadIndexRef.current = gamepad.index;
    setSelectedGamepadIndex(gamepad.index);
    previousButtonsRef.current = [];
    suppressNextInputRef.current = true;

    try {
      window.localStorage.setItem(
        DEVICE_STORAGE_KEY,
        JSON.stringify(selection)
      );
    } catch {
      // Device selection can still remain active for this page session.
    }
  }, []);

  const selectGamepad = useCallback((index: number) => {
    const gamepad = Array.from(
      navigator.getGamepads?.() ?? []
    ).find(
      (item): item is Gamepad =>
        !!item && item.connected && item.index === index
    );

    if (gamepad) rememberGamepad(gamepad);
  }, [rememberGamepad]);

  useEffect(() => {
    const poll = () => {
      const connectedGamepads = Array.from(
        navigator.getGamepads?.() ?? []
      ).filter(
        (item): item is Gamepad =>
          !!item && item.connected
      );

      const signature = connectedGamepads
        .map(gamepad =>
          `${gamepad.index}:${gamepad.id}:${gamepad.buttons.length}:${gamepad.axes.length}`
        )
        .join("|");

      if (signature !== gamepadListSignatureRef.current) {
        gamepadListSignatureRef.current = signature;
        setGamepads(connectedGamepads.map(gamepad => ({
          index: gamepad.index,
          id: gamepad.id,
          mapping: gamepad.mapping || "none",
          buttonCount: gamepad.buttons.length,
          axisCount: gamepad.axes.length,
        })));
      }

      if (connectedGamepads.length === 0) {
        setConnected(false);
        setGamepadId(null);
        selectedGamepadIndexRef.current = null;
        setSelectedGamepadIndex(null);
        previousButtonsRef.current = [];
        frameRef.current = requestAnimationFrame(poll);
        return;
      }

      const saved = savedGamepadRef.current;
      let gamepad = connectedGamepads.find(
        item =>
          item.index === selectedGamepadIndexRef.current &&
          (!saved || item.id === saved.id)
      ) ?? null;

      if (!gamepad) {
        gamepad = saved
          ? connectedGamepads.find(
            item =>
              item.index === saved.index &&
              item.id === saved.id
          ) ?? connectedGamepads.find(
            item => item.id === saved.id
          ) ?? null
          : null;

        // Select the first controller only for a client that has no saved
        // preference yet. If the chosen controller disappears, another one
        // must never silently take control of the locomotive.
        if (!saved) {
          gamepad = connectedGamepads[0] ?? null;
        }

        if (gamepad) rememberGamepad(gamepad);
      }

      if (!gamepad) {
        setConnected(false);
        setGamepadId(null);
        selectedGamepadIndexRef.current = null;
        setSelectedGamepadIndex(null);
        previousButtonsRef.current = [];
        frameRef.current = requestAnimationFrame(poll);
        return;
      }

      setConnected(true);
      setGamepadId(gamepad.id);

      const previous = previousButtonsRef.current;
      const current = gamepad.buttons.map(
        button => button.pressed
      );

      if (suppressNextInputRef.current) {
        suppressNextInputRef.current = false;
        previousButtonsRef.current = current;
        frameRef.current = requestAnimationFrame(poll);
        return;
      }

      for (const [actionName, buttonIndex] of
        Object.entries(mapping)) {
        if (buttonIndex === undefined) continue;

        const pressed = current[buttonIndex] ?? false;
        const wasPressed = previous[buttonIndex] ?? false;

        if (pressed && !wasPressed) {
          emit(actionName as GamepadAction);
        }
      }

      previousButtonsRef.current = current;
      frameRef.current = requestAnimationFrame(poll);
    };

    frameRef.current = requestAnimationFrame(poll);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [emit, mapping, rememberGamepad]);

  return (
    <GamepadContext.Provider
      value={{
        connected,
        gamepadId,
        gamepads,
        selectedGamepadIndex,
        selectGamepad,
        mapping,
        setButtonAction,
        resetMapping,
        subscribe,
      }}
    >
      {children}
    </GamepadContext.Provider>
  );
}

export function useGamepad() {
  const context = useContext(GamepadContext);

  if (!context) {
    throw new Error(
      "useGamepad must be used inside GamepadProvider"
    );
  }

  return context;
}

export function useGamepadAction(
  action: GamepadAction,
  callback: () => void,
  enabled = true
) {
  const { subscribe } = useGamepad();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    return subscribe(action, () => {
      callbackRef.current();
    });
  }, [action, enabled, subscribe]);
}
