// Page scrapers. Each function runs INSIDE a portal tab via chrome.scripting.executeScript,
// so it must be self-contained (no outside variables or helpers).
// Portals change their markup often: each scraper tries several selectors and falls back to
// generic heuristics. If a portal returns 0 jobs, update its selectors here first.

/* eslint-disable no-unused-vars */

/** Read job cards from a search-results page. Returns [{portal, external_id, url, title, company, location, posted_text, snippet}] */
async function scrapeList(portal, linkPattern) {
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
    await waitFor('a[href*="/jobs/view/"], [data-job-id], [data-occludable-job-id], [componentkey^="job-card-component-ref-"]');
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

    // Newer "AI-powered" job search: no links or stable classes; each card carries
    // componentkey="job-card-component-ref-<job id>" and reads title / company / location in order.
    await waitFor('[componentkey^="job-card-component-ref-"]', 4000);
    if (document.querySelector('[componentkey^="job-card-component-ref-"]')) {
      await scrollList('[componentkey^="job-card-component-ref-"]');
      for (const el of document.querySelectorAll('[componentkey^="job-card-component-ref-"]')) {
        const id = (el.getAttribute("componentkey") || "").replace(/\D+/g, "");
        if (!id) continue;
        const lines = (el.innerText || "").split("\n").map((x) => x.trim()).filter(Boolean).filter((l) => !/^selected,|\(verified job\)$/i.test(l));
        const d = lines.filter((l, i) => l !== lines[i - 1]);
        push({
          external_id: id,
          url: `https://www.linkedin.com/jobs/view/${id}/`,
          title: d[0] || "",
          company: d[1] || "",
          location: d[2] || "",
          posted_text: (d.find((l) => /ago$/i.test(l)) || "").replace(/^posted\s*/i, ""),
          snippet: "",
        });
      }
    }
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
    // Indeed hides decoy links among the results (zero-size, tabindex -1, made-up ids). Opening one
    // triggers its "verify you are human" check, so only real, visible cards are read.
    const real = (el) => {
      const r = el.getBoundingClientRect();
      const jk = el.getAttribute("data-jk") || "";
      return !!el.offsetParent && r.width > 0 && r.height > 0 && el.getAttribute("tabindex") !== "-1" && /^[0-9a-f]{16}$/.test(jk) && !/0123|1234|2345|3456|4567|5678|6789|789a|89ab|9abc|abcd|bcde|cdef/.test(jk);
    };
    const DESC = "#jobDescriptionText, .simple-job-description-html, [class*='job-description-html']";
    let prev = (document.querySelector(DESC) || {}).innerText || "";
    let reads = 0;
    for (const el of [...document.querySelectorAll("a[data-jk]")].filter(real)) {
      const jk = el.getAttribute("data-jk");
      const card = el.closest(".job_seen_beacon, td.resultContent, li, .result") || el;
      // Read the full description from the side pane (no job page to open = no bot check).
      let description = "";
      if (reads < 15) {
        reads++;
        el.click();
        for (let i = 0; i < 15; i++) {
          await sleep(400);
          const d = document.querySelector(DESC);
          if (d && d.innerText.length > 100 && d.innerText !== prev) { description = d.innerText.trim(); break; }
        }
        if (description) prev = description;
        await sleep(900 + Math.random() * 900);
      }
      push({
        external_id: jk,
        url: `${location.origin}/viewjob?jk=${jk}`,
        title: txt(card, "h2 span[title]|h2 a span|h2|a.jcs-JobTitle") || el.innerText.trim(),
        company: txt(card, '[data-testid="company-name"]|.companyName'),
        location: txt(card, '[data-testid="text-location"]|.companyLocation'),
        posted_text: txt(card, '[data-testid="myJobsStateDate"]|.date'),
        snippet: txt(card, ".job-snippet|[data-testid='jobsnippet_footer']"),
        description: description.slice(0, 20000),
      });
    }
  }

  // foundit: result cards are clickable boxes with no links; the card's id is the job id.
  if (portal === "foundit") {
    // Results load after the page; wait for real job cards (or foundit's "no result" message).
    for (let i = 0; i < 40; i++) {
      if (document.querySelector(".cardContainer[id]") || /sorry no result found/i.test(document.body.innerText || "")) break;
      await sleep(500);
    }
    await sleep(1500);
    await scrollList(".cardContainer");
    const slugify = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    document.querySelectorAll(".cardContainer[id]").forEach((card) => {
      const id = card.id;
      if (!/^\d{5,}$/.test(id)) return;
      const lines = (card.innerText || "").split("\n").map((x) => x.trim()).filter(Boolean);
      const title = txt(card, ".jobTitle") || lines[0] || "";
      const company = txt(card, ".companyName") || lines[1] || "";
      const loc = txt(card, ".details.location|[class*='location' i]") || lines.find((l) => /india|remote|work from home|,/i.test(l) && l !== title) || "";
      push({
        external_id: id,
        url: `https://www.foundit.in/job/${[slugify(title), slugify(company), slugify(loc.split(",")[0])].filter(Boolean).join("-")}-${id}`,
        title,
        company,
        location: loc,
        posted_text: (lines.find((l) => /^posted/i.test(l)) || "").replace(/^posted\s*/i, ""),
        snippet: "",
      });
    });
  }

  // Instahyre: its public job search (no sign-in needed). The page's own search API returns
  // jobs by skill/title but ignores the city, so we filter by city here.
  if (portal === "instahyre") {
    const params = new URLSearchParams(location.search);
    const q = params.get("aai_q") || "";
    const city = (params.get("aai_l") || "").toLowerCase();
    const ALIAS = { bengaluru: "bangalore", gurugram: "gurgaon", "new delhi": "delhi", mumbai: "mumbai", "navi mumbai": "mumbai" };
    const want = ALIAS[city] || city;
    const remote = /remote|work from home/.test(want);
    for (let offset = 0; offset < 60 && q; offset += 20) {
      let r;
      try {
        r = await fetch(`/api/v1/job_search?skills=${encodeURIComponent(q)}&offset=${offset}`, { credentials: "include" }).then((x) => x.json());
      } catch { break; }
      const objs = (r && r.objects) || [];
      for (const o of objs) {
        const locs = String(o.locations || "");
        const l = locs.toLowerCase();
        if (want && !remote && !(l.includes(want) || (want === "delhi" && /noida|gurgaon|delhi/.test(l)))) continue;
        if (remote && !/remote|work from home|anywhere/.test(l)) continue;
        push({
          external_id: String(o.id),
          url: o.public_url || `https://www.instahyre.com/job-${o.id}/`,
          title: o.title || o.candidate_title || "",
          company: (o.employer && o.employer.company_name) || "",
          location: locs,
          posted_text: "",
          snippet: Array.isArray(o.keywords) ? o.keywords.slice(0, 12).join(", ") : "",
        });
      }
      if (objs.length < 20) break;
      await sleep(800);
    }
  }

  // Generic reader for every other portal: job-detail links that match the portal's URL pattern.
  if (!["linkedin", "naukri", "indeed", "foundit", "instahyre"].includes(portal) && linkPattern) {
    const re = new RegExp(linkPattern, "i");
    const CITY = /(bengaluru|bangalore|hyderabad|pune|mumbai|chennai|gurugram|gurgaon|noida|delhi|kolkata|ahmedabad|kochi|coimbatore|remote|work from home|hybrid|india)/i;
    const POSTED = /(\d+\+?\s*(day|days|hour|hours|hr|hrs|week|weeks|month|months)\s*ago|today|just now|yesterday|few hours)/i;
    const pick = () => [...document.querySelectorAll("a[href]")].filter((a) => re.test(a.href));
    for (let i = 0; i < 24 && pick().length === 0; i++) await sleep(500);
    for (let i = 0; i < 8; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(700);
    }
    for (const a of pick()) {
      const href = a.href.split("#")[0];
      // Card = the largest ancestor that still holds only this one job link
      let card = a;
      while (card.parentElement && card.parentElement !== document.body) {
        const p = card.parentElement;
        const links = new Set([...p.querySelectorAll("a[href]")].filter((x) => re.test(x.href)).map((x) => x.href.split("#")[0]));
        if (links.size > 1 || (p.innerText || "").length > 2500) break;
        card = p;
      }
      const lines = (card.innerText || "").split("\n").map((x) => x.trim()).filter((x) => x && x.length < 160);
      const heading = card.querySelector("h1,h2,h3,h4,[class*='title' i]");
      const title = ((a.innerText || "").trim().split("\n")[0] || (heading && heading.innerText.trim().split("\n")[0]) || lines[0] || "").trim();
      if (!title || title.length < 3) continue;
      const company =
        (card.querySelector("[class*='company' i],[class*='comp-name' i],[class*='employer' i],[class*='org' i]") || {}).innerText ||
        lines.find((l) => l !== title && !CITY.test(l) && !POSTED.test(l) && !/\d+\s*-\s*\d+\s*(yrs|years)|₹|lpa|apply|save/i.test(l)) ||
        "";
      const loc = (card.querySelector("[class*='location' i],[class*='loc' i]") || {}).innerText || lines.find((l) => CITY.test(l)) || "";
      const idMatch = href.match(/(\d{5,})(?!.*\d{5,})/) || href.match(/-([A-Za-z0-9]{6,10})(?:[?#]|$)/);
      push({
        external_id: idMatch ? idMatch[1] : href.replace(/^https?:\/\/[^/]+/, "").slice(0, 190),
        url: href,
        title,
        company: String(company).split("\n")[0].trim().slice(0, 120),
        location: String(loc).split("\n")[0].trim().slice(0, 120),
        posted_text: (((card.innerText || "").match(POSTED) || [""])[0]).slice(0, 60),
        snippet: "",
      });
    }
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
      desc: "#jobDescriptionText|.simple-job-description-html|[class*='job-description-html']",
      title: "[data-testid='jobsearch-JobInfoHeader-title']|h1",
      company: "[data-testid='inlineHeader-companyName']|[data-company-name]",
      location: "[data-testid='inlineHeader-companyLocation']|[data-testid='job-location']",
    },
  };

  const href = location.href;
  // Bot checks and dead pages: report them instead of saving their text as the job.
  const pageText = (document.title + " " + ((document.querySelector("h1") || {}).innerText || "")).toLowerCase();
  if (/additional verification required|just a moment|verify you are human|are you a robot|security check|access denied/.test(pageText)) {
    return { description: "", problem: "bot_check" };
  }
  if (/can.t find this page|page not found|job (has )?expired|no longer (available|accepting)|job not found|404/.test(pageText)) {
    return { description: "", problem: "gone" };
  }
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

  // LinkedIn's newer job page has no stable class names: read the text under "About the job".
  if (!descEl && portal === "linkedin") {
    const more = [...document.querySelectorAll("button")].find((b) => /^(…|\.\.\.)\s*more$|^see more$/i.test((b.innerText || "").trim()));
    if (more) { more.click(); await sleep(800); }
    const t = document.body.innerText || "";
    const i = t.search(/About the job/i);
    if (i >= 0) {
      const rest = t.slice(i + "About the job".length);
      const end = rest.search(/\n(Set alert for similar jobs|About the company|Show less|(…|\.\.\.) more\n)/);
      const description = (end > 0 ? rest.slice(0, end) : rest.slice(0, 8000)).replace(/\n{3,}/g, "\n\n").trim();
      const parts = document.title.split(" | ");
      const locLine = t.split("\n").find((l) => / · (Reposted|Posted|\d+ (day|week|hour|month)s? ago)/i.test(l)) || "";
      return {
        description,
        title: parts.length >= 3 ? parts[0].trim() : "",
        company: parts.length >= 3 ? parts[1].trim() : "",
        location: locLine.split(" · ")[0].trim().slice(0, 120),
        problem: description.length >= 200 ? null : "no_description",
      };
    }
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

/** Read list entries from one of the user's own LinkedIn profile "details" pages or activity feed. */
async function scrapeLinkedInList(kind) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ready = () =>
    kind === "posts"
      ? document.querySelector(".feed-shared-update-v2, [data-urn*='activity']")
      : document.querySelector("main li") || /nothing to see|haven.t added|no (certifications|honors|recommendations|courses)/i.test(document.body.innerText || "");
  for (let i = 0; i < 16 && !ready(); i++) await sleep(500); // up to 8s for LinkedIn's app to render

  // Load more entries only when LinkedIn shows a "Show more" button (a few rounds at most).
  for (let i = 0; i < (kind === "posts" ? 3 : 4); i++) {
    const more = document.querySelector("button.scaffold-finite-scroll__load-button, button[aria-label*='Show more results' i]");
    if (!more && kind !== "posts") break;
    if (more) more.click();
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(900);
  }
  document.querySelectorAll("button.inline-show-more-text__button, button[aria-label*='see more' i]").forEach((b) => b.click());
  await sleep(400);

  const clean = (t) =>
    t.replace(/\n{2,}/g, "\n").split("\n").map((x) => x.trim())
      .filter((x, i, a) => x && a.indexOf(x) === i && !/^(show credential|see credential|show all|see more|…see more|endorse)$/i.test(x))
      .join(" | ");
  const items = [];
  const seen = new Set();
  const push = (t) => {
    const c = clean(t || "");
    if (c.length < 15 || seen.has(c)) return;
    seen.add(c);
    items.push(c.slice(0, 1500));
  };

  if (kind === "posts") {
    const KEY = /(award|recogni|appreciat|certif|honou?r|kudos|spot|star performer|congrat|milestone|achiev|promoted)/i;
    document.querySelectorAll(".feed-shared-update-v2, [data-urn*='activity']").forEach((el) => {
      const t = el.innerText || "";
      if (KEY.test(t)) push(t);
    });
  } else {
    const main = document.querySelector("main") || document.body;
    // Each entry is an OUTER list item; its nested list holds sub-parts (skills, credential link), so keep it whole.
    [...main.querySelectorAll("li")]
      .filter((li) => !li.parentElement.closest("li"))
      .forEach((li) => push(li.innerText));
  }
  const empty = !items.length && /nothing to see|haven.t added|no (certifications|honors|recommendations|courses)/i.test(document.body.innerText || "");
  return { url: location.href, items: items.slice(0, 40), empty };
}

/** Glassdoor search results: find the company's interview page. */
async function findGlassdoorInterviewUrl() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 15; i++) {
    const links = [...document.querySelectorAll("a[href]")].map((a) => a.href);
    const direct = links.find((h) => /\/Interview\/[^?#]*-E\d+(_P\d+)?\.htm/.test(h));
    if (direct) return direct.split("?")[0];
    const overview = links.map((h) => h.match(/Working-at-([^?#]*?)-EI_IE(\d+)/)).find(Boolean);
    if (overview) return `${location.origin}/Interview/${overview[1]}-Interview-Questions-E${overview[2]}.htm`;
    await sleep(500);
  }
  return null;
}

/** Read interview reviews on a Glassdoor or AmbitionBox page. */
async function scrapeInterviewReviews(site) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1500);
  const bodyText = () => document.body.innerText || "";
  const walled = () =>
    /(sign in to (continue|read|see)|continue with google|create an account to|join to unlock|log in to view)/i.test(bodyText().slice(0, 6000)) &&
    bodyText().length < 6000;

  for (let i = 0; i < 4; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(800);
  }
  // Expand truncated reviews
  document
    .querySelectorAll("button, span[role='button'], a")
    .forEach((b) => /^(read more|show more|continue reading|view more)$/i.test((b.innerText || "").trim()) && b.click());
  await sleep(800);

  const SEL = {
    glassdoor: "[data-test='InterviewReview'], [id^='InterviewReview'], li.empReview, [class*='InterviewReview'], [class*='interview-details']",
    ambitionbox: "[class*='interview-card'], [class*='iq-card'], [data-testid*='interview'], [class*='interviewCard'], [class*='round-wrapper']",
  };
  const KEY = /(interview|round|question|asked|process)/i;
  let nodes = [...document.querySelectorAll(SEL[site] || "article")];
  if (nodes.length < 2) {
    // Fallback: innermost blocks that read like an interview review
    nodes = [...document.querySelectorAll("article, li, section, div")].filter((el) => {
      const t = el.innerText || "";
      if (t.length < 200 || t.length > 5000 || !KEY.test(t)) return false;
      return ![...el.children].some((c) => (c.innerText || "").length > t.length * 0.8);
    });
  }
  const seen = new Set();
  const items = [];
  for (const el of nodes) {
    const t = (el.innerText || "").replace(/\n{2,}/g, "\n").trim();
    if (t.length < 120 || seen.has(t.slice(0, 200))) continue;
    seen.add(t.slice(0, 200));
    items.push(t.slice(0, 2500));
    if (items.length >= 25) break;
  }
  const notFound = /(page not found|404|no interviews? (found|yet)|we couldn.t find)/i.test(bodyText().slice(0, 3000));
  return { url: location.href, items: notFound ? [] : items, login_needed: !items.length && walled(), not_found: notFound };
}

/** Read people cards from a LinkedIn people-search results page. */
async function scrapeLinkedInPeople() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 20 && !document.querySelector("main a[href*='/in/']"); i++) await sleep(500);
  for (let i = 0; i < 3; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(700);
  }
  const first = (root, sel) => {
    for (const s of sel.split("|")) {
      const el = root.querySelector(s);
      if (el && el.innerText && el.innerText.trim()) return el.innerText.trim();
    }
    return "";
  };
  const cards = [...document.querySelectorAll("main li")].filter((li) => li.querySelector("a[href*='/in/']") && !li.querySelector("li"));
  const people = [];
  for (const li of cards) {
    const a = li.querySelector("a[href*='/in/']");
    const lines = (li.innerText || "").split("\n").map((x) => x.trim()).filter(Boolean);
    const nameEl = li.querySelector("span[aria-hidden='true']") || a;
    const name = (nameEl.innerText || lines[0] || "").split("\n")[0].trim();
    const degree = (lines.find((l) => /(1st|2nd|3rd\+?)/.test(l)) || "").match(/1st|2nd|3rd\+?/);
    const headline =
      first(li, ".entity-result__primary-subtitle|[class*='primary-subtitle']") ||
      lines.find((l, i) => i > 0 && l !== name && !/(1st|2nd|3rd|degree connection|Connect|Message|Follow)/i.test(l)) ||
      "";
    const location = first(li, ".entity-result__secondary-subtitle|[class*='secondary-subtitle']");
    const summary = first(li, ".entity-result__summary|[class*='summary']");
    people.push({
      name,
      headline: [headline, summary].filter(Boolean).join(" | "),
      profile_url: a.href.split("?")[0],
      location,
      degree: degree ? degree[0] : "",
    });
  }
  return { url: location.href, people: people.slice(0, 25) };
}

/** Is the user signed in on this portal? Looks for account menus vs "Login / Register" buttons. */
async function detectSignedIn() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1500);
  const els = [...document.querySelectorAll("header a, header button, nav a, nav button, [class*='header' i] a, [class*='header' i] button, [class*='nav' i] a")];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const texts = els.filter(visible).map((el) => (el.innerText || el.getAttribute("aria-label") || "").trim().toLowerCase()).filter(Boolean);
  const loggedIn =
    texts.some((t) => /^(log ?out|sign ?out|my (profile|account|jobs|applications)|profile|dashboard|my naukri|my shine)$/.test(t)) ||
    !!document.querySelector("[class*='avatar' i] img, img[alt*='profile' i], [aria-label*='account menu' i], [aria-label*='profile menu' i]");
  const loggedOut = texts.some((t) => /^(log ?in|sign ?in|login|register|sign ?up|join now|log in \/ register|login \/ register|jobseeker login)$/.test(t));
  if (loggedIn && !loggedOut) return "ok";
  if (loggedOut && !loggedIn) return "login_needed";
  return loggedIn ? "ok" : "unknown";
}

/** Read the user's own LinkedIn posts (activity → Posts), with certificate image links. */
async function scrapeLinkedInPosts() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Pick a readable size of a post image (about 800px) from its srcset; the src is often a 160px thumbnail.
  const bestSrc = (img) => {
    const opts = (img.getAttribute("srcset") || "")
      .split(",")
      .map((s) => s.trim().split(/\s+/))
      .map(([u, w]) => ({ u, w: parseInt(w, 10) || 0 }))
      .filter((o) => o.u);
    const good = opts.filter((o) => o.w >= 480 && o.w <= 1300).sort((a, b) => Math.abs(a.w - 800) - Math.abs(b.w - 800))[0];
    return (good && good.u) || img.getAttribute("src") || img.getAttribute("data-delayed-url") || img.currentSrc || "";
  };
  const dateFromUrn = (urn) => {
    try {
      const id = (String(urn).match(/(\d{15,})/) || [])[1];
      return id ? new Date(Number(BigInt(id) >> 22n)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
    } catch { return ""; }
  };
  const POST_SEL = ".feed-shared-update-v2, div[data-urn^='urn:li:activity'], div[data-id^='urn:li:activity']";
  for (let i = 0; i < 16 && !document.querySelector(POST_SEL); i++) await sleep(500);

  // Scroll until no new posts load (older posts such as 2022 need many rounds), max ~60 posts.
  let last = 0;
  let still = 0;
  for (let i = 0; i < 25 && still < 3; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    const more = [...document.querySelectorAll("main button, button.scaffold-finite-scroll__load-button")].find((b) => /^show more( results)?$/i.test((b.innerText || "").trim()));
    if (more) more.click();
    await sleep(1100);
    const n = document.querySelectorAll(POST_SEL).length;
    still = n === last ? still + 1 : 0;
    last = n;
    if (n >= 60) break;
  }
  // Expand truncated post text ("…more")
  document.querySelectorAll(POST_SEL).forEach((post) =>
    post.querySelectorAll("button").forEach((b) => {
      const t = (b.innerText || "").trim().toLowerCase();
      if (t === "…more" || t === "...more" || t === "see more" || /see-more/.test(b.className)) b.click();
    })
  );
  await sleep(600);

  const KEY = /(certif|course|program|workshop|bootcamp|training|learning|completed|complete|award|recogni|appreciat|honou?r|kudos|spot|star performer|congrat|milestone|achiev|promoted|thank you)/i;
  const posts = [];
  const seen = new Set();
  for (const el of document.querySelectorAll(POST_SEL)) {
    if (el.parentElement && el.parentElement.closest(POST_SEL)) continue; // outer post only
    const urn = el.getAttribute("data-urn") || el.getAttribute("data-id") || "";
    if (urn && seen.has(urn)) continue;
    seen.add(urn);
    // Skip reshares of other people's posts
    if (el.querySelector(".update-components-header, .feed-shared-header") && /reposted|shared this/i.test((el.querySelector(".update-components-header, .feed-shared-header") || {}).innerText || "")) continue;
    const textEl = el.querySelector(".update-components-text, .feed-shared-update-v2__description, .feed-shared-text");
    const text = ((textEl || el).innerText || "").replace(/\n{2,}/g, "\n").trim();
    // Exact post date from the activity id (LinkedIn ids carry a millisecond timestamp in the top bits).
    let date = "";
    try {
      const id = (urn.match(/(\d{15,})/) || [])[1];
      if (id) date = new Date(Number(BigInt(id) >> 22n)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    } catch {}
    if (!date) date = ((el.querySelector(".update-components-actor__sub-description, .feed-shared-actor__sub-description") || {}).innerText || "").split("•")[0].trim();
    // Post images live on LinkedIn's "feedshare" CDN path; match by URL (images in a background window may not have loaded yet).
    const images = [...el.querySelectorAll("img")]
      .map(bestSrc)
      .filter((u) => /^https:\/\/media\.licdn\.com\/.*feedshare/.test(u))
      .filter((u, i, a) => a.indexOf(u) === i)
      .slice(0, 2);
    if (!KEY.test(text) && !images.length) continue;
    if (!KEY.test(text) && text.length > 600) continue; // long post with a photo but no achievement words
    posts.push({
      date,
      text: text.slice(0, 2500),
      url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : "",
      images,
    });
    if (posts.length >= 30) break;
  }
  // LinkedIn's newer single-post page (opened from a pasted link) has none of the classes above:
  // read the post text box, the post id from the page, and the post's images directly.
  if (!posts.length && /linkedin\.com\/(posts|feed\/update)\//.test(location.href)) {
    for (let i = 0; i < 16 && !document.querySelector("[data-testid='expandable-text-box']"); i++) await sleep(500);
    document.querySelectorAll("button").forEach((b) => {
      const t = (b.innerText || "").trim().toLowerCase();
      if (t === "…more" || t === "...more" || t === "see more") b.click();
    });
    await sleep(600);
    const box = document.querySelector("[data-testid='expandable-text-box']");
    const urn = (document.documentElement.innerHTML.match(/urn:li:activity:\d{15,}/) || [""])[0];
    const images = [...document.querySelectorAll("img")]
      .filter((img) => /feedshare/.test(img.getAttribute("src") || img.getAttribute("srcset") || ""))
      .map(bestSrc)
      .filter((u) => /^https:\/\/media\.licdn\.com\/.*feedshare/.test(u))
      .filter((u, i, a) => a.indexOf(u) === i)
      .slice(0, 2);
    const text = ((box && box.innerText) || "").replace(/\n{2,}/g, "\n").trim();
    if (text || images.length) {
      posts.push({
        date: dateFromUrn(urn),
        text: text.slice(0, 2500),
        url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : location.href.split("?")[0],
        images,
      });
    }
  }
  return { url: location.href, posts };
}
