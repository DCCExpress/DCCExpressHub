import {
  ActionIcon,
  Group,
  SegmentedControl,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconMoon,
  IconSun,
} from "@tabler/icons-react";
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

  const {
    setColorScheme,
  } = useMantineColorScheme();

  const colorScheme =
    useComputedColorScheme(
      "dark",
      {
        getInitialValueInEffect: true,
      }
    );

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

    url.searchParams.delete(
      "lang"
    );

    window.location.replace(
      url.toString()
    );
  };

  const toggleColorScheme = () => {
    setColorScheme(
      colorScheme === "dark"
        ? "light"
        : "dark"
    );
  };

  const themeTitle =
    colorScheme === "dark"
      ? "Light theme"
      : "Dark theme";

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

      {/* <ActionIcon
        size="lg"
        radius="md"
        variant="light"
        color={
          colorScheme === "dark"
            ? "yellow"
            : "blue"
        }
        aria-label={themeTitle}
        title={themeTitle}
        onClick={toggleColorScheme}
      >
        {colorScheme === "dark" ? (
          <IconSun size={18} />
        ) : (
          <IconMoon size={18} />
        )}
      </ActionIcon> */}
    </Group>
  );
}
