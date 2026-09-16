import {
  Group,
  SegmentedControl,
} from "@mantine/core";
import { useTranslation } from "react-i18next";

type Language = "en" | "hu" | "de";

function normalizeLanguage(
  language: string | undefined
): Language {
  const code =
    language
      ?.split("-")[0]
      ?.toLowerCase();

  if (
    code === "hu" ||
    code === "de"
  ) {
    return code;
  }

  return "en";
}

export default function LanguageSwitcher() {
  const {
    i18n,
  } = useTranslation();

  const currentLanguage =
    normalizeLanguage(
      i18n.resolvedLanguage ??
      i18n.language
    );

  const changeLanguage = (
    language: string
  ) => {
    const nextLanguage =
      normalizeLanguage(language);

    if (
      nextLanguage ===
      currentLanguage
    ) {
      return;
    }

    /*
     * Language switching is an application-boundary operation.
     *
     * Do not call i18n.changeLanguage() here. A live language change would
     * re-run mounted React effects/callback dependencies that were never meant
     * to reload layout/runtime data. A clean page reload preserves the selected
     * language while rebuilding the application from one consistent state.
     *
     * This is intentionally conservative for the alpha firmware/UI.
     */
    localStorage.setItem(
      "lang",
      nextLanguage
    );

    const url =
      new URL(
        window.location.href
      );

    /*
     * A stale ?lang=... query parameter has priority in i18n.ts, so remove it
     * before reloading. The persisted localStorage value becomes authoritative.
     */
    url.searchParams.delete(
      "lang"
    );

    window.location.replace(
      url.toString()
    );
  };

  return (
    <Group
      gap="xs"
      wrap="nowrap"
    >
      <SegmentedControl
        size="xs"
        value={currentLanguage}
        onChange={changeLanguage}
        data={[
          {
            label: "EN",
            value: "en",
          },
          {
            label: "HU",
            value: "hu",
          },
          {
            label: "DE",
            value: "de",
          },
        ]}
      />
    </Group>
  );
}
