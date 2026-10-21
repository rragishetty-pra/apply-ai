// Runs on the Apply.ai website only. Relays messages between the page and the extension.
// The page detects the extension with a PING (answered here) — a DOM marker set at
// document_start would be wiped when the page's <html> is created/hydrated.
const VERSION = chrome.runtime.getManifest().version;
const mark = () => {
  if (document.documentElement) {
    document.documentElement.dataset.applyaiExtension = "1";
    document.documentElement.dataset.applyaiExtensionVersion = VERSION;
  }
};
document.addEventListener("DOMContentLoaded", mark);
window.addEventListener("load", mark);

window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.source !== "applyai-web") return;
  const { id, source, ...payload } = e.data; // payload = { type, token?, sessionId?, company?, role? }
  if (payload.type === "PING") {
    mark();
    window.postMessage({ source: "applyai-ext", id, result: { version: VERSION }, error: null }, window.location.origin);
    return;
  }
  chrome.runtime.sendMessage({ from: "web", ...payload }, (resp) => {
    const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : resp && resp.error;
    window.postMessage(
      { source: "applyai-ext", id, result: resp ? resp.result : null, error: err || null },
      window.location.origin
    );
  });
});
