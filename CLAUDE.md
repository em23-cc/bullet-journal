# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

个人子弹计划 — a single-page PWA that parses class group chat notifications into a bullet-journal task planner. Pure frontend: HTML/CSS/JS, localStorage, Service Worker. No build tools, no backend. Multi-device sync via GitHub Gist.

## Files

| File | Role |
|------|------|
| `index.html` | Shell: 4 tab panels, templates (`#bulletTemplate`, `#draftTemplate`, `#monthTodoTemplate`), settings overlay, symbol popover, login overlay, color picker |
| `app.js` | All UI logic: tab switching, rendering (week/month/year), bullet CRUD, symbol popover, settings, PWA install guide, storage helpers with cloud push hook |
| `sync.js` | Account+password auth + GitHub Gist sync. Login/register with SHA-256 hashing, Gist CRUD, debounced cloud push |
| `parser.js` | Two parsers: rules-based regex parser + DeepSeek AI API parser. `parserRegistry` with `getActiveParser()` |
| `styles.css` | Full stylesheet: Zen Minimal aesthetic, responsive breakpoints (900/560/400px), mobile FAB/sheet patterns |
| `sw.js` | Service Worker: network-first with cache fallback, skipWaiting + clients.claim, force update on new SW activation |
| `manifest.webmanifest` | PWA manifest, `display: standalone`, PNG icons (192+512) |
| `icon-*.png` | App icons: 192×192, 512×512, 180×180 (apple-touch-icon) |

## Storage keys (localStorage)

- `bullet-journal-planner:v2` — main bullet array
- `bullet-journal-planner:monthly-todos` — monthly todo items (3 categories)
- `bullet-journal-planner:yearly-events` — year calendar events with colored spans
- `bullet-journal-planner:parser` — active parser id (`"rules"` or `"deepseek"`)
- `bullet-journal-planner:deepseek-key` — DeepSeek API key
- `bullet-github-token` — GitHub PAT (gist scope only)
- `bullet-username` / `bullet-sync-code` — logged-in user session
- `bullet-data-gist-id` — cached data Gist ID per session

## Data model

**Bullet**: `{ id, symbol, text, dateKey, weekKey?, source, createdAt }`
- `symbol`: `•` task / `×` done / `>` migrated / `<` shelved / `–` note / `*` important
- `weekKey`: for week-scoped todos (no `dateKey`), set to the Monday of their week

**MonthlyTodo**: `{ id, symbol, text, category, month, createdAt }`
- `category`: `"生活"` | `"学业"` | `"工作"`

**YearlyEvent**: `{ id, color, text, startDate, endDate?, year }`
- `color`: one of 6 preset hex colors; supports spanning across multiple days

## Key architecture patterns

- **Tab switching**: 4 bottom tabs (收件箱/周/月/年), each panel toggled via `hidden`. `renderAll()` re-renders all visible panels.
- **Week view**: 3-column CSS grid — first cell is the "week todo" box (weekKey items), remaining 7 cells are day-boxes. Click a day-box opens the "today sheet" (bottom slide-up).
- **Month view**: 2-column layout (date + task) with height sync via `setTimeout`. Right sidebar for monthly todos (3 categories). On mobile, sidebar becomes a floating panel toggled by FAB button.
- **Year view**: 6 month cards per half-year. Mini calendars with colored bars (spanning events) and dots (single-day). Two-click date selection to create events.
- **Symbol popover**: Positioned near the symbol button. For week-todo bullets (no dateKey), shows weekday picker instead of symbol menu. When symbol is `>`, shows "↩ 撤销迁移" option.
- **Sync architecture**: `saveJson(key, data)` writes localStorage then calls `queueCloudPush()` (debounced 1.5s). `saveJsonLocal(key, data)` is localStorage-only — used during sync pull to avoid push loops. On login, `onSyncConnect()` pulls cloud data → merges into state → pushes local if cloud empty.
- **Versioning**: Cache name in `sw.js`, query strings on CSS/JS, version badge in header — all must be bumped together on deploy. Otherwise mobile shows stale cached version.

## Deployment

GitHub Pages at `em23-cc/bullet-journal`. Push to `main` branch:

```
git push origin main
```

After pushing, bump: cache name in `sw.js`, query strings in `index.html` (`?v=N`), version badge text.

## No test suite, no build step

Open `index.html` directly in a browser, or for HTTPS (PWA features):

```
python -m http.server 8080
```
