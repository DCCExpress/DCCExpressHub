import { after } from "node:test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createServer } from "vite";

// Load production classes without a browser or a connection to railway hardware.
const storage = new Map();

globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
};

globalThis.window = {
  location: { search: "" },
  localStorage,
  setTimeout: callback => setTimeout(callback, 0),
};

// i18n.ts updates document.documentElement.lang during module initialization.
// The production UI runs in a browser, while these Vite SSR tests run in Node.
// Provide the minimal DOM surface required by the production module.
globalThis.document = {
  documentElement: {
    lang: "en",
  },
};

globalThis.Path2D = class {
  constructor(path) {
    this.path = path;
  }
};

const root = fileURLToPath(
  new URL("../", import.meta.url)
);

const server = await createServer({
  root,
  configFile: false,
  optimizeDeps: {
    noDiscovery: true,
    include: [],
  },
  server: {
    middlewareMode: true,
    watch: null,
    hmr: false,
    ws: false,
  },
  resolve: {
    alias: {
      "@": resolve(root, "src"),
      "@domain": resolve(
        root,
        "src/domain"
      ),
    },
  },
});

after(() => server.close());

export const load = path =>
  server.ssrLoadModule(
    `/src/${path}.ts`
  );

export function recordingCanvas() {
  const calls = [];

  const ctx = new Proxy(
    {
      measureText: text => ({
        width:
          String(text).length * 6,
      }),
      getTransform: () => ({
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
      }),
    },
    {
      get: (target, key) =>
        key in target
          ? target[key]
          : (...args) =>
              calls.push([
                key,
                ...args,
              ]),
      set: (
        target,
        key,
        value
      ) => {
        calls.push([
          "set",
          key,
          value,
        ]);
        target[key] = value;
        return true;
      },
    }
  );

  return {
    ctx,
    calls,
  };
}
