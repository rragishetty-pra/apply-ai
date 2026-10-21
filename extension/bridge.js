// Runs on the Apply.ai website only. Relays messages between the page and the extension.
document.documentElement.dataset.applyaiExtension = "1";

window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.source !== "applyai-web") return;
  const { id, type, token } = e.data;
  chrome.runtime.sendMessage({ from: "web", type, token }, (resp) => {
    const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : resp && resp.error;
    window.postMessage(
      { source: "applyai-ext", id, result: resp ? resp.result : null, error: err || null },
      window.location.origin
    );
  });
});
