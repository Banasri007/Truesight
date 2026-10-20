import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const server = `http://localhost:${process.env.TRUESIGHT_PORT ?? "8787"}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: server, changeOrigin: true },
      "/auth": { target: server, changeOrigin: true },
      "/webhooks": { target: server, changeOrigin: true },
    },
  },
  build: {
    // three.js lives in the lazily loaded landing chunk.
    chunkSizeWarningLimit: 1600,
  },
});
