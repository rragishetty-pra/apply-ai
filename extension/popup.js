const $ = (id) => document.getElementById(id);
const send = (type) =>
  new Promise((resolve, reject) =>
    chrome.runtime.sendMessage({ type }, (r) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (r && r.error) return reject(new Error(r.error));
      resolve(r ? r.result : null);
    })
  );
const openApp = (path = "/dashboard") => chrome.tabs.create({ url: self.APP_URL + path });

async function render() {
  const s = await chrome.storage.local.get(["token", "running", "progress", "log", "lastRun"]);
  $("notPaired").hidden = !!s.token;
  $("paired").hidden = !s.token;
  $("status").textContent = !s.token ? "Not connected" : s.running ? "Running" : "Connected";

  const p = s.progress;
  if (s.running && p) {
    $("progress").textContent = `${p.phase}${p.of ? ` ${p.step}/${p.of}` : ""} — ${p.detail || ""}`;
    $("barFill").style.width = p.of ? `${Math.round((p.step / p.of) * 100)}%` : "100%";
  } else if (s.lastRun) {
    const st = s.lastRun.stats || {};
    $("progress").textContent = `Last run ${new Date(s.lastRun.at).toLocaleString()}: ${st.new ?? 0} new, ${st.tailored ?? 0} CVs tailored.`;
    $("barFill").style.width = "0";
  } else {
    $("progress").textContent = "Hunter hasn't run yet.";
  }
  $("run").hidden = !!s.running;
  $("stop").hidden = !s.running;
  $("log").textContent = (s.log || []).slice(-15).join("\n");
}

$("openApp1").onclick = () => openApp("/onboarding");
$("openApp2").onclick = () => openApp();
$("run").onclick = async () => { $("err").textContent = ""; try { await send("RUN_HUNTER"); } catch (e) { $("err").textContent = e.message; } };
$("stop").onclick = () => send("STOP");
$("checkLogins").onclick = async () => {
  $("err").textContent = "";
  $("checkLogins").disabled = true;
  $("checkLogins").textContent = "Checking…";
  try {
    const st = await send("CHECK_LOGINS");
    $("err").style.color = "#5f6368";
    $("err").textContent = Object.entries(st).map(([k, v]) => `${k}: ${v === "ok" ? "signed in" : "sign-in needed"}`).join(" · ");
  } catch (e) { $("err").textContent = e.message; }
  $("checkLogins").disabled = false;
  $("checkLogins").textContent = "Check sign-ins";
};
$("capture").onclick = async () => {
  $("captureMsg").textContent = "Reading this page…";
  try {
    const r = await send("CAPTURE");
    $("captureMsg").textContent = `Added: ${r.title}. Tailor will pick it up.`;
  } catch (e) { $("captureMsg").textContent = e.message; }
};

chrome.storage.onChanged.addListener(render);
render();
