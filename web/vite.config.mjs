import { defineConfig } from "vite";
import { codexApiPlugin } from "./server/viteCodexApi.mjs";

export default defineConfig({
  plugins: [codexApiPlugin()],
  server: {
    host: "127.0.0.1",
    strictPort: true,
  },
});
