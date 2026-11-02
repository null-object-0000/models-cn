import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectMoonshotChina,
  collectMoonshotInternational,
  parseMoonshotOutputLimits,
  parseMoonshotPricingPage,
} from "../src/collectors/moonshot.js";

const cnRsc = readFileSync(
  new URL("./fixtures/kimi-cn-rsc.txt", import.meta.url),
  "utf8",
);
const intlRsc = readFileSync(
  new URL("./fixtures/kimi-intl-rsc.txt", import.meta.url),
  "utf8",
);
const modelIds = [
  "kimi-k3",
  "kimi-k2.7-code",
  "kimi-k2.7-code-highspeed",
  "kimi-k2.6",
];
const emptyTable = "<table><thead><tr /></thead><tbody /></table>";
afterEach(() => vi.unstubAllGlobals());

const currentRsc = readFileSync(
  new URL("./fixtures/kimi-cn-rsc-20261102.txt", import.meta.url),
  "utf8",
);

// Preserve UTF-8 Flight lengths when mutating a real compiled record for failure tests.
function updateCurrentRsc(transform: (source: string) => string): string {
  return currentRsc.replace(
    /([0-9a-f]+:T)[0-9a-f]+,([\s\S]*)/,
    (_, prefix: string, source: string) => {
      const changed = transform(source);
      return `${prefix}${Buffer.byteLength(changed).toString(16)},${changed}`;
    },
  );
}

describe("Kimi collector parser", () => {
  it("parses the 2026-11-02 original grouped tables, links, Tooltip titles and inline MTok units", () => {
    const models = parseMoonshotPricingPage(currentRsc, "url").models;
    expect(models.map((model) => model.id)).toEqual([
      "kimi-k3.1-pro",
      "kimi-k3.1-pro-highspeed",
      "kimi-k3",
      "kimi-k2.7-code",
      "kimi-k2.7-code-highspeed",
      "kimi-k2.6",
    ]);
    expect(models.map((model) => model.limits.contextTokens)).toEqual([
      1_048_576, 1_048_576, 1_048_576, 262_144, 262_144, 262_144,
    ]);
    expect(
      models.map((model) => {
        const price = model.prices[0]!;
        expect(price.unit).toBe("1M_tokens");
        return [
          price.input.standard,
          price.output,
          price.input.cacheHit,
          price.input.explicitCacheCreation,
          price.input.explicitCacheCreation1h,
        ];
      }),
    ).toEqual([
      [13, 68, 1.3, 13, 26],
      [26, 136, 1.3, 26, 52],
      [20, 100, 2, 20, 40],
      [6.5, 27, 1.3, undefined, undefined],
      [13, 54, 2.6, undefined, undefined],
      [6.5, 27, 1.1, undefined, undefined],
    ]);
    const full = readFileSync(
      new URL(
        "../docs/upstream-samples-20261102/kimi-cn-rsc.txt",
        import.meta.url,
      ),
      "utf8",
    );
    expect(parseMoonshotPricingPage(full, "url").models).toEqual(models);
  });

  it("accepts reordered props and columns in the current grouped table", () => {
    const reordered = updateCurrentRsc((source) =>
      source
        .replace("className:`doc-table-bordered`,", "")
        .replace("rows:", "className:`doc-table-bordered`,rows:")
        .replace("title:`输入`", "title:`SWAP`")
        .replace("title:`输出`,width:`13%`", "title:`输入`,width:`13%`")
        .replace("title:`SWAP`", "title:`输出`")
        .replace(
          "`¥13.00 / MTok`,`¥68.00 / MTok`",
          "`¥68.00 / MTok`,`¥13.00 / MTok`",
        ),
    );
    expect(
      parseMoonshotPricingPage(reordered, "url").models[0]?.prices[0],
    ).toMatchObject({ input: { standard: 13 }, output: 68 });
  });

  it("reads English context prose and rejects missing context separately for each family", () => {
    const english = updateCurrentRsc((source) =>
      source
        .replace(
          "1,048,576 tokens 上下文窗口",
          "1,048,576-token context window",
        )
        .replace("262,144 tokens 上下文窗口", "262,144 tokens context window"),
    );
    expect(
      parseMoonshotPricingPage(english, "url").models.map(
        (model) => model.limits.contextTokens,
      ),
    ).toEqual([1_048_576, 1_048_576, 1_048_576, 262_144, 262_144, 262_144]);
    for (const context of [
      "1,048,576 tokens 上下文窗口",
      "262,144 tokens 上下文窗口",
    ]) {
      expect(() =>
        parseMoonshotPricingPage(
          updateCurrentRsc((source) => source.replace(context, "未公开上下文")),
          "url",
        ),
      ).toThrow(/missing context window/);
    }
  });

  it.each(["¥13.00", "¥13.00 / KTok", "unavailable / MTok"])(
    "rejects absent or unknown inline units and invalid prices: %s",
    (value) => {
      expect(() =>
        parseMoonshotPricingPage(
          updateCurrentRsc((source) => source.replace("¥13.00 / MTok", value)),
          "url",
        ),
      ).toThrow(/price and unit/);
    },
  );

  it("identifies current markdown shells as missing RSC data rather than model removal", () => {
    for (const locale of ["cn", "intl"]) {
      const shell = readFileSync(
        new URL(
          `../docs/upstream-samples-20261102/kimi-pricing-${locale}.md`,
          import.meta.url,
        ),
        "utf8",
      );
      expect(() => parseMoonshotPricingPage(shell, "url")).toThrow(
        /empty pricing shell; RSC data is required/,
      );
    }
  });

  it("reads the K3 table by column title, including both cache-write TTL tiers", () => {
    // The merged pricing page carries one table per family and they do not share a column
    // layout: K3 bills cache writes per TTL tier. Positional parsing broke the collector when
    // this table grew from 6 to 8 columns.
    const markdown = cnRsc;
    const parsed = parseMoonshotPricingPage(
      markdown,
      "https://platform.kimi.com/docs/pricing/chat",
    );
    expect(parsed.models[0]).toMatchObject({
      id: "kimi-k3",
      name: "Kimi K3",
      limits: { contextTokens: 1_048_576 },
      prices: [
        {
          market: "china",
          currency: "CNY",
          input: {
            cacheHit: 2,
            explicitCacheCreation: 20,
            explicitCacheCreation1h: 40,
            standard: 20,
          },
          output: 100,
        },
      ],
    });
    expect(parsed.models[0]?.limits.maxOutputTokens).toBeUndefined();
  });

  it("parses both tables of the merged page, whose column layouts differ", () => {
    const markdown = cnRsc;
    const parsed = parseMoonshotPricingPage(
      markdown,
      "https://platform.kimi.com/docs/pricing/chat",
    );
    expect(parsed.models.map((model) => model.id)).toEqual([
      "kimi-k3",
      "kimi-k2.7-code",
      "kimi-k2.7-code-highspeed",
      "kimi-k2.6",
    ]);
    // The K2 family has no cache-write columns, so those fields stay absent rather than zero.
    expect(parsed.models[1]?.prices[0]?.input).toEqual({
      cacheHit: 1.3,
      standard: 6.5,
    });
    expect(parsed.models[1]?.prices[0]?.output).toBe(27);
  });

  it("parses international MDX currency cells across both tables", () => {
    const markdown = intlRsc;
    const parsed = parseMoonshotPricingPage(
      markdown,
      "https://platform.kimi.ai/docs/pricing/chat",
      "international",
      "USD",
    );
    expect(parsed.models[0]?.prices[0]).toMatchObject({
      market: "international",
      currency: "USD",
      input: {
        cacheHit: 0.3,
        explicitCacheCreation: 3,
        explicitCacheCreation1h: 6,
        standard: 3,
      },
      output: 15,
    });
    // The K2 table names its input columns differently; both must resolve.
    expect(parsed.models[3]?.prices[0]).toMatchObject({
      input: { cacheHit: 0.16, standard: 0.95 },
      output: 4,
    });
  });

  it.each([
    [
      "CN",
      cnRsc,
      [
        [2, 20, 100],
        [1.3, 6.5, 27],
        [2.6, 13, 54],
        [1.1, 6.5, 27],
      ],
    ],
    [
      "国际站",
      intlRsc,
      [
        [0.3, 3, 15],
        [0.19, 0.95, 4],
        [0.38, 1.9, 8],
        [0.16, 0.95, 4],
      ],
    ],
  ] as const)(
    "核对%s全部模型的命中、未命中和输出价格",
    (_, flight, expected) => {
      const models = parseMoonshotPricingPage(flight, "url").models;
      expect(models.map((model) => model.id)).toEqual(modelIds);
      expect(
        models.map((model) => {
          const price = model.prices[0]!;
          return [price.input.cacheHit, price.input.standard, price.output];
        }),
      ).toEqual(expected);
    },
  );

  it("rejects empty markdown shells and empty or damaged RSC tables", () => {
    for (const text of [
      emptyTable,
      cnRsc.replace("rows:[[`kimi-k3`", "rows:[[]/*`kimi-k3`"),
      cnRsc.replace(/rows:\[\[`kimi-k3`[^\n]*?\]\]/, "rows:[]"),
      cnRsc.replace("rows:", "missingRows:"),
      cnRsc.replace("`¥100.00`", "`unavailable`"),
      cnRsc.replace("`¥100.00`,", ""),
      cnRsc.slice(0, 500),
    ]) {
      expect(() =>
        parseMoonshotPricingPage(
          text,
          "https://platform.kimi.com/docs/pricing/chat",
        ),
      ).toThrow();
    }
  });

  it("merges standalone currency cells and rejects a dangling symbol", () => {
    const split = cnRsc.replace("`¥100.00`", "`¥`,`100.00`");
    expect(
      parseMoonshotPricingPage(split, "url").models[0]?.prices[0]?.output,
    ).toBe(100);
    expect(() =>
      parseMoonshotPricingPage(cnRsc.replace("`¥100.00`", "`¥`"), "url"),
    ).toThrow("currency symbol");
  });

  it("reads the complete original Flight streams without counting no-JS tables twice", () => {
    for (const channel of ["cn", "intl"]) {
      const full = readFileSync(
        new URL(`../docs/kimi-rsc-samples/${channel}-rsc.txt`, import.meta.url),
        "utf8",
      );
      expect(
        parseMoonshotPricingPage(
          full,
          "https://platform.kimi.com/docs/pricing/chat",
        ).models.map((model) => model.id),
      ).toEqual(modelIds);
    }
  });

  it("uses column titles even when their order changes", () => {
    const reordered = cnRsc
      .replace("title:`模型`", "title:`计费单位`")
      .replace("title:`计费单位`,width:`10%`", "title:`模型`,width:`10%`")
      .replace("[`kimi-k3`,`1M tokens`", "[`1M tokens`,`kimi-k3`");
    expect(parseMoonshotPricingPage(reordered, "url").models[0]?.id).toBe(
      "kimi-k3",
    );
  });

  it("collects the current CN RSC models without relying on the empty markdown shell", async () => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.includes("/pricing/")) {
        expect((init.headers as Record<string, string>).RSC).toBe("1");
        return new Response(currentRsc);
      }
      if (url.includes("models-overview"))
        return new Response(modelIds.join(" "));
      return new Response(
        "Kimi 大模型的输出长度是多少\nkimi-k3 1024*1024 - prompt_tokens\nkimi-k2.6 256*1024 - prompt_tokens",
      );
    });
    const provider = await collectMoonshotChina();
    expect(provider.health.status).toBe("healthy");
    expect(provider.models).toHaveLength(6);
    expect(provider.models[0]).toMatchObject({
      id: "kimi-k3.1-pro",
      limits: { contextTokens: 1_048_576 },
    });
    expect(provider.models[0]?.limits.maxOutputTokens).toBeUndefined();
    expect(provider.models[2]?.limits.maxOutputTokens).toBe(1_048_576);
  });

  it("requests RSC first and keeps metadata requests in markdown", async () => {
    const requests: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      requests.push({ url, headers });
      if (url.includes("/pricing/")) return new Response(intlRsc);
      if (url.includes("models-overview"))
        return new Response(modelIds.join(" "));
      return new Response(
        "What is the output length of the Kimi model?\nkimi-k3 1024*1024 - prompt_tokens\nkimi-k2.6 256*1024 - prompt_tokens",
      );
    });
    const provider = await collectMoonshotInternational();
    expect(provider.health.status).toBe("healthy");
    expect(provider.models.map((model) => model.id)).toEqual(modelIds);
    expect(requests).toHaveLength(3);
    expect(requests[0]?.headers).toMatchObject({ RSC: "1", accept: "*/*" });
    expect(
      requests
        .slice(1)
        .every(
          ({ headers }) =>
            headers.accept === "text/markdown" && !("RSC" in headers),
        ),
    ).toBe(true);
  });

  it("falls back to markdown after an unusable RSC response", async () => {
    const markdown = readFileSync(
      new URL("./fixtures/kimi-intl-markdown.mdx", import.meta.url),
      "utf8",
    );
    const pricingHeaders: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.includes("/pricing/")) {
        const accept = (init.headers as Record<string, string>).accept!;
        pricingHeaders.push(accept);
        return new Response(accept === "*/*" ? emptyTable : markdown);
      }
      if (url.includes("models-overview"))
        return new Response(modelIds.join(" "));
      return new Response(
        "What is the output length of the Kimi model?\nkimi-k3 1024*1024 - prompt_tokens\nkimi-k2.6 256*1024 - prompt_tokens",
      );
    });
    const provider = await collectMoonshotInternational();
    expect(provider.health.status).toBe("healthy");
    expect(provider.models.map((model) => model.id)).toEqual([
      "kimi-k3",
      "kimi-k2.6",
    ]);
    expect(provider.models[0]?.prices[0]?.output).toBe(15);
    expect(provider.models[1]?.prices[0]?.input).toEqual({
      cacheHit: 0.16,
      standard: 0.95,
    });
    expect(pricingHeaders).toEqual(["*/*", "text/markdown"]);
  });

  it("fails collection when RSC and markdown both contain empty shells", async () => {
    const pricingHeaders: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.includes("/pricing/"))
        pricingHeaders.push((init.headers as Record<string, string>).accept!);
      return new Response(emptyTable);
    });
    await expect(collectMoonshotInternational()).rejects.toThrow(
      /RSC:.*markdown:/,
    );
    expect(pricingHeaders).toEqual(["*/*", "text/markdown"]);
  });

  it("parses official context-minus-prompt output limits", () => {
    const markdown = `
## Kimi 大模型的输出长度是多少

* 对于 \`kimi-k3\` 模型而言，最大输出长度是 \`1024*1024 - prompt_tokens\`；
* 对于 \`kimi-k2.6\`、\`kimi-k2.5\` 模型而言，最大输出长度是 \`256*1024 - prompt_tokens\`；

## Kimi 大模型支持的汉字数量是多少
`;
    const limits = parseMoonshotOutputLimits(markdown);
    expect(limits.get("kimi-k3")).toBe(1_048_576);
    expect(limits.get("kimi-k2.6")).toBe(262_144);
    expect(limits.get("kimi-k2.5")).toBeUndefined();
    expect(limits.get("kimi-k2.7-code")).toBeUndefined();
  });

  it("parses the English output-limit section", () => {
    const markdown = `
## What is the output length of the Kimi model?

* For \`kimi-k3\`, the maximum output length is \`1024*1024 - prompt_tokens\`.
* For \`kimi-k2.6\` and \`kimi-k2.5\`, the maximum output length is \`256*1024 - prompt_tokens\`.

## How many Chinese characters does the Kimi model support?
`;
    const limits = parseMoonshotOutputLimits(markdown);
    expect(limits.get("kimi-k3")).toBe(1_048_576);
    expect(limits.get("kimi-k2.6")).toBe(262_144);
    expect(limits.get("kimi-k2.5")).toBeUndefined();
  });

  it("collects the international channel with USD metadata", async () => {
    // The merged page carries two tables with different layouts, exactly like production.
    const pricing = intlRsc;
    const overview = "kimi-k3 kimi-k2.7-code kimi-k2.6";
    const troubleshooting = `
## What is the output length of the Kimi model?
* For \`kimi-k3\`, the maximum output length is \`1024*1024 - prompt_tokens\`.
* For \`kimi-k2.6\` and \`kimi-k2.5\`, the maximum output length is \`256*1024 - prompt_tokens\`.
## How many Chinese characters does the Kimi model support?
`;
    const requested: string[] = [];
    const provider = await collectMoonshotInternational(
      new Date("2026-07-23T00:00:00Z"),
      async (url) => {
        requested.push(url);
        // 单页定价：Kimi 已把在售模型合并到 /docs/pricing/chat
        if (url.endsWith("/docs/pricing/chat")) return pricing;
        // 旧的 per-model 路由已 307 重定向，不能再请求
        if (url.includes("/docs/pricing/")) {
          throw new Error(`retired per-model pricing page requested: ${url}`);
        }
        if (url.includes("models-overview")) return overview;
        return troubleshooting;
      },
    );
    expect(requested).toEqual([
      "https://platform.kimi.ai/docs/pricing/chat",
      "https://platform.kimi.ai/docs/api/models-overview",
      "https://platform.kimi.ai/docs/guide/troubleshooting#kimi",
    ]);
    expect(provider.models.map((model) => model.id)).toEqual([
      "kimi-k3",
      "kimi-k2.7-code",
      "kimi-k2.7-code-highspeed",
      "kimi-k2.6",
    ]);
    expect(provider).toMatchObject({
      id: "moonshot-intl",
      name: "Kimi International",
      baseUrls: { openai: "https://api.moonshot.ai/v1" },
    });
    expect(
      provider.models.every((model) =>
        model.prices.every(
          (price) =>
            price.market === "international" && price.currency === "USD",
        ),
      ),
    ).toBe(true);
    expect(provider.sources.every((source) => source.locale === "en")).toBe(
      true,
    );
  });

  it("rejects Moonshot V1 rows outside the selected Kimi scope", () => {
    const markdown = `
<DocTable
  columns={[
{ title: "模型", width: "24%" },
{ title: "计费单位", width: "12%" },
{ title: "输入价格（缓存命中）", width: "16%" },
{ title: "输入价格（缓存未命中）", width: "16%" },
{ title: "输出价格", width: "14%" },
{ title: "上下文窗口", width: "18%" },
]}
  rows={[
["moonshot-v1-8k", "1M tokens", "¥2.00", "¥2.00", "¥10.00", "8,192 tokens"],
]}
/>`;
    expect(() =>
      parseMoonshotPricingPage(
        markdown,
        "https://platform.kimi.com/docs/pricing/chat-v1",
      ),
    ).toThrow("Unsupported non-Kimi model in Kimi collector: moonshot-v1-8k");
  });
});
