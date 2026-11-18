import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { bakeUnitPlugin } from "./dev/bakeUnitPlugin.mjs";
import { publicDirPlugin } from "./dev/publicDirPlugin.mjs";
import { saveMapPlugin } from "./dev/saveMapPlugin.mjs";

export default defineConfig(({ mode }) => {
  // Vite only forwards VITE_ keys to the client. The bake plugin reads the token
  // from process.env, and the empty prefix here stays inside this config file.
  const localEnv = loadEnv(mode, process.cwd(), "");
  if (localEnv.RD_API_TOKEN && !process.env.RD_API_TOKEN) {
    process.env.RD_API_TOKEN = localEnv.RD_API_TOKEN;
  }

  return {
  plugins: [
    react(),
    tailwindcss(),
    publicDirPlugin(),
    saveMapPlugin({ file: "../demomap01.json" }),
    bakeUnitPlugin(),
  ],
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
};
});
