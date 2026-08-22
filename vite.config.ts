import { resolve } from "node:path";
import { defineConfig } from "vite";

const repoRoot = import.meta.dirname;
const sourceRoot = resolve(repoRoot, "src");

export default defineConfig({
  root: sourceRoot,
  publicDir: resolve(repoRoot, "public"),
  envDir: repoRoot,
  envPrefix: ["PUBLIC_"],
  build: {
    outDir: resolve(repoRoot, "dist"),
    emptyOutDir: true,
    target: "chrome116",
    sourcemap: false,
    modulePreload: false,
    rollupOptions: {
      input: {
        background: resolve(sourceRoot, "background/index.ts"),
        popup: resolve(sourceRoot, "popup/index.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
