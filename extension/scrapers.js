// Page scrapers. Each function runs INSIDE a portal tab via chrome.scripting.executeScript,
// so it must be self-contained (no outside variables or helpers).
// Portals change their markup often: each scraper tries several selectors and falls back to
// generic heuristics. If a portal returns 0 jobs, update its selectors here first.

/* eslint-disable no-unused-vars */

/** Read job cards from a search-results page. Returns [{portal, external_id, url, title, company, location, posted_text, snippet}] */
async function scrapeList(portal) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (root, sel) => {
    if (!root) return "";
    for (const s of sel.split("|")) {
      const el = root.querySelector(s);
      if (el && el.innerText && el.innerText.trim()) return el.innerText.trim().split("\n")[0].trim();
    }
    return "";
  };
  const waitFor = async (sel, ms = 12000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (document.querySelector(sel)) return true;
      await sleep(400);
    }
    return false;
  };
  const scrollList = async (anchorSel) => {
    // Find the scrollable container of the results list and scroll it so lazy cards load.
    const first = document.querySelector(anchorSel);
    let box = first;
    while (box && box !== document.body && !(box.scrollHeight > box.clientHeight + 50 && getComputedStyle(box).overflowY !== "visible")) {
      box = box.parentElement;
    }
    for (let i = 0; i < 10; i++) {
      if (box && box !== document.body) box.scrollTop = box.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(700);
    }
  };

  const out = [];
  const seen = new Set();
  const push = (j) => {
    if (!j.external_id || !j.title || seen.has(j.external_id)) return;
    seen.add(j.external_id);
    out.push({ portal, ...j, title: j.title.replace(/\s+with verification$/i, "").trim() });
  };

  if (portal === "linkedin") {
    await waitFor('a[href*="/jobs/view/"], [data-job-id], [data-occludable-job-id]');
    await scrollList('a[href*="/jobs/view/"], [data-job-id]');
    const cards = document.querySelectorAll("[data-occludable-job-id], [data-job-id], li.jobs-search-results__list-item, .base-card");
    const anchors = document.querySelectorAll('a[href*="/jobs/view/"]');
    const handle = (card, a) => {
      const href = a ? a.href : "";
      const m = href.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})/);
      const id = (card && (card.getAttribute("data-occludable-job-id") || card.getAttribute("data-job-id"))) || (m && m[1]);
      if (!id) return;
      const lines = card ? card.innerText.split("\n").map((s) => s.trim()).filter(Boolean) : [];
      push({
        external_id: String(id),
        url: `https://www.linkedin.com/jobs/view/${id}/`,
        title: (a && (a.getAttribute("aria-label") || a.innerText.split("\n")[0])) || lines[0] || "",
        company: txt(card, ".artdeco-entity-lockup__subtitle|.job-card-container__primary-description|.base-search-card__subtitle") || lines[1] || "",
        location: txt(card, ".artdeco-entity-lockup__caption|.job-card-container__metadata-item|.job-search-card__location") || lines[2] || "",
        posted_text: txt(card, "time|.job-search-card__listdate"),
        snippet: "",
      });
    };
    cards.forEach((c) => handle(c, c.querySelector('a[href*="/jobs/view/"]')));
    anchors.forEach((a) => handle(a.closest("li, .job-card-container, .base-card"), a));
  }

  if (portal === "naukri") {
    await waitFor(".srp-jobtuple-wrapper, .cust-job-tuple, article.jobTuple, a.title");
    await scrollList(".srp-jobtuple-wrapper, .cust-job-tuple, article.jobTuple");
    const cards = document.querySelectorAll(".srp-jobtuple-wrapper, .cust-job-tuple, article.jobTuple");
    cards.forEach((card) => {
      const a = card.querySelector("a.title, h2 a, a[href*='job-listings']");
      if (!a) return;
      const m = a.href.match(/-(\d{9,})(?:[?#]|$)/);
      const id = card.getAttribute("data-job-id") || (m && m[1]) || a.href.split("?")[0];
      push({
        external_id: String(id),
        url: a.href.split("?")[0],
        title: a.getAttribute("title") || a.innerText.trim(),
        company: txt(card, ".comp-name|a.subTitle|.companyInfo a"),
        location: txt(card, ".locWdth|.loc-wrap .ellipsis|.location|.loc"),
        posted_text: txt(card, ".job-post-day|.postedDate|.type br"),
        snippet: txt(card, ".job-desc|.ni-job-tuple-icon-srp-description|.job-description"),
      });
    });
  }

  if (portal === "indeed") {
    await waitFor("a[data-jk], [data-jk]");
    await scrollList("a[data-jk]");
    document.querySelectorAll("a[data-jk], [data-jk]").forEach((el) => {
      const jk = el.getAttribute("data-jk");
      const card = el.closest(".job_seen_beacon, td.resultContent, li, .result") || el;
      push({
        external_id: jk,
        url: `${location.origin}/viewjob?jk=${jk}`,
        title: txt(card, "h2 span[title]|h2 a span|h2|a.jcs-JobTitle") || el.innerText.trim(),
        company: txt(card, '[data-testid="company-name"]|.companyName'),
        location: txt(card, '[data-testid="text-location"]|.companyLocation'),
        posted_text: txt(card, '[data-testid="myJobsStateDate"]|.date'),
        snippet: txt(card, ".job-snippet|[data-testid='jobsnippet_footer']"),
      });
    });
  }

  return { url: location.href, jobs: out };
}

/** Read the full description from a job's own page. Works on known portals and, heuristically, anywhere. */
async function scrapeDetail(portal) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const first = (sel) => {
    for (const s of sel.split("|")) {
      const el = document.querySelector(s);
      if (el && el.innerText && el.innerText.trim()) return el;
    }
    return null;
  };
  const text = (sel) => {
    const el = first(sel);
    return el ? el.innerText.trim().split("\n")[0].trim() : "";
  };

  const SEL = {
    linkedin: {
      desc: "#job-details|.jobs-description__content|.jobs-box__html-content|.description__text|[class*='jobs-description']",
      title: ".job-details-jobs-unified-top-card__job-title|.jobs-unified-top-card__job-title|.top-card-layout__title|h1",
      company: ".job-details-jobs-unified-top-card__company-name|.jobs-unified-top-card__company-name|.topcard__org-name-link",
      location: ".job-details-jobs-unified-top-card__primary-description-container|.jobs-unified-top-card__bullet|.topcard__flavor--bullet",
    },
    naukri: {
      desc: "[class*='dang-inner-html']|[class*='job-desc-container']|section[class*='job-desc']|.job-desc",
      title: "h1",
      company: "[class*='jd-header-comp-name'] a|[class*='jd-header-comp-name']",
      location: "[class*='jhc__location'] a|[class*='location'] a|.location",
    },
    indeed: {
      desc: "#jobDescriptionText",
      title: "[data-testid='jobsearch-JobInfoHeader-title']|h1",
      company: "[data-testid='inlineHeader-companyName']|[data-company-name]",
      location: "[data-testid='inlineHeader-companyLocation']|[data-testid='job-location']",
    },
  };

  const href = location.href;
  if (/linkedin\.com\/(login|authwall|checkpoint|signup)/.test(href) || /naukri\.com\/nlogin/.test(href) || /secure\.indeed\.com\/auth/.test(href)) {
    return { description: "", problem: "login_needed" };
  }

  const s = SEL[portal];
  let descEl = null;
  if (s) {
    for (let i = 0; i < 25 && !descEl; i++) {
      descEl = first(s.desc);
      if (!descEl) await sleep(400);
    }
    // LinkedIn collapses long descriptions; expanding is harmless if the button exists.
    const more = document.querySelector("button.jobs-description__footer-button, button[aria-label*='see more' i], .show-more-less-html__button");
    if (more) { more.click(); await sleep(500); }
    if (descEl) descEl = first(s.desc);
  }

  if (!descEl) {
    // Generic: the smallest block that reads like a job description.
    const KEY = /(responsibilit|requirement|qualification|experience|skills|what you.?ll do|about the role|job description)/gi;
    let best = null;
    let bestLen = Infinity;
    document.querySelectorAll("article, section, main, div").forEach((el) => {
      const t = el.innerText || "";
      if (t.length < 400 || t.length > 30000) return;
      const hits = (t.match(KEY) || []).length;
      if (hits >= 2 && t.length < bestLen) { best = el; bestLen = t.length; }
    });
    descEl = best;
  }

  const description = descEl ? descEl.innerText.replace(/\n{3,}/g, "\n\n").trim() : "";
  return {
    description,
    title: s ? text(s.title) : (document.querySelector("h1") ? document.querySelector("h1").innerText.trim() : document.title),
    company: s ? text(s.company) : "",
    location: s ? text(s.location) : "",
    problem: description ? null : "no_description",
  };
}
