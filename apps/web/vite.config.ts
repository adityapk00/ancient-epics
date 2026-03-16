import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webPort = Number(process.env.PORT ?? process.env.VITE_PORT ?? 5173);
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: webPort,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
