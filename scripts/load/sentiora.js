// S9 load test (REBUILD_PLAN S9, D17). Runs in grafana/k6 inside the load
// stack; see scripts/load/README.md.
//
// LOAD_USERS signed-in users, each its own seeded account (load-0001@example.com…):
//   browse  85%  open the dashboard, poll the feed every 5 s like the web app,
//                open a save now and then, reload about once a minute
//   ask     10%  ask an instant question, read it, ask another
//   explain  5%  ask, then click Explain with AI (fake provider)
// Ramp RAMP, hold HOLD, ramp down. Pass/fail thresholds are the plan's targets.

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";

const BASE = `${__ENV.BASE_URL || "http://web:8080"}/api/v1`;
const USERS = Number(__ENV.LOAD_USERS || 500);
const PASSWORD = __ENV.LOAD_USER_PASSWORD;
const RAMP = __ENV.RAMP || "2m";
const HOLD = __ENV.HOLD || "10m";
const TZ = "Asia/Kolkata";

const QUESTIONS = new SharedArray("questions", () =>
  JSON.parse(open("/eval-rag/fixture/questions.json")).questions.map((q) => q.question),
);

const serverErrors = new Counter("server_errors");
const aiBusy = new Counter("ai_busy");
const instantAnswer = new Trend("instant_answer_ms", true);
const aiAnswer = new Trend("ai_answer_ms", true);

const browseVUs = Math.max(1, Math.round(USERS * 0.85));
const askVUs = Math.max(1, Math.round(USERS * 0.1));
const explainVUs = Math.max(1, USERS - browseVUs - askVUs);

function rampScenario(exec, target) {
  return {
    executor: "ramping-vus",
    exec,
    startVUs: 0,
    stages: [
      { duration: RAMP, target },
      { duration: HOLD, target },
      { duration: "30s", target: 0 },
    ],
    gracefulRampDown: "30s",
  };
}

export const options = {
  scenarios: {
    browse: rampScenario("browse", browseVUs),
    ask: rampScenario("askFlow", askVUs),
    explain: rampScenario("explainFlow", explainVUs),
  },
  thresholds: {
    instant_answer_ms: ["p(95)<1000"],
    server_errors: ["count==0"],
    "http_req_duration{name:feed}": ["p(95)<500"],
    "http_req_failed{scenario:browse}": ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

// -- helpers -------------------------------------------------------------------

const session = { access: null, refresh: null, items: [] };

// A 5xx, or no response at all (timeout, connection refused), counts against
// the plan's "zero 5xx" target.
function record(res) {
  if (res.status >= 500 || res.status === 0) serverErrors.add(1);
  return res;
}

function signIn() {
  const index = ((__VU - 1) % USERS) + 1;
  const email = `load-${String(index).padStart(4, "0")}@example.com`;
  const res = record(
    http.post(`${BASE}/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
      headers: { "Content-Type": "application/json" },
      tags: { name: "login" },
    }),
  );
  check(res, { "signed in": (r) => r.status === 200 });
  if (res.status !== 200) return false;
  const data = res.json("data");
  session.access = data.access_token;
  session.refresh = data.refresh_token;
  return true;
}

function refresh() {
  const res = record(
    http.post(`${BASE}/auth/refresh`, JSON.stringify({ refresh_token: session.refresh }), {
      headers: { "Content-Type": "application/json" },
      tags: { name: "refresh" },
    }),
  );
  if (res.status !== 200) return signIn();
  const data = res.json("data");
  session.access = data.access_token;
  session.refresh = data.refresh_token || session.refresh;
  return true;
}

function api(method, path, body, name, extraHeaders = {}) {
  const send = () =>
    http.request(method, `${BASE}${path}`, body === null ? null : JSON.stringify(body), {
      headers: {
        Authorization: `Bearer ${session.access}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      tags: { name },
      timeout: "60s",
    });
  let res = send();
  if (res.status === 401 && refresh()) res = send();
  return record(res);
}

function ensureSignedIn() {
  if (session.access) return true;
  return signIn();
}

function loadDashboard() {
  api("GET", "/users/me", null, "me");
  api("GET", "/auth/me", null, "auth_me");
  api("GET", "/users/me/source-preferences", null, "source_prefs");
  api("GET", `/dashboard/statistics?tz=${encodeURIComponent(TZ)}`, null, "statistics");
  pollFeed();
}

function pollFeed() {
  const res = api("GET", "/memory-items?page=1&per_page=100", null, "feed");
  if (res.status === 200) {
    const items = res.json("data.items") || [];
    session.items = items.map((i) => i.id);
  }
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function ask(mode) {
  const question = pick(QUESTIONS);
  const res = api(
    "POST",
    "/chat/stream",
    { question, answer_mode: mode, tz: TZ },
    mode === "ai" ? "ask_ai" : "ask_instant",
    { Accept: "text/event-stream" },
  );
  if (res.status === 429 && mode === "ai") {
    aiBusy.add(1);
    return res;
  }
  const ok = check(res, {
    [`${mode} answered`]: (r) => r.status === 200 && r.body.includes("event: final"),
  });
  if (ok) (mode === "ai" ? aiAnswer : instantAnswer).add(res.timings.duration);
  return res;
}

// -- scenarios -----------------------------------------------------------------

export function browse() {
  if (!ensureSignedIn()) return sleep(5);
  loadDashboard();
  // About a minute on the page: the feed polls every 5 s; sometimes a save is opened.
  for (let tick = 0; tick < 12; tick++) {
    sleep(5);
    pollFeed();
    if (session.items.length && Math.random() < 0.15) {
      api("GET", `/memory-items/${pick(session.items)}`, null, "memory_detail");
    }
  }
}

export function askFlow() {
  if (!ensureSignedIn()) return sleep(5);
  ask("instant");
  sleep(3 + Math.random() * 5); // reading the answer
}

export function explainFlow() {
  if (!ensureSignedIn()) return sleep(5);
  ask("instant");
  sleep(2 + Math.random() * 3);
  ask("ai");
  sleep(5 + Math.random() * 5);
}
