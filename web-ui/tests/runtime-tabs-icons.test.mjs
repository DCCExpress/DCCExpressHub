import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/LiteLayoutPage.tsx", import.meta.url), "utf8");

test("all runtime tabs have icon-only labels with tooltips and accessible names", () => {
  const tabs = [
    ["tasks", "IconClipboardList", '"TaskMan"'],
    ["automation", "IconRobot", 'i18next.t("ui.automation2")'],
    ["timetable", "IconCalendarTime", 'i18next.t("ui.timetable")'],
    ["info", "IconInfoCircle", 'i18next.t("ui.info")'],
    ["log", "IconListDetails", 'i18next.t("ui.log")'],
  ];
  for (const [name, icon, label] of tabs) {
    const marker = '<Tabs.Tab value="' + name + '"';
    const i = page.indexOf(marker);
    assert.ok(i >= 0, name + " tab missing");
    const tab = page.slice(i, page.indexOf("</Tabs.Tab>", i) + "</Tabs.Tab>".length);
    assert.ok(tab.includes("aria-label={" + label + "}") || tab.includes('aria-label=' + label), name + " missing accessible label");
    assert.ok(tab.includes("<" + icon), name + " missing icon");
    assert.ok(page.slice(i - 115, i).includes("<Tooltip label="), name + " missing tooltip");
  }
  assert.match(page, /<Tabs.List grow mb="sm">/);
  assert.match(page, /persistRuntimeTab\(nextTab\)/);
});
