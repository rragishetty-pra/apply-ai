// Usage: node set-app-url.mjs https://your-app.vercel.app
// Points the extension at your deployed Apply.ai (config.js + manifest.json).
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const dir = dirname(fileURLToPath(import.meta.url));
const raw = process.argv[2];
if (!raw) {
  console.error("Usage: node set-app-url.mjs https://your-app.vercel.app");
  process.exit(1);
}
const origin = new URL(raw).origin;

writeFileSync(join(dir, "config.js"),
  `// The Apply.ai web app this extension talks to.\n// Change it with:  node set-app-url.mjs https://your-app.vercel.app\nself.APP_URL = ${JSON.stringify(origin)};\n`);

const manifestPath = join(dir, "manifest.json");
const m = JSON.parse(readFileSync(manifestPath, "utf8"));
const portals = m.host_permissions.filter((h) => /linkedin|naukri|indeed/.test(h));
m.host_permissions = [...portals, `${origin}/*`];
m.content_scripts[0].matches = [`${origin}/*`];
writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n");

console.log(`Extension now points to ${origin}. Reload it in chrome://extensions.`);
