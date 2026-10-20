import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const server = `http://localhost:${process.env.WITNESS_PORT ?? "8787"}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: server, changeOrigin: true },
      "/auth": { target: server, changeOrigin: true },
      "/webhooks": { target: server, changeOrigin: true },
    },
  },
});
