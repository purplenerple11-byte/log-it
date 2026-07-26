# Log It — Session Handoff (2026-07-18)

Read this first. It's the state of the project, how we work, and what's next.

## What this is

A single-user, phone-first PWA ("Log It") that turns raw voice/text into
structured rows across domain Google Sheets. Owner: purplenerple11-byte
(purplenerple11@gmail.com). Live at `purplenerple11-byte.github.io/log-it/`
(GitHub Pages, repo `purplenerple11-byte/log-it`, default branch **`Main`** —
capital M).

## Architecture

```
PWA (index.html, GitHub Pages)
  → fetch POST text/plain (avoids CORS preflight)
    → Google Apps Script Web App  ("Execute as: Me", access: Anyone)
       source of truth in repo: server/routerWebApp.gs (v4.5) +
         server/tipRouting.js + server/trackPay.js (pasted alongside it as
         additional files in the SAME Apps Script project — same project,
         NOT separate ones; Apps Script shares one global scope per project)
       ⚠ Apps Script does NOT auto-sync: after editing those files, the user
         must paste them in and publish via Deploy → Manage deployments →
         pencil → Version: New version. NOT "New deployment" — that mints a
         fresh /exec URL and the current one is baked into CFG_DEFAULTS, so
         the app would silently keep running the old code.
      → Gemini API (systemInstruction SYSTEM_PROMPT, JSON response mode)
         model chain: gemini-3.1-flash-lite → gemini-3.5-flash (1 attempt each)
      → SpreadsheetApp writes to per-category sheets
    ← {success, category, sub_route, message}
  ← enriched confirmation shown in confirm card
```

- **Client** (`index.html`, ~1150 lines, no build/npm, plus `daily.js` for the
  daily-line content + pure selectors; tests live in `tests.js`, loaded only
  under `?test=1`):
  - Submission: `processEntry` → `submitWithRetry` (3 attempts, backoff 1s/3s)
    → `callRouter` (15s `AbortController` timeout, typed `SubmitError`:
    timeout/network/http/server; `isTransient` decides retry). Input held in
    `pendingEntry`, cleared ONLY on success; failures show `#fail-card`
    (Retry/Copy/Dismiss).
  - **Invariant:** server worst case (~5-9s) must stay under the client's 15s
    timeout — that's what makes client retries duplicate-safe. Don't add
    server retries/sleeps back.
  - Today view: successful logs mirrored to `localStorage` key `today_logs`
    (`{ts,day,category,sub_route,message,text}`); pruned to local day on write
    (= midnight reset, no timer). Tiny 15px orange squares under the
    Voice/Type toggle; tap expands to bullet rows (via `CAT_UI` + `catKey`),
    tap collapses. Empty → hidden. No hint text (removed deliberately).
  - Expand animation: the squares and the cards are the *same* elements —
    `.today-box` morphs in place. Because collapse/expand is a **layout**
    change (wrapped squares → stacked cards), transitions can't interpolate
    position: the boxes teleport and only size animates. The `today-fan`
    keyframe supplies the travel, starting each card lifted toward the row so
    they fan downward. Stagger is index-driven — `renderLogBox` emits
    `style="--i:N"`, CSS reads it for both delay and start offset. Don't go
    back to `nth-child`: it capped at `n+4`, so the fan flattened after three
    logs. `--fan-step` clamps at 6 to bound a busy day (~330ms total).
  - Mode toggle morph: `text-mode` class on `#app`; `#mic-btn` morphs into the
    text box (320ms cubic-bezier(.4,0,.2,1)); real `#text-input` fades in over
    the shell; headings "Hold to log" / "Type to log".
  - Layout is top-anchored (`#app` flex-start, `padding:8vh 24px 40px`) so the
    mic never moves when the Today list expands.
- **PWA install** (`manifest.json`, `icons/`): standalone, portrait, dark
  splash. Icon = dark `#121316` dot on solid `#cc785c` (regenerate with
  `python3 tools/make-icons.py`, stdlib only). One image serves "any maskable"
  because the field is solid and the dot sits inside the 80% safe zone. iOS
  ignores manifest icons — the `apple-touch-icon` link at 180px is what it uses.
  **All manifest paths must stay relative**: `start_url`/`scope` have to resolve
  to the `/log-it/` Pages subpath, not the domain root. A test guards this.
- **Categories/sheets:** tip (Track|Susans tabs), meal (Log + Daily Summary),
  idea (Ideas + Materials), car (Maintenance Log). Grocery retired in router
  v4.4 (moved to its own app); no routing guardrail replaced it, so a
  grocery-ish entry now goes to the nearest remaining category by design.
  Sheet IDs and the Web App URL are **baked into
  `CFG_DEFAULTS` in `index.html`**; the ⚙ settings panel (localStorage) still
  overrides them per-field, and `LS.get` falls back to the default when a key
  is unset — so a cache clear no longer means retyping six fields on a phone.
  Sent per-request; Gemini key lives in Script Properties.
  ⚠ The repo is public, so those six values are readable. Accepted knowingly
  (see session history #11) — the exposure is unsolicited writes to the
  sheets, not key theft. Don't "fix" this by ripping the defaults out.

## Testing (browser-only, no CLI runner)

- In-page harness: serve repo (`python3 -m http.server 8777`) and open
  `index.html?test=1` → renders PASS/FAIL + footer. **Currently 112 passed, 0
  failed.** Any change must keep it green; new features add tests there.
  Tests live in `tests.js`; `index.html` injects it only when `?test=1` is
  set, so production never fetches it. The harness reads production globals
  (one-way — production must never reference test symbols).
- `?mock=<success|server|http4xx|http5xx|network|timeout>` fakes the router in
  the real UI (set any non-empty router URL in localStorage first);
  `&to=<ms>` shortens the 15s timeout. Both dev switches are inert without
  URL params.
- Drive it with the Claude Browser pane; read the footer via
  `document.querySelector('pre').textContent` filtering for "passed".

## How we work (user's established preferences)

- Superpowers flow: brainstorm (one question at a time, options A/B/C) → spec
  in `docs/specs/` → plan in `docs/plans/` → implement → verify → merge.
- **User wants Sonnet subagents to implement and test**; Haiku for cheap
  mockups; controller (Opus) designs, reviews, and verifies in-browser.
  Interactive HTML mockups (inline widget) before committing to UI designs
  worked very well — user gives concrete tweak feedback.
- Merge to `Main` + push only after the user says so (push = live deploy via
  Pages). Never delete remote branches without the user naming it.
- Aesthetic: minimal, dark (#121316), orange accent `--action:#cc785c`; user
  is the only user — affordance hints can be dropped.

## Session history (all shipped & live)

1. Bulletproof submission (retry state machine, fail card, 15s timeout).
2. Today read-back view (local mirror; squares→bullets).
3. Boxes moved below the toggle; hint text removed.
4. Router v4.2: retry budgets aligned (1 attempt/model, no sleeps — was up to
   18 Gemini calls + duplicate-row risk) and fixed the confirmed `+ +` NaN bug
   that replaced the AM/PM disambiguation rule in SYSTEM_PROMPT with literal
   "NaN". 4 regression tests fetch and check the .gs in the suite. **User has
   deployed v4.2 to Apps Script.**
5. Voice⇄text morph.
6. `.gitignore` for the personal files (.rtf/.pdf/.txt/.DS_Store). Verified
   none had ever been committed on any branch — prevention only, no history
   rewrite. Merged to `Main`.
7. PWA manifest + app icon. Icon is a dark dot on a solid `--action` field;
   solid field means Android's maskable crop can't clip it, so one image
   serves "any maskable". Regenerate with `python3 tools/make-icons.py`
   (stdlib only). iOS ignores manifest icons — the `apple-touch-icon` link
   at 180px is what it uses. **User confirmed install prompt fires on
   device.**
8. Test harness split into `tests.js` (index.html 56.8KB → 40.3KB, -29%).
9. **v4.2 validated live by the user** ("worked 2-4 at susans" → Susans,
   2:00pm-4:00pm, $40). The NaN fix is confirmed in production.
10. Daily line: the static hint is now a rotating mantra/prompt/quote
    (`daily.js`). Two local-time windows split at 5pm ('am'/'pm' tags;
    untagged lines float into both); pick = hash of date+window, so it
    holds still within a window and rolls at 5pm and midnight. Pure
    `lineFor(date, lines)`; no storage, no timer. `#hint` lost
    `white-space: nowrap` so quotes wrap.
11. **Config baked in** (`CFG_DEFAULTS`): the Web App URL + five sheet IDs are
    hardcoded, with `LS.get` falling back to them when localStorage is empty.
    Motivation: a cache clear meant retyping six long IDs on a phone. The ⚙
    panel still wins when set, so it stays a live override; saving a field
    blank now resets to the baked-in value rather than emptying it. **Trade-off
    accepted deliberately by the user after being told the repo is public** —
    anyone reading it can POST rows into these sheets. The Gemini key is
    unaffected (Script Properties). Live; user verified a real log on device.
12. Today-view fan animation (see the Today view notes above). Index-driven
    stagger replaced the `nth-child` delays, which also fixed the fan
    flattening after the 3rd log. Live.
13. **Deterministic tip routing** (`server/tipRouting.js`, router v4.3). Three
    real logs of "9:18 in, 6:50 out, 350 dollars in tips" landed in Susans;
    the same entry with "$350" landed in Track. Cause: the prompt gave Gemini
    two tip schemas and only the Susans one had `clock_in`/`clock_out`, so an
    in/out pair fit that shape and routed there regardless of the written
    rules — and with no `tips` field on that schema, the $350 was silently
    dropped and an hours x $20 payroll row invented. Fix: one tip schema
    carrying every field, Gemini emits facts only (24h `HH:MM` times, plus
    `venue` only when a name is spoken), and `routeTip()` picks the tab in
    code — explicit venue, then tips (Track-only), then clock-in before noon,
    else Track. `shiftHours()` also derives the length from the times instead
    of trusting the model's arithmetic. 18 new tests; verified red against the
    old behavior before going green. **Shipped and confirmed live by the user**
    on 2026-07-23, after pasting both files into the Log It - Router project
    and publishing a new version of the existing deployment.
14. **Grocery retired** (router v4.4). Groceries moved to a dedicated app, so
    the category came out end to end: prompt line, schema, doPost case,
    SHEET_IDS slot, handleGrocery/insertGroceryItem (~80 lines), plus the
    client's ⚙ field, sheet_grocery default, payload key, and 🛒 CAT_UI entry.
    A guard test keeps it from creeping back. Stale grocery rows in a Today
    list degrade to a bullet via the existing CAT_UI fallback. **No routing
    guardrail replaced it by the user's choice** — "out of milk" now lands in
    the nearest remaining category. The orphaned grocery Sheet was left alone.
15. **Track pay & withholding** (`server/trackPay.js`, router v4.5). Track rows
    now carry Gross Wage, Est. Net Wage, Total Take-Home, and a true Eff. $/hr
    in columns F-I (previously "Rate" was only tips÷hours, saying nothing about
    the paycheck). Model reverse-engineered from two real paystubs — see the
    Track pay model section below. 22 new tests. Two findings worth keeping:
    the naive additivity test **telescopes and is nearly tautological**, so it
    was backed up with a ragged-12-shift drift test and an explicit
    "not taxed in isolation" test that both genuinely fail against wrong
    models; and the harness's source-inspecting tests were reading **cached**
    .gs files (it reported the v4.5 router as v4.4), now fixed with a per-run
    cache-buster in `fetchText`/`fetchJson`. **Needs the user to add F-I
    headers to the Track tab, paste `trackPay.gs`, and republish.**

## Key facts (don't re-litigate)

- Cost is a NON-issue: ~$0.0005/log. Do not spend effort on token/cost
  optimization. Latency + correctness only.
- Model names `gemini-3.1-flash-lite` / `gemini-3.5-flash` are real (post
  Jan-2026). Free-tier limits: 3.1-flash-lite 15 RPM / 500 RPD; 3.5-flash
  **20 RPD** (precious — fallback fires once per log max by design).
- Legacy per-domain Apps Script files (`Auto TIps.rtf`, `Car Maitnance.rtf`,
  `Food Log.rtf`, `Idea Capture.rtf` on the repo folder, untracked) are
  form-triggered predecessors, superseded by the router for PWA use. Possible
  schema drift: old Food Log wrote E=Calories/F=Macros; router writes
  E=creatine/F=fish_oil — user hasn't confirmed sheet headers.
- End-to-end validation the user can run: log "worked 2-4 at susans" → should
  route Susans 2:00pm-4:00pm, $40 (proves NaN fix live). For tip routing, log
  "9:18 in, 6:50 out, 350 dollars in tips" → Track, 9.03h, $350, $38.76/hr.
- Susans tab layout confirmed by the user: `A:Timestamp | B:Clock In |
  C:Clock Out | D:Hours | E:Pay @ $20/hr | F:Notes` — matches what the router
  writes. **Track tab** is `A:Timestamp | B:Hours | C:Tips | D:Tips-per-hr |
  E:Notes` plus, as of v4.5, `F:Gross Wage | G:Est. Net Wage |
  H:Total Take-Home | I:Eff. $/hr` (the user must add those four headers).
  The legacy script wrote a Date in column B, so if any of its rows survive,
  reading hours from B would poison the weekly pay math — `sumTrackHours`
  guards with a numeric check and a test proves it.
- First request after publishing a new version can be slow or time out
  client-side while the Apps Script container warms up. Observed 2026-07-23:
  ~4 failed attempts, zero Gemini calls logged, zero rows written, then normal
  service. It dies before reaching Gemini, so it is write-safe — but note it
  does bend the duplicate-safety invariant, which assumes the server always
  finishes under the client's 15s timeout. If a slow first call ever DOES
  reach the sheet, the retries could double-write; check for dupes before
  assuming otherwise.
- The 0.5h Track break deduction is pure script (`BREAK_DEDUCTION_HRS`), not
  AI, and the prompt says nothing about breaks — so there is no double
  deduction. The legacy script's "only if over 5 hours" rule is gone; the
  user chose to keep the unconditional deduction.

## Track pay model (v4.5) — calibrated, re-fit when things change

Reverse-engineered from two real paystubs (weeks ending 7/5 and 7/19/2026,
weekly pay period, NY). Reproduces gross, every deduction, and net **to the
penny on both**; tests.js locks it in.

| Component | Rate |
|---|---|
| Gross | hours x `TRACK_WAGE_RATE` = $16.07 (hours already net of the unpaid 0.5h break) |
| FICA / Medicare / NY-PFL | 6.2% / 1.45% / 0.4327% of gross |
| NY Disability | **$0.60 flat per week**, not a rate |
| Federal | real 2026 percentage method: Single, W-4 step 2 unchecked, $16,100 std deduction, 10% to $12,400 then 12% to $50,400, annualized /52 |
| NY State | **line fitted to the two stubs**: `0.054045 x gross - 10.874`, floored at 0 |

- **NY is calibration, not derivation.** NY's real tables are piecewise with the
  tax-table benefit recapture built in; the published brackets miss by
  $0.22-$0.35/week. Re-fit on a raise, filing-status change, or new tax year.
- **A shift's net is incremental within the Mon-Sun pay week** (WeekEnd is a
  Sunday, paid the following Thursday). Withholding is progressive, so taxing a
  shift alone understates it ~$20/shift. Consequence: `handleTip` sums the
  week's existing Track hours **before** appending, and the same hours net
  *less* later in the week — that's correct, not a bug.
- Rounding each deduction to cents (as the stubs do) is what makes the
  per-shift nets sum exactly to the week; a drift test on 12 ragged shift
  lengths catches losing that.
- Tips are treated as untaxed cash — correct per the stubs, where gross is
  exactly `units x rate` with no tip income.
- **Estimate for planning, not a tax document.**

## Next steps (prioritized)

1. (Optional) `?mock=` is still in `index.html` (~15 lines, wired into
   `callRouter` at ~line 948, inert without the URL param). Left there
   during the harness split because extracting it is surgery, not a move.
2. **Offline queue** (raised while scoping the manifest, deliberately deferred):
   a service worker caching the shell + queueing failed logs to retry when back
   online. Real value if logging where reception is bad, but it interacts with
   the existing `submitWithRetry` state machine and needs its own spec. Note a
   shell-only cache is *not* worth it alone — the app would open offline and
   then fail to submit anyway.
3. (Deferred minors, fine to ignore: JSON-parse block duplicated in
   readTodayLogs/recordTodayLog; `deps.now||Date.now()` epoch-0; keydown
   null-guard.)

## Gotchas

- `.superpowers/sdd/progress.md` = subagent-driven-dev ledger from Feature #2.
- Browser pane blocks `file://` — always use the local HTTP server.
- `textutil -convert txt` extracts the user's RTF code files.
- The user's Apps Script editor is the runtime; repo file is source of truth
  only by convention — remind them to paste+redeploy after any server change.
