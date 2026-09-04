import { useEffect, useMemo, useState } from "react";

import type {
  Loco,
  LocoAction,
  LocoActionHook,
  LocoFunction,
} from "@domain/types";

import { getLocos, saveLocos } from "../../api/domainApi";
import { uploadLocoImage } from "../../api/imageApi";
import { wsApi } from "../../services/wsApi";
import {
  createDefaultFunction,
  createEmptyLoco,
  createEmptyLocoActions,
} from "./locoDialogHelpers";

export function useLocoDialogState(
  opened: boolean,
  onSaved: (() => void) | undefined,
  t: (key: string) => string,
  loadLocos: () => Promise<Loco[]> = getLocos,
  persistLocos: (locos: Loco[]) => Promise<void> = saveLocos
) {
  const [locos, setLocos] = useState<Loco[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [activeActionHook, setActiveActionHook] = useState<LocoActionHook>("beforeStart");

  useEffect(() => {
    if (!opened) return;

    void (async () => {
      try {
        setLoading(true);
        setMessage("");
        const data = await loadLocos();
        setLocos(data);
        setSelectedId(data[0]?.id ?? "");
      } catch (error) {
        console.error(error);
        setMessage(t("locodialog.couldnotloadlocos"));
      } finally {
        setLoading(false);
      }
    })();
  }, [opened, t, loadLocos]);

  const selectedLoco = useMemo(
    () => locos.find(loco => loco.id === selectedId) ?? null,
    [locos, selectedId]
  );

  /*
   * Mantine Select requires every option value to be unique.
   *
   * Function actions reference a DCC function by function number, not by the
   * editor-only function ID. While the user edits a function number it is
   * perfectly possible to have a temporary duplicate (for example two F1
   * entries). Passing both to Select would produce duplicate value "1" and
   * Mantine intentionally throws an exception.
   *
   * Keep the editor state untouched, but expose at most one Select option for
   * each DCC function number. If duplicates temporarily exist, the first one
   * wins until the user finishes editing.
   */
  const functionOptions = useMemo(() => {
    const unique = new Map<string, { value: string; label: string }>();

    for (const fn of selectedLoco?.functions ?? []) {
      const value = String(fn.number);

      if (unique.has(value)) continue;

      unique.set(value, {
        value,
        label: `${fn.icon ? `${fn.icon} ` : ""}F${fn.number} - ${fn.name}`,
      });
    }

    return [...unique.values()];
  }, [selectedLoco?.functions]);

  const updateSelectedLoco = (patch: Partial<Loco>): void => {
    if (!selectedLoco) return;

    setLocos(previous =>
      previous.map(loco =>
        loco.id === selectedLoco.id
          ? { ...loco, ...patch }
          : loco
      )
    );
  };

  const addLoco = (): void => {
    const loco = createEmptyLoco();
    setLocos(previous => [...previous, loco]);
    setSelectedId(loco.id);
  };

  const deleteSelectedLoco = (): void => {
    if (!selectedLoco) return;

    const next = locos.filter(loco => loco.id !== selectedLoco.id);
    setLocos(next);
    setSelectedId(next[0]?.id ?? "");
  };

  const addFunction = (): void => {
    if (!selectedLoco) return;

    const maxFn = selectedLoco.functions.reduce(
      (max, fn) => Math.max(max, fn.number),
      -1
    );

    updateSelectedLoco({
      functions: [
        ...selectedLoco.functions,
        createDefaultFunction(maxFn + 1),
      ],
    });
  };

  const updateFunction = (
    fnId: string,
    patch: Partial<LocoFunction>
  ): void => {
    if (!selectedLoco) return;

    updateSelectedLoco({
      functions: selectedLoco.functions.map(fn =>
        fn.id === fnId ? { ...fn, ...patch } : fn
      ),
    });
  };

  const deleteFunction = (fnId: string): void => {
    if (!selectedLoco) return;

    updateSelectedLoco({
      functions: selectedLoco.functions.filter(fn => fn.id !== fnId),
    });
  };

  const updateActionsForHook = (
    hook: LocoActionHook,
    actions: LocoAction[]
  ): void => {
    if (!selectedLoco) return;

    updateSelectedLoco({
      actions: {
        ...createEmptyLocoActions(),
        ...(selectedLoco.actions ?? {}),
        [hook]: actions,
      },
    });
  };

  const sendFunctionTest = async (
    fn: LocoFunction,
    active: boolean
  ): Promise<void> => {
    if (!selectedLoco) return;

    try {
      setMessage("");
      await wsApi.setLocoFunction(selectedLoco.address, fn.number, active);
      setMessage(`F${fn.number} ${active ? "ON" : "OFF"} elküldve.`);
    } catch (error) {
      console.error(error);
      setMessage(`F${fn.number} parancs nem sikerült.`);
    }
  };

  const setImageFromFile = (file: File | null): void => {
    if (!file || !selectedLoco) return;

    const locoId = selectedLoco.id;

    void (async () => {
      try {
        setMessage("");
        const imagePath = await uploadLocoImage(file);

        setLocos(previous =>
          previous.map(loco =>
            loco.id === locoId
              ? { ...loco, image: imagePath }
              : loco
          )
        );

        setMessage(t("common.success"));
      } catch (error) {
        console.error(error);
        setMessage("A kép feltöltése nem sikerült.");
      }
    })();
  };

  const handleSave = async (): Promise<void> => {
    try {
      setSaving(true);
      setMessage("");
      await persistLocos(locos);
      setMessage(t("common.success"));
      onSaved?.();
    } catch (error) {
      console.error(error);
      setMessage(t("locodialog.couldnotsave"));
    } finally {
      setSaving(false);
    }
  };

  return {
    locos,
    selectedId,
    setSelectedId,
    loading,
    saving,
    message,
    activeActionHook,
    setActiveActionHook,
    selectedLoco,
    functionOptions,
    updateSelectedLoco,
    addLoco,
    deleteSelectedLoco,
    addFunction,
    updateFunction,
    deleteFunction,
    updateActionsForHook,
    sendFunctionTest,
    setImageFromFile,
    handleSave,
  };
}
