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

function isLoginWall(portal, url, pattern) {
  if (pattern && new RegExp(pattern, "i").test(url)) return true;
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
    const loginPatterns = {};
    for (const t of plan.tasks) if (t.login_pattern) loginPatterns[t.portal] = t.login_pattern;
    const blocked = new Set();

    // 1) Search pages
    for (const [k, task] of plan.tasks.entries()) {
      if (await get("stop")) break;
      if (blocked.has(task.portal)) continue;
      await setProgress({ phase: "Searching", detail: `${task.portal}: ${task.query} · ${task.location}`, step: k + 1, of: plan.tasks.length, badge: "…" });
      const finalUrl = await visit(worker.tabId, task.url);
      if (isLoginWall(task.portal, finalUrl, task.login_pattern)) {
        blocked.add(task.portal);
        stats.login_needed.push(task.portal);
        await log(`${task.portal}: please sign in to it in Chrome — skipped for now.`);
        continue;
      }
      try {
        const res = await run(worker.tabId, scrapeList, [task.portal, task.link_pattern || ""]);
        // Some portals redirect to sign-in only after the page's own script runs.
        if (res && res.url && isLoginWall(task.portal, res.url, task.login_pattern)) {
          blocked.add(task.portal);
          stats.login_needed.push(task.portal);
          await log(`${task.portal}: please sign in to it in Chrome — skipped for now.`);
          continue;
        }
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
        if (isLoginWall(job.portal, finalUrl, loginPatterns[job.portal])) {
          blocked.add(job.portal);
          continue;
        }
        const d = await run(worker.tabId, scrapeDetail, [job.portal]);
        if (d && d.problem === "bot_check") {
          // Don't keep poking a portal that wants a human check; the user can clear it once in Chrome.
          blocked.add(job.portal);
          await log(`${job.portal} asked to confirm you're a person. Open it once in Chrome and tick the box; skipped for this run.`);
        }
        await api("/api/ext/detail", { method: "POST", body: { id: job.id, ...(d || {}) } });
        if (d && d.description) stats.read++;
      } catch (e) {
        await log(`Couldn't read ${job.url} (${e.message})`);
      }
      await jitter(4000, 9000);
    }
    await closeWorker(worker);
    worker = null;

    // 3b) Company careers pages (searched from the Apply.ai server through each company's job system)
    stats.careers = 0;
    try {
      let cursor = 0;
      let total = 0;
      while (cursor !== null && !(await get("stop"))) {
        const r = await api("/api/ext/careers-scan", { method: "POST", body: { cursor } });
        total = r.total;
        stats.careers += r.added || 0;
        cursor = r.next;
        await setProgress({ phase: "Company careers", detail: `${Math.min(cursor ?? total, total)} of ${total} companies checked`, step: Math.min(cursor ?? total, total), of: total, badge: "…" });
      }
      if (total) await log(`Company careers pages: ${stats.careers} new matching jobs from ${total} companies.`);
    } catch (e) {
      await log(`Company careers search skipped: ${e.message}`);
    }

    await api("/api/ext/run-done", { method: "POST", body: { started_at, stats } }).catch(() => {});
    await log(`Read ${stats.read} job descriptions. Handing over to Tailor…`);

    // 4) Tailor, one job per request, paced for the AI free tier
    const deadline = Date.now() + 45 * 60_000;
    let tailorFails = 0;
    while (Date.now() < deadline && !(await get("stop"))) {
      let r;
      try {
        r = await api("/api/ext/tailor-next", { method: "POST" });
        tailorFails = 0;
      } catch (e) {
        // One slow step shouldn't end the run: the server puts the job back in the queue.
        if (++tailorFails >= 3) { await log(`Tailor stopped: ${e.message}`); break; }
        await sleep(5000);
        continue;
      }
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
    await log(`${stats.tailored} CVs tailored. Applier is preparing apply packs…`);

    // 5) Applier: an apply pack for every tailored job
    stats.packs = 0;
    while (Date.now() < deadline && !(await get("stop"))) {
      const r = await api("/api/ext/applier-next", { method: "POST" });
      if (r.done) break;
      if (r.rate_limited) {
        await setProgress({ phase: "Applier", detail: "AI limit reached — waiting a minute", badge: r.remaining });
        await sleep(60_000);
        continue;
      }
      stats.packs++;
      await setProgress({ phase: "Applier", detail: r.job ? `${r.job.title} — ${r.job.route === "referral_first" ? "referral first" : "apply directly"}` : "", badge: r.remaining });
      await sleep(5000);
    }

    // 6) Networker: people to ask for referral-first jobs (within the daily limit)
    stats.people = 0;
    try {
      const q = await api("/api/ext/networker-queue");
      if (q.jobs.length) {
        await log(`Networker is looking for people at ${q.jobs.map((j) => j.company).join(", ")}…`);
        const w = await openWorker();
        try {
          for (const j of q.jobs) {
            if (await get("stop")) break;
            await setProgress({ phase: "Networker", detail: `${j.company}`, badge: "…" });
            const r = await findPeople(j.id, j.company, j.title, w).catch((e) => ({ added: 0, reason: e.message }));
            stats.people += r.added || 0;
            if (r.reason === "cap") break;
          }
        } finally {
          await closeWorker(w);
        }
      }
    } catch (e) {
      await log(`Networker skipped: ${e.message}`);
    }
    await log(`Done. ${stats.tailored} CVs tailored, ${stats.packs} apply packs, ${stats.people} people to ask for referrals.`);
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

/**
 * Check sign-in on the big three with known pages, and on any other selected portal by opening its
 * home page and looking for an account menu vs a "Login / Register" button.
 * `extra` = [{ id, home, login_pattern }] sent by the Apply.ai page for the user's selected portals.
 */
async function checkLogins(extra = []) {
  await requirePaired();
  const worker = await openWorker();
  const status = {};
  try {
    for (const [portal, c] of Object.entries(LOGIN_CHECKS)) {
      const finalUrl = await visit(worker.tabId, c.url);
      status[portal] = c.ok(finalUrl) && !isLoginWall(portal, finalUrl) ? "ok" : "login_needed";
    }
    for (const p of (Array.isArray(extra) ? extra : []).slice(0, 12)) {
      if (!p || !p.id || !/^https:\/\//.test(p.home || "") || LOGIN_CHECKS[p.id]) continue;
      const finalUrl = await visit(worker.tabId, p.home);
      if (isLoginWall(p.id, finalUrl, p.login_pattern)) {
        status[p.id] = "login_needed";
        continue;
      }
      status[p.id] = (await run(worker.tabId, detectSignedIn, []).catch(() => "unknown")) || "unknown";
    }
  } finally {
    await closeWorker(worker);
  }
  await api("/api/ext/portal-status", { method: "POST", body: { status } }).catch(() => {});
  return status;
}

/* ──────────────────── LinkedIn achievements scan ──────────────────── */

/** Fetch an image (LinkedIn CDN) and return a small JPEG as base64, max 1280px. */
async function shrinkImage(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return null;
  const bmp = await createImageBitmap(await res.blob());
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { mime: "image/jpeg", data: btoa(bin) };
}

const NOT_PAIRED =
  "The extension isn't connected to your Apply.ai account. Reload the Apply.ai page (it reconnects automatically) or click Connect extension in Settings.";
async function requirePaired() {
  if (!(await get("token"))) throw new Error(NOT_PAIRED);
}

async function scanLinkedIn() {
  await requirePaired(); // check first, so nobody waits for a scan whose results can't be saved
  if (await get("running")) throw new Error("Hunter is running. Try the scan when it finishes.");
  if (await get("scanning")) throw new Error("A LinkedIn scan is already running.");
  const progress = (text) => set({ scanProgress: { text, at: Date.now() } });
  await set({ scanning: true });
  const alive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000); // keep the service worker awake
  const worker = await openWorker();
  const tabs = [worker.tabId];
  const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
  try {
    await progress("Opening your LinkedIn profile…");
    const loaded = waitForLoad(worker.tabId, 15000);
    await chrome.tabs.update(worker.tabId, { url: "https://www.linkedin.com/in/me/" });
    await loaded;
    await sleep(800);
    const me = (await chrome.tabs.get(worker.tabId)).url || "";
    if (isLoginWall("linkedin", me) || !/linkedin\.com\/in\/[^/]+/.test(me)) {
      throw new Error("Sign in to LinkedIn in this Chrome first, then try again.");
    }
    const base = me.match(/https:\/\/www\.linkedin\.com\/in\/[^/?#]+/)[0];
    const pages = [
      { section: "Licenses & certifications", url: `${base}/details/certifications/`, kind: "list" },
      { section: "Honors & awards", url: `${base}/details/honors/`, kind: "list" },
      { section: "Recommendations received", url: `${base}/details/recommendations/?detailScreenTabIndex=0`, kind: "list" },
      { section: "Your posts", url: `${base}/recent-activity/shares/`, kind: "posts" },
    ];

    // Read the four pages side by side in the background window (each capped at 25 seconds).
    await progress("Reading certifications, honours, recommendations and recent posts…");
    let done = 0;
    const sections = await Promise.all(
      pages.map(async (p, i) => {
        let tabId = worker.tabId;
        if (i > 0) {
          await sleep(i * 700); // stagger, so it looks like a person opening tabs
          const t = await chrome.tabs.create({ windowId: worker.windowId, url: "about:blank", active: false });
          tabId = t.id;
          tabs.push(tabId);
        }
        const loaded = waitForLoad(tabId, 15000);
        await chrome.tabs.update(tabId, { url: p.url });
        await loaded;
        if (p.kind === "posts") {
          const r = await withTimeout(run(tabId, scrapeLinkedInPosts, []).catch(() => null), 60000);
          done++;
          await progress(`Read ${done} of ${pages.length} sections…`);
          return { section: p.section, items: [], posts: (r && r.posts) || [] };
        }
        const r = await withTimeout(run(tabId, scrapeLinkedInList, [p.kind]).catch(() => null), 25000);
        done++;
        await progress(`Read ${done} of ${pages.length} sections…`);
        return { section: p.section, items: (r && !r.empty && r.items) || [] };
      })
    );

    // Certificate images: fetch in your browser, shrink, and send with the post text.
    const rawPosts = sections.flatMap((x) => x.posts || []);
    const withImages = rawPosts.filter((p) => p.images.length).length;
    if (withImages) await progress(`Reading ${withImages} certificate image${withImages > 1 ? "s" : ""}…`);
    let budget = 12;
    const posts = [];
    for (const p of rawPosts) {
      const images = [];
      for (const u of p.images) {
        if (budget <= 0) break;
        const img = await shrinkImage(u).catch(() => null);
        if (img) {
          images.push(img);
          budget--;
        }
      }
      posts.push({ ...p, images });
    }

    const read = sections.reduce((n, x) => n + x.items.length, 0) + posts.length;
    if (!read) return { found: 0, read: 0 };
    await progress(`Found ${read} entries. Picking out your achievements…`);
    const res = await api("/api/ext/linkedin-scan", {
      method: "POST",
      body: { sections: sections.map(({ section, items }) => ({ section, items })), posts },
    });
    return { found: res.found, read };
  } finally {
    clearInterval(alive);
    await closeWorker(worker);
    await set({ scanning: false, scanProgress: null });
  }
}

/** Read ONE LinkedIn post the user pastes (for posts LinkedIn doesn't list in their activity). */
async function readLinkedInPost(url) {
  if (!/^https:\/\/www\.linkedin\.com\/(posts|feed\/update)\//.test(url || "")) throw new Error("Paste a link to a LinkedIn post (it starts with linkedin.com/posts/ or linkedin.com/feed/update/).");
  const worker = await openWorker();
  try {
    const loaded = waitForLoad(worker.tabId, 15000);
    await chrome.tabs.update(worker.tabId, { url });
    await loaded;
    const r = await run(worker.tabId, scrapeLinkedInPosts, []).catch(() => null);
    const post = r && r.posts && r.posts[0];
    if (!post) throw new Error("Couldn't read that post. Check you're signed in to LinkedIn and the link opens your post.");
    const images = [];
    for (const u of post.images) {
      const img = await shrinkImage(u).catch(() => null);
      if (img) images.push(img);
    }
    const res = await api("/api/ext/linkedin-scan", { method: "POST", body: { sections: [], posts: [{ ...post, url: post.url || url, images }] } });
    return { found: res.found, read: 1 };
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
  await requirePaired();
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

/* ─────────────────────────────── Networker ─────────────────────────────── */

const ROLE_STOP = /\b(senior|sr|junior|jr|lead|principal|staff|associate|manager|engineer|ii|iii|i)\b/gi;

/** Find people at the company on LinkedIn for one job, then let Networker draft referral asks. */
async function findPeople(jobId, company, role, workerIn) {
  await requirePaired();
  if (!jobId || !company) throw new Error("Missing job details.");
  const worker = workerIn || (await openWorker());
  try {
    const core = String(role || "").replace(ROLE_STOP, " ").replace(/\s+/g, " ").trim();
    const searches = [
      `${company} ${core || role}`.trim(),
      `${company} talent acquisition`,
      `${company} recruiter ${core}`.trim(),
    ];
    const people = [];
    for (const q of searches) {
      const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}&origin=GLOBAL_SEARCH_HEADER`;
      const finalUrl = await visit(worker.tabId, url);
      if (isLoginWall("linkedin", finalUrl)) throw new Error("Sign in to LinkedIn in this Chrome first.");
      const r = await run(worker.tabId, scrapeLinkedInPeople, []).catch(() => null);
      if (r) people.push(...r.people);
      await jitter(3000, 6000);
    }
    const res = await api("/api/ext/networker", { method: "POST", body: { job_id: jobId, people } });
    return { added: res.added || 0, reason: res.reason || null, seen: people.length };
  } finally {
    if (!workerIn) await closeWorker(worker);
  }
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
          if (Array.isArray(msg.portals)) await set({ portalChecks: msg.portals });
          return checkLogins(msg.portals);
        case "SCAN_LINKEDIN":
          return scanLinkedIn();
        case "READ_POST":
          return readLinkedInPost(String(msg.url || "").trim());
        case "SCAN_PROGRESS":
          return (await get("scanProgress")) || null;
        case "FIND_PEOPLE":
          if (await get("running")) throw new Error("Hunter is running. Try again when it finishes.");
          return findPeople(String(msg.jobId || ""), String(msg.company || "").slice(0, 120), String(msg.role || "").slice(0, 160));
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
        return checkLogins((await get("portalChecks")) || []);
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
  set({ running: false, scanning: false });
  scheduleDaily();
});
chrome.runtime.onStartup.addListener(() => {
  set({ running: false, scanning: false });
  scheduleDaily();
});
