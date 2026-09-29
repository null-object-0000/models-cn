/**
 * 回归测试：collector 的 HTTP 层真的带上了重试。
 *
 * `src/net.ts` 自己的单测只能证明重试模块是对的，证明不了各 collector 有没有用它。
 * 这里从**产品真实入口**（`collectMoonshotChina` 走它自己的默认 fetcher）发起，
 * 只在 fetch 这一层注入「先抖两次再成功」，断言最终拿到了 healthy 数据。
 * 若哪天有人把某个 collector 的 `fetchTextWithRetry` 换回裸 `fetch`，这条会红。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectMoonshotChina } from "../src/collectors/moonshot.js";

const PRICING_PAGE = `
<DocTable
  columns={[
{ title: "模型", width: "12%" },
{ title: "计费单位", width: "10%" },
{ title: "输入价格（缓存命中）", width: "13%" },
{ title: "输入价格（缓存未命中）", width: "13%" },
{ title: "输出价格", width: "10%" },
{ title: "上下文窗口", width: "16%" },
]}
  rows={[
["kimi-k3", "1M tokens", "¥2.00", "¥20.00", "¥100.00", "1,048,576 tokens"],
]}
/>`;

/** 三个模型名都得在总览页出现，否则 collector 会按「页面改版」报错。 */
const OVERVIEW_PAGE = "kimi-k3 kimi-k2.7-code kimi-k2.6";

const TROUBLESHOOTING_PAGE = `## What is the output length of the Kimi model?
* For \`kimi-k3\`, the maximum output length is \`1024*1024 - prompt_tokens\`.
* For \`kimi-k2.6\`, the maximum output length is \`256*1024 - prompt_tokens\`.
## How many Chinese characters does the Kimi model support?
`;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MODELS_CN_RETRY_ATTEMPTS;
});

/** 上游三个页面各自返回的内容，按 URL 分流。 */
function pageFor(url: string): string {
  if (url.endsWith("/docs/pricing/chat")) return PRICING_PAGE;
  if (url.includes("models-overview")) return OVERVIEW_PAGE;
  return TROUBLESHOOTING_PAGE;
}

describe("collector 的网络层重试", () => {
  it("默认 fetcher 会在连接层抖动后重试，最终产出 healthy 数据", async () => {
    let fetchCalls = 0;
    let transientFailures = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      fetchCalls += 1;
      // 每个 URL 的头两次请求都抖掉，模拟上游偶发的 fetch failed
      if (transientFailures < 2) {
        transientFailures += 1;
        throw new TypeError("fetch failed");
      }
      return new Response(pageFor(url), { status: 200 });
    });

    const provider = await collectMoonshotChina(
      new Date("2026-07-23T00:00:00Z"),
    );

    expect(provider.health.status).toBe("healthy");
    expect(provider.models.map((model) => model.id)).toContain("kimi-k3");
    // 两次抖动 + 至少一次成功，证明重试真的发生了
    expect(fetchCalls).toBeGreaterThan(2);
  });

  it("关掉重试（MODELS_CN_RETRY_ATTEMPTS=1）时，一次抖动就会让采集失败", async () => {
    process.env.MODELS_CN_RETRY_ATTEMPTS = "1";
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });

    await expect(
      collectMoonshotChina(new Date("2026-07-23T00:00:00Z")),
    ).rejects.toThrow("fetch failed");
  });

  it("页面改版（解析失败）不会被重试掩盖：一次就抛，不做无用的重试", async () => {
    let fetchCalls = 0;
    vi.stubGlobal("fetch", async () => {
      fetchCalls += 1;
      // 定价页没了表格——确定性失败，重试没有意义
      return new Response("没有表格的页面", { status: 200 });
    });

    await expect(
      collectMoonshotChina(new Date("2026-07-23T00:00:00Z")),
    ).rejects.toThrow();
    // 三个来源各请求一次，且都不重试
    expect(fetchCalls).toBe(3);
  });
});
