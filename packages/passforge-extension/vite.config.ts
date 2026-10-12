import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // MV3 forbids remote/inline scripts; single self-contained bundle output.
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
