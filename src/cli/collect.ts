import { mkdir } from "node:fs/promises";
import path from "node:path";
import "../env.js";
import { collectModelsDevCalibration } from "../calibration/models-dev.js";
import { collectDeepSeek } from "../collectors/deepseek.js";
import { collectLongCat } from "../collectors/longcat.js";
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

await mkdir(providersDir, { recursive: true });
const collectors = [
  { id: "deepseek", collect: collectDeepSeek },
  { id: "longcat", collect: collectLongCat },
];

const providers = await Promise.all(
  collectors.map(async ({ id, collect }) => {
    const output = path.join(providersDir, `${id}.json`);
    const previous = await readProvider(output);
    const data = preserveUnchangedSourceTimestamps(await collect(), previous);
    await validateProvider(data);
    await writeJson(output, data);
    console.log(
      `Collected ${data.models.length} ${data.name} models into ${output}`,
    );
    return data;
  }),
);

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
  console.warn(`models.dev calibration skipped: ${(error as Error).message}`);
}
