/**
 * 守卫：`src/` 里不许出现裸网络调用。
 *
 * 上游一次瞬时抖动就足以把某个源记成 `error` 并开出只含时间戳的 PR。
 * 光在文档里写「请用 src/net.ts」挡不住——加这道自动检查，让新采集器无法悄悄绕开重试。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
);

/** 唯一允许自己持有网络原语的文件。 */
const ALLOWED = new Set(["net.ts"]);

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("网络调用守卫", () => {
  it("除 src/net.ts 外没有裸 fetch(", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(srcDir)) {
      if (ALLOWED.has(path.basename(file))) continue;
      const source = await readFile(file, "utf8");
      // 只看调用，不看注释/文档里提到的 fetch
      for (const [index, line] of source.split("\n").entries()) {
        const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
        if (/(?<![.\w])fetch\s*\(/.test(code)) {
          offenders.push(`${path.relative(srcDir, file)}:${index + 1}`);
        }
      }
    }
    expect(
      offenders,
      `这些位置绕过了 src/net.ts 的重试，请改用 fetchTextWithRetry / fetchJsonWithRetry / retryAsync：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("超时信号只在 src/net.ts 里创建（避免跨尝试复用已 abort 的 signal）", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(srcDir)) {
      if (ALLOWED.has(path.basename(file))) continue;
      const source = await readFile(file, "utf8");
      if (source.includes("AbortSignal.timeout")) {
        offenders.push(path.relative(srcDir, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
