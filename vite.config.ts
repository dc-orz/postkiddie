import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri 在 dev 时通过环境变量告知目标平台，用于条件编译与调试端口
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },

  // Tauri 期望一个固定端口，端口被占用时直接失败而不是静默换端口，
  // 否则 tauri.conf.json 里的 devUrl 会指向一个空端口。
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // 条件展开而非赋 undefined：tsconfig 开了 exactOptionalPropertyTypes，
    // 可选属性只接受被省略，不接受显式的 undefined
    ...(host ? { hmr: { protocol: "ws" as const, host, port: 1421 } } : {}),
    watch: {
      // Rust 侧由 cargo 自己 watch，避免 target/ 触发前端整轮重载
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    // Tauri 在 macOS/Linux 用 Safari/WebKitGTK，Windows 用 WebView2(Chromium)。
    // safari17 是 design token 里 CSS `light-dark()` 的下限（Safari 17.5 / macOS 14.5）。
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome123" : "safari17",
    // 不指定具体 minifier：Vite 8 底层换成了 rolldown，不再自带 esbuild，
    // 交给它选默认实现（oxc）比钉死一个名字更稳
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 1024,
  },

  // 桌面应用无需分析包体积以外的产物信息
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
