/**
 * The newest Chrome extension version. Keep in step with extension/manifest.json:
 * signed-in pages ask people with an older extension to update.
 */
export const LATEST_EXTENSION = "0.4.9";

/** Download of the whole repo; the extension is the `extension` folder inside it. */
export const EXTENSION_DOWNLOAD_URL = "https://github.com/rragishetty-pra/apply-ai/archive/refs/heads/main.zip";

/** true when version a is older than version b (e.g. "0.4.8" < "0.4.9"). */
export function isOlder(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  }
  return false;
}
