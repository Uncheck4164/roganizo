import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // The GitHub Pages demo lives under /roganizo/
  base: process.env.VITE_DEMO === "1" ? "/roganizo/" : "/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/login": "http://localhost:8080",
      "/setup": "http://localhost:8080",
      "/health": "http://localhost:8080",
    },
  },
});
