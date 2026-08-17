import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_SOURCES,
  parseDeepSeekPage,
} from "../src/collectors/deepseek.js";

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const finalZhHtml = readFileSync(
  path.join(fixtureDir, "deepseek-final-zh.html"),
  "utf8",
);
const finalEnHtml = readFileSync(
  path.join(fixtureDir, "deepseek-final-en.html"),
  "utf8",
);

const html = `
<html><body><div><table>
<tr><td colspan="2">模型</td><td>deepseek-v4-flash<sup>(1)</sup></td><td>deepseek-v4-pro</td></tr>
<tr><td colspan="2">BASE URL (OpenAI 格式)</td><td colspan="2"><a href="https://api.deepseek.com">API</a></td></tr>
<tr><td colspan="2">BASE URL (Anthropic 格式)</td><td colspan="2"><a href="https://api.deepseek.com/anthropic">API</a></td></tr>
<tr><td colspan="2">模型版本</td><td>DeepSeek-V4-Flash</td><td>DeepSeek-V4-Pro</td></tr>
<tr><td colspan="2">思考模式</td><td colspan="2">支持</td></tr>
<tr><td colspan="2">上下文长度</td><td colspan="2">1M</td></tr>
<tr><td colspan="2">输出长度</td><td colspan="2">最大 384K</td></tr>
<tr><td rowspan="4">功能</td><td><a href="/zh-cn/guides/json_mode">Json Output</a></td><td>支持</td><td>支持</td></tr>
<tr><td><a href="/zh-cn/guides/tool_calls">Tool Calls</a></td><td>支持</td><td>支持</td></tr>
<tr><td><a href="/zh-cn/guides/chat_prefix_completion">前缀</a></td><td>支持</td><td>支持</td></tr>
<tr><td><a href="/zh-cn/guides/fim_completion">FIM</a></td><td>仅非思考模式支持</td><td>仅非思考模式支持</td></tr>
<tr><td rowspan="3">价格</td><td>百万tokens输入（缓存命中）</td><td>0.02元</td><td>0.025元</td></tr>
<tr><td>百万tokens输入（缓存未命中）</td><td>1元</td><td>3元</td></tr>
<tr><td>百万tokens输出</td><td>2元</td><td>6元</td></tr>
<tr><td colspan="2">并发限制</td><td>2500</td><td>500</td></tr>
</table></div>
<p>我们将采用峰谷定价。新价格将于北京时间 2026 年 8 月 17 日 00:00 开始生效：</p>
<table>
<tr><td>模型</td><td></td><td>百万tokens输入（缓存命中）</td><td>百万tokens输入（缓存未命中）</td><td>百万tokens输出</td></tr>
<tr><td rowspan="2">deepseek-v4-flash</td><td>空闲时段</td><td>0.05元</td><td>1.5元</td><td>4.5元</td></tr>
<tr><td>高峰时段</td><td>0.10元</td><td>3.0元</td><td>9.0元</td></tr>
<tr><td rowspan="2">deepseek-v4-pro</td><td>空闲时段</td><td>0.15元</td><td>4.5元</td><td>13.5元</td></tr>
<tr><td>高峰时段</td><td>0.30元</td><td>9.0元</td><td>27.0元</td></tr>
</table>
<p>deepseek-chat 与 deepseek-reasoner 两个模型名将于北京时间 2026/07/24 23:59 弃用。</p></body></html>`;

const englishHtml = html
  .replace("模型版本", "MODEL VERSION")
  .replace("上下文长度", "CONTEXT LENGTH")
  .replace("输出长度", "MAX OUTPUT")
  .replace("百万tokens输入（缓存命中）", "1M INPUT TOKENS (CACHE HIT)")
  .replace("百万tokens输入（缓存未命中）", "1M INPUT TOKENS (CACHE MISS)")
  .replace("百万tokens输出", "1M OUTPUT TOKENS")
  .replace("并发限制", "Concurrency Limit")
  .replace(
    "我们将采用峰谷定价。新价格将于北京时间 2026 年 8 月 17 日 00:00 开始生效：",
    "The new prices take effect at 16:00 UTC on August 16, 2026:",
  )
  .replaceAll("空闲时段", "OFF-PEAK")
  .replaceAll("高峰时段", "PEAK")
  .replace("0.02元", "$0.0028")
  .replace("0.025元", "$0.003625")
  .replace("1元", "$0.14")
  .replace("3元", "$0.435")
  .replace("2元", "$0.28")
  .replace("6元", "$0.87")
  .replace(
    "deepseek-chat 与 deepseek-reasoner 两个模型名将于北京时间 2026/07/24 23:59 弃用。",
    "The model names deepseek-chat and deepseek-reasoner will be deprecated on 2026/07/24 15:59 UTC.",
  );

describe("parseDeepSeekPage", () => {
  it("extracts model metadata, CNY prices and alias deprecation", () => {
    const data = parseDeepSeekPage(html, DEEPSEEK_SOURCES[0]);
    expect(data.models).toHaveLength(2);
    expect(data.models[0]).toMatchObject({
      id: "deepseek-v4-flash",
      name: "DeepSeek-V4-Flash",
      limits: {
        contextTokens: 1_000_000,
        maxOutputTokens: 384_000,
        concurrency: 2500,
      },
    });
    expect(data.models[0]?.prices[0]).toMatchObject({
      currency: "CNY",
      input: { cacheHit: 0.02, standard: 1 },
      output: 2,
      effectiveTo: "2026-08-17T00:00:00+08:00",
    });
    expect(data.aliases).toEqual([
      {
        id: "deepseek-chat",
        mode: "non-thinking",
        deprecatedAt: "2026-07-24T23:59:00+08:00",
      },
      {
        id: "deepseek-reasoner",
        mode: "thinking",
        deprecatedAt: "2026-07-24T23:59:00+08:00",
      },
    ]);
  });

  it("extracts announced peak and off-peak CNY prices with daily windows", () => {
    const data = parseDeepSeekPage(html, DEEPSEEK_SOURCES[0]);
    expect(data.models[0]?.prices.slice(1)).toEqual([
      {
        market: "china",
        currency: "CNY",
        unit: "1M_tokens",
        rateType: "standard",
        dailyTimeRange: {
          label: "空闲时段",
          timeZone: "Asia/Shanghai",
          intervals: [
            { start: "00:00", end: "09:00" },
            { start: "12:00", end: "14:00" },
            { start: "18:00", end: "00:00" },
          ],
        },
        input: { cacheHit: 0.05, standard: 1.5 },
        output: 4.5,
        effectiveFrom: "2026-08-17T00:00:00+08:00",
      },
      expect.objectContaining({
        dailyTimeRange: expect.objectContaining({ label: "高峰时段" }),
        input: { cacheHit: 0.1, standard: 3 },
        output: 9,
      }),
    ]);
  });

  it("fails loudly when the pricing table disappears", () => {
    expect(() =>
      parseDeepSeekPage("<html></html>", DEEPSEEK_SOURCES[0]),
    ).toThrow(/No DeepSeek pricing table/);
  });

  it("extracts the independent official USD prices", () => {
    const data = parseDeepSeekPage(englishHtml, DEEPSEEK_SOURCES[1]);
    expect(data.models[0]?.prices[0]).toEqual({
      market: "international",
      currency: "USD",
      unit: "1M_tokens",
      rateType: "standard",
      input: { cacheHit: 0.0028, standard: 0.14 },
      output: 0.28,
      effectiveTo: "2026-08-16T16:00:00Z",
    });
    expect(data.aliases[0]?.deprecatedAt).toBe("2026-07-24T15:59:00Z");
  });

  it("parses the finalized off-peak/peak CNY layout into current prices", () => {
    const data = parseDeepSeekPage(finalZhHtml, DEEPSEEK_SOURCES[0]);
    expect(data.models).toHaveLength(2);
    expect(data.models[0]).toMatchObject({
      id: "deepseek-v4-flash",
      name: "DeepSeek-V4-Flash-0731",
      capabilities: {
        thinking: true,
        jsonOutput: true,
        toolCalls: true,
        chatPrefixCompletion: true,
        fimCompletion: "non-thinking-only",
      },
      limits: {
        contextTokens: 1_000_000,
        maxOutputTokens: 384_000,
        concurrency: 2500,
      },
    });
    expect(data.models[0]?.prices).toEqual([
      {
        market: "china",
        currency: "CNY",
        unit: "1M_tokens",
        rateType: "standard",
        dailyTimeRange: {
          label: "空闲时段",
          timeZone: "Asia/Shanghai",
          intervals: [
            { start: "00:00", end: "09:00" },
            { start: "12:00", end: "14:00" },
            { start: "18:00", end: "00:00" },
          ],
        },
        input: { cacheHit: 0.05, standard: 1.5 },
        output: 4.5,
      },
      {
        market: "china",
        currency: "CNY",
        unit: "1M_tokens",
        rateType: "standard",
        dailyTimeRange: {
          label: "高峰时段",
          timeZone: "Asia/Shanghai",
          intervals: [
            { start: "09:00", end: "12:00" },
            { start: "14:00", end: "18:00" },
          ],
        },
        input: { cacheHit: 0.1, standard: 3 },
        output: 9,
      },
    ]);
    expect(data.models[1]?.prices).toMatchObject([
      {
        dailyTimeRange: { label: "空闲时段" },
        input: { cacheHit: 0.15, standard: 4.5 },
        output: 13.5,
      },
      {
        dailyTimeRange: { label: "高峰时段" },
        input: { cacheHit: 0.3, standard: 9 },
        output: 27,
      },
    ]);
    // 定型页面不再携带“即将生效”的公告窗口
    expect(data.models[0]?.prices[0]).not.toHaveProperty("effectiveFrom");
    expect(data.models[0]?.prices[0]).not.toHaveProperty("effectiveTo");
  });

  it("parses the finalized off-peak/peak USD layout with English labels", () => {
    const data = parseDeepSeekPage(finalEnHtml, DEEPSEEK_SOURCES[1]);
    expect(data.models[0]?.capabilities).toMatchObject({
      jsonOutput: true,
      toolCalls: true,
      chatPrefixCompletion: true,
      fimCompletion: "non-thinking-only",
    });
    expect(data.models[0]?.prices).toEqual([
      {
        market: "international",
        currency: "USD",
        unit: "1M_tokens",
        rateType: "standard",
        dailyTimeRange: {
          label: "Off-peak",
          timeZone: "UTC",
          intervals: [
            { start: "00:00", end: "01:00" },
            { start: "04:00", end: "06:00" },
            { start: "10:00", end: "00:00" },
          ],
        },
        input: { cacheHit: 0.007, standard: 0.22 },
        output: 0.66,
      },
      {
        market: "international",
        currency: "USD",
        unit: "1M_tokens",
        rateType: "standard",
        dailyTimeRange: {
          label: "Peak",
          timeZone: "UTC",
          intervals: [
            { start: "01:00", end: "04:00" },
            { start: "06:00", end: "10:00" },
          ],
        },
        input: { cacheHit: 0.014, standard: 0.44 },
        output: 1.32,
      },
    ]);
    expect(data.models[1]?.prices).toMatchObject([
      {
        dailyTimeRange: { label: "Off-peak" },
        input: { cacheHit: 0.022, standard: 0.66 },
        output: 1.98,
      },
      {
        dailyTimeRange: { label: "Peak" },
        input: { cacheHit: 0.044, standard: 1.32 },
        output: 3.96,
      },
    ]);
  });
});
