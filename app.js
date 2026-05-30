const storageKey = "bullet-journal-planner:v2";
const legacyStorageKey = "personal-task-inbox:v1";

const symbols = [
  { value: "•", label: "任务" },
  { value: "×", label: "完成" },
  { value: ">", label: "迁移" },
  { value: "<", label: "排期" },
  { value: "○", label: "事件" },
  { value: "–", label: "备注" },
  { value: "*", label: "重要" },
];

const state = {
  bullets: loadBullets(),
  draft: null,
  deferredInstallPrompt: null,
};

/* ---------- DOM refs ---------- */

const noticeInput = document.querySelector("#noticeInput");
const parseButton = document.querySelector("#parseButton");
const pasteButton = document.querySelector("#pasteButton");
const reviewPanel = document.querySelector("#reviewPanel");
const confidenceBadge = document.querySelector("#confidenceBadge");
const draftList = document.querySelector("#draftList");
const draftTemplate = document.querySelector("#draftTemplate");
const sourceText = document.querySelector("#sourceText");
const createButton = document.querySelector("#createButton");
const ignoreButton = document.querySelector("#ignoreButton");
const weekGrid = document.querySelector("#weekGrid");
const weekRange = document.querySelector("#weekRange");
const legendList = document.querySelector("#legendList");
const quickAddForm = document.querySelector("#quickAddForm");
const quickSymbol = document.querySelector("#quickSymbol");
const quickText = document.querySelector("#quickText");
const todayList = document.querySelector("#todayList");
const todayDate = document.querySelector("#todayDate");
const installButton = document.querySelector("#installButton");
const accessHint = document.querySelector("#accessHint");
const pageTitle = document.querySelector("#pageTitle");

/* ---------- Tab switching ---------- */

const tabButtons = document.querySelectorAll(".tab-button");
const weekPanel = document.querySelector("#weekPanel");
const inboxPanel = document.querySelector("#inboxPanel");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    if (tab === "week") {
      weekPanel.hidden = false;
      inboxPanel.hidden = true;
      pageTitle.textContent = "本周";
    } else {
      weekPanel.hidden = true;
      inboxPanel.hidden = false;
      pageTitle.textContent = "收件箱";
    }
  });
});

/* ---------- Today sheet ---------- */

const todayBackdrop = document.querySelector("#todayBackdrop");
const todaySheet = document.querySelector("#todaySheet");
const todayCloseButton = document.querySelector("#todayCloseButton");

function openTodaySheet() {
  todayBackdrop.hidden = false;
  todaySheet.hidden = false;
  renderTodaySheet();
}

function closeTodaySheet() {
  todayBackdrop.hidden = true;
  todaySheet.hidden = true;
}

todayCloseButton.addEventListener("click", closeTodaySheet);
todayBackdrop.addEventListener("click", (e) => {
  if (e.target === todayBackdrop) closeTodaySheet();
});

/* ---------- Parse ---------- */

parseButton.addEventListener("click", async () => {
  const text = noticeInput.value.trim();
  if (!text) {
    noticeInput.focus();
    return;
  }

  try {
    parseButton.disabled = true;
    parseButton.textContent = "解析中…";
    const parser = getActiveParser();
    state.draft = await parser.parse(text);
    renderDraft();
  } catch (err) {
    alert(`解析失败：${err.message}`);
  } finally {
    parseButton.disabled = false;
    parseButton.textContent = "解析";
  }
});

pasteButton.addEventListener("click", async () => {
  if (!navigator.clipboard?.readText) {
    pasteButton.textContent = "手动粘贴";
    return;
  }
  try {
    noticeInput.value = await navigator.clipboard.readText();
    noticeInput.focus();
  } catch {
    pasteButton.textContent = "手动粘贴";
  }
});

/* ---------- Confirm / Ignore ---------- */

createButton.addEventListener("click", () => {
  const rows = [...draftList.querySelectorAll(".draft-row")];
  const bullets = rows
    .map((row) => ({
      id: createId(),
      symbol: row.querySelector(".draft-symbol").value,
      text: row.querySelector(".draft-text").value.trim(),
      dateKey: row.querySelector(".draft-date").value,
      source: state.draft?.source || "",
      createdAt: new Date().toISOString(),
    }))
    .filter((item) => item.text);

  state.bullets.unshift(...bullets);
  saveBullets();
  clearDraft();
  renderWeek();
});

ignoreButton.addEventListener("click", clearDraft);

/* ---------- Quick add (today sheet) ---------- */

quickAddForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = quickText.value.trim();
  if (!text) {
    quickText.focus();
    return;
  }

  state.bullets.unshift({
    id: createId(),
    symbol: quickSymbol.value,
    text,
    dateKey: todayKey(),
    source: "手动记录",
    createdAt: new Date().toISOString(),
  });
  quickText.value = "";
  saveBullets();
  renderTodaySheet();
  renderWeek();
});

/* ---------- Week todo quick add ---------- */

function addWeekTodo() {
  const text = prompt("添加一条本周待办：");
  if (!text || !text.trim()) return;

  state.bullets.unshift({
    id: createId(),
    symbol: "•",
    text: text.trim(),
    dateKey: "",
    source: "手动记录",
    createdAt: new Date().toISOString(),
  });
  saveBullets();
  renderWeek();
}

/* ---------- PWA install ---------- */

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
});

/* ---------- Settings ---------- */

const settingsButton = document.querySelector("#settingsButton");
const settingsOverlay = document.querySelector("#settingsOverlay");
const settingsCloseButton = document.querySelector("#settingsCloseButton");
const parserSelect = document.querySelector("#parserSelect");
const apiKeyField = document.querySelector("#apiKeyField");
const apiKeyInput = document.querySelector("#apiKeyInput");
const apiKeyHint = document.querySelector("#apiKeyHint");

function openSettings() {
  parserSelect.value = getActiveParserId();
  apiKeyInput.value = localStorage.getItem("bullet-journal-planner:deepseek-key") || "";
  apiKeyField.hidden = parserSelect.value !== "deepseek";
  settingsOverlay.hidden = false;
  updateApiKeyHint();
}

function closeSettings() {
  settingsOverlay.hidden = true;
}

settingsButton.addEventListener("click", openSettings);
settingsCloseButton.addEventListener("click", closeSettings);
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

parserSelect.addEventListener("change", () => {
  setActiveParserId(parserSelect.value);
  apiKeyField.hidden = parserSelect.value !== "deepseek";
  updateApiKeyHint();
});

apiKeyInput.addEventListener("input", () => {
  localStorage.setItem("bullet-journal-planner:deepseek-key", apiKeyInput.value.trim());
  updateApiKeyHint();
});

function updateApiKeyHint() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    apiKeyHint.textContent = "尚未设置 Key，将无法使用 AI 解析。";
  } else if (key.startsWith("sk-")) {
    apiKeyHint.textContent = "Key 已保存。";
  } else {
    apiKeyHint.textContent = "Key 格式可能不正确（通常以 sk- 开头）。";
  }
}

/* ---------- Service Worker ---------- */

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

/* ---------- Init ---------- */

renderAccessHint();
renderLegend();
renderWeek();

/* ---------- Render: Draft ---------- */

function renderDraft() {
  reviewPanel.hidden = false;
  const parserName = getActiveParser().name;
  confidenceBadge.textContent = `${parserName} · 像任务 ${state.draft.confidence}%`;
  sourceText.textContent = state.draft.source;
  draftList.replaceChildren();

  state.draft.bullets.forEach((bullet) => {
    const node = draftTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".draft-symbol").value = bullet.symbol;
    node.querySelector(".draft-text").value = bullet.text;
    node.querySelector(".draft-date").value = bullet.dateKey;

    const removeBtn = node.querySelector(".draft-remove");
    removeBtn.addEventListener("click", () => {
      node.remove();
      if (!draftList.children.length) clearDraft();
    });

    draftList.append(node);
  });

  reviewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearDraft() {
  state.draft = null;
  reviewPanel.hidden = true;
  noticeInput.value = "";
  draftList.replaceChildren();
}

/* ---------- Render: Week ---------- */

function renderWeek() {
  const days = weekDays();
  const today = todayKey();
  weekRange.textContent = `${formatMonthDay(days[0].date)} - ${formatMonthDay(days[6].date)}`;
  weekGrid.replaceChildren();

  // 一周待办框
  const todoBox = document.createElement("section");
  todoBox.className = "week-todo";
  const todoHeader = document.createElement("div");
  todoHeader.className = "week-todo-header";
  todoHeader.innerHTML = `<span>一周待办</span>`;
  const todoAddBtn = document.createElement("button");
  todoAddBtn.className = "week-todo-add";
  todoAddBtn.textContent = "+";
  todoAddBtn.title = "添加";
  todoAddBtn.addEventListener("click", addWeekTodo);
  todoHeader.append(todoAddBtn);

  const todoList = document.createElement("div");
  todoList.className = "day-list";
  const weekBullets = state.bullets.filter((item) => !item.dateKey);
  if (weekBullets.length) {
    weekBullets.forEach((bullet) => todoList.append(createBulletNode(bullet, "compact")));
  } else {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "暂无待办。";
    todoList.append(empty);
  }
  todoBox.append(todoHeader, todoList);
  weekGrid.append(todoBox);

  // 7 天
  days.forEach((day) => {
    const box = document.createElement("section");
    box.className = `day-box${day.key === today ? " today" : ""}`;
    const title = document.createElement("div");
    title.className = "day-title";
    title.innerHTML = `<span>${day.weekday}</span><span>${formatMonthDay(day.date)}</span>`;
    const list = document.createElement("div");
    list.className = "day-list";
    const bullets = state.bullets.filter((item) => item.dateKey === day.key);
    if (bullets.length) {
      bullets.forEach((bullet) => list.append(createBulletNode(bullet, "compact")));
    } else {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = " ";
      list.append(empty);
    }
    box.append(title, list);

    if (day.key === today) {
      box.addEventListener("click", (e) => {
        if (e.target.closest(".bullet-symbol") || e.target.closest(".bullet-text")) return;
        openTodaySheet();
      });
    }

    weekGrid.append(box);
  });
}

/* ---------- Render: Today Sheet ---------- */

function renderTodaySheet() {
  todayDate.textContent = formatFullDate(new Date());
  const todayBullets = state.bullets.filter((item) => item.dateKey === todayKey());
  todayList.replaceChildren();

  if (!todayBullets.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "今天还没有子弹。可以手动记录，或从通知解析后确认加入。";
    todayList.append(empty);
    return;
  }

  todayBullets.forEach((bullet) => todayList.append(createBulletNode(bullet, "today")));
}

/* ---------- Create Bullet Node ---------- */

function createBulletNode(bullet, mode) {
  const node = bulletTemplate.content.firstElementChild.cloneNode(true);
  const symbolButton = node.querySelector(".bullet-symbol");
  const textInput = node.querySelector(".bullet-text");
  const meta = node.querySelector(".bullet-meta");
  const migrateButton = node.querySelector(".migrate-button");
  const deleteButton = node.querySelector(".delete-button");

  node.classList.toggle("done", bullet.symbol === "×");
  symbolButton.textContent = bullet.symbol;
  textInput.value = bullet.text;

  if (bullet.dateKey) {
    meta.textContent = [formatDateKey(bullet.dateKey), bullet.source && bullet.source !== "手动记录" ? "来自通知" : ""]
      .filter(Boolean)
      .join(" · ");
  }

  symbolButton.addEventListener("click", () => {
    bullet.symbol = bullet.symbol === "×" ? "•" : "×";
    saveBullets();
    renderAll();
  });

  textInput.addEventListener("change", () => {
    bullet.text = textInput.value.trim() || bullet.text;
    saveBullets();
    renderAll();
  });

  migrateButton.addEventListener("click", () => {
    bullet.symbol = ">";
    bullet.dateKey = dateKeyFromDate(addDays(new Date(`${bullet.dateKey}T00:00:00`), 1));
    saveBullets();
    renderAll();
  });

  deleteButton.addEventListener("click", () => {
    state.bullets = state.bullets.filter((item) => item.id !== bullet.id);
    saveBullets();
    renderAll();
  });

  // 长按显示操作按钮（移动端）
  let pressTimer;
  node.addEventListener("touchstart", () => {
    pressTimer = setTimeout(() => {
      migrateButton.style.opacity = "1";
      deleteButton.style.opacity = "1";
    }, 500);
  }, { passive: true });
  node.addEventListener("touchend", () => clearTimeout(pressTimer));
  node.addEventListener("touchmove", () => clearTimeout(pressTimer));

  if (mode === "compact") {
    migrateButton.hidden = true;
    deleteButton.hidden = true;
  }

  return node;
}

function renderAll() {
  renderWeek();
  if (!todaySheet.hidden) renderTodaySheet();
}

/* ---------- Legend ---------- */

function renderLegend() {
  legendList.replaceChildren();
  symbols.forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "legend-chip";
    chip.innerHTML = `<strong>${item.value}</strong>${item.label}`;
    legendList.append(chip);
  });
}

/* ---------- Storage ---------- */

function loadBullets() {
  try {
    const current = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(current)) return current;
  } catch {}

  try {
    const legacy = JSON.parse(localStorage.getItem(legacyStorageKey)) || [];
    return legacy.map((task) => ({
      id: task.id || createId(),
      symbol: task.done ? "×" : "•",
      text: task.what || task.title || "未命名任务",
      dateKey: todayKey(),
      source: task.note || "",
      createdAt: task.createdAt || new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

function saveBullets() {
  localStorage.setItem(storageKey, JSON.stringify(state.bullets));
}

function renderAccessHint() {
  if (!accessHint) return;
  accessHint.textContent =
    location.hostname === "127.0.0.1" || location.hostname === "localhost"
      ? "手机访问请使用电脑的局域网 IP 地址。"
      : "任务会保存在这台设备的浏览器里。";
}
