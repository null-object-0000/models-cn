/**
 * 网络请求重试：上游站点偶发的连接层抖动（`fetch failed` / ECONNRESET / 5xx）
 * 会让整条采集判成 unhealthy，进而开出一个只带 error 状态的空 PR——
 * 那既污染 main，又让「真的有页面改版」淹没在噪音里。
 *
 * 边界（很重要）：只重试**请求本身**，不重试**解析**。
 * 页面改版、表格消失、字段改名都是确定性失败，重试它们只会拖长 CI 并掩盖真问题。
 * 所以重试包在 HTTP 这一层内（collector 里的 `fetcher`），解析仍只跑一次。
 *
 * 关掉重试：`MODELS_CN_RETRY_ATTEMPTS=1`（诊断「到底是抖动还是真改版」时用）。
 */
import { setTimeout as sleep } from "node:timers/promises";

/** 总尝试次数（含首次）。默认 3；设为 1 即完全关闭重试。 */
export function configuredAttempts(): number {
  const raw = process.env.MODELS_CN_RETRY_ATTEMPTS;
  if (!raw) return 3;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 3;
}

export interface RetryOptions {
  /** 总尝试次数（含首次） */
  attempts?: number;
  /** 首次退避毫秒，默认 1000 */
  baseDelayMs?: number;
  /** 单次退避上限毫秒，默认 8000 */
  maxDelayMs?: number;
  /** 可注入的 sleep（测试用） */
  sleepFn?: (ms: number) => Promise<void>;
  /** 每次重试前回调；默认打一行 stderr，让 CI 日志看得见重试 */
  onRetry?: (info: RetryAttempt) => void;
  /** 覆盖「这个错误值不值得重试」的判断 */
  shouldRetry?: (error: unknown) => boolean;
}

export interface RetryAttempt {
  /** 刚失败的那次尝试序号（1 = 首次） */
  attempt: number;
  attempts: number;
  delayMs: number;
  error: unknown;
}

const RETRYABLE_PATTERNS = [
  // Node fetch/undici 的连接层错误
  "fetch failed",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "socket hang up",
  "other side closed",
  "UND_ERR_",
  // 超时（AbortSignal.timeout 抛 TimeoutError / AbortError）
  "TimeoutError",
  "AbortError",
  "The operation was aborted",
  // playwright 的网络层错误
  "net::ERR_",
];

/** HTTP 状态码里只有 429 和 5xx 值得重试；4xx 是确定性的（改版 / 404 / 403），重试没意义。 */
function httpStatusOf(message: string): number | undefined {
  const match = /HTTP (\d{3})/.exec(message);
  return match?.[1] ? Number(match[1]) : undefined;
}

export function isRetryableError(error: unknown): boolean {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const status = httpStatusOf(message);
  if (status !== undefined) return status === 429 || status >= 500;
  return RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern));
}

function backoffMs(attempt: number, base: number, max: number): number {
  // 指数退避 + 抖动：避免多个并发 collector 在同一时刻齐步重试
  const exponential = Math.min(base * 2 ** (attempt - 1), max);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

function defaultOnRetry(info: RetryAttempt): void {
  const reason =
    info.error instanceof Error ? info.error.message : String(info.error);
  console.warn(
    `[net] 第 ${info.attempt}/${info.attempts} 次尝试失败（${reason}），${info.delayMs}ms 后重试`,
  );
}

/** 把任意异步操作按退避策略重试。用于 playwright 的 request（qwen）与原生 fetch 两类入口。 */
export async function retryAsync<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? configuredAttempts();
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  const sleepFn = options.sleepFn ?? sleep;
  const shouldRetry = options.shouldRetry ?? isRetryableError;
  const onRetry = options.onRetry ?? defaultOnRetry;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error)) throw error;
      const delayMs = backoffMs(attempt, baseDelayMs, maxDelayMs);
      onRetry({ attempt, attempts, delayMs, error });
      await sleepFn(delayMs);
    }
  }
  // 循环要么 return 要么 throw，这里只为类型收窄
  throw lastError;
}

export interface FetchWithRetryInit extends RetryOptions {
  headers?: Record<string, string>;
  /** 单次尝试的超时毫秒，默认 30000 */
  timeoutMs?: number;
  /** HTTP 非 2xx 时错误消息的前缀，默认 `Failed to fetch <url>` */
  errorPrefix?: string;
}

function retryOptionsOf(init: FetchWithRetryInit): RetryOptions {
  const options: RetryOptions = {};
  if (init.attempts !== undefined) options.attempts = init.attempts;
  if (init.baseDelayMs !== undefined) options.baseDelayMs = init.baseDelayMs;
  if (init.maxDelayMs !== undefined) options.maxDelayMs = init.maxDelayMs;
  if (init.sleepFn !== undefined) options.sleepFn = init.sleepFn;
  if (init.onRetry !== undefined) options.onRetry = init.onRetry;
  if (init.shouldRetry !== undefined) options.shouldRetry = init.shouldRetry;
  return options;
}

/**
 * 带重试的 GET：一次尝试 = 「发请求 + 断言 2xx」。
 *
 * **超时必须由本函数管理**：`AbortSignal.timeout()` 造出的 signal 一旦触发就永久 abort，
 * 若把它放进 init 跨尝试复用，第一次超时之后的重试会立刻被同一个 signal 拒掉——
 * 等于重试完全失效。所以每次尝试都新建一个 signal。
 *
 * 断言 2xx 放在重试内部，503/429 才会被重试；404/403 这类确定性失败立刻抛出。
 */
export async function requestWithRetry(
  url: string,
  init: FetchWithRetryInit = {},
): Promise<Response> {
  const { headers, timeoutMs = 30_000, errorPrefix } = init;
  const prefix = errorPrefix ?? `Failed to fetch ${url}`;
  return retryAsync(async () => {
    const requestInit: RequestInit = {
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (headers !== undefined) requestInit.headers = headers;
    const response = await fetch(url, requestInit);
    if (!response.ok) {
      throw new Error(`${prefix}: HTTP ${response.status}`);
    }
    return response;
  }, retryOptionsOf(init));
}

/** 带重试地取纯文本（响应体解析在重试之外，解析失败不重试）。 */
export async function fetchTextWithRetry(
  url: string,
  init: FetchWithRetryInit = {},
): Promise<string> {
  return (await requestWithRetry(url, init)).text();
}

/** 带重试地取 JSON（同上，JSON 解析失败视为确定性失败）。 */
export async function fetchJsonWithRetry<T>(
  url: string,
  init: FetchWithRetryInit = {},
): Promise<T> {
  return (await requestWithRetry(url, init)).json() as Promise<T>;
}

/** 站点通用的 User-Agent：上游按它识别采集来源。 */
export const MODELS_CN_USER_AGENT =
  "models-cn/0.1 (+https://github.com/null-object-0000/models-cn)";
