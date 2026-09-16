import {
  Group,
  SegmentedControl,
  Text,
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
    t,
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

    localStorage.setItem(
      "lang",
      nextLanguage
    );

    document.documentElement.lang =
      nextLanguage;

    void i18n.changeLanguage(
      nextLanguage
    );
  };

  return (
    <Group
      gap="xs"
      wrap="nowrap"
    >
      {/* <Text
        size="xs"
        c="dimmed"
      >
        {t("settings.language")}
      </Text> */}

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