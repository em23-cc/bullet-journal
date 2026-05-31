/* sync.js — 账号密码 + GitHub Gist 多设备同步 */
window.currentUser = null;
window.isSyncing = false;

// GitHub Personal Access Token — 只需 gist 权限
function getGithubToken() {
  return localStorage.getItem("bullet-github-token") || "";
}
function setGithubToken(t) {
  if (t) localStorage.setItem("bullet-github-token", t.trim());
}

/* ================================================================
   DOM refs
   ================================================================ */

let domSync = {};

function initSyncDom() {
  domSync.loginBtn = document.querySelector("#loginBtn");
  domSync.userBadge = document.querySelector("#userBadge");
  domSync.userName = document.querySelector("#userName");
  domSync.logoutBtn = document.querySelector("#logoutBtn");
  domSync.syncRefreshBtn = document.querySelector("#syncRefreshBtn");
  domSync.syncStatus = document.querySelector("#syncStatus");
  domSync.loginOverlay = document.querySelector("#loginOverlay");
  domSync.tokenInput = document.querySelector("#tokenInput");
  domSync.usernameInput = document.querySelector("#usernameInput");
  domSync.passwordInput = document.querySelector("#passwordInput");
  domSync.doLoginBtn = document.querySelector("#doLoginBtn");
  domSync.doRegisterBtn = document.querySelector("#doRegisterBtn");
}

/* ================================================================
   Password hashing
   ================================================================ */

async function hashPassword(username, password) {
  const data = new TextEncoder().encode(username.toLowerCase() + ":" + password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ================================================================
   GitHub Gist API
   ================================================================ */

async function gh(url, opts = {}) {
  const token = getGithubToken();
  if (!token) throw new Error("请先设置 GitHub Token");
  const headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };
  if (opts.body) headers["Content-Type"] = "application/json";
  const resp = await fetch("https://api.github.com" + url, { ...opts, headers });
  if (!resp.ok) {
    if (resp.status === 401) throw new Error("Token 无效，请联系管理员");
    if (resp.status === 403 && (resp.headers.get("X-RateLimit-Remaining") || "1") === "0") throw new Error("API 请求过多，请稍后");
    throw new Error("网络错误 " + resp.status);
  }
  return resp.json();
}

async function findAccountGist(username) {
  const key = username.toLowerCase();
  let page = 1;
  while (true) {
    const gists = await gh("/gists?per_page=100&page=" + page);
    if (!gists.length) break;
    for (const g of gists) {
      if (g.description === "bullet-acct:" + key) return g;
    }
    if (gists.length < 100) break;
    page++;
  }
  return null;
}

async function createAccountGist(username, hash, syncCode) {
  const key = username.toLowerCase();
  const body = {
    description: "bullet-acct:" + key,
    public: false,
    files: { "account.json": { content: JSON.stringify({ hash: hash, syncCode: syncCode }) } },
  };
  return gh("/gists", { method: "POST", body: JSON.stringify(body) });
}

async function readAccountGist(gistId) {
  const gist = await gh("/gists/" + gistId);
  const file = gist.files["account.json"];
  if (!file || !file.content) throw new Error("账号数据异常");
  return JSON.parse(file.content);
}

/* ================================================================
   Data Gist (sync data)
   ================================================================ */

function getDataGistId() {
  return localStorage.getItem("bullet-data-gist-id");
}
function setDataGistId(id) {
  localStorage.setItem("bullet-data-gist-id", id);
}

async function createDataGist(syncCode) {
  const body = {
    description: "bullet-sync:" + syncCode,
    public: false,
    files: { "sync.json": { content: JSON.stringify({ bullets: [], monthlyTodos: [], yearlyEvents: [] }) } },
  };
  const gist = await gh("/gists", { method: "POST", body: JSON.stringify(body) });
  setDataGistId(gist.id);
  return gist;
}

async function findDataGist(syncCode) {
  let page = 1;
  while (true) {
    const gists = await gh("/gists?per_page=100&page=" + page);
    if (!gists.length) break;
    for (const g of gists) {
      if (g.description === "bullet-sync:" + syncCode) return g;
    }
    if (gists.length < 100) break;
    page++;
  }
  return null;
}

async function ensureDataGist(syncCode) {
  let gistId = getDataGistId();
  if (gistId) {
    try { await gh("/gists/" + gistId); return gistId; }
    catch { setDataGistId(""); }
  }
  let gist = await findDataGist(syncCode);
  if (!gist) gist = await createDataGist(syncCode);
  setDataGistId(gist.id);
  return gist.id;
}

async function readDataGist(gistId) {
  const gist = await gh("/gists/" + gistId);
  const file = gist.files["sync.json"];
  if (!file || !file.content) return { bullets: [], monthlyTodos: [], yearlyEvents: [] };
  try { return JSON.parse(file.content); } catch { return { bullets: [], monthlyTodos: [], yearlyEvents: [] }; }
}

async function writeDataGist(gistId, data) {
  return gh("/gists/" + gistId, {
    method: "PATCH",
    body: JSON.stringify({ files: { "sync.json": { content: JSON.stringify(data) } } }),
  });
}

/* ================================================================
   Push / Pull
   ================================================================ */

async function pushToCloud(data) {
  if (!window.currentUser) return;
  const gistId = await ensureDataGist(window.currentUser.syncCode);
  await writeDataGist(gistId, data);
}

async function pullFromCloud() {
  if (!window.currentUser) return null;
  const gistId = await ensureDataGist(window.currentUser.syncCode);
  return readDataGist(gistId);
}

async function pushLocalToCloud() {
  try {
    await pushToCloud({ bullets: state.bullets, monthlyTodos: state.monthlyTodos, yearlyEvents: state.yearlyEvents });
  } catch (err) {
    console.warn("Push failed", err);
    window.showSyncStatus("上传失败: " + err.message, 0);
  }
}

/* ================================================================
   Login / Register
   ================================================================ */

async function doLogin() {
  if (domSync.tokenInput) setGithubToken(domSync.tokenInput.value);
  const username = domSync.usernameInput.value.trim();
  const password = domSync.passwordInput.value;
  if (!username || !password) { alert("请输入用户名和密码"); return; }
  if (username.length < 2) { alert("用户名至少 2 个字符"); return; }

  domSync.doLoginBtn.disabled = true;
  domSync.doRegisterBtn.disabled = true;
  try {
    const hash = await hashPassword(username, password);
    const gist = await findAccountGist(username);
    if (!gist) { alert("账号不存在，请先注册"); return; }

    const acct = await readAccountGist(gist.id);
    if (acct.hash !== hash) { alert("密码错误"); return; }

    window.currentUser = { username: username, syncCode: acct.syncCode };
    localStorage.setItem("bullet-username", username);
    localStorage.setItem("bullet-sync-code", acct.syncCode);
    setDataGistId("");

    closeLoginPanel();
    renderLoginUI();
    window.showSyncStatus("登录成功", 2000);
    await onSyncConnect();
  } catch (err) {
    alert("登录失败: " + err.message);
  } finally {
    domSync.doLoginBtn.disabled = false;
    domSync.doRegisterBtn.disabled = false;
  }
}

async function doRegister() {
  if (domSync.tokenInput) setGithubToken(domSync.tokenInput.value);
  const username = domSync.usernameInput.value.trim();
  const password = domSync.passwordInput.value;
  if (!username || !password) { alert("请输入用户名和密码"); return; }
  if (username.length < 2) { alert("用户名至少 2 个字符"); return; }
  if (password.length < 4) { alert("密码至少 4 位"); return; }

  domSync.doLoginBtn.disabled = true;
  domSync.doRegisterBtn.disabled = true;
  try {
    const exist = await findAccountGist(username);
    if (exist) { alert("该用户名已被注册"); return; }

    const hash = await hashPassword(username, password);
    const syncCode = generateSyncCode();
    await createAccountGist(username, hash, syncCode);
    await createDataGist(syncCode);

    window.currentUser = { username: username, syncCode: syncCode };
    localStorage.setItem("bullet-username", username);
    localStorage.setItem("bullet-sync-code", syncCode);

    closeLoginPanel();
    renderLoginUI();
    window.showSyncStatus("注册成功，同步码: " + syncCode, 4000);
    await onSyncConnect();
  } catch (err) {
    alert("注册失败: " + err.message);
  } finally {
    domSync.doLoginBtn.disabled = false;
    domSync.doRegisterBtn.disabled = false;
  }
}

async function doLogout() {
  window.currentUser = null;
  localStorage.removeItem("bullet-username");
  localStorage.removeItem("bullet-sync-code");
  renderLoginUI();
  window.showSyncStatus("已退出登录");
  if (typeof renderAccessHint === "function") renderAccessHint();
}

/* ================================================================
   Sync on connect
   ================================================================ */

async function onSyncConnect() {
  window.isSyncing = true;
  try {
    window.showSyncStatus("同步中…", 0);
    const cloud = await pullFromCloud();
    if (cloud) {
      let count = 0;
      if (cloud.bullets && cloud.bullets.length) {
        state.bullets = cloud.bullets;
        saveJsonLocal(STORAGE_KEY, cloud.bullets);
        count += cloud.bullets.length;
      }
      if (cloud.monthlyTodos && cloud.monthlyTodos.length) {
        state.monthlyTodos = cloud.monthlyTodos;
        saveJsonLocal(MONTHLY_KEY, cloud.monthlyTodos);
        count += cloud.monthlyTodos.length;
      }
      if (cloud.yearlyEvents && cloud.yearlyEvents.length) {
        state.yearlyEvents = cloud.yearlyEvents;
        saveJsonLocal(YEARLY_KEY, cloud.yearlyEvents);
        count += cloud.yearlyEvents.length;
      }
      if (count > 0) {
        window.showSyncStatus("已同步 " + count + " 条数据");
      } else {
        await pushLocalToCloud();
        window.showSyncStatus("已上传本地 " + state.bullets.length + " 条任务");
      }
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
   Sync code
   ================================================================ */

function generateSyncCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/* ================================================================
   UI
   ================================================================ */

function renderLoginUI() {
  initSyncDom();
  if (!domSync.loginBtn) return;

  if (window.currentUser) {
    domSync.loginBtn.hidden = true;
    domSync.userBadge.hidden = false;
    domSync.userName.textContent = window.currentUser.username;
  } else {
    domSync.loginBtn.hidden = false;
    domSync.userBadge.hidden = true;
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

function openLoginPanel() {
  if (!domSync.loginOverlay) return;
  domSync.loginOverlay.hidden = false;
  if (domSync.tokenInput) domSync.tokenInput.value = getGithubToken();
  domSync.usernameInput.value = "";
  domSync.passwordInput.value = "";
  domSync.usernameInput.focus();
}

function closeLoginPanel() {
  if (!domSync.loginOverlay) return;
  domSync.loginOverlay.hidden = true;
}

/* ================================================================
   Debounced cloud push
   ================================================================ */

let pushTimer = null;

function queueCloudPush() {
  if (!window.currentUser || window.isSyncing) return;
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

  const savedUser = localStorage.getItem("bullet-username");
  const savedCode = localStorage.getItem("bullet-sync-code");
  if (savedUser && savedCode) {
    window.currentUser = { username: savedUser, syncCode: savedCode };
  }
  renderLoginUI();

  if (domSync.loginBtn) domSync.loginBtn.addEventListener("click", openLoginPanel);
  if (domSync.userBadge) domSync.userBadge.addEventListener("click", openLoginPanel);
  if (domSync.logoutBtn) domSync.logoutBtn.addEventListener("click", doLogout);
  if (domSync.doLoginBtn) domSync.doLoginBtn.addEventListener("click", doLogin);
  if (domSync.doRegisterBtn) domSync.doRegisterBtn.addEventListener("click", doRegister);
  if (domSync.syncRefreshBtn) domSync.syncRefreshBtn.addEventListener("click", () => onSyncConnect());
  if (domSync.loginOverlay) {
    domSync.loginOverlay.addEventListener("click", (e) => {
      if (e.target === domSync.loginOverlay) closeLoginPanel();
    });
  }
  if (domSync.passwordInput) {
    domSync.passwordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLogin();
    });
  }

  if (window.currentUser) {
    onSyncConnect();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupSync);
} else {
  setupSync();
}
