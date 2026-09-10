import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Trailing slash matters: "/api" alone prefix-matches ANY path that
      // starts with those letters — e.g. a future frontend route like
      // /api-keys would otherwise get silently forwarded to the backend
      // (and 404, since the backend has no such route) instead of being
      // served by the SPA router. "/api/" only matches real API calls.
      "/api/": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          react:    ["react", "react-dom"],
          recharts: ["recharts"],
        },
      },
    },
  },
});
