import { copyFile, cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function copyCatalog(): Plugin {
  let outputDirectory = "";
  return {
    name: "copy-model-catalog",
    configureServer(server) {
      server.middlewares.use("/api.json", async (_request, response) => {
        try {
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(await readFile(path.resolve("api.json")));
        } catch {
          response.statusCode = 500;
          response.end('{"error":"catalog unavailable"}');
        }
      });
    },
    configResolved(config) {
      outputDirectory = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await mkdir(outputDirectory, { recursive: true });
      await copyFile(
        path.resolve("api.json"),
        path.join(outputDirectory, "api.json"),
      );
      await cp(path.resolve("v1"), path.join(outputDirectory, "v1"), {
        recursive: true,
      });
      await cp(
        path.resolve("schema", "v1"),
        path.join(outputDirectory, "schema", "v1"),
        { recursive: true },
      );
    },
  };
}

export default defineConfig({
  root: "site",
  base: "./",
  plugins: [react(), copyCatalog()],
  build: {
    outDir: "../dist/site",
    emptyOutDir: true,
  },
});
