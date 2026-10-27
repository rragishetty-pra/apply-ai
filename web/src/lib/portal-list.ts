/**
 * Every job source Hunter knows. Client-safe (used by Settings, the dashboard and the server plan).
 *
 * For portals without a dedicated reader, the extension uses a generic reader driven by `linkPattern`
 * (the shape of a job-detail URL on that site) — so a portal can be tuned here without touching the
 * extension. `loginPattern` matches the URL a portal redirects to when it wants you to sign in.
 */
export interface PortalInfo {
  id: string;
  name: string;
  about: string;
  defaultOn: boolean;
  needsLogin: boolean;      // shows more / any jobs only when signed in (every portal needs an account to apply)
  loginUrl?: string;
  homeUrl?: string;         // page used to check whether the user is signed in
  linkPattern?: string;     // regex source for job-detail links (generic reader)
  loginPattern?: string;    // regex source for sign-in redirects
  abroad?: boolean;         // can search outside India
  trial?: boolean;          // new reader, being tuned on live runs
}

export const PORTALS: PortalInfo[] = [
  { id: "naukri", name: "Naukri", about: "India's largest job portal", defaultOn: true, needsLogin: false, loginUrl: "https://www.naukri.com/nlogin/login" },
  { id: "linkedin", name: "LinkedIn", about: "India, remote and abroad", defaultOn: true, needsLogin: true, loginUrl: "https://www.linkedin.com/login", abroad: true },
  { id: "indeed", name: "Indeed", about: "Wide coverage across India", defaultOn: true, needsLogin: false, loginUrl: "https://secure.indeed.com/auth" },
  {
    id: "foundit", name: "Foundit", about: "Formerly Monster India", defaultOn: true, needsLogin: false,
    loginUrl: "https://www.foundit.in/rio/login", homeUrl: "https://www.foundit.in/",
    linkPattern: "foundit\\.in/job/[^?#]*-\\d{6,}", loginPattern: "foundit\\.in/(rio/)?login",
  },
  {
    id: "shine", trial: true, name: "Shine", about: "HT Media's job portal", defaultOn: false, needsLogin: false,
    loginUrl: "https://www.shine.com/myshine/login/", homeUrl: "https://www.shine.com/",
    linkPattern: "shine\\.com/jobs/[^?#]+/\\d{6,}", loginPattern: "shine\\.com/myshine/login",
  },
  {
    id: "hirist", name: "Hirist", about: "Tech and IT jobs", defaultOn: true, needsLogin: false,
    loginUrl: "https://www.hirist.tech/login", homeUrl: "https://www.hirist.tech/",
    linkPattern: "hirist\\.tech/j/[^?#]*-\\d{5,}", loginPattern: "hirist\\.tech/login",
  },
  {
    id: "instahyre", trial: true, name: "Instahyre", about: "Tech jobs; searched without sign-in", defaultOn: false, needsLogin: false,
    loginUrl: "https://www.instahyre.com/login/", homeUrl: "https://www.instahyre.com/candidate/opportunities/",
    linkPattern: "instahyre\\.com/job-\\d+", loginPattern: "instahyre\\.com/(login|signup)",
  },
  {
    id: "cutshort", trial: true, name: "Cutshort", about: "Startups and tech", defaultOn: false, needsLogin: false,
    loginUrl: "https://cutshort.io/login", homeUrl: "https://cutshort.io/",
    linkPattern: "cutshort\\.io/job/[^?#]+-[A-Za-z0-9]{6,10}(?:$|[?#])", loginPattern: "cutshort\\.io/(login|signup)",
  },
  {
    id: "glassdoor", trial: true, name: "Glassdoor", about: "Jobs with company reviews", defaultOn: false, needsLogin: true,
    loginUrl: "https://www.glassdoor.co.in/profile/login_input.htm", homeUrl: "https://www.glassdoor.co.in/",
    linkPattern: "glassdoor\\.co\\.in/(job-listing|partner/jobListing|Job/[^?#]*-JV_)", loginPattern: "glassdoor\\.co\\.in/(profile/login|member/profile)",
  },
  {
    id: "wellfound", trial: true, name: "Wellfound", about: "Startup jobs (formerly AngelList Talent)", defaultOn: false, needsLogin: true,
    loginUrl: "https://wellfound.com/login", homeUrl: "https://wellfound.com/jobs",
    linkPattern: "wellfound\\.com/jobs/\\d+", loginPattern: "wellfound\\.com/(login|join)",
  },
  {
    id: "iimjobs", trial: true, name: "iimjobs", about: "Management, finance and senior roles", defaultOn: false, needsLogin: false,
    loginUrl: "https://www.iimjobs.com/login", homeUrl: "https://www.iimjobs.com/",
    linkPattern: "iimjobs\\.com/j/[^?#]+", loginPattern: "iimjobs\\.com/login",
  },
];

export const PORTAL_IDS = PORTALS.map((p) => p.id);
export const DEFAULT_PORTALS = PORTALS.filter((p) => p.defaultOn).map((p) => p.id);

export const portalName = (id: string | null | undefined) =>
  id === "careers" ? "Company careers" : PORTALS.find((p) => p.id === id)?.name || (id ? id[0].toUpperCase() + id.slice(1) : "Other");

/** Industries for the company careers-page search. */
export const INDUSTRIES = [
  "IT services & consulting",
  "Product & internet",
  "Global banks & financial services",
  "Indian banks, NBFCs & insurance",
  "Consulting & Big Four",
  "Analytics & data",
  "Healthcare & pharma",
  "Telecom & media",
  "Retail, FMCG & e-commerce",
  "Manufacturing, auto & energy",
  "Semiconductors & hardware",
] as const;
