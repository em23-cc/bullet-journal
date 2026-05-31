/* sync.js — 同步密钥：多设备数据同步 */
// 替换为你的 Cloudflare Worker URL
const WORKER_URL = "https://YOUR_WORKER.workers.dev";

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
  domSync.syncStatus = document.querySelector("#syncStatus");
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

window.showSyncStatus = function (text, duration = 2000) {
  if (!domSync.syncStatus) return;
  domSync.syncStatus.textContent = text;
  domSync.syncStatus.style.opacity = "1";
  clearTimeout(domSync.syncStatus._timer);
  domSync.syncStatus._timer = setTimeout(() => {
    domSync.syncStatus.style.opacity = "0";
  }, duration);
};

/* ================================================================
   Cloud data push / pull
   ================================================================ */

async function pushToCloud(data) {
  if (!window.syncCode) return;
  const resp = await fetch(`${WORKER_URL}/${window.syncCode}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!resp.ok) throw new Error("Push failed: " + resp.status);
}

async function pullFromCloud() {
  if (!window.syncCode) return null;
  const resp = await fetch(`${WORKER_URL}/${window.syncCode}`);
  if (!resp.ok) throw new Error("Pull failed: " + resp.status);
  return resp.json();
}

/* Called by app.js after connecting — fetch cloud data, merge into state */
async function onSyncConnect() {
  window.isSyncing = true;
  try {
    window.showSyncStatus("同步中…");
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
      window.showSyncStatus("已同步云端数据");
    } else {
      // No cloud data, push local
      await pushLocalToCloud();
    }
    renderAll();
    if (typeof renderAccessHint === "function") renderAccessHint();
  } catch (err) {
    console.warn("Sync failed", err);
    window.showSyncStatus("同步失败，请检查网络");
  } finally {
    window.isSyncing = false;
  }
}

async function pushLocalToCloud() {
  try {
    await pushToCloud({
      bullets: state.bullets,
      monthlyTodos: state.monthlyTodos,
      yearlyEvents: state.yearlyEvents,
    });
    window.showSyncStatus("已上传本地数据");
  } catch (err) {
    console.warn("Push failed", err);
  }
}

/* ================================================================
   UI actions
   ================================================================ */

function openSyncPanel() {
  if (!domSync.syncOverlay) return;
  domSync.syncOverlay.hidden = false;
  if (window.syncCode) {
    domSync.syncCodeDisplay.textContent = window.syncCode;
  }
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
  showSyncStatus("已生成同步码: " + code, 4000);
  // Push local data to cloud
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
  showSyncStatus("已断开同步，数据仅存于本机");
  if (typeof renderAccessHint === "function") renderAccessHint();
}

/* ================================================================
   Debounced cloud push (called by app.js after every local save)
   ================================================================ */

let pushTimer = null;

function queueCloudPush() {
  if (!window.syncCode || window.isSyncing) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushLocalToCloud();
    pushTimer = null;
  }, 1000);
}

/* ================================================================
   Init
   ================================================================ */

function setupSync() {
  initSyncDom();

  // Restore sync code from localStorage
  const savedCode = localStorage.getItem("bullet-sync-code");
  if (savedCode) {
    window.syncCode = savedCode;
  }
  renderSyncUI();

  // Event bindings
  if (domSync.syncBtn) domSync.syncBtn.addEventListener("click", openSyncPanel);
  if (domSync.syncBadge) domSync.syncBadge.addEventListener("click", openSyncPanel);
  if (domSync.syncGenBtn) domSync.syncGenBtn.addEventListener("click", doGenerateCode);
  if (domSync.syncConnectBtn) domSync.syncConnectBtn.addEventListener("click", doConnectCode);
  if (domSync.syncDisconnectBtn) domSync.syncDisconnectBtn.addEventListener("click", doDisconnect);
  if (domSync.syncOverlay) {
    domSync.syncOverlay.addEventListener("click", (e) => {
      if (e.target === domSync.syncOverlay) closeSyncPanel();
    });
  }

  // If already synced, load from cloud
  if (window.syncCode) {
    onSyncConnect();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupSync);
} else {
  setupSync();
}
