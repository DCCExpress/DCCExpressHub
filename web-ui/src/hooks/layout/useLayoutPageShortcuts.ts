
import {
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";

import type {
  EditorTool,
} from "../../models/editor/types/EditorTypes";

type EditorToolSetter =
  Dispatch<SetStateAction<EditorTool>>;

type BooleanSetter =
  Dispatch<SetStateAction<boolean>>;

export type UseLayoutPageShortcutsParams = {
  saveLayoutToServer: () => Promise<void>;
  setTool: EditorToolSetter;
  setEditMode: BooleanSetter;
  blockSelectionActive?: boolean;
  editMode?: boolean;
  undoLayout?: () => void;
  redoLayout?: () => void;
};

export function useLayoutPageShortcuts({
  saveLayoutToServer,
  setTool,
  setEditMode,
  blockSelectionActive = false,
  editMode = false,
  undoLayout,
  redoLayout,
}: UseLayoutPageShortcutsParams): void {
  useEffect(() => {
    const onKeyDown = (
      ev: KeyboardEvent
    ): void => {
      const isCtrl =
        ev.ctrlKey || ev.metaKey;

      if (
        isCtrl &&
        ev.key.toLowerCase() === "s"
      ) {
        ev.preventDefault();
        void saveLayoutToServer();
      }

      const target =
        ev.target as HTMLElement | null;

      const tagName =
        target?.tagName;

      const isTypingField =
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT" ||
        target?.isContentEditable === true;

      if (isTypingField) {
        return; // Preserve native text-field undo/redo.
      }

      if (editMode && !blockSelectionActive && isCtrl && !ev.altKey) {
        const key = ev.key.toLowerCase();
        if (key === "z" || key === "y") {
          ev.preventDefault();
          if (key === "y" || ev.shiftKey) redoLayout?.();
          else undoLayout?.();
          return;
        }
      }

      if (ev.key === "Escape") {
        setTool({
          mode: "cursor",
          elementType: "general",
        });

        return;
      }

      if (
        ev.key.toLowerCase() === "e" &&
        !ev.ctrlKey &&
        !ev.altKey &&
        !ev.metaKey &&
        !blockSelectionActive
      ) {
        ev.preventDefault();
        setEditMode(prev => !prev);
      }
    };

    window.addEventListener(
      "keydown",
      onKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        onKeyDown
      );
    };
  }, [
    saveLayoutToServer,
    setEditMode,
    setTool,
    blockSelectionActive,
    editMode,
    undoLayout,
    redoLayout,
  ]);
}
