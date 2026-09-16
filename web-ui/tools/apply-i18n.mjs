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

  let key = en
    .replace(/\{\{.*?\}\}/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 10)
    .map((w, i) =>
      i
        ? w[0].toUpperCase() + w.slice(1).toLowerCase()
        : w.toLowerCase()
    )
    .join('');

  const base = key;
  let suffix = 2;

  while (
    resources.en[key] &&
    resources.en[key] !== en
  ) {
    key = base + suffix++;
  }

  resources.en[key] = en;
  resources.hu[key] = hu;
  resources.de[key] = de;
  translations.set(original, key);
}

const files = [
  ...new Set(
    entries
      .filter(e => translations.has(e.text))
      .map(e => e.file)
  ),
];

let count = 0;

function hasStableIdentitySibling(propertyNode) {
  const parent = propertyNode?.parent;

  if (!parent || !ts.isObjectLiteralExpression(parent)) {
    return false;
  }

  const stableNames = new Set([
    'id',
    'value',
    'key',
    'position',
    'type',
    'action',
    'mode',
    'protocol',
  ]);

  return parent.properties.some(property => {
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isShorthandPropertyAssignment(property)
    ) {
      return false;
    }

    const name =
      property.name?.getText?.()
        ?.replace(/^['"]|['"]$/g, '');

    return stableNames.has(name);
  });
}

for (const file of files) {
  // Domain state names and serialized labels are data, not interface text.
  if (/^(domain|demo)\//.test(file)) continue;

  if (
    /^services\//.test(file) &&
    ![
      'services/backupService.ts',
      'services/layoutOutput.ts',
    ].includes(file)
  ) {
    continue;
  }

  const full = path.join('src', file);
  let source = fs.readFileSync(full, 'utf8');

  const ast = ts.createSourceFile(
    full,
    source,
    ts.ScriptTarget.Latest,
    true
  );

  const nodes = new Map();

  function collect(node) {
    nodes.set(
      `${node.getStart(ast)}:${node.end}`,
      node
    );

    ts.forEachChild(
      node,
      collect
    );
  }

  collect(ast);

  const edits = [];
  const components = new Set();

  /*
   * Only useMemo may receive an automatic language dependency.
   *
   * Adding resolvedLanguage to arbitrary useCallback dependencies caused
   * language switching to re-create data-loading callbacks. Effects that
   * depended on those callbacks then reloaded layout/runtime/config state.
   * Translation must never cause operational state transitions.
   */
  const memoCalls = new Set();

  function enclosingComponent(node) {
    while (node) {
      if (
        ts.isFunctionDeclaration(node) &&
        /^[A-Z]/.test(node.name?.text ?? '') &&
        node.body
      ) {
        return node;
      }

      if (
        ts.isArrowFunction(node) &&
        ts.isVariableDeclaration(node.parent) &&
        /^[A-Z]/.test(
          node.parent.name.getText(ast)
        ) &&
        ts.isBlock(node.body)
      ) {
        return node;
      }

      node = node.parent;
    }

    return null;
  }

  for (
    const entry of entries.filter(
      e =>
        e.file === file &&
        translations.has(e.text)
    )
  ) {
    const node =
      nodes.get(
        `${entry.start}:${entry.end}`
      );

    if (
      !node ||
      node.end !== entry.end
    ) {
      throw new Error(
        'Node mismatch: ' +
        file +
        ':' +
        entry.line
      );
    }

    // Never translate comparison operands, protocol values or keys.
    let ancestor = node;
    let unsafe = false;

    while (
      ancestor.parent &&
      (
        ts.isConditionalExpression(
          ancestor.parent
        ) ||
        ts.isBinaryExpression(
          ancestor.parent
        ) ||
        ts.isParenthesizedExpression(
          ancestor.parent
        )
      )
    ) {
      const parent =
        ancestor.parent;

      if (
        ts.isConditionalExpression(
          parent
        ) &&
        parent.condition === ancestor
      ) {
        unsafe = true;
      }

      if (
        ts.isBinaryExpression(
          parent
        ) &&
        (
          ![
            '??',
            '||',
            '&&',
            '+',
          ].includes(
            parent.operatorToken.getText(
              ast
            )
          ) ||
          parent.left === ancestor
        )
      ) {
        unsafe = true;
      }

      ancestor = parent;
    }

    if (unsafe) continue;

    if (/^models\//.test(file)) {
      let method = node;

      while (
        method &&
        !ts.isMethodDeclaration(method)
      ) {
        method = method.parent;
      }

      if (
        !method ||
        method.name.getText(ast) !==
          'getEditableProperties'
      ) {
        continue;
      }
    }

    const call =
      `i18next.t("ui.${translations.get(entry.text)}"` +
      (
        entry.values.length
          ? ', { ' +
            entry.values
              .map(
                ([k, v]) =>
                  `${k}: ${v}`
              )
              .join(', ') +
            ' }'
          : ''
      ) +
      ')';

    let replacement = call;
    let start = entry.start;
    let end = entry.end;

    const component =
      enclosingComponent(node);

    if (component) {
      components.add(
        component
      );
    }

    if (entry.kind === 'jsx') {
      const raw =
        node.getFullText(ast);

      replacement =
        `${/^\s/.test(raw) ? ' ' : ''}` +
        `{${call}}` +
        `${/\s$/.test(raw) ? ' ' : ''}`;

      start = node.pos;
    } else if (
      entry.kind === 'attr'
    ) {
      replacement =
        `{${call}}`;
    } else if (
      entry.kind === 'property'
    ) {
      let fn = node.parent;

      while (
        fn &&
        !ts.isFunctionLike(fn)
      ) {
        fn = fn.parent;
      }

      if (!fn) {
        /*
         * Module-scope labels are especially dangerous because older code may
         * use them as hidden logic identifiers. Only auto-translate a static
         * object label when the object has a separate stable identity field.
         *
         * Example:
         *   { value: "left", label: "Left" }  -> safe
         *   { label: "Left", ... }            -> skip
         */
        if (
          !hasStableIdentitySibling(
            node.parent
          )
        ) {
          continue;
        }

        start =
          node.parent.getStart(ast);

        end =
          node.parent.end;

        replacement =
          `get ${node.parent.name.getText(ast)}() { return ${call}; }`;
      }
    }

    let parent = node.parent;

    while (parent) {
      if (
        ts.isCallExpression(
          parent
        ) &&
        parent.expression.getText(ast) ===
          'useMemo' &&
        component
      ) {
        memoCalls.add(
          parent
        );
      }

      parent =
        parent.parent;
    }

    edits.push({
      start,
      end,
      replacement,
    });

    count++;
  }

  if (!edits.length) {
    continue;
  }

  let needsHookImport = false;

  for (
    const component of components
  ) {
    if (
      !/\buseTranslation\s*\(/.test(
        component.body.getText(ast)
      )
    ) {
      const bodyStart =
        component.body.getStart(ast) +
        1;

      edits.push({
        start: bodyStart,
        end: bodyStart,
        replacement:
          '\n  useTranslation();',
      });

      needsHookImport = true;
    }
  }

  for (
    const call of memoCalls
  ) {
    const deps =
      call.arguments[1];

    if (
      deps &&
      ts.isArrayLiteralExpression(
        deps
      ) &&
      !deps.elements.some(
        element =>
          element
            .getText(ast)
            .includes(
              'resolvedLanguage'
            )
      )
    ) {
      edits.push({
        start:
          deps.getStart(ast) + 1,
        end:
          deps.getStart(ast) + 1,
        replacement:
          'i18next.resolvedLanguage, ',
      });
    }
  }

  edits.sort(
    (a, b) =>
      b.start - a.start
  );

  for (
    const edit of edits
  ) {
    source =
      source.slice(
        0,
        edit.start
      ) +
      edit.replacement +
      source.slice(
        edit.end
      );
  }

  source =
    'import i18next from "i18next";\n' +
    source.replace(
      /^\uFEFF/,
      ''
    );

  if (
    needsHookImport &&
    !/import\s*\{[^}]*\buseTranslation\b[^}]*\}\s*from\s*["']react-i18next/.test(
      source
    )
  ) {
    source =
      'import { useTranslation } from "react-i18next";\n' +
      source;
  }

  fs.writeFileSync(
    full,
    source
  );

  console.log(
    file +
    ': ' +
    edits.length
  );
}

for (
  const lang of Object.keys(
    resources
  )
) {
  fs.writeFileSync(
    `src/i18n/ui.${lang}.json`,
    JSON.stringify(
      resources[lang],
      null,
      2
    ) + '\n'
  );
}

console.log(
  `${count} replacements, ${Object.keys(resources.en).length} translations`
);
