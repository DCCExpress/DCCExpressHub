import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const mockMode = mode === "mock";

  const device = mockMode
    ? "http://127.0.0.1:3001"
    : (
        process.env.DCCEXPRESS_DEVICE_URL?.trim() ||
        "http://192.168.1.132"
      );

  console.log(
    `[DCCExpressHub Vite] mode=${mode} backend=${device}`
  );

  return {
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
      strictPort: true,

      proxy: mode === "demo"
        ? {}
        : {
            "/api": {
              target: device,
              changeOrigin: true,
              configure(proxy) {
                proxy.on("proxyReq", (proxyReq, req) => {
                  console.log(
                    `[VITE PROXY] ${req.method} ${req.url} -> ${device}`
                  );
                });
              }
            },

            "/images": {
              target: device,
              changeOrigin: true
            },

            "/upload": {
              target: device,
              changeOrigin: true
            },

            "/delete": {
              target: device,
              changeOrigin: true
            },

            "/list": {
              target: device,
              changeOrigin: true
            },

            "/fsinfo": {
              target: device,
              changeOrigin: true
            },

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
  };
});
