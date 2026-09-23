import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const device =
    process.env.DCCEXPRESS_DEVICE_URL?.trim() ||
    "http://127.0.0.1:5174";

  const proxy: Record<string, string | ProxyOptions> =
    mode === "demo"
      ? {}
      : {
          "/api": {
            target: device,
            changeOrigin: true,
          },

          "/images": {
            target: device,
            changeOrigin: true,
          },

          "/upload": {
            target: device,
            changeOrigin: true,
          },

          "/delete": {
            target: device,
            changeOrigin: true,
          },

          "/list": {
            target: device,
            changeOrigin: true,
          },

          "/fsinfo": {
            target: device,
            changeOrigin: true,
          },

          "/ws": {
            target: device.replace(/^http/, "ws"),
            ws: true,
            changeOrigin: true,
          },

          "/flash": {
            target: device,
            changeOrigin: true,
          },

          "/sd": {
            target: device,
            changeOrigin: true,
          },
        };

  return {
    base: "/",

    plugins: [
      react(),
    ],

    resolve: {
      alias: {
        "@": resolve(root, "src"),
        "@domain": resolve(root, "src/domain"),
      },
    },

    // Vite stays on its own fixed development port. The native desktop backend
    // uses 5174 by default, so the two servers never compete for the same port.
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      proxy,
    },

    worker: {
      format: "es",

      rolldownOptions: {
        output: {
          entryFileNames: "assets/w-[hash].js",
          chunkFileNames: "assets/wc-[hash].js",
          assetFileNames: "assets/wa-[hash][extname]",
        },
      },
    },

    build: {
      outDir: "dist",
      emptyOutDir: true,
      target: "es2017",

      rolldownOptions: {
        output: {
          entryFileNames: "assets/app-v2.js",
          chunkFileNames: "assets/c-[hash].js",

          assetFileNames: assetInfo =>
            assetInfo.names.some(name =>
              name.endsWith(".css")
            )
              ? "assets/index-v2.css"
              : "assets/[name][extname]",
        },
      },
    },
  };
});
