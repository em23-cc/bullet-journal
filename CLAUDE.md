# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

个人子弹计划 — a single-page PWA that parses class group chat notifications into a bullet-journal task planner. Pure frontend: HTML/CSS/JS, localStorage, Service Worker. No build tools, no backend.

## Files

| File | Role |
|------|------|
| `index.html` | Shell: 4 tab panels, templates (`#bulletTemplate`, `#draftTemplate`, `#monthTodoTemplate`), settings overlay, symbol popover, color picker |
| `app.js` | All UI logic: tab switching, rendering (week/month/year), bullet CRUD, symbol popover, settings, PWA registration, storage helpers |
| `parser.js` | Two parsers: rules-based regex parser + DeepSeek AI API parser. `parserRegistry` with `getActiveParser()` |
| `styles.css` | Full stylesheet: dot-grid background, bullet journal aesthetics, responsive breakpoints (900/560/400px), mobile FAB/sheet patterns |
| `sw.js` | Service Worker: cache-first with network update, skipWaiting + clients.claim |
| `manifest.webmanifest` | PWA manifest, `display: standalone` |

## Storage keys (localStorage)

- `bullet-journal-planner:v2` — main bullet array
- `bullet-journal-planner:monthly-todos` — monthly todo items (3 categories)
- `bullet-journal-planner:yearly-events` — year calendar events with colored spans
- `bullet-journal-planner:parser` — active parser id (`"rules"` or `"deepseek"`)
- `bullet-journal-planner:deepseek-key` — DeepSeek API key

## Data model

**Bullet**: `{ id, symbol, text, dateKey, weekKey?, source, createdAt }`
- `symbol`: `•` task / `×` done / `>` migrated / `<` shelved / `–` note / `*` important
- `weekKey`: for week-scoped todos (no `dateKey`), set to the Monday of their week

**MonthlyTodo**: `{ id, symbol, text, category, month, createdAt }`
- `category`: `"生活"` | `"学业"` | `"工作"`

**YearlyEvent**: `{ id, color, text, startDate, endDate?, year }`
- `color`: one of 6 preset hex colors
- Supports spanning across multiple days

## Key architecture patterns

- **Tab switching**: 4 bottom tabs (收件箱/周/月/年), each panel toggled via `hidden`. `renderAll()` re-renders all visible panels.
- **Week view**: 3-column CSS grid — first cell is the "week todo" box (weekKey items), remaining 7 cells are day-boxes. Click a day-box opens the "today sheet" (bottom slide-up).
- **Month view**: 2-column layout (date + task) with height sync via `setTimeout`. Right sidebar for monthly todos (3 categories). On mobile, sidebar becomes a floating panel toggled by FAB button.
- **Year view**: 6 month cards per half-year. Mini calendars with colored bars (spanning events) and dots (single-day). Two-click date selection to create events.
- **Symbol popover**: Positioned near the symbol button. For week-todo bullets (no dateKey), shows weekday picker instead of symbol menu.
- **Versioning**: Cache name in `sw.js`, query strings on CSS/JS, version badge in header — all must be bumped together on deploy.

## Deployment

GitHub Pages at `em23-cc/bullet-journal`. Push to `main` branch:

```
git push origin main
```

After pushing, bump version numbers: cache name in `sw.js`, query strings in `index.html` (`?v=N`), version badge text. Otherwise mobile will show stale cached version.

## No test suite, no build step

This project has no tests, no bundler, no linter. Open `index.html` directly in a browser, or use a local static server for HTTPS (needed for PWA features). On Windows Git Bash:

```
python -m http.server 8080
```
