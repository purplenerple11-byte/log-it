# Today Read-Back View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show today's logs on the main screen as a row of tiny orange squares that expand into a vertical bullet list, sourced from a local `localStorage` mirror written on each successful log.

**Architecture:** Purely additive vanilla JS in `index.html`, namespaced `today*`. A local-mirror data layer (write on success, prune to today, read newest-first) feeds a render layer (tiny squares ⇄ full-width orange rows). Two authorized touches to existing code: one `recordTodayLog(...)` call in the `processEntry` success branch, and switching `#app` from vertically-centered to top-anchored so expansion pushes lower controls down while the mic stays fixed. Verified with the existing `?test=1` in-page harness plus manual browser checks.

**Tech Stack:** Vanilla HTML/CSS/JS, single file, no build/npm/test-runner. Tests run in-browser via `?test=1`, served by `python3 -m http.server` and driven in the Browser pane. Reuses existing `CAT_UI`, `catKey`, `LS`.

## Global Constraints

- Single file: `index.html`. No new files, no dependencies, no build step, no server changes.
- localStorage key: `today_logs`.
- Entry shape: `{ ts:<epoch ms>, day:"<local YYYY-MM-DD>", category, sub_route, message, text }`.
- Icons/labels derived at render via existing `CAT_UI[catKey(category, sub_route)]` — never stored.
- Prune to today's local day on every write (this is the midnight reset — no timer).
- Collapsed square: 15×15px, 4px radius, solid `var(--action)` (#cc785c), 7px gap.
- Expanded row: full-width, 14px radius, `var(--action)`, ~58px tall; shows emoji + label + summary(`message`) + time (`h:mm AM/PM`), newest first.
- Empty (0 logs today): `#today-section` is `display:none` — main screen unchanged.
- Tap toggles expand/collapse only — no per-row action, edit, or delete.
- Do-not-touch: no change to `#status`, `#mic-wrap`, `#mic-btn`, `.pulse`, `#hint`, `#mode-toggle`/`.mode-btn`, `#transcript`, `#text-wrap`/`#text-input`, `#confirm-card`, `#fail-card`, `#gear-btn`, CSS variables, or existing JS behavior — apart from the two authorized touches (the `recordTodayLog` call and the `#app` alignment/padding change).
- Use `innerHTML` only with values passed through `escapeHtml`.

**Verification model (every "Run test" step):** from the repo root start `python3 -m http.server 8777` (once), then open `http://localhost:8777/index.html?test=1` in a browser and read the rendered PASS/FAIL report. Reload after each edit. No CLI test runner exists.

---

## File Structure

- **Modify:** `index.html` only.
  - New JS (data + render layers, helpers) inside the existing `<script>`.
  - New CSS block appended before `</style>`.
  - New markup inserted after `#mic-wrap` (index.html:395), before `#hint` (index.html:397).
  - Existing-code edits: `#app` rule (index.html:38-46); one line after `showConfirm(...)` (index.html:735); init hooks in the INIT section.

Layer responsibilities:
- **Helpers** (pure): `localDayStamp`, `pruneToToday`, `formatLogTime`, `escapeHtml`.
- **Data layer**: `recordTodayLog` (write+prune+trigger render), `readTodayLogs` (today, newest-first, defensive).
- **Render layer**: `renderTodayView`, `renderLogBox`, `toggleTodayExpanded`.

---

## Task 1: Pure helpers

**Files:** Modify `index.html` (add helpers near the top of the logic section, after the `LS` block ~line 476).

**Interfaces:**
- Consumes: nothing.
- Produces: `localDayStamp(ts)->"YYYY-MM-DD"`, `pruneToToday(entries, now)->entries`, `formatLogTime(ts)->"h:mm AM/PM"`, `escapeHtml(s)->string`.

- [ ] **Step 1: Write the failing tests**

Add to the `?test=1` registration block, immediately before `runTests();` (index.html end-of-script):

```javascript
  test('localDayStamp: formats local Y-M-D', () => {
    const ts = new Date(2026, 6, 14, 9, 5).getTime();
    assertEq(localDayStamp(ts), '2026-07-14');
  });
  test('pruneToToday: keeps only today', () => {
    const now = new Date(2026, 6, 14, 9, 5).getTime();
    const kept = pruneToToday([
      { ts: now, day: '2026-07-14' },
      { ts: 1, day: '2000-01-01' }
    ], now);
    assertEq(kept.length, 1);
    assertEq(kept[0].day, '2026-07-14');
  });
  test('formatLogTime: morning', () => {
    assertEq(formatLogTime(new Date(2026,6,14,9,5).getTime()), '9:05 AM');
  });
  test('formatLogTime: afternoon', () => {
    assertEq(formatLogTime(new Date(2026,6,14,14,30).getTime()), '2:30 PM');
  });
  test('formatLogTime: midnight', () => {
    assertEq(formatLogTime(new Date(2026,6,14,0,0).getTime()), '12:00 AM');
  });
  test('formatLogTime: noon', () => {
    assertEq(formatLogTime(new Date(2026,6,14,12,0).getTime()), '12:00 PM');
  });
  test('escapeHtml: escapes markup chars', () => {
    assertEq(escapeHtml('<b>&"x'), '&lt;b&gt;&amp;&quot;x');
  });
```

- [ ] **Step 2: Run to verify FAIL**

Open `http://localhost:8777/index.html?test=1`.
Expected: the 7 new tests FAIL with "localDayStamp is not defined" etc.

- [ ] **Step 3: Implement the helpers**

Add after the `LS` block (index.html ~line 476):

```javascript
// ================================================================
// TODAY VIEW — PURE HELPERS
// ================================================================
const TODAY_KEY = 'today_logs';

function localDayStamp(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function pruneToToday(entries, now) {
  const today = localDayStamp(now);
  return entries.filter(e => e && e.day === today);
}

function formatLogTime(ts) {
  const d = new Date(ts);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return h + ':' + m + ' ' + ampm;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
```

- [ ] **Step 4: Run to verify PASS**

Open `?test=1`. Expected: the 7 new tests PASS; footer `33 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add Today-view pure helpers (day stamp, prune, time, escape)"
```

---

## Task 2: Data layer (record + read)

**Files:** Modify `index.html` (add below the helpers).

**Interfaces:**
- Consumes: `TODAY_KEY`, `localDayStamp`, `pruneToToday`, `LS`.
- Produces:
  - `readTodayLogs(deps={})->entries` — today only, newest-first; `deps.get(key)` (default `LS.get`), `deps.now` (default `Date.now()`); tolerates malformed/non-array JSON.
  - `recordTodayLog(category, sub_route, message, text, deps={})->entries` — appends, prunes to today, persists via `deps.set` (default `LS.set`), then calls `renderTodayView(deps)` if it exists.

- [ ] **Step 1: Write the failing tests**

Add to the `?test=1` block before `runTests();`:

```javascript
  function fakeStore(seed) {
    const mem = { [TODAY_KEY]: seed === undefined ? '' : seed };
    return { get: (k) => mem[k] || '', set: (k, v) => { mem[k] = v; }, mem };
  }
  test('recordTodayLog: appends an entry', () => {
    const now = new Date(2026,6,14,9,5).getTime();
    const s = fakeStore();
    recordTodayLog('grocery', '', 'Milk logged.', 'buy milk', { get: s.get, set: s.set, now });
    const logs = readTodayLogs({ get: s.get, now });
    assertEq(logs.length, 1);
    assertEq(logs[0].category, 'grocery');
    assertEq(logs[0].message, 'Milk logged.');
  });
  test('recordTodayLog: prunes previous-day entries', () => {
    const now = new Date(2026,6,14,9,5).getTime();
    const s = fakeStore(JSON.stringify([{ ts: 1, day: '2000-01-01', category: 'x' }]));
    recordTodayLog('meal', '', 'Lunch.', 'lunch', { get: s.get, set: s.set, now });
    const logs = readTodayLogs({ get: s.get, now });
    assertEq(logs.length, 1);
    assertEq(logs[0].category, 'meal');
  });
  test('readTodayLogs: newest first', () => {
    const now = new Date(2026,6,14,9,5).getTime();
    const s = fakeStore();
    recordTodayLog('a', '', 'first', 't1', { get: s.get, set: s.set, now });
    recordTodayLog('b', '', 'second', 't2', { get: s.get, set: s.set, now: now + 1000 });
    const logs = readTodayLogs({ get: s.get, now: now + 2000 });
    assertEq(logs[0].message, 'second');
  });
  test('readTodayLogs: malformed JSON returns empty', () => {
    const s = fakeStore('not json{');
    assertEq(readTodayLogs({ get: s.get, now: Date.now() }).length, 0);
  });
```

- [ ] **Step 2: Run to verify FAIL**

Open `?test=1`. Expected: the 4 new tests FAIL with "recordTodayLog is not defined" / "readTodayLogs is not defined".

- [ ] **Step 3: Implement the data layer**

Add below the helpers:

```javascript
// ================================================================
// TODAY VIEW — DATA LAYER (local mirror)
// ================================================================
function readTodayLogs(deps = {}) {
  const get = deps.get || LS.get;
  const now = deps.now || Date.now();
  let arr = [];
  try { const raw = get(TODAY_KEY); arr = raw ? JSON.parse(raw) : []; } catch { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  const today = pruneToToday(arr, now).filter(e => e && typeof e.ts === 'number');
  today.sort((a, b) => b.ts - a.ts);
  return today;
}

function recordTodayLog(category, sub_route, message, text, deps = {}) {
  const now = deps.now || Date.now();
  const get = deps.get || LS.get;
  const set = deps.set || LS.set;
  let arr = [];
  try { const raw = get(TODAY_KEY); arr = raw ? JSON.parse(raw) : []; } catch { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  arr.push({ ts: now, day: localDayStamp(now), category, sub_route, message, text });
  arr = pruneToToday(arr, now);
  try { set(TODAY_KEY, JSON.stringify(arr)); } catch {}
  if (typeof renderTodayView === 'function') renderTodayView(deps);
  return arr;
}
```

- [ ] **Step 4: Run to verify PASS**

Open `?test=1`. Expected: the 4 new tests PASS; footer `37 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add Today-view data layer (record/read local mirror)"
```

---

## Task 3: Render layer (markup, CSS, render/toggle)

**Files:** Modify `index.html` — add CSS before `</style>`; add markup after `#mic-wrap`; add JS below the data layer; add init hooks.

**Interfaces:**
- Consumes: `readTodayLogs`, `CAT_UI`, `catKey`, `formatLogTime`, `escapeHtml`.
- Produces: `renderTodayView(deps={})`, `renderLogBox(entry)->htmlString`, `toggleTodayExpanded()`.

- [ ] **Step 1: Write the failing tests**

Add to the `?test=1` block before `runTests();`:

```javascript
  test('renderTodayView: renders one box per entry and shows section', () => {
    const now = new Date(2026,6,14,9,5).getTime();
    const s = fakeStore(JSON.stringify([
      { ts: now, day: '2026-07-14', category: 'grocery', sub_route: '', message: 'Milk logged.', text: 'm' },
      { ts: now - 1000, day: '2026-07-14', category: 'meal', sub_route: '', message: 'Lunch.', text: 'l' }
    ]));
    renderTodayView({ get: s.get, now });
    assertEq(document.getElementById('today-row').children.length, 2);
    assert(document.getElementById('today-section').style.display !== 'none', 'section visible');
  });
  test('renderTodayView: empty hides the section', () => {
    const s = fakeStore('[]');
    renderTodayView({ get: s.get, now: Date.now() });
    assertEq(document.getElementById('today-section').style.display, 'none');
  });
  test('toggleTodayExpanded: toggles expanded class', () => {
    const row = document.getElementById('today-row');
    row.classList.remove('expanded');
    toggleTodayExpanded();
    assert(row.classList.contains('expanded'), 'should expand');
    toggleTodayExpanded();
    assert(!row.classList.contains('expanded'), 'should collapse');
  });
  test('renderLogBox: contains label, time, escaped message', () => {
    const html = renderLogBox({ ts: new Date(2026,6,14,9,5).getTime(), category: 'grocery', sub_route: '', message: 'x <b>' });
    assert(html.indexOf('Grocery') !== -1, 'has label');
    assert(html.indexOf('9:05 AM') !== -1, 'has time');
    assert(html.indexOf('&lt;b&gt;') !== -1, 'escaped message');
  });
```

- [ ] **Step 2: Run to verify FAIL**

Open `?test=1`. Expected: the 4 new tests FAIL ("renderTodayView is not defined", or null element errors because the markup/functions don't exist yet).

- [ ] **Step 3: Add the CSS**

Insert immediately before the closing `</style>` tag:

```css
    /* ── TODAY VIEW ── */
    #today-section { width: 100%; max-width: 340px; }
    #today-row {
      display: flex; flex-direction: row; flex-wrap: wrap;
      justify-content: center; align-content: flex-start;
      gap: 7px; cursor: pointer; user-select: none;
    }
    .today-box {
      background: var(--action);
      border-radius: 4px;
      width: 15px; height: 15px; flex: 0 0 15px;
      display: flex; align-items: center; justify-content: flex-start;
      overflow: hidden;
      transition: width .3s cubic-bezier(.4,0,.2,1), height .3s cubic-bezier(.4,0,.2,1),
                  flex-basis .3s cubic-bezier(.4,0,.2,1), border-radius .28s ease,
                  padding .28s ease, box-shadow .28s ease;
    }
    #today-row.expanded .today-box {
      width: 100%; flex-basis: 100%; height: 58px;
      border-radius: 14px; padding: 0 14px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    }
    #today-row.expanded .today-box:nth-child(1) { transition-delay: 0ms; }
    #today-row.expanded .today-box:nth-child(2) { transition-delay: 70ms; }
    #today-row.expanded .today-box:nth-child(3) { transition-delay: 140ms; }
    #today-row.expanded .today-box:nth-child(n+4) { transition-delay: 200ms; }
    .today-emoji {
      font-size: 22px; flex-shrink: 0; width: 0; opacity: 0; overflow: hidden;
      transition: opacity .16s ease, width .2s ease, margin .2s ease;
    }
    #today-row.expanded .today-emoji { opacity: 1; width: auto; margin-right: 10px; transition-delay: 150ms; }
    .today-details { opacity: 0; width: 0; flex: 0; overflow: hidden; white-space: nowrap; transition: opacity .16s ease; }
    #today-row.expanded .today-details { opacity: 1; width: auto; flex: 1; white-space: normal; transition: opacity .2s ease; transition-delay: 150ms; }
    .today-label-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .today-label { color: #fff; font-weight: 600; font-size: 14px; }
    .today-time { color: rgba(255,255,255,0.7); font-size: 11.5px; flex-shrink: 0; white-space: nowrap; }
    .today-summary { color: rgba(255,255,255,0.9); font-size: 12.5px; margin-top: 2px; }
    #today-hint { text-align: center; color: var(--dim); font-size: 12px; margin-top: 10px; }
```

- [ ] **Step 4: Add the markup**

Insert after the `#mic-wrap` closing `</div>` (index.html:395), before `<div id="hint">`:

```html
  <div id="today-section" style="display:none">
    <div id="today-row" role="button" tabindex="0" aria-expanded="false"
         aria-label="Today's logs" onclick="toggleTodayExpanded()"></div>
    <div id="today-hint">tap to see today</div>
  </div>
```

- [ ] **Step 5: Implement the render layer**

Add below the data layer:

```javascript
// ================================================================
// TODAY VIEW — RENDER LAYER
// ================================================================
function renderLogBox(entry) {
  const key = catKey(entry.category, entry.sub_route);
  const cfg = CAT_UI[key] || { icon: '•', label: entry.category || 'Log' };
  const time = formatLogTime(entry.ts);
  return '<div class="today-box">' +
      '<span class="today-emoji">' + cfg.icon + '</span>' +
      '<div class="today-details">' +
        '<div class="today-label-row">' +
          '<span class="today-label">' + escapeHtml(cfg.label) + '</span>' +
          '<span class="today-time">' + time + '</span>' +
        '</div>' +
        '<div class="today-summary">' + escapeHtml(entry.message || '') + '</div>' +
      '</div>' +
    '</div>';
}

function renderTodayView(deps = {}) {
  const section = document.getElementById('today-section');
  const row = document.getElementById('today-row');
  if (!section || !row) return;
  const logs = readTodayLogs(deps);
  if (logs.length === 0) {
    section.style.display = 'none';
    row.classList.remove('expanded');
    row.innerHTML = '';
    return;
  }
  section.style.display = '';
  row.innerHTML = logs.map(renderLogBox).join('');
}

function toggleTodayExpanded() {
  const row = document.getElementById('today-row');
  if (!row) return;
  const expanded = row.classList.toggle('expanded');
  row.setAttribute('aria-expanded', String(expanded));
  const hint = document.getElementById('today-hint');
  if (hint) hint.textContent = expanded ? 'tap to collapse' : 'tap to see today';
}
```

- [ ] **Step 6: Add init hooks**

In the INIT section (after `loadConfig();`, index.html ~line 745), add:

```javascript
renderTodayView();
document.getElementById('today-row').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTodayExpanded(); }
});
```

- [ ] **Step 7: Run to verify PASS**

Open `?test=1`. Expected: the 4 new tests PASS; footer `41 passed, 0 failed`.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: add Today-view render layer (squares <-> bullet rows) + markup/CSS"
```

---

## Task 4: Wire into logging + top-anchor layout + manual verification

**Files:** Modify `index.html` — one line in `processEntry` success branch; the `#app` rule.

**Interfaces:**
- Consumes: `recordTodayLog`.
- Produces: live feature (successful logs appear; layout pushes down).

- [ ] **Step 1: Wire recordTodayLog into the success branch**

In `processEntry`, immediately after `showConfirm(result.category, result.sub_route, result.message);` (index.html:735), add:

```javascript
    recordTodayLog(result.category, result.sub_route, result.message, text);
```

- [ ] **Step 2: Top-anchor the layout (Option B)**

In the `#app` rule (index.html:38-46), change these two lines:

```css
      justify-content: center;
      padding: 32px 24px;
```

to:

```css
      justify-content: flex-start;
      padding: 8vh 24px 40px;
```

Leave `display`, `flex-direction`, `align-items`, `min-height`, and `gap` unchanged.

- [ ] **Step 3: Confirm the full unit suite still passes**

Open `http://localhost:8777/index.html?test=1`.
Expected: `41 passed, 0 failed` (Feature #1's 26 + this feature's 15).

- [ ] **Step 4: Manual verification in the real UI**

Open `http://localhost:8777/index.html?mock=success`. In Settings, ensure any non-empty router URL is saved (the mock intercepts before real network). Then:

| Action | Expected |
|---|---|
| Note the mic's vertical position (screenshot) | baseline |
| Type mode → enter `test one` → Log It | Confirm card shows; **one** orange 15px square appears under the mic; `#today-section` visible |
| Enter `test two` → Log It | **two** squares now |
| Tap the squares | Squares expand into two full-width orange rows (emoji + label + summary + time), newest first; the Voice/Type toggle + input are **pushed down**; the **mic does not move** (compare to baseline screenshot) |
| Tap again | Collapses back to two small squares |
| Reload the page (no params) | The two squares are still there (persisted); app renders top-anchored; no `?test` UI |

Record each row's result. All must pass, especially "mic does not move".

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: record logs to Today view + top-anchor layout for push-down expand"
```

---

## Task 5: Finalize

- [ ] **Step 1: Production smoke (no dev params)**

Open `http://localhost:8777/index.html`. Confirm: top-anchored layout looks clean; if `today_logs` has today's entries they show as squares, else nothing (section hidden); no `?test`/`?mock` artifacts; logging still works end-to-end via the mock or a real router.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feature/today-view
```

- [ ] **Step 3: Report** the commit list and the manual-verification table to the user, and ask whether to merge to `Main` (per finishing-a-development-branch).

---

## Self-Review

**Spec coverage:**
- Local mirror on success → Task 2 (`recordTodayLog`) + Task 4 (wire-in). ✅
- Entry shape / `today_logs` key / derive icon+label from `CAT_UI`+`catKey` → Tasks 2 + 3. ✅
- Prune to today = midnight reset → Task 1 (`pruneToToday`) used in Task 2. ✅
- Tiny orange squares ⇄ full-width orange bullet rows, newest first, time `h:mm AM/PM` → Tasks 1 + 3. ✅
- Empty state hides section → Task 3 (`renderTodayView`). ✅
- Tap toggles only → Task 3 (`toggleTodayExpanded`); no other handlers added. ✅
- Option B push-down, mic fixed → Task 4 (`#app` top-anchor) + manual check. ✅
- Do-not-touch boundary (only two authorized edits) → Task 4 Steps 1–2 are the only existing-code changes; everything else is additive. ✅
- localStorage-unavailable tolerance → `readTodayLogs`/`recordTodayLog` try/catch (Task 2); malformed-JSON test. ✅
- `innerHTML` only via `escapeHtml` → Task 1 + Task 3 (`renderLogBox`). ✅
- Reuse `?test=1` harness → all tasks. ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code. ✅

**Type consistency:** `TODAY_KEY`, `localDayStamp`, `pruneToToday`, `formatLogTime`, `escapeHtml`, `readTodayLogs(deps)`, `recordTodayLog(category, sub_route, message, text, deps)`, `renderTodayView(deps)`, `renderLogBox(entry)`, `toggleTodayExpanded()`, markup ids `today-section`/`today-row`/`today-hint`, classes `today-box`/`today-emoji`/`today-details`/`today-label-row`/`today-label`/`today-time`/`today-summary` — used consistently across tasks. ✅

**Test count ledger:** start 26 (Feature #1) → +7 (T1) = 33 → +4 (T2) = 37 → +4 (T3) = 41. Matches Task 4 Step 3. ✅
