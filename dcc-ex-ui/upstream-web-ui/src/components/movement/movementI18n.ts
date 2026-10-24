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
  const translationKey =
    `ui.${key}`;

  return values
    ? i18next.t(
        translationKey,
        values
      )
    : i18next.t(
        translationKey
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
