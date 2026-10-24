import fs from "node:fs";

const [featureFile, baselineFile] = process.argv.slice(2);
if (!featureFile || !baselineFile) throw new Error("Expected feature and baseline TAP logs");

function parse(file) {
  const text = fs.readFileSync(file, "utf8");
  const matches = [...text.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1].trim());
  const reported = text.match(/^# tests (\d+)$/m);
  const failures = text.match(/^# fail (\d+)$/m);
  if (!reported || !failures) throw new Error("Incomplete TAP output in " + file);
  const counts = new Map();
  for (const name of matches) counts.set(name, (counts.get(name) ?? 0) + 1);
  return { count: Number(reported[1]), fails: Number(failures[1]), counts };
}

const feature = parse(featureFile);
const baseline = parse(baselineFile);
console.log(`Feature: ${feature.count} tests, ${feature.fails} failures`);
console.log(`alpha7:  ${baseline.count} tests, ${baseline.fails} failures`);
const newFailures = [];
for (const [name, count] of feature.counts) {
  const delta = count - (baseline.counts.get(name) ?? 0);
  if (delta > 0) newFailures.push(`${name} (${delta})`);
}
if (newFailures.length) {
  console.error("New failures compared to alpha7:");
  for (const name of newFailures) console.error(" - " + name);
  process.exitCode = 1;
} else {
  console.log("PASS: No new failing test names compared with alpha7.");
}
