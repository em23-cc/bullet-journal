/* app.js v11 — 4 Tab + 符号菜单 + 月/年视图 + 周偏移 */

const STORAGE_KEY = "bullet-journal-planner:v2";
const LEGACY_KEY = "personal-task-inbox:v1";
const MONTHLY_KEY = "bullet-journal-planner:monthly-todos";
const YEARLY_KEY = "bullet-journal-planner:yearly-events";

const DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SYMBOLS = [
  { value: "•", label: "任务" },
  { value: "×", label: "完成" },
  { value: ">", label: "迁移" },
  { value: "<", label: "排期" },
  { value: "–", label: "备注" },
  { value: "*", label: "重要" },
];

const YEAR_COLORS = ["#e06c6c", "#e0a56c", "#d4c04a", "#6cbe6c", "#6ca8e0", "#b06ce0"];

function mkEl(tag, attrs = {}) {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "className") el.className = v;
    else if (k === "innerHTML") el.innerHTML = v;
    else if (k === "textContent") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  });
  return el;
}

function formatShort(dateKey) {
  const parts = dateKey.split("-");
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
}

const state = {
  bullets: loadJson(STORAGE_KEY) || migrateLegacy(),
  monthlyTodos: loadJson(MONTHLY_KEY) || [],
  /* undo state for migrate action */
  undoAction: null,
  undoTimer: null,
  yearlyEvents: loadJson(YEARLY_KEY) || [],
  draft: null,
  weekOffset: 0,
  monthOffset: 0,
  viewYear: new Date().getFullYear(),
  half: "first",
  activeBullet: null,
  activePopoverBullet: null,
  pendingYearEvent: null,
  currentSheetDate: todayKey(),
  deferredInstallPrompt: null,
};

/* ================================================================
   DOM refs
   ================================================================ */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const dom = {
  pageTitle: $("#pageTitle"),
  noticeInput: $("#noticeInput"),
  parseButton: $("#parseButton"),
  pasteButton: $("#pasteButton"),
  reviewPanel: $("#reviewPanel"),
  confidenceBadge: $("#confidenceBadge"),
  draftList: $("#draftList"),
  sourceText: $("#sourceText"),
  createButton: $("#createButton"),
  ignoreButton: $("#ignoreButton"),
  weekGrid: $("#weekGrid"),
  weekRange: $("#weekRange"),
  weekPrev: $("#weekPrev"),
  weekNext: $("#weekNext"),
  legendList: $("#legendList"),
  quickAddForm: $("#quickAddForm"),
  quickSymbol: $("#quickSymbol"),
  quickText: $("#quickText"),
  todayList: $("#todayList"),
  todayDate: $("#todayDate"),
  todayBackdrop: $("#todayBackdrop"),
  todaySheet: $("#todaySheet"),
  todayCloseButton: $("#todayCloseButton"),
  monthLayout: $("#monthLayout"),
  monthTitle: $("#monthTitle"),
  monthPrev: $("#monthPrev"),
  monthNext: $("#monthNext"),
  mtodoLife: $("#mtodoLife"),
  mtodoStudy: $("#mtodoStudy"),
  mtodoWork: $("#mtodoWork"),
  yearGrid: $("#yearGrid"),
  yearTitle: $("#yearTitle"),
  yearPrev: $("#yearPrev"),
  yearNext: $("#yearNext"),
  halfFirstBtn: $("#halfFirstBtn"),
  halfSecondBtn: $("#halfSecondBtn"),
  colorPicker: $("#colorPicker"),
  colorEventInput: $("#colorEventInput"),
  colorSaveBtn: $("#colorSaveBtn"),
  colorCancelBtn: $("#colorCancelBtn"),
  colorDeleteBtn: $("#colorDeleteBtn"),
  symbolPopover: $("#symbolPopover"),
  installButton: $("#installButton"),
  accessHint: $("#accessHint"),
  settingsButton: $("#settingsButton"),
  settingsOverlay: $("#settingsOverlay"),
  settingsCloseButton: $("#settingsCloseButton"),
  parserSelect: $("#parserSelect"),
  apiKeyField: $("#apiKeyField"),
  apiKeyInput: $("#apiKeyInput"),
  apiKeyHint: $("#apiKeyHint"),
};

/* ================================================================
   Tab switching
   ================================================================ */

const allPanels = {
  inbox: $("#inboxPanel"),
  week: $("#weekPanel"),
  month: $("#monthPanel"),
  year: $("#yearPanel"),
};

$$(".tab-button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    $$(".tab-button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    Object.entries(allPanels).forEach(([k, el]) => { el.hidden = k !== tab; });

    const titles = { inbox: "收件箱", week: "本周", month: "月视图", year: "年视图" };
    dom.pageTitle.textContent = titles[tab] || "";

    if (tab === "inbox") renderInboxHistory();
    if (tab === "week") renderWeek();
    if (tab === "month") { renderMonth(); renderMonthTodos(); initMonthFab(); }
    if (tab === "year") renderYear();
  });
});

/* ================================================================
   Inbox (parse / draft / confirm)
   ================================================================ */

dom.parseButton.addEventListener("click", async () => {
  const text = dom.noticeInput.value.trim();
  if (!text) { dom.noticeInput.focus(); return; }
  try {
    dom.parseButton.disabled = true;
    dom.parseButton.textContent = "解析中…";
    const parser = getActiveParser();
    state.draft = await parser.parse(text);
    renderDraft();
  } catch (err) {
    alert(`解析失败：${err.message}`);
  } finally {
    dom.parseButton.disabled = false;
    dom.parseButton.textContent = "解析";
  }
});

dom.pasteButton.addEventListener("click", async () => {
  if (!navigator.clipboard?.readText) { dom.pasteButton.textContent = "手动粘贴"; return; }
  try { dom.noticeInput.value = await navigator.clipboard.readText(); dom.noticeInput.focus(); }
  catch { dom.pasteButton.textContent = "手动粘贴"; }
});

dom.createButton.addEventListener("click", () => {
  const rows = [...dom.draftList.querySelectorAll(".draft-row")];
  const bullets = rows.map((row) => ({
    id: createId(),
    symbol: row.querySelector(".draft-symbol").value,
    text: row.querySelector(".draft-text").value.trim(),
    dateKey: row.querySelector(".draft-date").value,
    source: state.draft?.source || "",
    createdAt: new Date().toISOString(),
  })).filter((item) => item.text);

  state.bullets.unshift(...bullets);
  saveJson(STORAGE_KEY, state.bullets);
  clearDraft();
  renderWeek();
  renderInboxHistory();
});

dom.ignoreButton.addEventListener("click", clearDraft);

function renderDraft() {
  dom.reviewPanel.hidden = false;
  dom.confidenceBadge.textContent = `${getActiveParser().name} · 像任务 ${state.draft.confidence}%`;
  dom.sourceText.textContent = state.draft.source;
  dom.draftList.replaceChildren();

  state.draft.bullets.forEach((bullet) => {
    const tmpl = document.querySelector("#draftTemplate");
    const node = tmpl.content.firstElementChild.cloneNode(true);
    node.querySelector(".draft-symbol").value = bullet.symbol;
    node.querySelector(".draft-text").value = bullet.text;
    node.querySelector(".draft-date").value = bullet.dateKey;
    node.querySelector(".draft-remove").addEventListener("click", () => {
      node.remove();
      if (!dom.draftList.children.length) clearDraft();
    });
    dom.draftList.append(node);
  });
  dom.reviewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearDraft() {
  state.draft = null;
  dom.reviewPanel.hidden = true;
  dom.noticeInput.value = "";
  dom.draftList.replaceChildren();
}

function renderInboxHistory() {
  const historyList = document.querySelector("#historyList");
  if (!historyList) return;
  historyList.replaceChildren();

  const recent = state.bullets
    .filter((b) => b.source && b.source !== "手动记录")
    .slice(0, 15);

  if (!recent.length) {
    historyList.append(mkEl("p", { className: "empty-state", textContent: "暂无历史。" }));
    return;
  }

  recent.forEach((b) => {
    const item = mkEl("div", { className: "history-item" });
    item.innerHTML = `<span class="hi-symbol">${b.symbol}</span><span class="hi-text">${b.text}</span><span class="hi-date">${formatDateKey(b.dateKey) || "未排期"}</span>`;
    historyList.append(item);
  });
}

/* ================================================================
   Week view
   ================================================================ */

dom.weekPrev.addEventListener("click", () => { state.weekOffset--; renderWeek(); });
dom.weekNext.addEventListener("click", () => { state.weekOffset++; renderWeek(); });

dom.todayCloseButton.addEventListener("click", closeTodaySheet);
dom.todayBackdrop.addEventListener("click", (e) => { if (e.target === dom.todayBackdrop) closeTodaySheet(); });

function closeTodaySheet() {
  dom.todayBackdrop.hidden = true;
  dom.todaySheet.hidden = true;
}

function openTodaySheet(dateKey) {
  state.currentSheetDate = dateKey || todayKey();
  dom.todayBackdrop.hidden = false;
  dom.todaySheet.hidden = false;
  renderTodaySheet(state.currentSheetDate);
}

function getWeekBase() {
  const now = new Date();
  now.setDate(now.getDate() + state.weekOffset * 7);
  const day = now.getDay() || 7;
  return addDays(now, 1 - day);
}

function renderWeek() {
  const base = getWeekBase();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(base, i);
    days.push({
      weekday: `周${"一二三四五六日"[i]}`,
      date,
      key: dateKeyFromDate(date),
    });
  }

  const today = todayKey();
  dom.weekRange.textContent = `${formatMonthDay(days[0].date)} - ${formatMonthDay(days[6].date)}`;
  dom.weekGrid.replaceChildren();

  // 一周待办
  const todoBox = mkEl("section", { className: "week-todo" });
  const todoHdr = mkEl("div", { className: "week-todo-header", innerHTML: "<span>一周待办</span>" });
  const todoBtns = mkEl("div", { className: "week-todo-btns" });
  const todoMigAll = mkEl("button", { className: "week-todo-add", textContent: "→", title: "全部迁到下周" });
  todoMigAll.addEventListener("click", () => {
    const currentWk = dateKeyFromDate(getWeekBase());
    const undone = state.bullets.filter((b) => !b.dateKey && b.symbol !== "×" && (b.weekKey || currentWk) === currentWk);
    if (!undone.length) { alert("没有未完成的待办。"); return; }
    if (!confirm(`把 ${undone.length} 条未完成的待办移到下周？`)) return;
    const nextWk = dateKeyFromDate(addDays(getWeekBase(), 7));
    undone.forEach((b) => { b.weekKey = nextWk; });
    saveJson(STORAGE_KEY, state.bullets);
    renderWeek();
  });
  const todoAdd = mkEl("button", { className: "week-todo-add", textContent: "+", title: "添加" });
  todoAdd.addEventListener("click", () => {
    const txt = prompt("添加一条本周待办：");
    if (txt?.trim()) {
      state.bullets.unshift({ id: createId(), symbol: "•", text: txt.trim(), dateKey: "", weekKey: dateKeyFromDate(getWeekBase()), source: "手动记录", createdAt: new Date().toISOString() });
      saveJson(STORAGE_KEY, state.bullets);
      renderWeek();
    }
  });
  todoBtns.append(todoMigAll, todoAdd);
  todoHdr.append(todoBtns);
  const todoList = mkEl("div", { className: "day-list" });
  const currentWk = dateKeyFromDate(getWeekBase());
  const weekBullets = state.bullets.filter((b) => !b.dateKey && (!b.weekKey || b.weekKey === currentWk));
  if (weekBullets.length) {
    weekBullets.forEach((b) => todoList.append(createBulletNode(b, "compact")));
  } else {
    todoList.append(mkEl("p", { className: "empty-state", textContent: "暂无待办。" }));
  }
  todoBox.append(todoHdr, todoList);
  dom.weekGrid.append(todoBox);

  // 7 天
  days.forEach((day) => {
    const box = mkEl("section", { className: `day-box${day.key === today ? " today" : ""}` });
    const title = mkEl("div", { className: "day-title", innerHTML: `<span>${day.weekday}</span><span>${formatMonthDay(day.date)}</span>` });
    const list = mkEl("div", { className: "day-list" });
    const bullets = state.bullets.filter((b) => b.dateKey === day.key);
    if (bullets.length) {
      bullets.forEach((b) => list.append(createBulletNode(b, "compact")));
    } else {
      list.append(mkEl("p", { className: "empty-state", textContent: " " }));
    }
    box.append(title, list);

    box.addEventListener("click", (e) => {
      if (e.target.closest(".bullet-symbol") || e.target.closest(".bullet-text") || e.target.closest(".delete-button")) return;
      openTodaySheet(day.key);
    });

    dom.weekGrid.append(box);
  });
}

/* ================================================================
   Today sheet
   ================================================================ */

dom.quickAddForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = dom.quickText.value.trim();
  if (!text) { dom.quickText.focus(); return; }
  state.bullets.unshift({
    id: createId(), symbol: dom.quickSymbol.value,
    text, dateKey: state.currentSheetDate, source: "手动记录", createdAt: new Date().toISOString(),
  });
  dom.quickText.value = "";
  saveJson(STORAGE_KEY, state.bullets);
  renderTodaySheet(state.currentSheetDate);
  renderWeek();
});

function renderTodaySheet(dateKey) {
  const dk = dateKey || todayKey();
  const date = new Date(dk + "T00:00:00");
  dom.todayDate.textContent = formatFullDate(date);
  const bullets = state.bullets.filter((b) => b.dateKey === dk);
  dom.todayList.replaceChildren();

  if (!bullets.length) {
    dom.todayList.append(mkEl("p", { className: "empty-state", textContent: "这天还没有子弹。" }));
    return;
  }
  bullets.forEach((b) => dom.todayList.append(createBulletNode(b, "today")));
}

/* ================================================================
   Month view
   ================================================================ */

function getMonthBase() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + state.monthOffset, 1);
}

dom.monthPrev.addEventListener("click", () => { state.monthOffset--; renderMonth(); renderMonthTodos(); });
dom.monthNext.addEventListener("click", () => { state.monthOffset++; renderMonth(); renderMonthTodos(); });


function renderMonth() {
  const base = getMonthBase();
  const year = base.getFullYear();
  const month = base.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();

  dom.monthTitle.textContent = `${month + 1}月 ${year}`;
  dom.monthLayout.replaceChildren();

  const dateCol = mkEl("div", { className: "month-date-col" });
  const taskCol = mkEl("div", { className: "month-task-col" });

  let prevWeek = -1;

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const weekOfMonth = Math.floor((d + firstDow - 1) / 7);
    const dayOfWeek = date.getDay();
    const isWeekDivider = d > 1 && weekOfMonth !== prevWeek;
    prevWeek = weekOfMonth;

    // Date column
    const dateRow = mkEl("div", { className: `month-date-row${isWeekDivider ? " week-divider" : ""}` });
    dateRow.innerHTML = `<span class="date-num">${d}</span><span class="date-dow">${DOWS[dayOfWeek]}</span>`;
    dateCol.append(dateRow);

    // Task column
    const dateKey = toDateKey(year, month + 1, d);
    const dayBullets = state.bullets.filter((b) => b.dateKey === dateKey);
    const dayEvents = state.yearlyEvents.filter((e) => (e.date || e.startDate) === dateKey);
    const taskRow = mkEl("div", { className: `month-task-row${isWeekDivider ? " week-divider" : ""}` });

    if (dayBullets.length) {
      dayBullets.forEach((b) => taskRow.append(createBulletNode(b, "compact")));
    }

    dayEvents.forEach((evt) => {
      const sd = evt.startDate || evt.date;
      const ed = evt.endDate;
      let displayText = evt.text;
      if (ed && ed !== sd) {
        const sdDay = parseInt(sd.split("-")[2]);
        const edDay = parseInt(ed.split("-")[2]);
        const sdMonth = parseInt(sd.split("-")[1]);
        const edMonth = parseInt(ed.split("-")[1]);
        if (sdMonth !== edMonth) {
          displayText = `${evt.text} (${sdMonth}月${sdDay}日-${edMonth}月${edDay}日)`;
        } else {
          displayText = `${evt.text} (${sdDay}日-${edDay}日)`;
        }
      }
      const evtEl = mkEl("div", { className: "month-year-event" });
      const dot = mkEl("div", { className: "ye-dot" });
      dot.style.backgroundColor = evt.color;
      const txt = mkEl("span", { className: "ye-text", textContent: displayText });
      evtEl.append(dot, txt);
      evtEl.addEventListener("click", () => openYearEventPicker(sd, evt));
      taskRow.append(evtEl);
    });

    // + button
    const addBtn = mkEl("button", { className: "month-add-btn", textContent: "+", title: "添加任务" });
    addBtn.addEventListener("click", () => {
      const inp = mkEl("input", { className: "month-inline-input", placeholder: "添加..." });
      taskRow.append(inp);
      inp.focus();
      addBtn.hidden = true;
      inp.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && inp.value.trim()) {
          state.bullets.unshift({
            id: createId(), symbol: "•", text: inp.value.trim(),
            dateKey, source: "手动记录", createdAt: new Date().toISOString(),
          });
          saveJson(STORAGE_KEY, state.bullets);
          renderMonth();
          renderMonthTodos();
        } else if (ev.key === "Escape") {
          inp.remove();
          addBtn.hidden = false;
        }
      });
      inp.addEventListener("blur", () => {
        if (!inp.value.trim()) { inp.remove(); addBtn.hidden = false; }
      });
    });
    taskRow.append(addBtn);

    taskCol.append(taskRow);
  }

  dom.monthLayout.append(dateCol, taskCol);

  // Sync row heights between date column and task column
  const syncHeights = () => {
    const dateRows = dateCol.querySelectorAll(".month-date-row");
    const taskRows = taskCol.querySelectorAll(".month-task-row");
    dateRows.forEach((dr, i) => {
      const tr = taskRows[i];
      if (!tr) return;
      const maxH = Math.max(dr.scrollHeight, tr.scrollHeight);
      dr.style.height = maxH + "px";
      tr.style.height = maxH + "px";
    });
  };
  setTimeout(syncHeights, 0);
  setTimeout(syncHeights, 50);
}

/* Monthly todo panel */

function addMonthTodo(cat, text) {
  state.monthlyTodos.push({
    id: createId(), symbol: "•", text,
    category: cat, month: monthKey(), createdAt: new Date().toISOString(),
  });
  saveJson(MONTHLY_KEY, state.monthlyTodos);
  renderMonthTodos();
}

$$(".month-todo-input").forEach((inp) => {
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && inp.value.trim()) {
      addMonthTodo(inp.dataset.cat, inp.value.trim());
      inp.value = "";
      inp.focus();
    }
  });
});

$$(".mtodo-add-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = btn.parentElement.querySelector(".month-todo-input");
    if (input.value.trim()) {
      addMonthTodo(btn.dataset.cat, input.value.trim());
      input.value = "";
      input.focus();
    }
  });
});

function monthKey() {
  const base = getMonthBase();
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

let monthFabInited = false;
function initMonthFab() {
  if (monthFabInited) return;
  monthFabInited = true;
  const fab = document.querySelector("#monthTodoFab");
  const sidebar = document.querySelector("#monthTodoSidebar");
  if (!fab || !sidebar) return;

  const openFab = () => { sidebar.classList.add("open"); fab.classList.add("hidden"); };
  const closeFab = () => { sidebar.classList.remove("open"); fab.classList.remove("hidden"); };
  fab.addEventListener("click", openFab);
  fab.textContent = "待办 ▲";
  sidebar.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  document.addEventListener("click", (e) => {
    if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && e.target !== fab && !fab.contains(e.target)) {
      closeFab();
    }
  });
}

function renderMonthTodos() {
  const key = monthKey();
  const todos = state.monthlyTodos.filter((t) => t.month === key);

  const cats = { "生活": dom.mtodoLife, "学业": dom.mtodoStudy, "工作": dom.mtodoWork };
  Object.values(cats).forEach((el) => { el.replaceChildren(); });

  todos.forEach((todo) => {
    const catEl = cats[todo.category];
    if (!catEl) return;
    const tmpl = document.querySelector("#monthTodoTemplate");
    const node = tmpl.content.firstElementChild.cloneNode(true);
    const symBtn = node.querySelector(".bullet-symbol");
    const txtInp = node.querySelector(".bullet-text");
    const delBtn = node.querySelector(".delete-button");

    symBtn.textContent = todo.symbol;
    txtInp.value = todo.text;
    node.classList.toggle("done", todo.symbol === "×");

    symBtn.addEventListener("click", () => {
      todo.symbol = todo.symbol === "×" ? "•" : "×";
      saveJson(MONTHLY_KEY, state.monthlyTodos);
      renderMonthTodos();
    });
    txtInp.addEventListener("change", () => {
      todo.text = txtInp.value.trim() || todo.text;
      saveJson(MONTHLY_KEY, state.monthlyTodos);
    });
    delBtn.addEventListener("click", () => {
      state.monthlyTodos = state.monthlyTodos.filter((t) => t.id !== todo.id);
      saveJson(MONTHLY_KEY, state.monthlyTodos);
      renderMonthTodos();
    });
    catEl.append(node);
  });
}

/* ================================================================
   Year view
   ================================================================ */

dom.yearPrev.addEventListener("click", () => { state.viewYear--; renderYear(); });
dom.yearNext.addEventListener("click", () => { state.viewYear++; renderYear(); });

dom.halfFirstBtn.addEventListener("click", () => { state.half = "first"; dom.halfFirstBtn.classList.add("active"); dom.halfSecondBtn.classList.remove("active"); renderYear(); });
dom.halfSecondBtn.addEventListener("click", () => { state.half = "second"; dom.halfSecondBtn.classList.add("active"); dom.halfFirstBtn.classList.remove("active"); renderYear(); });

dom.colorCancelBtn.addEventListener("click", () => { dom.colorPicker.hidden = true; state.pendingYearEvent = null; clearYearSelection(); });
dom.colorDeleteBtn.addEventListener("click", () => {
  if (state.pendingYearEvent?.eventId) {
    state.yearlyEvents = state.yearlyEvents.filter((e) => e.id !== state.pendingYearEvent.eventId);
    saveJson(YEARLY_KEY, state.yearlyEvents);
  }
  dom.colorPicker.hidden = true;
  state.pendingYearEvent = null;
  clearYearSelection();
  renderAll();
});

dom.colorSaveBtn.addEventListener("click", () => {
  const text = dom.colorEventInput.value.trim();
  if (!text || !state.pendingYearEvent) return;
  const { startDate, endDate, color, eventId } = state.pendingYearEvent;

  if (eventId) {
    const evt = state.yearlyEvents.find((e) => e.id === eventId);
    if (evt) { evt.text = text; evt.color = color; evt.startDate = startDate; evt.endDate = endDate; }
  } else {
    state.yearlyEvents.push({ id: createId(), color, text, startDate, endDate: endDate || null, year: state.viewYear });
  }
  saveJson(YEARLY_KEY, state.yearlyEvents);
  dom.colorPicker.hidden = true;
  state.pendingYearEvent = null;
  clearYearSelection();
  renderAll();
});

let yearSelectedStart = null;
function clearYearSelection() { yearSelectedStart = null; }

function getMonthsForHalf() {
  return state.half === "first" ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11];
}

function renderYear() {
  dom.yearTitle.textContent = state.viewYear;
  dom.yearGrid.replaceChildren();

  const months = getMonthsForHalf();

  months.forEach((m) => {
    const card = mkEl("div", { className: "year-month-card" });
    const nameRow = mkEl("div", { className: "year-month-name", textContent: `${m + 1}月` });
    card.append(nameRow);

    // Mini calendar
    const miniCal = mkEl("div", { className: "mini-cal" });
    ["日","一","二","三","四","五","六"].forEach((dh) => {
      miniCal.append(mkEl("div", { className: "mini-day-header", textContent: dh }));
    });

    const daysInMonth = new Date(state.viewYear, m + 1, 0).getDate();
    const firstDow = new Date(state.viewYear, m, 1).getDay();

    for (let i = 0; i < firstDow; i++) {
      miniCal.append(mkEl("div", { className: "mini-day empty" }));
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = toDateKey(state.viewYear, m + 1, d);
      const cell = mkEl("div", { className: "mini-day", textContent: String(d) });
      cell.dataset.date = dateKey;

      // Colored bars for spanning events, dots for single-day
      state.yearlyEvents.forEach((evt) => {
        const sd = evt.startDate || evt.date;
        const ed = evt.endDate || sd;
        if (dateKey < sd || dateKey > ed || evt.year !== state.viewYear) return;

        if (sd === ed) {
          const dot = mkEl("div", { className: "dot" });
          dot.style.backgroundColor = evt.color;
          cell.append(dot);
        } else {
          const bar = mkEl("div", { className: "bar" });
          bar.style.backgroundColor = evt.color;
          if (dateKey === sd && dateKey === ed) bar.classList.add("single");
          else if (dateKey === sd) bar.classList.add("start");
          else if (dateKey === ed) bar.classList.add("end");
          else bar.classList.add("mid");
          cell.append(bar);
        }
      });

      // Highlight selected start
      if (yearSelectedStart && yearSelectedStart === dateKey) {
        cell.classList.add("selected");
      }

      cell.addEventListener("click", () => onYearDayClick(dateKey));
      miniCal.append(cell);
    }

    card.append(miniCal);

    // Events list below calendar
    const eventsList = mkEl("div", { className: "year-events-list" });
    const monthEvents = state.yearlyEvents
      .filter((e) => {
        const sd = e.startDate || e.date;
        const mNum = parseInt(sd.split("-")[1]) - 1;
        return mNum === m && e.year === state.viewYear;
      })
      .sort((a, b) => (a.startDate || a.date).localeCompare(b.startDate || b.date));

    let lastDate = "";
    monthEvents.forEach((evt) => {
      const sd = evt.startDate || evt.date;
      const ed = evt.endDate;
      const sdDay = parseInt(sd.split("-")[2]);
      const isSameDate = sd === lastDate;

      const item = mkEl("div", { className: "year-event-item" });

      let datePrefix = "";
      if (ed && ed !== sd) {
        const edDay = parseInt(ed.split("-")[2]);
        const sdMonth = parseInt(sd.split("-")[1]);
        const edMonth = parseInt(ed.split("-")[1]);
        if (sdMonth !== edMonth) {
          datePrefix = `-${sdMonth}月${sdDay}日-${edMonth}月${edDay}日`;
        } else {
          datePrefix = `-${sdDay}-${edDay}日`;
        }
      } else if (!isSameDate) {
        datePrefix = `-${sdDay}日`;
      }

      const dateSpan = mkEl("span", { className: "year-event-date", textContent: datePrefix });
      const dot = mkEl("div", { className: "year-event-dot" });
      dot.style.backgroundColor = evt.color;
      const txt = mkEl("span", { className: "year-event-text", textContent: evt.text });

      item.append(dateSpan, dot, txt);
      item.addEventListener("click", () => openYearEventPicker(sd, evt));
      eventsList.append(item);
      lastDate = sd;
    });

    card.append(eventsList);
    dom.yearGrid.append(card);
  });
}

function onYearDayClick(dateKey) {
  if (!yearSelectedStart) {
    yearSelectedStart = dateKey;
    renderYear();
    return;
  }

  // Second click — order the dates, then highlight end and open picker
  const savedStart = yearSelectedStart;
  yearSelectedStart = null;
  let s = savedStart, e = dateKey;
  if (e < s) [s, e] = [e, s];

  setTimeout(() => {
    const endCell = document.querySelector(`.mini-day[data-date="${e}"]`);
    if (endCell) endCell.classList.add("selected");
  }, 50);

  setTimeout(() => {
    openYearEventPicker(s, null, e === s ? null : e);
    clearYearSelection();
    renderYear();
  }, 250);
}

function openYearEventPicker(startDate, existingEvent, endDate) {
  dom.colorPicker.hidden = false;
  dom.colorEventInput.value = existingEvent?.text || "";
  dom.colorDeleteBtn.hidden = !existingEvent;

  state.pendingYearEvent = existingEvent
    ? { startDate: existingEvent.startDate || existingEvent.date, endDate: existingEvent.endDate || null, color: existingEvent.color, eventId: existingEvent.id }
    : { startDate, endDate: endDate || null, color: YEAR_COLORS[0] };

  updateColorPickerUI();
}

function updateColorPickerUI() {
  $$(".color-dot").forEach((dot) => {
    dot.classList.toggle("selected", dot.dataset.color === state.pendingYearEvent?.color);
  });
}

$$(".color-dot").forEach((dot) => {
  dot.addEventListener("click", () => {
    if (state.pendingYearEvent) {
      state.pendingYearEvent.color = dot.dataset.color;
      updateColorPickerUI();
    }
  });
});

/* ================================================================
   Migrate with undo
   ================================================================ */

function doMigrate(bullet) {
  const prev = { symbol: bullet.symbol, dateKey: bullet.dateKey };
  bullet.symbol = ">";
  bullet.dateKey = dateKeyFromDate(addDays(new Date(bullet.dateKey + "T00:00:00"), 1));
  saveJson(STORAGE_KEY, state.bullets);

  state.undoAction = { type: "migrate", bullet, prev };
  clearTimeout(state.undoTimer);
  showUndoToast();

  state.undoTimer = setTimeout(() => {
    state.undoAction = null;
    hideUndoToast();
  }, 5000);
}

function undoLastAction() {
  if (!state.undoAction) return;
  const { type, bullet, prev } = state.undoAction;
  if (type === "migrate") {
    bullet.symbol = prev.symbol;
    bullet.dateKey = prev.dateKey;
    saveJson(STORAGE_KEY, state.bullets);
  }
  state.undoAction = null;
  hideUndoToast();
  renderAll();
}

function showUndoToast() {
  const toast = document.querySelector("#undoToast");
  if (!toast) return;
  const span = toast.querySelector("span");
  if (span && state.undoAction) {
    span.textContent = "已迁移到下一天";
  }
  toast.hidden = false;
  toast.style.opacity = "1";
}

function hideUndoToast() {
  const toast = document.querySelector("#undoToast");
  if (!toast) return;
  toast.style.opacity = "0";
  setTimeout(() => { toast.hidden = true; }, 200);
}

/* ================================================================
   Bullet node + Symbol popover
   ================================================================ */

function createBulletNode(bullet, mode) {
  const tmpl = document.querySelector("#bulletTemplate");
  const node = tmpl.content.firstElementChild.cloneNode(true);
  const symBtn = node.querySelector(".bullet-symbol");
  const txtInp = node.querySelector(".bullet-text");
  const meta = node.querySelector(".bullet-meta");
  const migBtn = node.querySelector(".migrate-button");
  const delBtn = node.querySelector(".delete-button");

  node.classList.toggle("done", bullet.symbol === "×");
  node.classList.toggle("shelved", bullet.symbol === "<");
  node.classList.toggle("important", bullet.symbol === "*");
  symBtn.textContent = bullet.symbol;
  txtInp.value = bullet.text;

  if (bullet.dateKey) {
    meta.textContent = [formatDateKey(bullet.dateKey), bullet.source && bullet.source !== "手动记录" ? "来自通知" : ""].filter(Boolean).join(" · ");
  }

  /* Symbol button → popover */
  symBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    state.activePopoverBullet = bullet;
    showSymbolPopover(symBtn);
  });

  txtInp.addEventListener("change", () => {
    bullet.text = txtInp.value.trim() || bullet.text;
    saveJson(STORAGE_KEY, state.bullets);
    renderAll();
  });

  /* Migrate button in today sheet */
  migBtn.addEventListener("click", () => {
    doMigrate(bullet);
    renderAll();
  });

  delBtn.addEventListener("click", () => {
    state.bullets = state.bullets.filter((b) => b.id !== bullet.id);
    saveJson(STORAGE_KEY, state.bullets);
    renderAll();
  });

  // Long press for mobile
  let pressTimer;
  node.addEventListener("touchstart", () => {
    pressTimer = setTimeout(() => { migBtn.style.opacity = "1"; delBtn.style.opacity = "1"; }, 500);
  }, { passive: true });
  node.addEventListener("touchend", () => clearTimeout(pressTimer));
  node.addEventListener("touchmove", () => clearTimeout(pressTimer));

  if (mode === "compact") {
    migBtn.hidden = true;
  }

  return node;
}

/* Symbol popover */

function showSymbolPopover(anchor) {
  const bullet = state.activePopoverBullet;
  const rect = anchor.getBoundingClientRect();

  // Week-todo: show weekday menu instead of symbol menu
  if (bullet && !bullet.dateKey) {
    const weekBase = getWeekBase();
    const weekdays = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    dom.symbolPopover.replaceChildren();
    weekdays.forEach((wd, i) => {
      const date = addDays(weekBase, i);
      const btn = mkEl("button", { className: "symbol-option" });
      btn.textContent = `${wd} ${formatMonthDay(date)}`;
      btn.addEventListener("click", () => {
        bullet.dateKey = dateKeyFromDate(date);
        saveJson(STORAGE_KEY, state.bullets);
        hideSymbolPopover();
        renderAll();
      });
      dom.symbolPopover.append(btn);
    });
    dom.symbolPopover.hidden = false;
    dom.symbolPopover.style.top = `${rect.bottom + 4}px`;
    dom.symbolPopover.style.left = `${Math.min(rect.left, window.innerWidth - 160)}px`;
    return;
  }

  // Default symbol menu
  rebuildSymbolMenu();
  dom.symbolPopover.hidden = false;
  dom.symbolPopover.style.top = `${rect.bottom + 4}px`;
  dom.symbolPopover.style.left = `${Math.min(rect.left, window.innerWidth - 140)}px`;
}

function rebuildSymbolMenu() {
  dom.symbolPopover.replaceChildren();
  [
    { sym: "×", label: "× 完成" },
    { sym: ">", label: "> 迁移" },
    { sym: "<", label: "< 排期" },
    { sym: "–", label: "– 备注" },
    { sym: "*", label: "* 重要" },
    { sym: "•", label: "• 任务" },
  ].forEach(({ sym, label }) => {
    const btn = mkEl("button", { className: "symbol-option" });
    btn.dataset.sym = sym;
    btn.textContent = label;
    btn.addEventListener("click", () => {
      const b = state.activePopoverBullet;
      if (!b) return;
      if (sym === "×") b.symbol = "×";
      else if (sym === ">") {
        doMigrate(b);
      }
      else if (sym === "<") b.symbol = "<";
      else if (sym === "–") b.symbol = "–";
      else if (sym === "*") b.symbol = "*";
      else if (sym === "•") b.symbol = "•";
      saveJson(STORAGE_KEY, state.bullets);
      hideSymbolPopover();
      renderAll();
    });
    dom.symbolPopover.append(btn);
  });
}

function hideSymbolPopover() {
  dom.symbolPopover.hidden = true;
  state.activePopoverBullet = null;
}

rebuildSymbolMenu();

document.addEventListener("click", (e) => {
  if (!dom.symbolPopover.hidden && !dom.symbolPopover.contains(e.target)) {
    hideSymbolPopover();
  }
});

/* ================================================================
   Render helpers
   ================================================================ */

function renderAll() {
  renderWeek();
  if (!dom.todaySheet.hidden) renderTodaySheet(state.currentSheetDate);
  if (!allPanels.month.hidden) { renderMonth(); renderMonthTodos(); }
  if (!allPanels.year.hidden) renderYear();
  if (!allPanels.inbox.hidden) renderInboxHistory();
}

function renderLegend() {
  dom.legendList.replaceChildren();
  SYMBOLS.forEach((item) => {
    const chip = mkEl("span", { className: "legend-chip" });
    chip.innerHTML = `<strong>${item.value}</strong>${item.label}`;
    dom.legendList.append(chip);
  });
}

/* ================================================================
   Settings
   ================================================================ */

function openSettings() {
  dom.parserSelect.value = getActiveParserId();
  dom.apiKeyInput.value = localStorage.getItem("bullet-journal-planner:deepseek-key") || "";
  dom.apiKeyField.hidden = dom.parserSelect.value !== "deepseek";
  dom.settingsOverlay.hidden = false;
  updateApiKeyHint();
}

function closeSettings() { dom.settingsOverlay.hidden = true; }

dom.settingsButton.addEventListener("click", openSettings);
dom.settingsCloseButton.addEventListener("click", closeSettings);
dom.settingsOverlay.addEventListener("click", (e) => { if (e.target === dom.settingsOverlay) closeSettings(); });

dom.parserSelect.addEventListener("change", () => {
  setActiveParserId(dom.parserSelect.value);
  dom.apiKeyField.hidden = dom.parserSelect.value !== "deepseek";
  updateApiKeyHint();
});

dom.apiKeyInput.addEventListener("input", () => {
  localStorage.setItem("bullet-journal-planner:deepseek-key", dom.apiKeyInput.value.trim());
  updateApiKeyHint();
});

function updateApiKeyHint() {
  const key = dom.apiKeyInput.value.trim();
  if (!key) dom.apiKeyHint.textContent = "尚未设置 Key，将无法使用 AI 解析。";
  else if (key.startsWith("sk-")) dom.apiKeyHint.textContent = "Key 已保存。";
  else dom.apiKeyHint.textContent = "Key 格式可能不正确（通常以 sk- 开头）。";
}

/* ================================================================
   PWA
   ================================================================ */

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  dom.installButton.hidden = false;
});

dom.installButton.addEventListener("click", async () => {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "activated") {
          location.reload();
        }
      });
    });
    // Force update check
    reg.update().catch(() => {});
  }).catch(() => {});
}

/* ================================================================
   Storage helpers (localStorage + sync.js cloud)
   ================================================================ */

function loadJson(key) {
  try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : null; }
  catch { return null; }
}

function saveJson(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
  if (typeof queueCloudPush === "function") queueCloudPush();
}

/* localStorage-only (no cloud queue) — used during sync to avoid loop */
function saveJsonLocal(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function migrateLegacy() {
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY)) || [];
    return legacy.map((t) => ({
      id: t.id || createId(), symbol: t.done ? "×" : "•",
      text: t.what || t.title || "未命名", dateKey: todayKey(),
      source: t.note || "", createdAt: t.createdAt || new Date().toISOString(),
    }));
  } catch { return []; }
}

function renderAccessHint() {
  if (!dom.accessHint) return;
  dom.accessHint.textContent =
    location.hostname === "127.0.0.1" || location.hostname === "localhost"
      ? "手机访问请使用电脑的局域网 IP 地址。"
      : window.currentUser
        ? "已登录，多设备用同一账号即可同步数据。"
        : "登录账号即可多设备同步数据。";
}

/* ================================================================
   Init
   ================================================================ */

renderAccessHint();
renderLegend();
renderWeek();
renderInboxHistory();

// Undo button
const undoBtn = document.querySelector("#undoBtn");
if (undoBtn) undoBtn.addEventListener("click", undoLastAction);

// Sync handled by sync.js setupSync() — it calls onSyncConnect on load if syncCode saved
