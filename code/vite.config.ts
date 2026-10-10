import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  // 降级构建目标 —— 这一条是给安卓准备的。
  //
  // Windows 用 WebView2（随 Edge 更新，版本很新），但安卓用的是
  // **用户设备上的系统 WebView**，老设备可能长期停留在很旧的 Chromium。
  // 不降级的话，新语法会让页面在老设备上直接白屏。
  // 详见 docs/02-架构设计.md §8.4
  build: {
    target: ["es2018", "chrome90"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
