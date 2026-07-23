import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import "../env.js";
import { collectModelsDevCalibration } from "../calibration/models-dev.js";
import { collectDeepSeek } from "../collectors/deepseek.js";
import { collectLongCat } from "../collectors/longcat.js";
import {
  collectMoonshotChina,
  collectMoonshotInternational,
} from "../collectors/moonshot.js";
import { collectQwen } from "../collectors/qwen.js";
import {
  calibrationDir,
  preserveUnchangedSourceTimestamps,
  providersDir,
  readJson,
  readProvider,
  writeJson,
} from "../io.js";
import type { ModelsDevCalibration } from "../types.js";
import { validateCalibration, validateProvider } from "../validation.js";
import { failedHealth } from "../health.js";

await mkdir(providersDir, { recursive: true });
const collectors = [
  { id: "deepseek", collect: collectDeepSeek },
  { id: "longcat", collect: collectLongCat },
  { id: "moonshot-cn", collect: collectMoonshotChina },
  { id: "moonshot-intl", collect: collectMoonshotInternational },
  { id: "qwen-cn", collect: collectQwen },
];

const providerOption = process.argv.indexOf("--provider");
const requestedProvider =
  providerOption >= 0 ? process.argv[providerOption + 1] : undefined;
if (providerOption >= 0 && !requestedProvider) {
  throw new Error("--provider requires a provider ID");
}
const selectedCollectors = requestedProvider
  ? collectors.filter(({ id }) => id === requestedProvider)
  : collectors;
if (!selectedCollectors.length) {
  throw new Error(`Unknown provider: ${requestedProvider}`);
}

await Promise.all(
  selectedCollectors.map(async ({ id, collect }) => {
    const output = path.join(providersDir, `${id}.json`);
    const previous = await readProvider(output);
    try {
      const data = preserveUnchangedSourceTimestamps(await collect(), previous);
      await validateProvider(data);
      await writeJson(output, data);
      console.log(
        `Collected ${data.models.length} ${data.name} models into ${output}`,
      );
    } catch (error) {
      if (!previous) throw error;
      const fallback = {
        ...previous,
        health: failedHealth(previous.health, error),
      };
      await validateProvider(fallback);
      await writeJson(output, fallback);
      console.error(`${id} collection failed: ${(error as Error).message}`);
    }
  }),
);

const providers = (
  await Promise.all(
    (await readdir(providersDir))
      .filter((file) => file.endsWith(".json"))
      .map((file) => readProvider(path.join(providersDir, file))),
  )
).filter((provider) => provider !== undefined);

await mkdir(calibrationDir, { recursive: true });
const calibrationOutput = path.join(calibrationDir, "models-dev.json");
const previousCalibration =
  await readJson<ModelsDevCalibration>(calibrationOutput);
try {
  const calibration = await collectModelsDevCalibration(
    providers,
    previousCalibration,
  );
  await validateCalibration(calibration);
  await writeJson(calibrationOutput, calibration);
  const mismatches = calibration.models.filter(
    (model) => model.status === "mismatch",
  ).length;
  const partial = calibration.models.filter(
    (model) => model.status === "partial",
  ).length;
  console.log(
    `Calibrated ${calibration.models.length} models against models.dev (${mismatches} mismatch, ${partial} partial)`,
  );
} catch (error) {
  if (!previousCalibration) throw error;
  const fallback = {
    ...previousCalibration,
    health: failedHealth(previousCalibration.health, error),
  };
  await validateCalibration(fallback);
  await writeJson(calibrationOutput, fallback);
  console.error(`models.dev calibration failed: ${(error as Error).message}`);
}
