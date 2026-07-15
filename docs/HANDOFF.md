# Log It — Session Handoff (2026-07-15)

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
       source of truth in repo: server/routerWebApp.gs (v4.2)
       ⚠ Apps Script does NOT auto-sync: after editing that file, the user
         must paste it into the Apps Script editor and create a new deployment
      → Gemini API (systemInstruction SYSTEM_PROMPT, JSON response mode)
         model chain: gemini-3.1-flash-lite → gemini-3.5-flash (1 attempt each)
      → SpreadsheetApp writes to per-category sheets
    ← {success, category, sub_route, message}
  ← enriched confirmation shown in confirm card
```

- **Client** (`index.html`, ~1150 lines, no build/npm; tests live in
  `tests.js`, loaded only under `?test=1`):
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
  grocery (Raw Log + categorized Grocery List), idea (Ideas + Materials),
  car (Maintenance Log). Sheet IDs entered in the app's ⚙ settings
  (localStorage), sent per-request; Gemini key lives in Script Properties.

## Testing (browser-only, no CLI runner)

- In-page harness: serve repo (`python3 -m http.server 8777`) and open
  `index.html?test=1` → renders PASS/FAIL + footer. **Currently 54 passed, 0
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
  route Susans 2:00pm-4:00pm, $40 (proves NaN fix live).

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
