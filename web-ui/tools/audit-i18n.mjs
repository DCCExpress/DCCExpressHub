import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src');
const entries = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) { if (item.name !== 'demo') walk(file); continue; }
    if (!/\.tsx?$/.test(file) || file.endsWith('i18n.ts')) continue;
    const source = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      let kind;
      const p = node.parent;
      if (ts.isJsxText(node)) kind = 'jsx';
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
        if (ts.isJsxAttribute(p) && /^(label|title|description|placeholder|aria-label|alt|subtitle)$/.test(p.name.getText(ast))) kind = 'attr';
        if (ts.isPropertyAssignment(p) && /^(label|title|description|message|placeholder|tooltip)$/.test(p.name.getText(ast))) kind = 'property';
        if (ts.isNewExpression(p) && p.expression.getText(ast) === 'Error') kind = 'error';
        if (ts.isCallExpression(p) && /^(setError|setMessage|alert|confirm|window.confirm|addLog)$/.test(p.expression.getText(ast))) kind = 'message';
        let a = p;
        while (ts.isConditionalExpression(a) || ts.isBinaryExpression(a) || ts.isParenthesizedExpression(a)) a = a.parent;
        if (ts.isJsxExpression(a) && (!ts.isJsxAttribute(a.parent) || /^(label|title|description|placeholder|aria-label|alt|subtitle)$/.test(a.parent.name.getText(ast)))) kind = 'expression';
      }
      if (kind) {
        let text;
        const values = [];
        if (ts.isTemplateExpression(node)) {
          text = node.head.text;
          for (const span of node.templateSpans) {
            const name = `value${values.length + 1}`;
            values.push([name, span.expression.getText(ast)]);
            text += `{{${name}}}` + span.literal.text;
          }
        } else text = node.text;
        if (kind === 'jsx') text = text.replace(/\s+/g, ' ').trim();
        if (text && /[a-zA-ZáéíóöőúüűÁÉÍÓÖŐÚÜŰ]/.test(text)) entries.push({ file: path.relative(root, file).replaceAll('\\', '/'), line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, start: node.getStart(ast), end: node.end, kind, text, values });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
}
walk(root);
fs.writeFileSync('tools/i18n-audit.json', JSON.stringify(entries, null, 2));
const unique = [...new Set(entries.map(e => e.text))];
fs.writeFileSync('tools/i18n-strings.txt', unique.map((s, i) => `${i}\t${s}`).join('\n'));
console.log(`${entries.length} occurrences, ${unique.length} unique strings`);
