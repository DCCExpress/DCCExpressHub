import {
  Group,
  SegmentedControl,
} from "@mantine/core";
import { useTranslation } from "react-i18next";

type Language =
  | "en"
  | "hu"
  | "de";

function normalizeLanguage(
  language: string | null | undefined
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

    localStorage.setItem(
      "lang",
      nextLanguage
    );

    const url =
      new URL(
        window.location.href
      );

    if (
      url.searchParams.has(
        "lang"
      )
    ) {
      url.searchParams.delete(
        "lang"
      );

      window.history.replaceState(
        null,
        "",
        url.toString()
      );
    }

    window.location.reload();
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
