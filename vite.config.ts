import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

function copyCatalog(): Plugin {
  let outputDirectory = "";
  return {
    name: "copy-model-catalog",
    configResolved(config) {
      outputDirectory = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await mkdir(outputDirectory, { recursive: true });
      await copyFile(
        path.resolve("api.json"),
        path.join(outputDirectory, "api.json"),
      );
    },
  };
}

export default defineConfig({
  root: "site",
  base: "./",
  plugins: [copyCatalog()],
  build: {
    outDir: "../dist/site",
    emptyOutDir: true,
  },
});
