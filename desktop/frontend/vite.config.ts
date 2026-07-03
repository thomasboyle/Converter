import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/start": { target: "http://127.0.0.1:8742", changeOrigin: true },
      "/progress": { target: "http://127.0.0.1:8742", changeOrigin: true },
      "/cancel": { target: "http://127.0.0.1:8742", changeOrigin: true },
      "/clip": { target: "http://127.0.0.1:8742", changeOrigin: true },
      "/gifs": { target: "http://127.0.0.1:8742", changeOrigin: true },
    },
  },
});
