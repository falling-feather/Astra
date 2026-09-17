import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET
  ?? `http://127.0.0.1:${process.env.DEMO_API_PORT ?? "3001"}`;
const localApiProxy = {
  "/api": apiProxyTarget,
  "/health": apiProxyTarget,
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: localApiProxy,
  },
  preview: {
    proxy: localApiProxy,
  },
});
