import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // MV3 forbids remote/inline scripts. Three entry points: the popup page,
    // the autofill frame page, and the service worker (manifest type=module,
    // so shared ESM chunks under assets/ are fine).
    rollupOptions: {
      input: {
        index: "index.html",
        frame: "frame.html",
        background: "src/background.ts",
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
});
