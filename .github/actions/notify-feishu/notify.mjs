// Report a run outcome to Feishu. Never fails the build.
//
// The scheduled run is 3x/day, so raw notification would be noise:
//   - failure  : a broken source stays broken for days (Sep incident: 28 in a row),
//                so notify on the transition into failure, then ~daily.
//   - opened/updated PR : that is the actionable "review me" signal, notify every time.
import process from "node:process";

const {
  MODE = "failure",
  PR_URL,
  FEISHU_APP_ID,
  FEISHU_APP_SECRET,
  FEISHU_CHAT_ID,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  GITHUB_RUN_ID,
  GITHUB_WORKFLOW,
  GITHUB_WORKFLOW_REF,
  GITHUB_EVENT_NAME,
  GITHUB_REF_NAME,
  GITHUB_SERVER_URL = "https://github.com",
  GITHUB_API_URL = "https://api.github.com",
} = process.env;

// Failure reminder cadence: ~1/day at the 3x/day schedule.
const REMIND_EVERY = 8;

const runUrl = `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
const log = (msg) => console.log(`[notify-feishu] ${msg}`);

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return res.json();
}

async function api(pathname) {
  if (!GITHUB_TOKEN) return null;
  try {
    const res = await fetch(`${GITHUB_API_URL}${pathname}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      log(`API ${pathname} -> ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    log(`API ${pathname} failed: ${err.message}`);
    return null;
  }
}

// Best-effort: name the steps that actually failed.
async function failedSteps() {
  const data = await api(
    `/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/jobs`,
  );
  const out = [];
  for (const job of data?.jobs ?? []) {
    if (job.conclusion !== "failure") continue;
    const steps = (job.steps ?? [])
      .filter((s) => s.conclusion === "failure")
      .map((s) => s.name);
    out.push(steps.length ? `${job.name} → ${steps.join(", ")}` : job.name);
  }
  return out;
}

// "owner/repo/.github/workflows/update-prices.yml@refs/heads/main" -> "update-prices.yml"
// The workflow *name* can contain spaces, so it is not safe in a URL.
function workflowFileName() {
  const path = (GITHUB_WORKFLOW_REF ?? "").split("@")[0];
  const name = path.split("/").pop();
  return name && name.endsWith(".yml") ? name : null;
}

// How many runs in a row have failed, counting this one.
async function consecutiveFailures() {
  const file = workflowFileName();
  if (!file) return null;
  const data = await api(
    `/repos/${GITHUB_REPOSITORY}/actions/workflows/${file}/runs?per_page=100`,
  );
  const runs = data?.workflow_runs;
  if (!runs) return null;

  // The list is newest-first, so locate this run and count *older* runs only.
  const index = runs.findIndex((r) => String(r.id) === String(GITHUB_RUN_ID));
  if (index === -1) return null;

  let count = 1; // this run
  for (let i = index + 1; i < runs.length; i += 1) {
    const run = runs[i];
    if (run.status !== "completed") continue;
    if (run.conclusion !== "failure") break;
    count += 1;
  }
  return count;
}

function context() {
  return `${GITHUB_WORKFLOW} · ${GITHUB_EVENT_NAME}${
    GITHUB_REF_NAME ? ` (${GITHUB_REF_NAME})` : ""
  }`;
}

function failureText(steps, streak) {
  const lines = ["🔴 models-cn 工作流失败", "", context()];
  if (steps.length) {
    lines.push("", "失败步骤:", ...steps.map((s) => `- ${s}`));
  }
  if (streak && streak > 1) {
    lines.push("", `⚠️ 已连续失败 ${streak} 次，仍未恢复。`);
  }
  if (PR_URL) lines.push("", `已生成的 PR: ${PR_URL}`);
  lines.push("", runUrl);
  return lines.join("\n");
}

function prText() {
  return [
    "🟡 models-cn 有定价更新待合并",
    "",
    context(),
    "",
    PR_URL,
    "",
    "Actions 已通过，合并后才会发布到站点与 API。",
  ].join("\n");
}

// Returns the message to send, or null to stay quiet.
async function compose() {
  if (MODE === "pr") {
    if (!PR_URL) {
      log("skipped: pr mode without a PR url");
      return null;
    }
    return prText();
  }

  const streak = await consecutiveFailures();
  const due = streak === null || streak === 1 || streak % REMIND_EVERY === 0;
  if (!due) {
    log(`suppressed: ${streak} consecutive failures (already notified)`);
    return null;
  }
  return failureText(await failedSteps(), streak);
}

async function main() {
  const missing = [
    "FEISHU_APP_ID",
    "FEISHU_APP_SECRET",
    "FEISHU_CHAT_ID",
  ].filter((k) => !process.env[k]);
  if (missing.length) {
    log(`skipped: missing ${missing.join(", ")}`);
    return;
  }

  const text = await compose();
  if (!text) return;

  const tokenRes = await post(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    { app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET },
  );
  if (tokenRes.code !== 0) {
    log(`token error: ${tokenRes.code} ${tokenRes.msg}`);
    return;
  }

  const sendRes = await post(
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
    {
      receive_id: FEISHU_CHAT_ID,
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
    { Authorization: `Bearer ${tokenRes.tenant_access_token}` },
  );
  if (sendRes.code !== 0) {
    log(`send error: ${sendRes.code} ${sendRes.msg}`);
    return;
  }
  log(`sent (mode=${MODE}) ${sendRes.data?.message_id ?? ""}`);
}

try {
  await main();
} catch (err) {
  log(`unexpected: ${err.message}`);
}
process.exit(0);
