import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configuredAttempts,
  fetchJsonWithRetry,
  fetchTextWithRetry,
  isRetryableError,
  retryAsync,
} from "../src/net.js";

const noSleep = async () => {};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MODELS_CN_RETRY_ATTEMPTS;
});

describe("isRetryableError：区分「抖动」与「确定性失败」", () => {
  it("连接层错误可重试", () => {
    for (const message of [
      "fetch failed",
      "read ECONNRESET",
      "connect ETIMEDOUT",
      "socket hang up",
      "net::ERR_CONNECTION_CLOSED",
      "UND_ERR_SOCKET",
    ]) {
      expect(isRetryableError(new Error(message)), message).toBe(true);
    }
  });

  it("超时可重试", () => {
    const timeout = Object.assign(
      new Error("The operation was aborted due to timeout"),
      { name: "TimeoutError" },
    );
    expect(isRetryableError(timeout)).toBe(true);
  });

  it("429 与 5xx 可重试；404/403 这类 4xx 不重试", () => {
    expect(isRetryableError(new Error("Failed to fetch x: HTTP 503"))).toBe(
      true,
    );
    expect(isRetryableError(new Error("Failed to fetch x: HTTP 429"))).toBe(
      true,
    );
    expect(isRetryableError(new Error("Failed to fetch x: HTTP 404"))).toBe(
      false,
    );
    expect(isRetryableError(new Error("Failed to fetch x: HTTP 403"))).toBe(
      false,
    );
  });

  it("解析失败不是网络错误，不该重试", () => {
    // 页面改版的报错形态：这些重试只是拖长 CI，还会掩盖真问题
    for (const message of [
      "Kimi pricing page contains duplicate model IDs",
      "Zhipu pricing config contains no token-priced models",
      "LongCat quick start is missing the maximum output length for X",
      "Cannot parse Qwen input price: abc",
      "Unexpected token < in JSON at position 0",
    ]) {
      expect(isRetryableError(new Error(message)), message).toBe(false);
    }
  });
});

describe("retryAsync", () => {
  it("抖动后成功：返回结果并重试到成功为止", async () => {
    let calls = 0;
    const result = await retryAsync(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("fetch failed");
        return "ok";
      },
      { sleepFn: noSleep },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("用尽尝试次数后抛出最后一次的错误", async () => {
    let calls = 0;
    await expect(
      retryAsync(
        async () => {
          calls += 1;
          throw new Error(`fetch failed #${calls}`);
        },
        { attempts: 3, sleepFn: noSleep },
      ),
    ).rejects.toThrow("fetch failed #3");
    expect(calls).toBe(3);
  });

  it("不可重试的错误立刻抛出，不浪费尝试次数", async () => {
    let calls = 0;
    await expect(
      retryAsync(
        async () => {
          calls += 1;
          throw new Error("pricing page contains duplicate model IDs");
        },
        { attempts: 3, sleepFn: noSleep },
      ),
    ).rejects.toThrow("duplicate model IDs");
    expect(calls).toBe(1);
  });

  it("退避是递增的且带抖动，不会多路同刻齐步重试", async () => {
    const delays: number[] = [];
    await expect(
      retryAsync(
        async () => {
          throw new Error("fetch failed");
        },
        {
          attempts: 4,
          baseDelayMs: 1000,
          maxDelayMs: 8000,
          sleepFn: async (ms) => void delays.push(ms),
        },
      ),
    ).rejects.toThrow();
    expect(delays).toHaveLength(3);
    // 上界 = min(base * 2^(n-1), max)，下界 = 一半（抖动 0.5–1.0）
    delays.forEach((delay, index) => {
      const ceiling = Math.min(1000 * 2 ** index, 8000);
      expect(delay).toBeGreaterThanOrEqual(Math.round(ceiling * 0.5));
      expect(delay).toBeLessThanOrEqual(ceiling);
    });
  });

  it("attempts=1 完全关闭重试（诊断抖动 vs 真改版时用）", async () => {
    process.env.MODELS_CN_RETRY_ATTEMPTS = "1";
    expect(configuredAttempts()).toBe(1);
    let calls = 0;
    await expect(
      retryAsync(
        async () => {
          calls += 1;
          throw new Error("fetch failed");
        },
        { sleepFn: noSleep },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("环境变量非法时回落到默认 3 次", () => {
    process.env.MODELS_CN_RETRY_ATTEMPTS = "0";
    expect(configuredAttempts()).toBe(3);
    process.env.MODELS_CN_RETRY_ATTEMPTS = "abc";
    expect(configuredAttempts()).toBe(3);
  });
});

describe("fetchTextWithRetry / fetchJsonWithRetry", () => {
  it("非 2xx 会按状态码决定是否重试", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response("nope", { status: 404 });
    });
    await expect(
      fetchTextWithRetry("https://example.test/a", { sleepFn: noSleep }),
    ).rejects.toThrow("HTTP 404");
    expect(calls).toBe(1);

    calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return calls < 2
        ? new Response("bad gateway", { status: 502 })
        : new Response("healed", { status: 200 });
    });
    await expect(
      fetchTextWithRetry("https://example.test/b", { sleepFn: noSleep }),
    ).resolves.toBe("healed");
    expect(calls).toBe(2);
  });

  it("JSON 解析失败不重试（确定性失败，不是网络抖动）", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response("<html>upstream changed</html>", { status: 200 });
    });
    await expect(
      fetchJsonWithRetry("https://example.test/c", { sleepFn: noSleep }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("每次尝试都用新的超时信号：第一次超时不会让后续重试被同一个已 abort 的 signal 拒掉", async () => {
    // 这是最容易写错的地方——把 `AbortSignal.timeout()` 提到重试外面，
    // 第一次超时之后的重试会立刻失败，等于重试完全失效（且很难看出来）。
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      signals.push(signal);
      if (signals.length === 1) {
        // 模拟第一次尝试真的超时：等 signal 自己被 abort 再抛 TimeoutError
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(
              Object.assign(
                new Error("The operation was aborted due to timeout"),
                { name: "TimeoutError" },
              ),
            ),
          );
        });
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    });

    const text = await fetchTextWithRetry("https://example.test/d", {
      timeoutMs: 5,
      sleepFn: noSleep,
    });

    expect(text).toBe("ok");
    expect(signals).toHaveLength(2);
    expect(signals[1]).not.toBe(signals[0]);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});

describe("重试日志", () => {
  it("重试时默认往 stderr 打一行，便于在 CI 日志里看见抖动", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    await retryAsync(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error("fetch failed");
        return "ok";
      },
      { sleepFn: noSleep },
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("fetch failed");
    warn.mockRestore();
  });
});
