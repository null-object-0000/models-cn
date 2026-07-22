import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { Catalog } from "../types.js";
import { hasMaterialCatalogChanges, renderUpdateReport } from "../report.js";

const execFileAsync = promisify(execFile);
const option = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
};
const base = option("--base", "HEAD");
const output = option("--output", "update-report.md");
const statusOutput = option("--status-output", "update-material.txt");
const { stdout } = await execFileAsync("git", ["show", `${base}:api.json`], {
  maxBuffer: 10 * 1024 * 1024,
});
const before = JSON.parse(stdout) as Catalog;
const after = JSON.parse(await readFile("api.json", "utf8")) as Catalog;
await writeFile(output, renderUpdateReport(before, after), "utf8");
await writeFile(
  statusOutput,
  `${hasMaterialCatalogChanges(before, after)}\n`,
  "utf8",
);
console.log(`Wrote automated update report to ${output}`);
