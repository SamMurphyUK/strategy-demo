import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind IPv4 explicitly. On this machine localhost resolves to 127.0.0.1, and Vite's
    // default listen was IPv6-only (::1), so the browser was refused.
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
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
