/* sync.js — GitHub Gist 多设备数据同步 */
window.syncCode = null;
window.isSyncing = false;

/* ================================================================
   DOM refs
   ================================================================ */

let domSync = {};

function initSyncDom() {
  domSync.syncBtn = document.querySelector("#syncBtn");
  domSync.syncBadge = document.querySelector("#syncBadge");
  domSync.syncCodeDisplay = document.querySelector("#syncCodeDisplay");
  domSync.syncOverlay = document.querySelector("#syncOverlay");
  domSync.syncGenBtn = document.querySelector("#syncGenBtn");
  domSync.syncCodeInput = document.querySelector("#syncCodeInput");
  domSync.syncConnectBtn = document.querySelector("#syncConnectBtn");
  domSync.syncDisconnectBtn = document.querySelector("#syncDisconnectBtn");
  domSync.syncRefreshBtn = document.querySelector("#syncRefreshBtn");
  domSync.syncStatus = document.querySelector("#syncStatus");
  domSync.tokenInput = document.querySelector("#tokenInput");
}

/* ================================================================
   GitHub Token
   ================================================================ */

function getToken() {
  return localStorage.getItem("bullet-github-token") || "";
}

function setToken(t) {
  localStorage.setItem("bullet-github-token", t.trim());
}

/* ================================================================
   Sync code
   ================================================================ */

function generateSyncCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function renderSyncUI() {
  initSyncDom();
  if (!domSync.syncBtn) return;

  if (window.syncCode) {
    domSync.syncBtn.hidden = true;
    domSync.syncBadge.hidden = false;
    domSync.syncCodeDisplay.textContent = window.syncCode;
  } else {
    domSync.syncBtn.hidden = false;
    domSync.syncBadge.hidden = true;
  }
}

window.showSyncStatus = function (text, duration = 3000) {
  if (!domSync.syncStatus) return;
  domSync.syncStatus.textContent = text;
  domSync.syncStatus.style.opacity = "1";
  clearTimeout(domSync.syncStatus._timer);
  if (duration > 0) {
    domSync.syncStatus._timer = setTimeout(() => {
      domSync.syncStatus.style.opacity = "0";
    }, duration);
  }
};

/* ================================================================
   GitHub Gist API
   ================================================================ */

async function gh(url, opts = {}) {
  const token = getToken();
  if (!token) throw new Error("请先设置 GitHub Token");
  const headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };
  if (opts.body) headers["Content-Type"] = "application/json";
  const resp = await fetch("https://api.github.com" + url, { ...opts, headers });
  if (!resp.ok) {
    if (resp.status === 401) throw new Error("Token 无效");
    if (resp.status === 403 && resp.headers.get("X-RateLimit-Remaining") === "0") throw new Error("API 限流");
    throw new Error("GitHub " + resp.status);
  }
  return resp.json();
}

async function findGist() {
  // List user's gists, find one with description "bullet-sync:CODE"
  let page = 1;
  while (true) {
    const gists = await gh("/gists?per_page=100&page=" + page);
    if (!gists.length) break;
    for (const g of gists) {
      if (g.description === "bullet-sync:" + window.syncCode) return g;
    }
    if (gists.length < 100) break;
    page++;
  }
  return null;
}

async function createGist(data) {
  const body = {
    description: "bullet-sync:" + window.syncCode,
    public: false,
    files: { "sync.json": { content: JSON.stringify(data) } },
  };
  const gist = await gh("/gists", { method: "POST", body: JSON.stringify(body) });
  localStorage.setItem("bullet-gist-id:" + window.syncCode, gist.id);
  return gist;
}

async function updateGist(gistId, data) {
  return gh("/gists/" + gistId, {
    method: "PATCH",
    body: JSON.stringify({ files: { "sync.json": { content: JSON.stringify(data) } } }),
  });
}

async function readGist(gistId) {
  const gist = await gh("/gists/" + gistId);
  const file = gist.files["sync.json"];
  if (!file || !file.content) return {};
  try { return JSON.parse(file.content); } catch { return {}; }
}

/* ================================================================
   Push / Pull
   ================================================================ */

async function pushToCloud(data) {
  if (!window.syncCode) return;
  const cachedId = localStorage.getItem("bullet-gist-id:" + window.syncCode);
  if (cachedId) {
    try { await updateGist(cachedId, data); return; }
    catch (e) { /* gist may have been deleted */ }
  }
  const gist = await findGist();
  if (gist) {
    await updateGist(gist.id, data);
    localStorage.setItem("bullet-gist-id:" + window.syncCode, gist.id);
  } else {
    await createGist(data);
  }
}

async function pullFromCloud() {
  if (!window.syncCode) return null;
  const cachedId = localStorage.getItem("bullet-gist-id:" + window.syncCode);
  if (cachedId) {
    try { return await readGist(cachedId); }
    catch (e) { /* gist may have been deleted */ }
  }
  const gist = await findGist();
  if (gist) {
    localStorage.setItem("bullet-gist-id:" + window.syncCode, gist.id);
    return await readGist(gist.id);
  }
  return {};
}

async function pushLocalToCloud() {
  try {
    await pushToCloud({
      bullets: state.bullets,
      monthlyTodos: state.monthlyTodos,
      yearlyEvents: state.yearlyEvents,
    });
  } catch (err) {
    console.warn("Push failed", err);
    window.showSyncStatus("上传失败: " + err.message, 0);
    throw err;
  }
}

/* ================================================================
   Connect / Disconnect
   ================================================================ */

async function onSyncConnect() {
  if (!getToken()) {
    window.showSyncStatus("请先设置 GitHub Token", 0);
    return;
  }
  window.isSyncing = true;
  try {
    window.showSyncStatus("同步中…", 0);
    const cloud = await pullFromCloud();
    if (cloud && Object.keys(cloud).length) {
      if (cloud.bullets && cloud.bullets.length) {
        state.bullets = cloud.bullets;
        saveJsonLocal(STORAGE_KEY, cloud.bullets);
      }
      if (cloud.monthlyTodos && cloud.monthlyTodos.length) {
        state.monthlyTodos = cloud.monthlyTodos;
        saveJsonLocal(MONTHLY_KEY, cloud.monthlyTodos);
      }
      if (cloud.yearlyEvents && cloud.yearlyEvents.length) {
        state.yearlyEvents = cloud.yearlyEvents;
        saveJsonLocal(YEARLY_KEY, cloud.yearlyEvents);
      }
      window.showSyncStatus("已同步 " + (cloud.bullets ? cloud.bullets.length : 0) + " 条任务");
    } else {
      await pushLocalToCloud();
      window.showSyncStatus("已上传本地 " + state.bullets.length + " 条任务");
    }
    renderAll();
    if (typeof renderAccessHint === "function") renderAccessHint();
  } catch (err) {
    console.warn("Sync failed", err);
    window.showSyncStatus("同步失败: " + err.message, 0);
  } finally {
    window.isSyncing = false;
  }
}

/* ================================================================
   UI actions
   ================================================================ */

function openSyncPanel() {
  if (!domSync.syncOverlay) return;
  domSync.syncOverlay.hidden = false;
  if (domSync.tokenInput) domSync.tokenInput.value = getToken();
  if (window.syncCode) domSync.syncCodeDisplay.textContent = window.syncCode;
}

function closeSyncPanel() {
  if (!domSync.syncOverlay) return;
  domSync.syncOverlay.hidden = true;
}

async function doGenerateCode() {
  const code = generateSyncCode();
  domSync.syncCodeInput.value = code;
  window.syncCode = code;
  localStorage.setItem("bullet-sync-code", code);
  renderSyncUI();
  window.showSyncStatus("已生成同步码: " + code, 4000);
  if (domSync.tokenInput) setToken(domSync.tokenInput.value.trim());
  await onSyncConnect();
}

async function doConnectCode() {
  const code = domSync.syncCodeInput.value.trim().toUpperCase();
  if (code.length < 4) {
    alert("请输入有效的同步码");
    return;
  }
  domSync.syncConnectBtn.disabled = true;
  try {
    if (domSync.tokenInput) setToken(domSync.tokenInput.value.trim());
    window.syncCode = code;
    localStorage.setItem("bullet-sync-code", code);
    renderSyncUI();
    await onSyncConnect();
    closeSyncPanel();
  } catch (err) {
    alert("连接失败: " + err.message);
    window.syncCode = null;
  } finally {
    domSync.syncConnectBtn.disabled = false;
  }
}

function doDisconnect() {
  window.syncCode = null;
  localStorage.removeItem("bullet-sync-code");
  renderSyncUI();
  window.showSyncStatus("已断开同步，数据仅存于本机");
  if (typeof renderAccessHint === "function") renderAccessHint();
}

/* ================================================================
   Debounced cloud push
   ================================================================ */

let pushTimer = null;

function queueCloudPush() {
  if (!window.syncCode || window.isSyncing) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushLocalToCloud();
    pushTimer = null;
  }, 1500);
}

/* ================================================================
   Init
   ================================================================ */

function setupSync() {
  initSyncDom();

  const savedCode = localStorage.getItem("bullet-sync-code");
  if (savedCode) {
    window.syncCode = savedCode;
  }
  renderSyncUI();

  if (domSync.syncBtn) domSync.syncBtn.addEventListener("click", openSyncPanel);
  if (domSync.syncBadge) domSync.syncBadge.addEventListener("click", openSyncPanel);
  if (domSync.syncGenBtn) domSync.syncGenBtn.addEventListener("click", doGenerateCode);
  if (domSync.syncConnectBtn) domSync.syncConnectBtn.addEventListener("click", doConnectCode);
  if (domSync.syncDisconnectBtn) domSync.syncDisconnectBtn.addEventListener("click", doDisconnect);
  if (domSync.syncRefreshBtn) domSync.syncRefreshBtn.addEventListener("click", () => onSyncConnect());
  if (domSync.syncOverlay) {
    domSync.syncOverlay.addEventListener("click", (e) => {
      if (e.target === domSync.syncOverlay) closeSyncPanel();
    });
  }

  if (window.syncCode && getToken()) {
    onSyncConnect();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupSync);
} else {
  setupSync();
}
