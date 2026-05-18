import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [
    mockupPreviewPlugin(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5174,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  preview: {
    port: process.env.PORT ? Number(process.env.PORT) : 5174,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
