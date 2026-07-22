import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_SOURCES,
  parseDeepSeekPage,
} from "../src/collectors/deepseek.js";

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
</table></div><p>deepseek-chat 与 deepseek-reasoner 两个模型名将于北京时间 2026/07/24 23:59 弃用。</p></body></html>`;

const englishHtml = html
  .replace("模型版本", "MODEL VERSION")
  .replace("上下文长度", "CONTEXT LENGTH")
  .replace("输出长度", "MAX OUTPUT")
  .replace("百万tokens输入（缓存命中）", "1M INPUT TOKENS (CACHE HIT)")
  .replace("百万tokens输入（缓存未命中）", "1M INPUT TOKENS (CACHE MISS)")
  .replace("百万tokens输出", "1M OUTPUT TOKENS")
  .replace("并发限制", "Concurrency Limit")
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
      price: {
        currency: "CNY",
        input: { cacheHit: 0.02, standard: 1 },
        output: 2,
      },
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

  it("fails loudly when the pricing table disappears", () => {
    expect(() =>
      parseDeepSeekPage("<html></html>", DEEPSEEK_SOURCES[0]),
    ).toThrow(/No DeepSeek pricing table/);
  });

  it("extracts the independent official USD prices", () => {
    const data = parseDeepSeekPage(englishHtml, DEEPSEEK_SOURCES[1]);
    expect(data.models[0]?.price).toEqual({
      market: "international",
      currency: "USD",
      unit: "1M_tokens",
      rateType: "standard",
      input: { cacheHit: 0.0028, standard: 0.14 },
      output: 0.28,
    });
    expect(data.aliases[0]?.deprecatedAt).toBe("2026-07-24T15:59:00Z");
  });
});
