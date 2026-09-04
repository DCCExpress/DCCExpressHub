import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const device = process.env.DCCEXPRESS_DEVICE_URL?.trim() || "http://dccex.local";

export default defineConfig(({ mode }) => ({
  /*
   * Demo builds use relative asset paths.
   *
   * This makes the exact same build work both here:
   *   http://127.0.0.1:5500/site/demo/
   *
   * and here:
   *   https://dccexpress.github.io/DCCExpressLite/demo/
   *
   * The normal embedded/live build keeps the root base.
   */
  base: mode === "demo" ? "./" : "/",

  plugins: [react()],

  resolve: {
    alias: {
      "@": resolve(root, "src"),
      "@domain": resolve(root, "src/domain")
    }
  },

  server: {
    host: "0.0.0.0",
    port: 5174,

    proxy: mode === "demo"
      ? {}
      : {
          "/api": { target: device, changeOrigin: true },

          // User images always come from the ESP32 in dev mode.
          // Do NOT rewrite /images -> / because the firmware stores them
          // in LittleFS under /images/.
          "/images": { target: device, changeOrigin: true },

          // Legacy filesystem endpoints currently used by the Lite firmware.
          "/upload": { target: device, changeOrigin: true },
          "/delete": { target: device, changeOrigin: true },
          "/list": { target: device, changeOrigin: true },
          "/fsinfo": { target: device, changeOrigin: true },

          "/ws": {
            target: device.replace(/^http/, "ws"),
            ws: true,
            changeOrigin: true
          }
        }
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2017",

    rollupOptions: {
      output: {
        entryFileNames: "assets/app-v2.js",
        chunkFileNames: "assets/chunk-[hash].js",
        assetFileNames: assetInfo =>
          assetInfo.names.some(name => name.endsWith(".css"))
            ? "assets/index-v2.css"
            : "assets/[name][extname]"
      }
    }
  }
}));
