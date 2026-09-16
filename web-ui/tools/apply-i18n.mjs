import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
const entries = JSON.parse(fs.readFileSync('tools/i18n-audit.json', 'utf8'));
const unique = [...new Set(entries.map(e => e.text))];
const translations = new Map();
const resources = { en: {}, hu: {}, de: {} };
for (const line of fs.readFileSync('tools/i18n-translations.txt', 'utf8').trim().split(/\r?\n/)) {
  const [id, hu, de, english] = line.split('¦');
  const original = unique[Number(id)];
  const en = english ?? original;
  let key = en.replace(/\{\{.*?\}\}/g, ' ').replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ').slice(0, 10).map((w, i) => i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()).join('');
  const base = key;
  let suffix = 2;
  while (resources.en[key] && resources.en[key] !== en) key = base + suffix++;
  resources.en[key] = en;
  resources.hu[key] = hu;
  resources.de[key] = de;
  translations.set(original, key);
}
const files = [...new Set(entries.filter(e => translations.has(e.text)).map(e => e.file))];
let count = 0;
for (const file of files) {
  // Domain state names and serialized labels are data, not interface text.
  if (/^(domain|demo)\//.test(file)) continue;
  if (/^services\//.test(file) && !['services/backupService.ts', 'services/layoutOutput.ts'].includes(file)) continue;
  const full = path.join('src', file);
  let source = fs.readFileSync(full, 'utf8');
  const ast = ts.createSourceFile(full, source, ts.ScriptTarget.Latest, true);
  const nodes = new Map();
  function collect(n) { nodes.set(`${n.getStart(ast)}:${n.end}`, n); ts.forEachChild(n, collect); }
  collect(ast);
  const edits = [];
  const components = new Set();
  const memoCalls = new Set();
  function enclosingComponent(n) {
    while (n) {
      if (ts.isFunctionDeclaration(n) && /^[A-Z]/.test(n.name?.text ?? '') && n.body) return n;
      if (ts.isArrowFunction(n) && ts.isVariableDeclaration(n.parent) && /^[A-Z]/.test(n.parent.name.getText(ast)) && ts.isBlock(n.body)) return n;
      n = n.parent;
    }
    return null;
  }
  for (const entry of entries.filter(e => e.file === file && translations.has(e.text))) {
    const node = nodes.get(`${entry.start}:${entry.end}`);
    if (!node || node.end !== entry.end) throw new Error('Node mismatch: ' + file + ':' + entry.line);
    // Never translate comparison operands, protocol values or keys.
    let ancestor = node;
    let unsafe = false;
    while (ancestor.parent && (ts.isConditionalExpression(ancestor.parent) || ts.isBinaryExpression(ancestor.parent) || ts.isParenthesizedExpression(ancestor.parent))) {
      const parent = ancestor.parent;
      if (ts.isConditionalExpression(parent) && parent.condition === ancestor) unsafe = true;
      if (ts.isBinaryExpression(parent) && (!['??', '||', '&&', '+'].includes(parent.operatorToken.getText(ast)) || parent.left === ancestor)) unsafe = true;
      ancestor = parent;
    }
    if (unsafe) continue;
    if (/^models\//.test(file)) {
      let a = node;
      while (a && !ts.isMethodDeclaration(a)) a = a.parent;
      if (!a || a.name.getText(ast) !== 'getEditableProperties') continue;
    }
    const call = `i18next.t("ui.${translations.get(entry.text)}"${entry.values.length ? ', { ' + entry.values.map(([k,v]) => `${k}: ${v}`).join(', ') + ' }' : ''})`;
    let replacement = call;
    let start = entry.start;
    let end = entry.end;
    const component = enclosingComponent(node);
    if (component) components.add(component);
    if (entry.kind === 'jsx') {
      // Preserve spaces bordering inline elements and expressions.
      const raw = node.getFullText(ast);
      replacement = `${/^\s/.test(raw) ? ' ' : ''}{${call}}${/\s$/.test(raw) ? ' ' : ''}`;
      start = node.pos;
    } else if (entry.kind === 'attr') replacement = `{${call}}`;
    else if (entry.kind === 'property') {
      let a = node.parent;
      while (a && !ts.isFunctionLike(a)) a = a.parent;
      if (!a) {
        // Static UI metadata resolves its label at render time, not at module load.
        start = node.parent.getStart(ast);
        end = node.parent.end;
        replacement = `get ${node.parent.name.getText(ast)}() { return ${call}; }`;
      }
    }
    let a = node.parent;
    while (a) {
      if (ts.isCallExpression(a) && ['useMemo', 'useCallback'].includes(a.expression.getText(ast)) && component) memoCalls.add(a);
      a = a.parent;
    }
    edits.push({ start, end, replacement });
    count++;
  }
  if (!edits.length) continue;
  let needsHookImport = false;
  for (const component of components) {
    if (!/\buseTranslation\s*\(/.test(component.body.getText(ast))) {
      edits.push({ start: component.body.getStart(ast) + 1, end: component.body.getStart(ast) + 1, replacement: '\n  useTranslation();' });
      needsHookImport = true;
    }
  }
  for (const call of memoCalls) {
    const deps = call.arguments[1];
    if (deps && ts.isArrayLiteralExpression(deps)) edits.push({ start: deps.getStart(ast) + 1, end: deps.getStart(ast) + 1, replacement: 'i18next.resolvedLanguage, ' });
  }
  edits.sort((a,b) => b.start - a.start);
  for (const e of edits) source = source.slice(0, e.start) + e.replacement + source.slice(e.end);
  source = 'import i18next from "i18next";\n' + source.replace(/^\uFEFF/, '');
  if (needsHookImport && !/import\s*\{[^}]*\buseTranslation\b[^}]*\}\s*from\s*["']react-i18next/.test(source)) source = 'import { useTranslation } from "react-i18next";\n' + source;
  fs.writeFileSync(full, source);
  console.log(file + ': ' + edits.length);
}
for (const lang of Object.keys(resources)) fs.writeFileSync(`src/i18n/ui.${lang}.json`, JSON.stringify(resources[lang], null, 2) + '\n');
console.log(`${count} replacements, ${Object.keys(resources.en).length} translations`);

