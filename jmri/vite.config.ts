import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "JMRI_");
  // Server-side target only: never expose a password or privileged address to the browser.
  const target = env.JMRI_TARGET || "http://127.0.0.1:12080";
  if (!/^https?:\/\//.test(target)) throw new Error("JMRI_TARGET must be http(s)://host:port");
  return {
    plugins: [react()],
    server: {
      port: 5186,
      strictPort: true,
      proxy: {
        "/jmri": {
          target,
          changeOrigin: true,
          ws: true,
          rewrite: path => path.replace(/^\/jmri(?=\/|$)/, ""),
        },
      },
    },
    preview: { port: 5186, strictPort: true },
  };
});
