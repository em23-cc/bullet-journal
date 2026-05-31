/* auth.js — LeanCloud 手机号登录 + 用户管理 */
// LeanCloud 初始化 — 请在 LeanCloud 控制台获取你的 AppID 和 AppKey 替换下方占位符
AV.init({
  appId: "YOUR_APP_ID",
  appKey: "YOUR_APP_KEY",
  serverURL: "https://YOUR_SERVER.lc-cn-n1-shared.com",
});

/* Shared state — global for cross-script access */
window.window.currentUser = null;
window.showSyncStatus = function () {};

/* ================================================================
   DOM refs (created after DOM ready)
   ================================================================ */

let domAuth = {};

function initAuthDom() {
  domAuth.loginBtn = document.querySelector("#loginBtn");
  domAuth.userBadge = document.querySelector("#userBadge");
  domAuth.userPhone = document.querySelector("#userPhone");
  domAuth.logoutBtn = document.querySelector("#logoutBtn");
  domAuth.loginOverlay = document.querySelector("#loginOverlay");
  domAuth.phoneInput = document.querySelector("#phoneInput");
  domAuth.codeInput = document.querySelector("#codeInput");
  domAuth.sendCodeBtn = document.querySelector("#sendCodeBtn");
  domAuth.confirmLoginBtn = document.querySelector("#confirmLoginBtn");
  domAuth.syncStatus = document.querySelector("#syncStatus");
}

/* ================================================================
   UI
   ================================================================ */

function renderAuthUI() {
  initAuthDom();
  if (!domAuth.loginBtn) return;

  if (window.currentUser) {
    domAuth.loginBtn.hidden = true;
    domAuth.userBadge.hidden = false;
    domAuth.userPhone.textContent = maskPhone(window.currentUser.getMobilePhoneNumber());
  } else {
    domAuth.loginBtn.hidden = false;
    domAuth.userBadge.hidden = true;
  }
}

window.showSyncStatus = function (text, duration = 2000) {
  if (!domAuth.syncStatus) return;
  domAuth.syncStatus.textContent = text;
  domAuth.syncStatus.style.opacity = "1";
  clearTimeout(domAuth.syncStatus._timer);
  domAuth.syncStatus._timer = setTimeout(() => {
    domAuth.syncStatus.style.opacity = "0";
  }, duration);
}

function maskPhone(phone) {
  if (!phone) return "";
  return phone.slice(0, 3) + "****" + phone.slice(-4);
}

/* ================================================================
   SMS & Login
   ================================================================ */

let codeCooldown = 0;
let cooldownTimer = null;

async function sendSmsCode() {
  if (codeCooldown > 0) return;
  const phone = domAuth.phoneInput.value.trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    alert("请输入正确的手机号");
    return;
  }
  try {
    domAuth.sendCodeBtn.disabled = true;
    await AV.User.requestLoginSmsCode(phone);
    codeCooldown = 60;
    updateCooldownUI();
    cooldownTimer = setInterval(() => {
      codeCooldown--;
      if (codeCooldown <= 0) {
        clearInterval(cooldownTimer);
        domAuth.sendCodeBtn.disabled = false;
        domAuth.sendCodeBtn.textContent = "发送验证码";
      } else {
        updateCooldownUI();
      }
    }, 1000);
  } catch (err) {
    domAuth.sendCodeBtn.disabled = false;
    alert("发送失败：" + (err.error || err.message));
  }
}

function updateCooldownUI() {
  domAuth.sendCodeBtn.textContent = codeCooldown + "s 后重发";
}

async function doLogin() {
  const phone = domAuth.phoneInput.value.trim();
  const code = domAuth.codeInput.value.trim();
  if (!phone || !code) return;
  try {
    domAuth.confirmLoginBtn.disabled = true;
    domAuth.confirmLoginBtn.textContent = "登录中…";
    window.currentUser = await AV.User.signUpOrlogInWithMobilePhone(phone, code);
    closeLoginModal();
    renderAuthUI();
    showSyncStatus("已同步云端数据");
    if (typeof onLoginSync === "function") onLoginSync();
    if (typeof renderAccessHint === "function") renderAccessHint();
  } catch (err) {
    alert("登录失败：" + (err.error || err.message));
  } finally {
    domAuth.confirmLoginBtn.disabled = false;
    domAuth.confirmLoginBtn.textContent = "确认登录";
  }
}

async function doLogout() {
  await AV.User.logOut();
  window.currentUser = null;
  renderAuthUI();
  showSyncStatus("已退出，数据仅存于本机");
  if (typeof renderAccessHint === "function") renderAccessHint();
}

function openLoginModal() {
  if (!domAuth.loginOverlay) return;
  domAuth.loginOverlay.hidden = false;
  domAuth.phoneInput.value = "";
  domAuth.codeInput.value = "";
  domAuth.phoneInput.focus();
}

function closeLoginModal() {
  if (!domAuth.loginOverlay) return;
  domAuth.loginOverlay.hidden = true;
}

/* ================================================================
   Init
   ================================================================ */

function setupAuth() {
  initAuthDom();

  window.currentUser = AV.User.current();
  renderAuthUI();

  // Event bindings
  if (domAuth.loginBtn) domAuth.loginBtn.addEventListener("click", openLoginModal);
  if (domAuth.logoutBtn) domAuth.logoutBtn.addEventListener("click", doLogout);
  if (domAuth.sendCodeBtn) domAuth.sendCodeBtn.addEventListener("click", sendSmsCode);
  if (domAuth.confirmLoginBtn) domAuth.confirmLoginBtn.addEventListener("click", doLogin);
  if (domAuth.loginOverlay) {
    domAuth.loginOverlay.addEventListener("click", (e) => {
      if (e.target === domAuth.loginOverlay) closeLoginModal();
    });
  }

  // Enter key on code input
  if (domAuth.codeInput) {
    domAuth.codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLogin();
    });
  }
}

// Safe DOM-ready: fires immediately if DOM already loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupAuth);
} else {
  setupAuth();
}
