# Working guide

How to get things done in this repo quickly and safely. `CLAUDE.md` says *what must stay true*;
this says *how*. Keep it current: when a recipe changes, edit it here in the same commit.

## Orient in a minute

1. `git log --oneline -15` — commit messages here are detailed and are the real changelog.
2. `docs/HANDOFF.md` → **Now** and **Next** sections.
3. Know the three runtimes: **index.html** (logging), **read pages** (`shifts.html`, `ideas.html`),
   **Apps Script** (`server/*`, deployed separately from Pages).

## The verify loop

Run all of these before calling anything done. Each has caught something the others missed.

| Check | How | Catches |
|---|---|---|
| Browser suite | open `/index.html?test=1`; read the footer | pure logic, source assertions |
| Server sim | `node tools/gas-sim.js` | handler plumbing, sheet writes, duplicate global names |
| Look at it | `/shifts.html?mock=1`, `/ideas.html?mock=1` at 375px | layout, wrong totals on screen |
| Live | `curl` the endpoint (below) after a deploy | config, IDs, Sheets behaviour |

Reading the suite from the Browser pane:

```js
const t=document.querySelector('pre').textContent.split('\n');
JSON.stringify({footer:t.filter(l=>/passed/.test(l)), fails:t.filter(l=>/^FAIL/.test(l))})
```

**If the count didn't move after you added tests, the run is stale** — reload with a new `&r=`.
Write tests first and *see them fail* before implementing; three tests here were once green with no
implementation at all.

Starting the preview: `preview_start {name:"log-it"}` (port 8778, from `.claude/launch.json`). A
`python3 -m http.server` started from Bash tends to die between turns, and the pane then refuses
`localhost` with an unhelpful "denied".

### Hitting the live endpoint

```bash
URL='https://script.google.com/macros/s/AKfycbx4VyyLzfafaKkAsNP2LUbSaLOFxS-vX34c-3lHIQPLIHIoqBqOEXghIRzS4n8vQ-24/exec'
curl -sL "$URL" -H 'Content-Type: text/plain;charset=utf-8' --data '{"text":""}'   # → "No text received"
```

- **Never `-X POST`.** Apps Script answers with a 302 to googleusercontent; forcing POST onto the
  redirect gets a 405 "Page Not Found" that looks exactly like a broken deployment.
- Safe probes that write nothing: `{"text":""}`; a read with a wrong token (→ `unauthorized`); an
  entry naming the track while it's closed (→ refused).
- **Anything else that logs writes a real row** to the user's sheet. Only do it when they asked.
- Reads need `READ_TOKEN`. Ask the user; keep it in a shell variable; never write it to a file.
- Reads must send `sheet_ids` — the server's own fallbacks are placeholders.

## Deploying

**Server:** `tools/deploy-apps-script.sh --check`, read the diff, then
`tools/deploy-apps-script.sh "what changed"`. It pulls live, refuses if live differs from the
deployed version (editor edits, or an unpublished push), stages under the live file names, pushes,
verifies by pull-back, and publishes a new version of the existing deployment. The first request
after a publish can be slow; it never reaches Gemini, so it's safe to retry.

**Front end:** push `Main`. Pages takes ~30–60s; check with
`curl -s https://purplenerple11-byte.github.io/log-it/shifts.html | grep -c '<something new>'`.
If you changed a `.js`/`.css` used by `shifts.html`, `ideas.html` or `daily.js`, **bump the
`?v=` token** on every tag in that page (one token per page; a test enforces it).

## Recipes

### Add a tip venue (the Dorset Inn pattern)
1. `server/<venue>Pay.js` (pure, prefixed names): wage rate, withholding, `allocate…Week`, a reader
   returning the shift shape `{ts, venue, week, hours, tips, notes, clockIn, clockOut, pay, dupeOf}`.
2. `tipRouting.js` → `routeTip` (and `seasonGate` if it's seasonal). Rewrite, don't delete, routing
   tests whose reason no longer holds — say why in the comment.
3. Router prompt: the category line, the `venue` enum, the TIP VENUE rule.
4. Router: a `handleTip` branch, a handler using `getOrCreateTab`, `handleRead` via
   `getSheetByName` (a missing tab must not throw), `handleDeleteShift`.
5. Add the live file to `MAP` in `tools/deploy-apps-script.sh` and `FILES` in `tools/gas-sim.js`,
   plus a sim scenario.
6. `index.html` `CAT_UI['tip_<Venue>']` for the confirmation card and Today square.
7. Shift page: add fixture rows to `mockSheet.js` and the module to the `?mock=1` loader. Venue chips
   are data-driven. Gross-only venues must stay out of `paid*` totals.
8. Inject the module in the `?test=1` list in `index.html`.

### Re-fit withholding to a paystub
Compare **gross, every deduction line, and net** for the stub's week, then put a test in `tests.js`
that reproduces the stub to the penny. Track's model (`trackPay.js`, fitted to the weeks ending
7/5 and 7/19/2026):

| Component | Rate |
|---|---|
| Gross | hours × `TRACK_WAGE_RATE` $16.07 (hours already net of the 0.5h unpaid break) |
| FICA / Medicare / NY-PFL | 6.2% / 1.45% / 0.4327% of gross |
| NY Disability | **$0.60 flat per week** |
| Federal | 2026 percentage method: Single, step 2 unchecked, $16,100 std deduction |
| NY State | fitted line `0.054045 × gross − 10.874`, floored at 0 |

Round each deduction to cents, as stubs do — that is what makes per-shift amounts sum to the week.
**Dorset (`dorsetPay.js`)** is fitted to the 10/23/2026 stub (test "Dorset paystub"): biweekly
Sun–Sat periods anchored 10/4/2026, federal and Vermont annualized ×26 (`federalForPeriod`), VT S/0,
VT CCC 0.11%, tips as "Charge Tips" in gross. That stub also paid 12.9 training hours at $14.42
(VT minimum wage) — one-off, not modelled. A stub's hours can exceed what was logged; compare
periods by deductions on the stub's own gross, not by the app's total.

### Open or close Track
`TRACK_SEASON_OPEN` in `server/tipRouting.js` (the meet runs roughly late June → Labor Day). Update
the `seasonGate: Track is closed right now` test, deploy the server.

### Add a field the read pages can write
`PATCHABLE` in `sheetWrite.js` (header + coercer) → a `handlePatch` call from the page via
`patchField` → a test for the whitelist **and** for the refusal message. The header must exist in
the sheet; patching fails loudly, naming it, if not.

### Add a read-page feature
Pure function in `shiftStats.js` / `ideaModel.js` with tests → wire it in the page → check it on
`?mock=1` at 375px → bump `?v=`.

### Change the Gemini prompt
It's `SYSTEM_PROMPT` in the router. Several tests assert exact substrings of it; run the suite. Never
let the prompt choose a tab or a pay figure — it extracts facts only.

### Add daily lines
Append to `DAILY_LINES` in `daily.js`, with no `author`. Expect today's line to change (the rotation
reshuffles). The content tests guard the pools.

## Traps that have actually bitten

- **Stale caches**, three separate times: `fetchText` (fixed with a buster), the `?test=1` injector
  (fixed), the read pages' own `<script src>` (fixed with `?v=`). If it behaves as though your edit
  didn't happen, check what the browser fetched before debugging logic.
- **Sheets converts written values**: `"4:00pm"` → time value → `Date` on 1899-12-30 when read.
- **The prompt's AM/PM rule** suits mornings and misreads evenings; times are corrected in code.
- **`deps.x || default`** swallows real zeros — use `??`.
- **`curl -X POST`** against Apps Script (see above).
- **A push replaces the whole Apps Script project** — a file missing from the stage is deleted.
- **Diffing live against git** gives false alarms when a push came from uncommitted work. Compare
  against the deployed version (the deploy script does).
- **The mock never sends sheet ids**, so an empty-id bug was invisible under `?mock=1` and showed up
  on the first real request.

## Live facts

| Thing | Value |
|---|---|
| Apps Script project | "Log It - Router", id `1Np9nv59S7Zuu4r-ABdXUPCEtZDRFAuYcAu5cfgcNfM8_GDVAIb1guZpV` |
| Deployment | `AKfycbx4Vyy…n8vQ-24` (full id in `CFG_DEFAULTS`); version number in `clasp list-deployments` |
| Sheet ids | `CFG_DEFAULTS` in `index.html` (also `DC_SHEET_DEFAULTS` in `dataClient.js`) |
| Track tab | Timestamp, Hours, Tips, Hourly Rate, Notes, Gross Wage, Est. Net Wage, Total Take-Home, Eff. $/hr |
| Susans tab | Timestamp, Clock In, Clock Out, Hours, Pay @ $20/hr, Notes (dormant since 7/15) |
| Dorset Inn tab | Timestamp, Clock In, Clock Out, Hours, Tips, Notes, Gross Wage, Tips Share, Est. Net Wage, Total Take-Home, Eff. $/hr |
| Ideas tab | Timestamp, Title, Category, Effort, Excitement (1-5), Next Step, Tags, Status |
| Materials tab | Timestamp, Project, Item, Category, Price, Notes, Got it |
