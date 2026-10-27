import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function createStore(fetchGraph) {
  const source = fs.readFileSync(new URL('../src/services/routeGraphStore.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^import .*?;\s*/gms, '')
    .replace('export const routeGraphStore = new RouteGraphStore();', 'globalThis.store = new RouteGraphStore();');
  const context = vm.createContext({ getRouteGraphWs: fetchGraph,
    createClientGraphFromRouteGraphDto: response => response.graph });
  vm.runInContext(js, context);
  return context.store;
}

test('reload replaces cached topology with the current server graph', async () => {
  let revision = 1;
  const store = createStore(async () => ({ ready: true, graph: { revision } }));
  assert.equal((await store.reload()).revision, 1);
  revision = 2;
  assert.equal((await store.reload()).revision, 2);
});

test('reload does not reuse an outstanding pre-save graph response', async () => {
  let resolveOld;
  let calls = 0;
  const store = createStore(() => ++calls === 1
    ? new Promise(resolve => { resolveOld = resolve; })
    : Promise.resolve({ ready: true, graph: { revision: 2 } }));
  const old = store.ensureLoaded();
  const fresh = store.reload();
  resolveOld({ ready: true, graph: { revision: 1 } });
  await old;
  assert.equal((await fresh).revision, 2);
  assert.equal(calls, 2);
});
