import { defineConfig } from "vite";

// Content scripts must be classic scripts (no ESM): content.ts is built as a
// self-contained IIFE alongside the main build's output.
export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: "dist",
    lib: {
      entry: "src/content.ts",
      formats: ["iife"],
      name: "passforgeContent",
      fileName: () => "content.js",
    },
    rollupOptions: {
      output: {
        entryFileNames: "content.js",
      },
    },
  },
});
