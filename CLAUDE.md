# CLAUDE.md

Log It: a single-user, phone-first PWA. Voice/text → Gemini → a structured row in the right Google
Sheet, plus read pages over those sheets. Live at `purplenerple11-byte.github.io/log-it/` (GitHub
Pages). Default branch **`Main`** (capital M) — pushing it deploys the front end.

**Read next:** `docs/GUIDE.md` for how to do things (recipes, verification, deploy, traps).
`docs/HANDOFF.md` for current state, next steps and history. Each rule below is short on purpose;
the incident behind it is in the commit that introduced it (`git log -S '<name>'`).

## Map

```
index.html ─ POST text/plain (no CORS preflight) ─→ Apps Script Web App (server/*)
shifts.html, ideas.html ─ same POST, op: read|patch|delete + READ_TOKEN ─┘   → Gemini → Sheets
```

| File | What it is |
|---|---|
| `index.html` | The logging app: UI, retry state machine, Today view, ⚙ config. No framework, no build. |
| `daily.js` | Daily line content + seeded rotation (pure). |
| `shifts.html` + `shiftStats.js` | Earnings page + its pure aggregation. |
| `ideas.html` + `ideaModel.js` | Ideas page + its pure model (status, sort, manual order, materials). |
| `dataClient.js`, `ui.js`, `theme.css` | Read-page transport/cache, in-app dialogs, shared tokens. |
| `server/routerWebApp.gs` | `doPost`, Gemini prompt + fallback, every sheet handler. Live file `Code`. |
| `server/tipRouting.js` | `routeTip`, `seasonGate`, `fixClockOut`, shift dates/hours. Live `tipRouter`. |
| `server/trackPay.js` / `dorsetPay.js` | Wage + withholding per employer (NY / VT). |
| `server/readApi.js` / `sheetWrite.js` | Row→object readers / patch+delete validation, `contiguousRow`. |
| `tests.js` | Browser harness, injected only under `?test=1`. |
| `tools/` | `deploy-apps-script.sh`, `gas-sim.js` (server sim), `make-icons.py`. |
| `mockSheet.js` | Real sheet rows as a fixture, loaded only under `?mock=1`. |

## Commands

```bash
python3 -m http.server 8778            # or preview_start {name:"log-it"} (.claude/launch.json)
# browser suite: open /index.html?test=1, read document.querySelector('pre') footer
node tools/gas-sim.js                  # real server code vs an in-memory sheet (write paths)
tools/deploy-apps-script.sh --check    # then: tools/deploy-apps-script.sh "release note"
```

No npm, no lint, no CLI test runner. `shifts.html?mock=1` / `ideas.html?mock=1` run the real read
pipeline on fixture rows with no deploy and no token.

## Invariants — load-bearing; don't undo

**Logging path**
- **Duplicate safety is the `request_id`, not timing.** Client keeps one id across retries and the
  Retry button; `doPost` holds the script lock across the *whole* request and checks a CacheService
  entry on that id; only successes are cached. Runs of 82s/107s/268s are on record — no timeout is
  safe. Never add server-side retries or sleeps (v4.2: 18 Gemini calls + duplicate rows).
- **Tip routing is code, never the prompt.** Gemini returns facts (`venue`, `clock_in`/`out` as 24h,
  `hours`, `tips`, `shift_date`); never give it a per-tab output shape. Order in `routeTip`: named
  venue → tips with no hours/times = Dorset weekly tips → clock-in before noon Track / noon+ Dorset →
  tips with hours = Track → default Dorset. Then `seasonGate`: while `TRACK_SEASON_OPEN = false`,
  implied Track → Dorset, a *named* track is refused (nothing written); `handleTip` re-checks.
- **Times:** the prompt maps bare 7–11 to AM, so `fixClockOut` turns a clock-out that lands after
  the clock-in when read as PM into PM (`4 - 10:24` was pricing as 18.4h); real overnights still wrap.
  Sheets turns written times into 1899-epoch Dates — read them with `cellClock`.
- **The pay week comes from the day worked**, not the day logged (`shift_date` → `resolveShiftDate`:
  exact YYYY-MM-DD, real date, not future, ≤45 days, else today). Back-dated rows are echoed on the card.
- **Track pay is calibrated** to two paystubs (NY line fitted, SDI $0.60/week flat, 2026 federal
  method) and taxed **incrementally within the Mon–Sun week**: sum the week *before* appending.
  Re-fit on a raise, filing-status change or new tax year. Stamp formats (`formatTrackRow`) — the tab
  is a Sheets Table and appended rows once rendered as 1900-era dates.
- **Dorset Inn is priced by the week, never the shift.** $10/hr, no break; tips weekly and taxed
  through payroll with the wage (FICA, Medicare, federal, Vermont 2026 table; no NY lines). Each
  shift gets an hours-share, so a week has one $/hr; the last row takes the rounding remainder.
  Tips or a delete re-price the whole week. A tips-only entry with no day → the week just ended.
  `VT_ALLOWANCES = 0` and Mon–Sun are **assumptions until the first stub**. Tab self-creates.
- **Deleting a Track row invalidates its week** → `recomputeTrackWeek` rewrites the survivors.
- **Secrets:** Gemini key and `READ_TOKEN` live only in Script Properties, set by hand, never in a
  file. Sheet IDs + Web App URL are deliberately baked into `CFG_DEFAULTS` (public repo, accepted by
  the user: the exposure is junk writes, not key theft) — don't "fix" that. `LS.get` falls back to
  them *without writing localStorage*, which is why `dataClient.js` carries its own copy (drift-tested).

**Read pages**
- **Reads never take the script lock; the token never gates logging.** `requireReadToken` lives only
  in the op branches; `tokenMatches` fails closed when `READ_TOKEN` is unset.
- **Susans is gross; Track and Dorset are after tax.** Track + Dorset add (`paid*` totals); Susans is
  never summed with them, and the chart plots one venue's money at a time.
- **Columns by header name, never letter; rows by timestamp, never index.** Materials E/F are hand-kept
  Price/Notes. Materials are identified by timestamp + item, falling back to project + item, refusing
  when ambiguous. A blank Ideas `Status` reads as Active — don't backfill.
- **Static assets on read pages and `daily.js` carry `?v=`** and one page never mixes tokens (tested).
  Bump the token whenever those files change: a cached script beside a new page blanked Ideas.
- **Animate by mutating nodes, not re-rendering.** New nodes paint at their end state (Today fan,
  chart drill-down). Today-fan stagger is index-driven via `--i`, never `nth-child`.

**Tests and tooling**
- Source-inspecting tests fetch through `fetchText` (cache-busted), and the `?test=1` injector
  cache-busts too. **A green suite whose count didn't change after adding tests is stale.**
- A test asserting only "it throws" passes with no implementation (`ReferenceError`) — assert the message.
- `tests.js` reads production globals; production never references test symbols. The harness hides
  `#app` rather than wiping the DOM.
- **A green suite is not a working page.** Screenshot at 375px and hit the live endpoint before saying done.

**Apps Script**
- One project, **one global scope**; live names differ from the repo's (see the router header).
  `gas-sim.js` fails on a top-level name defined twice — loading alone would not catch it.
- Deploy with `tools/deploy-apps-script.sh`: it refuses if live differs from the deployed version,
  verifies by pull-back, and publishes a new **version** of deployment `AKfycbx4Vyy…`. Never
  `create-deployment` / "New deployment" — it mints a new `/exec` URL. Push alone changes nothing live.
- Script Properties and triggers have no CLI/API — they are the user's to set.

**Everything else**
- Daily line: seeded per-cycle Fisher-Yates; `orderFor`'s boundary repair is load-bearing; pm
  collisions nudge half the pool, never +1; adding lines lengthens the no-repeat window and reshuffles
  it. New lines carry no `author`.
- All paths relative (Pages serves under `/log-it/`); a test guards the manifest.
- Voice capture is press-and-hold with `recognition.continuous = true`.

## Conventions

- Features: brainstorm (one question at a time, options) → spec in `docs/specs/` → build test-first
  → verify in-browser and live. Interactive mockups before UI work.
- Push to `Main` = live deploy; say what's going out. The user prefers Claude deploy Apps Script
  itself rather than hand over paste steps.
- Latency and correctness only — cost is a non-issue (~$0.0005/log). Gemini: `gemini-3.1-flash-lite`
  (15 RPM / 500 RPD) → `gemini-3.5-flash` (**20 RPD**), one attempt each. Both names are real.
- Aesthetic: dark `#121316`, accent `--action: #cc785c`, minimal; single user, so hints can go.
- Public repo: `.gitignore` keeps the user's `.rtf/.pdf/.txt` working files out.
