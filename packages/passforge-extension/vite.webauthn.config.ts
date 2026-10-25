import { defineConfig } from "vite";

// page-webauthn runs in the page's MAIN world — a self-contained IIFE like
// the content script, just a different file.
export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: "dist",
    lib: {
      entry: "src/page-webauthn.ts",
      formats: ["iife"],
      name: "passforgeWebauthn",
      fileName: () => "page-webauthn.js",
    },
    rollupOptions: {
      output: {
        entryFileNames: "page-webauthn.js",
      },
    },
  },
});
