import path from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: { host: "0.0.0.0", port: 5173, strictPort: false, allowedHosts: true },
  preview: { host: "0.0.0.0", port: 5173, allowedHosts: true },
  build: { target: "es2022", assetsInlineLimit: 4096, chunkSizeWarningLimit: 2000 },
});
