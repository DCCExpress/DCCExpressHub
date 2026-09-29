import i18next from "i18next";
import {
  useTranslation,
} from "react-i18next";

export function movementText(
  key: string,
  values?: Record<
    string,
    string | number
  >
): string {
  return i18next.t(
    `ui.${key}`,
    values
  );
}

export function useMovementTranslation(): (
  key: string,
  values?: Record<
    string,
    string | number
  >
) => string {
  useTranslation();
  return movementText;
}
