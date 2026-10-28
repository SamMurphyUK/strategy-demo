import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Map JSON, unit data and art are read from the Godot project one level up.
    fs: { allow: [".."] },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      input: {
        main: "index.html",
        battle: "battle.html",
      },
    },
  },
});
