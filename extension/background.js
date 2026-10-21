// Apply.ai extension — background service worker.
// Runs Hunter in the user's own Chrome, then nudges Tailor on the server.
importScripts("config.js", "scrapers.js");

const API = () => self.APP_URL;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => sleep(min + Math.random() * (max - min));

/* ─────────────────────────── storage helpers ─────────────────────────── */

const get = async (k) => (await chrome.storage.local.get(k))[k];
const set = (obj) => chrome.storage.local.set(obj);

async function log(line) {
  const logLines = (await get("log")) || [];
  logLines.push(`${new Date().toLocaleTimeString()}  ${line}`);
  await set({ log: logLines.slice(-60) });
}

async function setProgress(p) {
  await set({ progress: p });
  chrome.action.setBadgeText({ text: p && p.badge ? String(p.badge) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#1f6f5c" });
}

/* ───────────────────────────── API calls ───────────────────────────── */

async function api(path, { method = "GET", body } = {}) {
  const token = await get("token");
  if (!token) throw new Error("Not connected. Open Apply.ai and click “Connect extension”.");
  const res = await fetch(`${API()}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Apply-Token": token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Apply.ai answered ${res.status}`);
  return json;
}

/* ─────────────────────────── worker window ─────────────────────────── */

// Hunter works in its own minimised window so your tabs aren't disturbed.
async function openWorker() {
  const win = await chrome.windows.create({ url: "about:blank", state: "minimized", focused: false });
  return { windowId: win.id, tabId: win.tabs[0].id };
}

async function closeWorker(w) {
  if (w) await chrome.windows.remove(w.windowId).catch(() => {});
}

function waitForLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(onUpd);
      clearTimeout(t);
      resolve();
    };
    const onUpd = (id, info) => id === tabId && info.status === "complete" && done();
    const t = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpd);
  });
}

async function visit(tabId, url) {
  const loaded = waitForLoad(tabId);
  await chrome.tabs.update(tabId, { url });
  await loaded;
  await jitter(1500, 3000);
  return (await chrome.tabs.get(tabId)).url || "";
}

async function run(tabId, func, args) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res ? res.result : null;
}

function isLoginWall(portal, url) {
  if (portal === "linkedin") return /linkedin\.com\/(login|authwall|checkpoint|signup|uas\/login)/.test(url);
  if (portal === "naukri") return /naukri\.com\/nlogin/.test(url);
  if (portal === "indeed") return /secure\.indeed\.com\/auth/.test(url);
  return false;
}

function portalOf(url) {
  if (/linkedin\.com/.test(url)) return "linkedin";
  if (/naukri\.com/.test(url)) return "naukri";
  if (/indeed\.com/.test(url)) return "indeed";
  return "other";
}

/* ─────────────────────────────── Hunter ─────────────────────────────── */

let keepAlive = null;

async function runHunter(trigger) {
  if (await get("running")) return { started: false, message: "Hunter is already running." };
  await set({ running: true, stop: false, log: [] });
  keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  const started_at = new Date().toISOString();
  const stats = { trigger, searches: 0, cards: 0, new: 0, kept: 0, read: 0, tailored: 0, login_needed: [] };
  let worker = null;

  try {
    const plan = await api("/api/ext/plan");
    if (!plan.ready) throw new Error(plan.reason);
    await set({ dailyRunHour: plan.daily_run_hour });
    await log(`Hunter started (${plan.tasks.length} searches).`);

    worker = await openWorker();
    const cards = [];
    const blocked = new Set();

    // 1) Search pages
    for (const [k, task] of plan.tasks.entries()) {
      if (await get("stop")) break;
      if (blocked.has(task.portal)) continue;
      await setProgress({ phase: "Searching", detail: `${task.portal}: ${task.query} · ${task.location}`, step: k + 1, of: plan.tasks.length, badge: "…" });
      const finalUrl = await visit(worker.tabId, task.url);
      if (isLoginWall(task.portal, finalUrl)) {
        blocked.add(task.portal);
        stats.login_needed.push(task.portal);
        await log(`${task.portal}: please sign in to it in Chrome — skipped for now.`);
        continue;
      }
      try {
        const res = await run(worker.tabId, scrapeList, [task.portal]);
        const found = (res && res.jobs) || [];
        cards.push(...found);
        stats.searches++;
        await log(`${task.portal}: ${found.length} jobs for “${task.query}” in ${task.location}`);
      } catch (e) {
        await log(`${task.portal}: couldn't read results (${e.message})`);
      }
      await jitter(3000, 7000);
    }
    stats.cards = cards.length;
    if (stats.login_needed.length) {
      const status = {};
      stats.login_needed.forEach((p) => (status[p] = "login_needed"));
      await api("/api/ext/portal-status", { method: "POST", body: { status } }).catch(() => {});
    }

    // 2) Send cards; server de-duplicates, filters and says which pages to open
    let queue = [];
    for (let i = 0; i < cards.length || i === 0; i += 150) {
      const r = await api("/api/ext/jobs", { method: "POST", body: { jobs: cards.slice(i, i + 150) } });
      stats.new += r.new;
      stats.kept += r.kept;
      queue = r.need_details;
      if (!cards.length) break;
    }
    await log(`${stats.new} new jobs, ${stats.kept} look relevant. Reading ${queue.length} job pages…`);

    // 3) Job pages → full descriptions
    for (const [k, job] of queue.entries()) {
      if (await get("stop")) break;
      if (blocked.has(job.portal)) continue;
      await setProgress({ phase: "Reading jobs", detail: job.url, step: k + 1, of: queue.length, badge: queue.length - k });
      try {
        const finalUrl = await visit(worker.tabId, job.url);
        if (isLoginWall(job.portal, finalUrl)) {
          blocked.add(job.portal);
          continue;
        }
        const d = await run(worker.tabId, scrapeDetail, [job.portal]);
        await api("/api/ext/detail", { method: "POST", body: { id: job.id, ...(d || {}) } });
        if (d && d.description) stats.read++;
      } catch (e) {
        await log(`Couldn't read ${job.url} (${e.message})`);
      }
      await jitter(4000, 9000);
    }
    await closeWorker(worker);
    worker = null;
    await api("/api/ext/run-done", { method: "POST", body: { started_at, stats } }).catch(() => {});
    await log(`Read ${stats.read} job descriptions. Handing over to Tailor…`);

    // 4) Tailor, one job per request, paced for the AI free tier
    const deadline = Date.now() + 45 * 60_000;
    while (Date.now() < deadline && !(await get("stop"))) {
      const r = await api("/api/ext/tailor-next", { method: "POST" });
      if (r.done) break;
      if (r.rate_limited) {
        await setProgress({ phase: "Tailor", detail: "AI limit reached — waiting a minute", badge: r.remaining });
        await sleep(60_000);
        continue;
      }
      if (r.job && r.job.status === "tailored") stats.tailored++;
      await setProgress({ phase: "Tailor", detail: r.job ? `${r.job.title} — ${r.job.match_percent ?? "?"}%` : "", badge: r.remaining });
      await sleep(5000);
    }
    await log(`Done. ${stats.tailored} CVs tailored. Open your dashboard to review.`);
    await set({ lastRun: { at: new Date().toISOString(), stats } });
    return { started: true, stats };
  } catch (e) {
    await log(`Stopped: ${e.message}`);
    throw e;
  } finally {
    await closeWorker(worker);
    clearInterval(keepAlive);
    await set({ running: false });
    await setProgress(null);
  }
}

/* ─────────────────────────── sign-in check ─────────────────────────── */

const LOGIN_CHECKS = {
  naukri: { url: "https://www.naukri.com/mnjuser/homepage", ok: (u) => /naukri\.com\/mnjuser/.test(u) },
  linkedin: { url: "https://www.linkedin.com/feed/", ok: (u) => /linkedin\.com\/feed/.test(u) },
  indeed: { url: "https://profile.indeed.com/", ok: (u) => /profile\.indeed\.com/.test(u) },
};

async function checkLogins() {
  const worker = await openWorker();
  const status = {};
  try {
    for (const [portal, c] of Object.entries(LOGIN_CHECKS)) {
      const finalUrl = await visit(worker.tabId, c.url);
      status[portal] = c.ok(finalUrl) && !isLoginWall(portal, finalUrl) ? "ok" : "login_needed";
    }
  } finally {
    await closeWorker(worker);
  }
  await api("/api/ext/portal-status", { method: "POST", body: { status } }).catch(() => {});
  return status;
}

/* ──────────────────── LinkedIn achievements scan ──────────────────── */

async function scanLinkedIn() {
  if (await get("running")) throw new Error("Hunter is running. Try the scan when it finishes.");
  const worker = await openWorker();
  try {
    const me = await visit(worker.tabId, "https://www.linkedin.com/in/me/");
    if (isLoginWall("linkedin", me) || !/linkedin\.com\/in\/[^/]+/.test(me)) {
      throw new Error("Sign in to LinkedIn in this Chrome first, then try again.");
    }
    const base = me.match(/https:\/\/www\.linkedin\.com\/in\/[^/?#]+/)[0];
    const pages = [
      { section: "Licenses & certifications", url: `${base}/details/certifications/`, kind: "list" },
      { section: "Honors & awards", url: `${base}/details/honors/`, kind: "list" },
      { section: "Recommendations received", url: `${base}/details/recommendations/?detailScreenTabIndex=0`, kind: "list" },
      { section: "Courses", url: `${base}/details/courses/`, kind: "list" },
      { section: "Recent posts mentioning awards or recognition", url: `${base}/recent-activity/all/`, kind: "posts" },
    ];
    const sections = [];
    for (const p of pages) {
      await visit(worker.tabId, p.url);
      const r = await run(worker.tabId, scrapeLinkedInList, [p.kind]).catch(() => null);
      sections.push({ section: p.section, items: (r && !r.empty && r.items) || [] });
      await jitter(2500, 5000);
    }
    const res = await api("/api/ext/linkedin-scan", { method: "POST", body: { sections } });
    return { found: res.found, read: sections.reduce((n, x) => n + x.items.length, 0) };
  } finally {
    await closeWorker(worker);
  }
}

/* ──────────────────── Interview research (Coach) ──────────────────── */

const LEGAL = new Set(["pvt", "private", "ltd", "limited", "inc", "llp", "llc", "corp", "corporation", "co"]);
const slugify = (t) => {
  const words = String(t || "").toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean);
  const core = words.filter((w) => !LEGAL.has(w));
  return (core.length ? core : words).join("-");
};

/** Read interview reviews for a company/role on Glassdoor and AmbitionBox in the user's own Chrome. */
async function researchInterviews(sessionId, company, role) {
  if (!sessionId || !company) throw new Error("Missing company for research.");
  if (await get("running")) throw new Error("Hunter is running. Try again when it finishes.");
  const worker = await openWorker();
  const sections = [];
  try {
    // AmbitionBox: role page first, then the company's interview page
    const c = slugify(company);
    const r = slugify(role);
    for (const url of [
      r && `https://www.ambitionbox.com/interviews/${c}-interview-questions/${r}`,
      `https://www.ambitionbox.com/interviews/${c}-interview-questions`,
    ].filter(Boolean)) {
      await visit(worker.tabId, url);
      const res = await run(worker.tabId, scrapeInterviewReviews, ["ambitionbox"]).catch(() => null);
      if (res && (res.items.length || res.login_needed)) {
        sections.push({ site: "AmbitionBox", url: res.url, items: res.items, login_needed: res.login_needed });
        if (res.items.length >= 5) break;
      }
      await jitter(2000, 4000);
    }

    // Glassdoor: find the company's interview page, then read it (filtered by role when possible)
    await visit(worker.tabId, `https://www.glassdoor.co.in/Search/results.htm?keyword=${encodeURIComponent(company)}`);
    const gdUrl = await run(worker.tabId, findGlassdoorInterviewUrl, []).catch(() => null);
    if (gdUrl) {
      for (const url of [role ? `${gdUrl}?filter.jobTitleFTS=${encodeURIComponent(role)}` : null, gdUrl].filter(Boolean)) {
        await jitter(2000, 4000);
        await visit(worker.tabId, url);
        const res = await run(worker.tabId, scrapeInterviewReviews, ["glassdoor"]).catch(() => null);
        if (res && (res.items.length || res.login_needed)) {
          sections.push({ site: "Glassdoor", url: res.url, items: res.items, login_needed: res.login_needed });
          if (res.items.length >= 5 || res.login_needed) break;
        }
      }
    }
  } finally {
    await closeWorker(worker);
  }
  const out = await api("/api/ext/interview-research", { method: "POST", body: { session_id: sessionId, sections } });
  return { found: out.found, login_needed: out.login_needed || [], sites: sections.filter((x) => x.items.length).map((x) => x.site) };
}

/* ──────────────────────── "Add this job" capture ──────────────────────── */

async function captureActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) throw new Error("Open a job's page first.");
  const portal = portalOf(tab.url);
  const d = await run(tab.id, scrapeDetail, [portal === "other" ? "" : portal]);
  if (!d || !d.description) throw new Error("Couldn't find a job description on this page.");
  const r = await api("/api/ext/capture", {
    method: "POST",
    body: { url: tab.url, portal, title: d.title || tab.title, company: d.company, location: d.location, description: d.description },
  });
  return { id: r.id, title: d.title || tab.title };
}

/* ─────────────────────────────── messages ─────────────────────────────── */

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    // Messages from the Apply.ai website must come from the configured app origin.
    if (msg.from === "web") {
      const origin = sender.origin || (sender.url ? new URL(sender.url).origin : "");
      if (origin !== new URL(API()).origin) throw new Error("This site isn't your Apply.ai app.");
      switch (msg.type) {
        case "STATUS":
          return { paired: !!(await get("token")), running: !!(await get("running")) };
        case "PAIR":
          if (!/^apx_[\w-]{20,}$/.test(msg.token || "")) throw new Error("Invalid pairing token.");
          await set({ token: msg.token });
          await scheduleDaily();
          return { paired: true };
        case "CHECK_LOGINS":
          return checkLogins();
        case "SCAN_LINKEDIN":
          return scanLinkedIn();
        case "RESEARCH_INTERVIEWS":
          return researchInterviews(String(msg.sessionId || ""), String(msg.company || "").slice(0, 120), String(msg.role || "").slice(0, 160));
        case "RUN_HUNTER":
          if (await get("running")) throw new Error("Hunter is already running.");
          runHunter("dashboard").catch(() => {});
          return { started: true };
        default:
          throw new Error("Unknown request");
      }
    }
    // Messages from the popup
    switch (msg.type) {
      case "RUN_HUNTER":
        runHunter("manual").catch(() => {});
        return { started: true };
      case "STOP":
        await set({ stop: true });
        return { stopping: true };
      case "CHECK_LOGINS":
        return checkLogins();
      case "CAPTURE":
        return captureActiveTab();
      case "DISCONNECT":
        await chrome.storage.local.remove(["token"]);
        return { ok: true };
      default:
        throw new Error("Unknown request");
    }
  })()
    .then((result) => reply({ result }))
    .catch((e) => reply({ error: e.message }));
  return true; // async reply
});

/* ─────────────────────────────── schedule ─────────────────────────────── */

async function scheduleDaily() {
  await chrome.alarms.clear("hunter-check");
  chrome.alarms.create("hunter-check", { delayInMinutes: 1, periodInMinutes: 30 });
}

// Every 30 min: if it's at or after the user's chosen hour (within a 5-hour window) and
// Hunter hasn't run today, run it. Covers Chrome being closed at the exact hour.
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "hunter-check") return;
  if (!(await get("token")) || (await get("running"))) return;
  let hour = await get("dailyRunHour");
  if (hour === undefined) {
    try {
      hour = (await api("/api/ext/plan")).daily_run_hour;
      await set({ dailyRunHour: hour });
    } catch {
      return;
    }
  }
  if (hour === null || hour === undefined) return;
  const now = new Date();
  const lastRun = await get("lastRun");
  const ranToday = lastRun && new Date(lastRun.at).toDateString() === now.toDateString();
  const h = now.getHours();
  if (!ranToday && h >= hour && h < hour + 5) runHunter("schedule").catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  set({ running: false });
  scheduleDaily();
});
chrome.runtime.onStartup.addListener(() => {
  set({ running: false });
  scheduleDaily();
});
