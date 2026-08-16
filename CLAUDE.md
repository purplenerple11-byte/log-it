# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`docs/HANDOFF.md` is the living state-of-the-project doc — session history, what's shipped, and the
prioritized backlog. Read it after this file. This file covers what stays true between sessions.

## Commands

There is no build, no npm, no lint, and no CLI test runner. Everything is browser-driven.

```bash
python3 -m http.server 8777        # serve the repo root; open http://localhost:8777/index.html
python3 tools/make-icons.py        # regenerate icons/ (stdlib only, by design)
```

- **Seeing the read pages without a deploy:** `shifts.html?mock=1` / `ideas.html?mock=1` load the
  real server modules and run the actual sheet rows in `mockSheet.js` through them, so the whole
  read pipeline is exercised with no Apps Script publish and no token. Writes are simulated
  locally and say so. Both are inert without the URL param.
- **Tests:** open `index.html?test=1`. The harness hides the app, runs everything, and appends a
  `<pre>` with PASS/FAIL lines and a `N passed, N failed` footer. Read it via
  `document.querySelector('pre').textContent`. Must stay green; new features add tests to `tests.js`.
- **Running a single test:** not supported — the harness runs all registered tests, all-or-nothing.
  To isolate one, temporarily comment out the others' `test(...)` registrations.
- **Manual/mock runs:** `?mock=<success|server|http4xx|http5xx|network|timeout>` fakes the router
  inside the real UI (set any non-empty `router_url` in localStorage first). `&to=<ms>` shortens the
  30s timeout. Both dev switches are inert without their URL params.
- The Browser pane blocks `file://` — always go through the local HTTP server.

## Architecture

A single-user, phone-first PWA that turns raw voice/text into structured rows across per-domain
Google Sheets. Live at `purplenerple11-byte.github.io/log-it/` via GitHub Pages. Default branch is
**`Main`** (capital M) — pushing to it deploys.

```
index.html (PWA, GitHub Pages)
  → fetch POST text/plain          # text/plain deliberately avoids a CORS preflight
    → Apps Script Web App          # source of truth in repo: server/routerWebApp.gs
      → Gemini API                 # SYSTEM_PROMPT via systemInstruction, JSON response mode
                                   # chain: gemini-3.1-flash-lite → gemini-3.5-flash (1 attempt each)
      → SpreadsheetApp             # writes to per-category sheets
    ← {success, category, sub_route, message}
  ← confirmation card
```

The logging path is six files: `index.html` (~1260 lines, app + styles + logic, no framework),
`daily.js` (the daily line's content list + pure selectors — production, loaded on every page view),
`tests.js` (harness, injected only under `?test=1`), `server/routerWebApp.gs` (the router), and two
pure server modules pasted into Apps Script as additional files and pulled into the browser only
under `?test=1` so they can be tested: `server/tipRouting.js` (→ `tipRouting.gs`, tip-tab routing)
and `server/trackPay.js` (→ `trackPay.gs`, Track wage + withholding).

The **read pages** (v4.8) sit alongside it and share nothing but `theme.css` and the router URL:
`shifts.html` + `shiftStats.js`, `ideas.html` + `ideaModel.js`, both on `dataClient.js`, plus two
more server modules `server/readApi.js` (→ `readApi.gs`) and `server/sheetWrite.js`
(→ `sheetWrite.gs`). `mockSheet.js` is a dev fixture holding the real sheet rows, loaded only
under `?mock=1`.

### Invariants — these are load-bearing, don't undo them

- **Duplicate safety comes from the request id, NOT from timing.** This file used to claim the
  server's worst case was "~5-9s" and that the gap to the client's 15s timeout was the only reason
  retries were duplicate-safe. **That was wrong.** The execution log shows a 16.3s run on
  2026-07-27 that wrote its row *after* the client had already given up and retried — two rows for
  one entry — plus historical runs of 268s / 107s / 82s. No client timeout is high enough to rely
  on. What actually protects us (v4.6): the client sends a `request_id` that stays constant across
  its automatic retries *and* the Retry button, and `doPost` holds the **script lock for the whole
  request** while checking a `CacheService` entry keyed on that id. The lock must span the sheet
  write, not just the cache read — a retry starts *before* the original writes, so an unlocked
  check sees nothing. Only successes are cached, so a genuinely failed request stays retryable.
  Tests assert this ordering against the `.gs` source. Client timeout is now 30s, which merely
  stops ordinary slow runs from retrying at all.
- Still true: never add server-side retries or sleeps back into the `.gs` — that's the bug v4.2
  fixed (up to 18 Gemini calls + duplicate rows). Keeping the server fast is worth doing; it just
  isn't what makes retries safe.
- **Appended Track rows must have their number formats stamped** (`formatTrackRow`). The Track tab
  is a Sheets *Table*; a row appended past the table's managed range inherits whatever formatting
  the cells carried, and one row came out with every number rendered as a 1900-era date (9.27 →
  "1/8/1900 6:28:48"). The values were fine, the formats were not.
- **Tip tab routing is code, never the prompt.** Gemini returns *facts* for a tip entry
  (`venue`, `clock_in`/`clock_out` as 24h `HH:MM`, `hours`, `tips`); `routeTip()` in
  `server/tipRouting.js` picks Track vs Susans and `shiftHours()` derives the length. The old
  prompt offered two tip schemas and only the Susans one had clock fields, so an entry phrased
  as an in/out pair routed to Susans no matter what the written rules said — and since that
  schema has no `tips` field, the tip amount was silently dropped and a bogus hours × $20 row
  written. **Never give the model a per-tab output shape again.** Order: explicit venue →
  tips (Track-only; Susans is flat $20/hr) → clock-in before noon → Track by default.
- **Track pay is calibrated, not derived — and a shift is taxed by its week.** The withholding
  model in `server/trackPay.js` was reverse-engineered from two real paystubs (weeks ending
  7/5 and 7/19/2026) and reproduces both to the penny; `tests.js` locks that in. FICA/Medicare/
  NY-PFL are flat rates, NY disability is **$0.60 flat per week** (not a rate), and federal is
  the real 2026 percentage method (Single, step-2 unchecked, $16,100 standard deduction). **NY
  State is a line fitted to two points** because NY's actual withholding tables are piecewise —
  the published brackets miss by $0.22-$0.35/week. Re-fit against a fresh stub after any raise,
  filing-status change, or new tax year; `TRACK_WAGE_RATE` also needs editing on a raise.
  Withholding is progressive and assessed weekly, so a shift's net is its **incremental**
  contribution to the Mon-Sun pay week — which means `handleTip` must sum the week's existing
  Track hours **before** appending the new row, or the shift counts itself. **The pay week comes
  from the day the shift HAPPENED, not the day it was logged** (v4.7): Gemini fills `shift_date`
  when the entry names a day ("yesterday", "Sunday", "Aug 2"), `resolveShiftDate` in
  `server/tipRouting.js` validates it, and the row is stamped with that date so `sumTrackHours`
  buckets it correctly. Logging Sunday's shift on Wednesday used to treat it as a fresh week and
  overstate the net by ~$23. `resolveShiftDate` is all guard — it rejects anything that is not an
  exact `YYYY-MM-DD`, is not a real calendar date, is in the future, or is older than 45 days, and
  falls back to today, because a wrong date misfiles the shift silently. Back-dated shifts are
  echoed on the confirmation card ("logged for Sun Aug 2") so a misread day is visible.
  Meal/idea/car still use the log time; only tip entries carry a shift date. Taxing a shift in
  isolation understates withholding by ~$20/shift; a test guards against collapsing to that.
  Track columns are `A-E` as before plus `F Gross Wage | G Est. Net Wage | H Total Take-Home |
  I Eff. $/hr`. It's an estimate for planning, not a tax document.
- **Source-inspecting tests must fetch through `fetchText`/`fetchJson`.** They append a
  per-run cache-buster. Without it the browser serves a cached copy and the test silently
  validates the *previous* version of the file — it once reported the v4.5 router as v4.4.
  The `?test=1` `<script>` injector cache-busts for the same reason: it didn't, and a run
  reported `137 passed, 0 failed` against a `tests.js` that had 22 new tests in it. **A green
  suite whose count didn't change after you added tests is not green, it's stale.**
- **A test that only asserts "it throws" can pass with no implementation at all** — calling an
  undefined name throws `ReferenceError`, which a bare `try/catch` swallows happily. Three such
  tests were vacuously green here. Assert on the refusal *message*.
- **Apps Script does not auto-sync.** `server/routerWebApp.gs` is the source of truth by convention
  only; the user's Apps Script editor is the actual runtime. After any server change, remind the
  user to paste it in and publish — nothing happens otherwise. Publishing means **Deploy →
  Manage deployments → pencil → Version: New version**, *not* "New deployment": a new
  deployment mints a fresh `/exec` URL, and the current one is baked into `CFG_DEFAULTS`,
  so the app would silently keep hitting the old code. Expect the first request after a
  version bump to be slow or to time out client-side while the container warms up; it
  never reaches Gemini, so it writes nothing and is safe to retry.
- **The daily line is a seeded rotation, not a hash-mod.** `lineFor` in `daily.js` used to be
  `pool[dailyHash(key) % pool.length]` — deterministic and scattered on consecutive days, but
  sampling *with replacement*, so nothing stopped a line reappearing days later (measured: 38
  repeats within 7 days/year on the real content, one line shown 10x, one never shown).
  `dailyHash` is kept exactly as-is but now only seeds a per-cycle Fisher-Yates shuffle
  (`seededRandom`/mulberry32); every line shows exactly once before any of them repeat. **The
  boundary repair (`orderFor`) is load-bearing** — without it the minimum gap between two
  showings of the same line was 2 days; with it, 22+. Rotation length is the pool size in days,
  so **adding lines to `DAILY_LINES` directly lengthens the no-repeat window** (currently 254
  lines total → am pool 191 / pm pool 190, ~6 months) — editing the list also reshuffles the whole schedule, so today's line
  can change when content is added; that's expected. Untagged lines sit in both the am and pm
  pools, so a same-day collision is possible; the pm pick is nudged **half the pool away**, never
  by 1 — a +1 nudge steals tomorrow's regularly scheduled slot and manufactures a back-to-back
  repeat. Every new `DAILY_LINES` entry must be unattributed (no `author` field) — two existing
  attributed quotes turned out to be misattributed and had to be removed; don't reintroduce that
  risk at scale.
- **Reads must never take the script lock, and the token must never gate logging.** `doPost`
  dispatches on `op` (absent/`log` = the original path, plus `read`/`patch`/`delete`). The log path
  holds the script lock for its whole request to make retries idempotent, and runs of 82s/107s/268s
  are on record — so a read holding that lock would block logging a shift for that long. The read
  branch returns *before* `LockService` is touched; `patch`/`delete` do take it, since they mutate.
  Equally load-bearing in the other direction: `requireReadToken` is only ever called inside the
  op branches, never on the way to Gemini, so a wrong or missing key can't stop a log. Tests assert
  both orderings against the `.gs` source. `tokenMatches` **fails closed when `READ_TOKEN` is
  unset** — a plain equality check would compare `''` to `''` and turn a forgotten setup step into
  a public feed of income history and ideas.
- **Track's take-home and Susans' pay are different units and must never be summed.** Track's
  figure is net of withholding plus tips; Susans' $20/hr is gross, with no withholding modeled.
  This was violated once already *in the chart* while the totals were correct — Susans gross was
  stacked on Track net under a legend reading "Net wage". The chart now plots one venue at a time.
  Susans is finished; the next job (bartending or cooking) will need its own wage rate and a
  withholding line re-fit to a real paystub, which is why shifts travel as one list carrying
  `venue` and an **optional** `pay` block rather than per-venue arrays.
- **Sheet columns are located by header name, never by letter.** `handleIdea` writes `''` into
  Materials columns E and F on the assumption they were spare; they are `Price` and `Notes`,
  filled in by hand. `columnForHeader` returns -1 and callers fail loudly naming the header they
  wanted. Ideas rows are identified by their column-A timestamp, materials by timestamp **plus**
  item (every material of one idea shares that idea's timestamp), falling back to project + item
  when the timestamp is blank — one live row is — and **refusing to write when that is ambiguous**.
  Never a row index: sorting or deleting in Sheets renumbers everything below.
- **Deleting a Track row invalidates the rest of its pay week.** Withholding is incremental within
  the Mon–Sun week, so the survivors' stored net was computed as though the deleted shift's hours
  were present. `recomputeTrackWeek` rewrites them — the automated form of the hand cleanup on
  2026-07-27, where a survivor was left $23.37 too high. The same `recomputeWeek` fills in the 16
  pre-v4.5 rows at read time, for display only.
- **A blank Ideas `Status` cell reads as Active.** That is what let 25 existing rows work with no
  backfill write; don't "fix" it by stamping Active into the sheet.
- **All paths must stay relative.** `start_url`/`scope` in `manifest.json`, the `tests.js` injection,
  and icon hrefs have to resolve under the `/log-it/` Pages subpath, not the domain root. A test
  guards the manifest.
- **`tests.js` depends on production one-way.** The harness reads production globals; production must
  never reference test symbols. It hides `#app` rather than wiping the DOM, because integration tests
  manipulate real elements.
- **The Gemini key stays out of the client** — it lives in Apps Script Script Properties, and nothing
  else may move it. Sheet IDs and the Web App URL are a deliberate exception: they're baked into
  `CFG_DEFAULTS` in `index.html` so a cache clear doesn't mean retyping six fields on a phone. The ⚙
  panel (localStorage) overrides them per-field; `LS.get` falls back to the default when unset. The
  repo is public, so those six values are readable — the user accepted that knowingly, having been
  told. The exposure is unsolicited writes to the sheets, not key theft. **Don't undo this** as a
  security cleanup; if it ever needs reversing, the replacement is one-tap import/export of all six,
  not a return to typing them in.

### Client flow

`processEntry` → `submitWithRetry` (3 attempts, 1s/3s backoff) → `callRouter` (30s `AbortController`,
typed `SubmitError` of kind timeout/network/http/server; `isTransient` decides retry). Input is held
in `pendingEntry` and cleared **only** on success; failures raise `#fail-card` (Retry/Copy/Dismiss).

Successful logs are mirrored to `localStorage.today_logs`, pruned to the local day on write — that's
the midnight reset, no timer involved. Layout is top-anchored so the mic never shifts when the Today
list expands.

The squares and the expanded cards are the same elements (`.today-box`). Expanding is a layout change,
which transitions can't interpolate — hence the `today-fan` keyframe for the downward travel. Its
stagger is index-driven: `renderLogBox` emits `style="--i:N"` and CSS derives both delay and start
offset from it. Don't refactor that back to `nth-child` — the old rules capped at `n+4`, so the fan
flattened after the third log.

Voice capture is **press-and-hold** (`pointerdown`/`up`/`leave`/`cancel`) with
`recognition.continuous = true`, so a natural speaking pause no longer ends the entry.

### Categories

tip (Track|Susans tabs), meal (Log + Daily Summary), idea (Ideas + Materials),
car (Maintenance Log). Grocery was retired in router v4.4 (moved to a dedicated app) —
no routing guardrail replaced it, so a grocery-ish entry now lands in the nearest
remaining category by design.

## Conventions

- Superpowers flow: brainstorm (one question at a time) → spec in `docs/specs/` → plan in
  `docs/plans/` → implement → verify in-browser → merge.
- **Push only when the user says so** — push is a live deploy. Never delete remote branches unless
  the user names them.
- Aesthetic: minimal, dark (`#121316`), orange accent `--action: #cc785c`. The user is the only user,
  so affordance hints can be dropped.
- Cost is a non-issue (~$0.0005/log). Do not spend effort on token/cost optimization — latency and
  correctness only.
- Free-tier limits worth respecting: `gemini-3.1-flash-lite` 15 RPM / 500 RPD; `gemini-3.5-flash`
  **20 RPD** — the fallback fires at most once per log by design.
- Model names `gemini-3.1-flash-lite` / `gemini-3.5-flash` are real (post Jan-2026), not typos.
- The repo is public and serves Pages; `.gitignore` keeps the user's personal `.rtf`/`.pdf`/`.txt`
  working files out. Legacy per-domain Apps Script exports sitting in the repo folder are untracked
  predecessors, superseded by the router.
