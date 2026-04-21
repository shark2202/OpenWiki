import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // Tauri 在 `cargo build` 期间会往 src-tauri/target/doc 下生成几十万个
    // rustdoc HTML 文件。如果 Vite 监听它们，会导致无限 HMR reload，前端
    // 永远来不及挂载，Tauri 窗口就会一直停留在默认的透明背景上。
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
