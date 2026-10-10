# Log It — Handoff (2026-10-09)

State of the project and what's next. Rules live in `CLAUDE.md`, recipes in `docs/GUIDE.md`.
Detail for any line below is in its commit (`git log --oneline`, then `git show <sha>`).

## Now

- **Live:** router **v4.9.3** at deployment `AKfycbx4Vyy…` **@23**; front end on Pages from `Main`.
- **Jobs:** **Dorset Inn** is the current job (busser, $10/hr, weekly tips through payroll, Vermont).
  **Track is closed** until next season (`TRACK_SEASON_OPEN = false`). Susans is finished.
- **First real Dorset shift** logged 2026-10-09: 4:00pm → 10:24pm, 6.4h, $59.10 est. take-home,
  tips pending. It created the `Dorset Inn` tab.
- **Tests:** browser suite **287 passed, 0 failed**; `node tools/gas-sim.js` 15/15.
- **The user has set:** `READ_TOKEN` and `GEMINI_API_KEY` in Script Properties, the Ideas `Status`
  and Materials `Got it` headers, and the read key on the phone.

## Next

1. **Re-fit Dorset withholding to the first paystub** (GUIDE → "Re-fit withholding"): check
   `VT_ALLOWANCES`, the pay-week boundary, and that tips appear on the stub. Until then every
   Dorset figure is marked as an estimate.
2. **Reopen Track next season** (late June): flip `TRACK_SEASON_OPEN`, update its test, deploy.
3. **Offline queue** (deferred on purpose): a service worker that caches the shell *and* queues
   failed logs. It interacts with `submitWithRetry` and needs its own spec. A shell-only cache is not
   worth it — the app would open offline and then fail to submit.
4. Optional: the 16 pre-v4.5 Track rows are recomputed at read time for display only;
   `recomputeWeek` could write them back.
5. Optional: `?mock=` (the router-failure faker) still lives inline in `index.html` (~15 lines,
   inert without the param). Extracting it is surgery on the logging path, not a move.

## How we work (the user's preferences)

- Brainstorm one question at a time with lettered options and a recommendation → spec in
  `docs/specs/` → build test-first → verify in the browser and live → ship.
- Interactive mockups before UI changes work well; the user gives concrete tweak feedback, often as
  phone screenshots.
- Deploy rather than hand over paste steps (Apps Script via the deploy script). Pushing `Main` is a
  live deploy — say what's going out. Never delete remote branches unless the user names them.
- Earlier sessions: the user wanted Sonnet subagents to implement and test, Haiku for cheap mockups,
  with the controller designing, reviewing and verifying in-browser.
- Dark, minimal, orange accent. Single user, so affordance hints can go.
- Asks for numbers to be right and for "est." to mean something. Says so plainly when a screen is
  confusing — treat "I can't tell X" as a bug report.

## Changelog

| # | Shipped |
|---|---|
| 1 | Bulletproof submission: retry state machine, fail card |
| 2–3 | Today read-back view (local mirror, squares → cards), moved under the toggle |
| 4 | Router v4.2: one Gemini attempt per model, no sleeps; fixed the `+ +` → "NaN" prompt bug |
| 5 | Voice ⇄ text morph |
| 6 | `.gitignore` for personal files (verified none were ever committed) |
| 7 | PWA manifest + icon (relative paths for the `/log-it/` subpath) |
| 8 | Test harness split into `tests.js` |
| 10, 17 | Daily line, then a seeded no-repeat rotation (min gap 22 days; ~6-month cycle) |
| 11 | Config baked into `CFG_DEFAULTS` (public repo, accepted by the user) |
| 12 | Today-view fan animation, index-driven stagger |
| 13 | v4.3: tip routing moved from the prompt into code (`routeTip`) |
| 14 | v4.4: grocery category retired (moved to its own app) |
| 15 | v4.5: Track pay + withholding, fitted to two paystubs to the penny |
| 16 | v4.6: duplicate-write fix — request id + lock across the whole request |
| 18 | v4.7: shifts priced by the day they happened (`shift_date`) |
| 19 | v4.8: shifts + ideas pages, read/patch/delete ops behind `READ_TOKEN`; drill-down chart, drag-to-reorder ideas, in-app dialogs, `?v=` asset versioning |
| 20 | v4.9: Dorset Inn — weekly-priced pay, Vermont withholding, tips taxed via payroll |
| 21 | v4.9.1–4.9.3: Track closed for the season (`seasonGate`); evening clock-out fix; Sheets time values read as clock times; batched sheet writes; deploy script; server simulator; this docs restructure |
