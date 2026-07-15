# Daily Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a time-windowed rotating line (mantras / prompts / quotes) in the `#hint` slot — one line per morning (before 5pm) and one per evening (5pm on), deterministic per date+window.

**Architecture:** A new `daily.js` holds the content list (`DAILY_LINES`) and pure selection logic (`windowFor`, `dailyHash`, `lineFor`); `index.html` gains a `renderDailyLine()` that fills the existing `#hint` element on init. No storage, no timer — the line is a pure function of the local date and window, recomputed on page load.

**Tech Stack:** Vanilla JS, no build, no npm. Tests run in the in-page harness (`tests.js`, loaded only under `?test=1`).

**Spec:** `docs/specs/2026-07-15-daily-line-design.md`

## Global Constraints

- All paths relative — must resolve under the `/log-it/` GitHub Pages subpath (`daily.js`, not `/daily.js`).
- No build step, no npm, no external dependencies.
- Test suite must stay green: currently **54 passed, 0 failed** at `index.html?test=1`.
- One-way dependency: `tests.js` may read production globals; `index.html`/`daily.js` must never reference test symbols.
- Commit per task. Do **not** push — pushing deploys to GitHub Pages and only the user authorizes it.
- Work on branch `feature/daily-line` off `Main` (capital M).
- Serve with `python3 -m http.server 8777` from the repo root; the Browser pane blocks `file://`.
- Read harness results via `document.querySelector('pre').textContent` (last line is `N passed, N failed`).

---

### Task 1: `daily.js` — pure selection logic + seed content

**Files:**
- Create: `daily.js`
- Modify: `index.html` (add script tag before the main inline `<script>` at line 606)
- Test: `tests.js`

**Interfaces:**
- Consumes: nothing from the app.
- Produces (globals, used by Tasks 2–3 and by tests):
  - `DAILY_LINES: Array<{text: string, when?: 'am'|'pm', author?: string}>`
  - `windowFor(date: Date): 'am' | 'pm'` — local hour < 17 → `'am'`, else `'pm'`.
  - `dailyHash(s: string): number` — deterministic unsigned 32-bit hash.
  - `lineFor(date: Date, lines): {text, when?, author?} | null` — pool = entries matching the window plus untagged floaters; index = `dailyHash('<y>-<m>-<d>-<window>') % pool.length`; `null` for missing/empty list or empty pool.

- [ ] **Step 1: Write the failing tests**

In `tests.js`, insert immediately before the `runTests();` line (inside the `if (...get('test') === '1')` block):

```js
  // ---- daily line: pure selection logic ----
  // NOTE: Date months are 0-indexed — new Date(2026, 6, 15) is July 15 2026.
  test('windowFor: 16:59 local is am', () => {
    assertEq(windowFor(new Date(2026, 6, 15, 16, 59)), 'am');
  });
  test('windowFor: 17:00 local is pm', () => {
    assertEq(windowFor(new Date(2026, 6, 15, 17, 0)), 'pm');
  });
  test('lineFor: deterministic for the same date + window', () => {
    const lines = [{ text: 'a' }, { text: 'b' }, { text: 'c' }];
    const d = new Date(2026, 6, 15, 9, 0);
    const first = lineFor(d, lines);
    assert(first, 'should pick a line');
    assertEq(lineFor(d, lines), first);
    assertEq(lineFor(new Date(2026, 6, 15, 11, 30), lines), first, 'same window, same pick');
  });
  test('lineFor: am/pm tags confine lines to their window', () => {
    const lines = [{ text: 'M', when: 'am' }, { text: 'E', when: 'pm' }];
    assertEq(lineFor(new Date(2026, 6, 15, 9, 0), lines).text, 'M');
    assertEq(lineFor(new Date(2026, 6, 15, 18, 0), lines).text, 'E');
  });
  test('lineFor: floaters are eligible in both windows', () => {
    const only = [{ text: 'F' }];
    assertEq(lineFor(new Date(2026, 6, 15, 9, 0), only).text, 'F');
    assertEq(lineFor(new Date(2026, 6, 15, 18, 0), only).text, 'F');
  });
  test('lineFor: empty, missing, or drained pool gives null', () => {
    assertEq(lineFor(new Date(), []), null);
    assertEq(lineFor(new Date(), null), null);
    assertEq(lineFor(new Date(2026, 6, 15, 9, 0), [{ text: 'x', when: 'pm' }]), null);
  });
  test('lineFor: picks vary across days (not stuck on one index)', () => {
    const pool = [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }, { text: 'e' }];
    const seen = new Set();
    for (let d = 1; d <= 30; d++) seen.add(lineFor(new Date(2026, 6, d, 9, 0), pool).text);
    assert(seen.size >= 2, '30 days drew ' + seen.size + ' distinct lines');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/pigote/Desktop/log-it && python3 -m http.server 8777
```

Open `http://localhost:8777/index.html?test=1` in the Browser pane; read `document.querySelector('pre').textContent`.
Expected: the 7 new tests FAIL with `windowFor is not defined` / `lineFor is not defined`; footer `54 passed, 7 failed`.

- [ ] **Step 3: Create `daily.js`**

```js
// Log It — daily line: mantras, prompts, and quotes for the #hint slot.
// Pure data + pure selection. index.html renders it; tests.js asserts on it.
//
// Entry shape: { text, when?, author? }
//   when:   'am' (shown before 5pm), 'pm' (5pm on), absent = either window
//   author: attribution line for quotes; absent for mantras/prompts

const DAILY_LINES = [
  // seed set (voice-checked with the user); full list lands in a later task
  { text: 'Begin again.' },
  { text: 'Slow is smooth. Smooth is fast.' },
  { text: 'Do the boring maintenance now.' },
  { text: 'Small rows add up.' },
  { text: 'Done counts.', when: 'pm' },
  { text: 'What are you putting off that takes five minutes?', when: 'am' },
  { text: 'What did today actually cost you?', when: 'pm' },
  { text: 'What went better than you expected?', when: 'pm' },
  { text: 'What would you skip tomorrow if nobody noticed?', when: 'pm' },
  { text: "What's the one thing worth writing down today?", when: 'am' },
  { text: 'You could leave life right now. Let that determine what you do and say and think.', author: 'Marcus Aurelius' },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', author: 'Seneca' },
  { text: 'How we spend our days is, of course, how we spend our lives.', author: 'Annie Dillard', when: 'pm' },
  { text: 'The best time to plant a tree was twenty years ago. The second best time is now.', author: 'proverb', when: 'am' },
  { text: 'What gets measured gets managed.', author: 'Peter Drucker' },
];

// 5pm split: 'am' = midnight-4:59pm (get the day started),
// 'pm' = 5pm-midnight (look back at it). Local time, like the Today view.
function windowFor(date) {
  return date.getHours() < 17 ? 'am' : 'pm';
}

// djb2-xor, unsigned. Hash (not dayOfYear % n) so the same calendar date
// lands differently each year and consecutive days don't walk the list.
function dailyHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function lineFor(date, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const win = windowFor(date);
  const pool = lines.filter((l) => !l.when || l.when === win);
  if (pool.length === 0) return null;
  const key = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate() + '-' + win;
  return pool[dailyHash(key) % pool.length];
}
```

In `index.html`, directly above the main inline `<script>` (line 606, the one followed by the `// CATEGORY DISPLAY CONFIG` banner), add:

```html
<script src="daily.js"></script>
```

(Relative path — same rule as the `tests.js` injection.)

- [ ] **Step 4: Run tests to verify they pass**

Reload `http://localhost:8777/index.html?test=1`.
Expected footer: `61 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add daily.js index.html tests.js
git commit -m "feat: daily-line selection logic (am/pm windows, date-hash pick)"
```

---

### Task 2: Render into the `#hint` slot

**Files:**
- Modify: `index.html` — hint CSS (lines 135–146), hint markup (line 503), new `renderDailyLine()` beside the init block (~line 1111), init call
- Test: `tests.js`

**Interfaces:**
- Consumes: `DAILY_LINES`, `lineFor(date, lines)` from Task 1.
- Produces: `renderDailyLine(deps?: {now?: Date, lines?: Array|null})` — fills `#hint`; `deps` exists for tests (same pattern as `readTodayLogs(deps)`). Renders nothing when there is no line.

- [ ] **Step 1: Write the failing tests**

In `tests.js`, insert immediately after the Task 1 tests (still before `runTests();`):

```js
  // ---- daily line: render ----
  test('renderDailyLine: text only, no attribution element', () => {
    renderDailyLine({ now: new Date(2026, 6, 15, 9, 0), lines: [{ text: 'Begin again.' }] });
    const hint = document.getElementById('hint');
    assertEq(hint.textContent.trim(), 'Begin again.');
    assert(!hint.querySelector('.hint-author'), 'no author element expected');
  });
  test('renderDailyLine: attribution renders when author present', () => {
    renderDailyLine({ now: new Date(2026, 6, 15, 9, 0), lines: [{ text: 'X.', author: 'Seneca' }] });
    const a = document.getElementById('hint').querySelector('.hint-author');
    assert(a, 'author element expected');
    assertEq(a.textContent, '— Seneca');
  });
  test('renderDailyLine: no lines, nothing rendered', () => {
    renderDailyLine({ lines: null });
    assertEq(document.getElementById('hint').textContent, '');
    renderDailyLine(); // restore the real line
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Reload `http://localhost:8777/index.html?test=1`.
Expected: 3 new FAILs with `renderDailyLine is not defined`; footer `61 passed, 3 failed`.

- [ ] **Step 3: Implement**

**(a)** In `index.html`, replace the hint CSS block (the `/* ── HINT ── */` section):

```css
    /* ── HINT (daily line: mantra / prompt / quote) ── */
    #hint {
      font-size: 17px;
      color: var(--dim);
      text-align: center;
      max-width: 340px;
      line-height: 1.45;
      margin-top: -10px;
      margin-bottom: 10px;
      transition: opacity .2s;
    }
    .hint-author {
      font-size: 13px;
      opacity: .75;
      margin-top: 4px;
    }
    #app.text-mode #hint { opacity: 0; pointer-events: none; }
```

(`white-space: nowrap` is deliberately dropped — quotes wrap; `#app` is `align-items: center`, so `max-width` centers itself. The text-mode fade rule is unchanged.)

**(b)** Replace the hint markup:

```html
  <div id="hint"></div>
```

(was `<div id="hint">speak naturally — it figures out the rest</div>` — the static hint retires; if `daily.js` ever fails to load, the slot stays empty and nothing else cares.)

**(c)** Add above the `// INIT` banner in the inline script:

```js
// ================================================================
// DAILY LINE (content + selection live in daily.js)
// ================================================================
function renderDailyLine(deps = {}) {
  const el = document.getElementById('hint');
  if (!el) return;
  const lines = 'lines' in deps
    ? deps.lines
    : (typeof DAILY_LINES !== 'undefined' ? DAILY_LINES : null);
  const line = (typeof lineFor === 'function') ? lineFor(deps.now || new Date(), lines) : null;
  el.textContent = '';
  if (!line) return;
  const t = document.createElement('div');
  t.textContent = line.text;
  el.appendChild(t);
  if (line.author) {
    const a = document.createElement('div');
    a.className = 'hint-author';
    a.textContent = '— ' + line.author;
    el.appendChild(a);
  }
}
```

**(d)** In the init block, after `renderTodayView();` add:

```js
renderDailyLine();
```

- [ ] **Step 4: Run tests to verify they pass**

Reload `http://localhost:8777/index.html?test=1`.
Expected footer: `64 passed, 0 failed`.

- [ ] **Step 5: Eyeball it**

Open `http://localhost:8777/index.html` (no params). Expected: a seed line under the mic (attribution visible if today's pick is a quote); switching to Type fades it out with the rest of the mic cluster; no layout jump against the Voice/Type toggle.

- [ ] **Step 6: Commit**

```bash
git add index.html tests.js
git commit -m "feat: render the daily line in the hint slot"
```

---

### Task 3: Full content + guards + handoff doc

**Files:**
- Modify: `daily.js` (replace the seed `DAILY_LINES` with the full list below — copy it **verbatim**, do not write new lines)
- Modify: `docs/HANDOFF.md`
- Test: `tests.js`

**Interfaces:**
- Consumes: the `DAILY_LINES` shape from Task 1.
- Produces: the shipped content list (100 entries).

- [ ] **Step 1: Write the failing tests**

In `tests.js`, after the Task 2 tests:

```js
  // ---- daily line: content ----
  test('DAILY_LINES: every entry well-formed, no duplicate text', () => {
    assert(Array.isArray(DAILY_LINES), 'DAILY_LINES should be an array');
    const texts = new Set();
    for (const l of DAILY_LINES) {
      assert(typeof l.text === 'string' && l.text.trim().length > 0, 'bad text: ' + JSON.stringify(l));
      assert(l.when === undefined || l.when === 'am' || l.when === 'pm', 'bad when: ' + JSON.stringify(l));
      assert(l.author === undefined || (typeof l.author === 'string' && l.author.length > 0), 'bad author: ' + JSON.stringify(l));
      texts.add(l.text);
    }
    assertEq(texts.size, DAILY_LINES.length, 'duplicate line text');
  });
  test('DAILY_LINES: substantial pools in both windows', () => {
    assert(DAILY_LINES.length >= 90, 'want >= 90 lines, got ' + DAILY_LINES.length);
    const am = DAILY_LINES.filter((l) => !l.when || l.when === 'am').length;
    const pm = DAILY_LINES.filter((l) => !l.when || l.when === 'pm').length;
    assert(am >= 40, 'am pool only ' + am);
    assert(pm >= 40, 'pm pool only ' + pm);
  });
```

- [ ] **Step 2: Run tests to verify the pool test fails**

Reload `http://localhost:8777/index.html?test=1`.
Expected: well-formed test PASSes against the seed list; pool test FAILs (`want >= 90 lines, got 15`); footer `65 passed, 1 failed`.

- [ ] **Step 3: Replace `DAILY_LINES` in `daily.js` with the full list**

Copy verbatim — the voice was reviewed with the user; do not invent replacements:

```js
const DAILY_LINES = [
  // ── mantras: either window ──
  { text: 'Begin again.' },
  { text: 'Slow is smooth. Smooth is fast.' },
  { text: 'Do the boring maintenance now.' },
  { text: 'Small rows add up.' },
  { text: 'One thing at a time.' },
  { text: 'Write it down or lose it.' },
  { text: 'Trust the log, not the memory.' },
  { text: 'Consistency beats intensity.' },
  { text: 'If it matters, it gets measured.' },
  { text: 'Keep the streak boring.' },
  { text: 'Attention is the budget.' },
  { text: 'The system works if you feed it.' },
  { text: 'Momentum is a maintenance item.' },
  { text: 'No zero days.' },
  { text: 'Future you reads this.' },
  { text: 'Log the bad days too.' },
  { text: 'Round numbers are usually lies.' },
  { text: 'When in doubt, note it down.' },
  { text: "You can't improve what you won't look at." },
  { text: 'Boring works.' },
  { text: 'Enough is a number. Find it.' },
  { text: 'Two minutes now or twenty later.' },
  { text: "The car doesn't care how you feel about oil changes." },
  { text: 'Data first, drama later.' },
  { text: 'Guessing is expensive.' },
  { text: 'Show up. Write down. Repeat.' },
  { text: 'Nothing fancy. Just today.' },
  { text: 'Precision is a favor to future you.' },
  { text: 'Ten honest minutes beat an hour of pretending.' },
  { text: 'Name it and it gets smaller.' },
  { text: "If you can't say it in one sentence, you don't know it yet." },
  { text: 'Cheap now or expensive later. Pick one.' },
  { text: 'Most problems are maintenance problems.' },
  { text: 'Simple scales. Clever breaks.' },
  { text: "The note you don't take is the one you'll need." },
  { text: 'A short log beats a long memory.' },

  // ── morning ──
  { text: 'What are you putting off that takes five minutes?', when: 'am' },
  { text: "What's the one thing worth writing down today?", when: 'am' },
  { text: 'What would make today feel like a win by dinner?', when: 'am' },
  { text: "What's today's one non-negotiable?", when: 'am' },
  { text: 'Where does the first hour go?', when: 'am' },
  { text: "What's likely to go sideways today — and what's the plan?", when: 'am' },
  { text: 'What can you set up now that tonight-you will thank you for?', when: 'am' },
  { text: 'If today repeated a hundred times, which habit would win?', when: 'am' },
  { text: "What's worth doing badly today so it exists at all?", when: 'am' },
  { text: 'What deserves your best two hours today?', when: 'am' },
  { text: "What's one thing you can finish — not start — today?", when: 'am' },
  { text: "What's the cheapest upgrade to today's routine?", when: 'am' },
  { text: 'What did yesterday teach you that today can use?', when: 'am' },
  { text: "What's on the list only because it's always been on the list?", when: 'am' },
  { text: 'What are you pretending not to know this morning?', when: 'am' },
  { text: 'Hardest thing first. Coffee optional.', when: 'am' },
  { text: "Start before you're ready.", when: 'am' },
  { text: 'Set the day before it sets you.', when: 'am' },
  { text: 'First entry sets the tone.', when: 'am' },
  { text: 'The best time to plant a tree was twenty years ago. The second best time is now.', author: 'proverb', when: 'am' },
  { text: 'Well begun is half done.', author: 'Aristotle', when: 'am' },
  { text: 'When you arise in the morning, think of what a precious privilege it is to be alive.', author: 'Marcus Aurelius', when: 'am' },
  { text: 'Make each day your masterpiece.', author: 'John Wooden', when: 'am' },
  { text: 'First say to yourself what you would be; and then do what you have to do.', author: 'Epictetus', when: 'am' },

  // ── evening ──
  { text: 'What did today actually cost you?', when: 'pm' },
  { text: 'What went better than you expected?', when: 'pm' },
  { text: 'What would you skip tomorrow if nobody noticed?', when: 'pm' },
  { text: 'What did you do today that deserves a row in the sheet?', when: 'pm' },
  { text: 'What surprised you today?', when: 'pm' },
  { text: "What drained you today that shouldn't have?", when: 'pm' },
  { text: "What's one thing you'd redo about today?", when: 'pm' },
  { text: 'Who made today easier?', when: 'pm' },
  { text: 'What did you almost not log?', when: 'pm' },
  { text: "What's still circling in your head? Park it here.", when: 'pm' },
  { text: 'Did today match the plan — and does that matter?', when: 'pm' },
  { text: "What's tomorrow's first move?", when: 'pm' },
  { text: "What did you spend money on today that you'll forget by Friday?", when: 'pm' },
  { text: 'Which hour of today would you want back?', when: 'pm' },
  { text: 'What worked today? Do it again tomorrow.', when: 'pm' },
  { text: 'Done counts.', when: 'pm' },
  { text: 'Close the day like a tab.', when: 'pm' },
  { text: 'The day is logged. Let it go.', when: 'pm' },
  { text: 'You did what you did. Note it and rest.', when: 'pm' },
  { text: 'Park it on paper, not in your head.', when: 'pm' },
  { text: 'How we spend our days is, of course, how we spend our lives.', author: 'Annie Dillard', when: 'pm' },
  { text: 'Sleep is the best meditation.', author: 'Dalai Lama', when: 'pm' },
  { text: 'Very little is needed to make a happy life.', author: 'Marcus Aurelius', when: 'pm' },

  // ── quotes: either window ──
  { text: 'The impediment to action advances action. What stands in the way becomes the way.', author: 'Marcus Aurelius' },
  { text: 'You could leave life right now. Let that determine what you do and say and think.', author: 'Marcus Aurelius' },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', author: 'Seneca' },
  { text: 'We suffer more often in imagination than in reality.', author: 'Seneca' },
  { text: 'What gets measured gets managed.', author: 'Peter Drucker' },
  { text: 'Little strokes fell great oaks.', author: 'Benjamin Franklin' },
  { text: 'Lost time is never found again.', author: 'Benjamin Franklin' },
  { text: 'Energy and persistence conquer all things.', author: 'Benjamin Franklin' },
  { text: 'Either write something worth reading or do something worth writing.', author: 'Benjamin Franklin' },
  { text: 'Waste no more time arguing what a good man should be. Be one.', author: 'Marcus Aurelius' },
  { text: 'Confine yourself to the present.', author: 'Marcus Aurelius' },
  { text: 'You become what you give your attention to.', author: 'Epictetus' },
  { text: 'He who has a why to live can bear almost any how.', author: 'Friedrich Nietzsche' },
  { text: 'The obstacle is the path.', author: 'Zen proverb' },
  { text: 'No man ever steps in the same river twice.', author: 'Heraclitus' },
  { text: 'Inspiration exists, but it has to find you working.', author: 'Pablo Picasso' },
  { text: 'Nothing is so fatiguing as the eternal hanging on of an uncompleted task.', author: 'William James' },
];
```

(36 floater mantras + 24 morning + 23 evening + 17 floater quotes = 100 entries. Pools: am 77, pm 76.)

- [ ] **Step 4: Run tests to verify they pass**

Reload `http://localhost:8777/index.html?test=1`.
Expected footer: `66 passed, 0 failed`.

- [ ] **Step 5: Update `docs/HANDOFF.md`**

**(a)** In "Session history", append:

```markdown
10. Daily line: the static hint is now a rotating mantra/prompt/quote
    (`daily.js`). Two local-time windows split at 5pm ('am'/'pm' tags;
    untagged lines float into both); pick = hash of date+window, so it
    holds still within a window and rolls at 5pm and midnight. Pure
    `lineFor(date, lines)`; no storage, no timer. `#hint` lost
    `white-space: nowrap` so quotes wrap.
```

**(b)** In "Next steps", delete items 1 and 2 (the 3.8s dedupe shipped as `CONFIRM_DURATION_MS`, and voice capture is now press-and-hold with `continuous = true` — both live as of commit `ee97af6`) and renumber the rest.

**(c)** In the Architecture bullet about the mode toggle morph, change `headings "Tap to log" / "Type to log"` to `headings "Hold to log" / "Type to log"`.

- [ ] **Step 6: Commit**

```bash
git add daily.js tests.js docs/HANDOFF.md
git commit -m "feat: full daily-line content (100 lines) + handoff update"
```

---

## Verification (after all tasks)

1. `http://localhost:8777/index.html?test=1` → `66 passed, 0 failed`.
2. `http://localhost:8777/index.html` → daily line visible under the mic; long quote wraps inside 375px (Browser pane mobile preset); Type mode fades it; Voice mode brings it back.
3. Spot-check the window flip in the console: `lineFor(new Date(2026, 6, 15, 9, 0), DAILY_LINES)` vs `...16, 18, 0...` — different windows, evening line drawn from pm+floaters.
4. Do **not** push. Merge/push happens only when the user says so.
