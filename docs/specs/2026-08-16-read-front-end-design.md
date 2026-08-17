# Read/Interact Front End — Design

**Date:** 2026-08-16
**Status:** Approved (brainstormed and grilled with user 2026-08-16)

## What

Two new pages in the same repo, reached from the mic screen:

- **`shifts.html`** — earnings over time (weekly and monthly, tips vs wage,
  effective $/hr) *and* a filterable log of individual shifts.
- **`ideas.html`** — every captured idea, browsable, with write-back: move an
  idea between **Active / Done / Archived**, edit its next step, tick off
  materials as acquired, and record what one cost.

Meals and car maintenance are out of scope. The plumbing makes adding either
one later a small job.

## Why

Log It is a one-way pipe. The only read-back is `today_logs` in
localStorage, pruned to the current day, so everything older is reachable
only by opening Google Sheets on a phone. Months of shift earnings and a
growing pile of captured ideas are effectively write-only.

Ideas in particular need the write-back: a list you can't cross things off
of goes stale, and then stops being worth opening.

Google Sheets stays the system of record. The logging path does not change.

## Ground truth (read from the live sheets, 2026-08-16)

Design assumptions that were wrong before the sheets were actually read:

| Tab | Columns | Note |
|---|---|---|
| Track | `A Timestamp \| B Hours \| C Tips \| D Hourly Rate \| E Notes \| F Gross Wage \| G Est. Net Wage \| H Total Take-Home \| I Eff. $/hr` | F–I headers already present. **33 rows; the 16 from 6/3–7/19 have F–I blank** (they predate v4.5). |
| Susans | `A Timestamp \| B Clock In \| C Clock Out \| D Hours \| E Pay @ $20/hr \| F Notes` | Dormant since 6/28. Two identical 7/15 rows are validation logs. Pay is **gross** — no withholding modeled. |
| Ideas | `A Timestamp \| B Title \| C Category \| D Effort \| E Excitement (1-5) \| F Next Step \| G Tags` | 25 rows. **No status column.** |
| Materials | `A Timestamp \| B Project \| C Item \| D Category \| E Price \| F Notes` | **E and F are real, hand-maintained columns** — the router writes empty strings into them. One row has a **blank timestamp**. Rows from one idea all share that idea's timestamp. |

No legacy rows with a Date in Track column B survive, so `sumTrackHours`'s
numeric guard has no live case — it stays anyway.

## Approach chosen

Extend the existing router with new ops, rather than a second Web App or
published CSV. A second Web App doubles the paste-and-republish ritual and
adds a URL to `CFG_DEFAULTS`; published CSV is public by definition, so it
can't carry the token, and gives no write path.

## Transport

`doPost` gains an `op` field:

| `op` | Meaning |
|---|---|
| absent / `log` | Today's behavior, byte for byte |
| `read` | Return rows for a scope |
| `patch` | Change one whitelisted field on one row |
| `delete` | Remove one shift row, then repair its pay week |

Reads ride the same `POST text/plain` the logger uses. A `doGet` would put
the token in the query string — where it lands in referrers and logs — and
Apps Script GETs bounce through a redirect to `googleusercontent.com`, a
CORS surprise waiting to be found in production. The POST path is proven.

## Load-bearing invariants

1. **Reads take no script lock.** `doPost` holds the lock for the whole
   request so retries are idempotent (v4.6). A read holding that lock would
   mean opening the shifts page blocks logging a shift. Reads branch out
   *before* the lock is acquired. `patch` and `delete` do take it.
2. **The token gates `read`/`patch`/`delete` only.** The `log` path never
   checks it, so a missing or wrong token can never stop a log being written.
3. **Pay-week boundaries come from the server.** Shifts are returned already
   tagged with `payWeekStart(ts)` from `trackPay.gs` — the same function that
   priced them. The dashboard never computes a week boundary itself.
4. **Track take-home and Susans pay are never summed.** Track's is net of
   withholding plus tips; Susans' is gross. One number built from both would
   be part post-tax and part pre-tax.

## Shift shape — built for the next job

Susans is finished; a bartending or cooking job follows track season, and it
will want withholding too. So the read layer returns **one `shifts[]` list**
where each shift carries its venue and an **optional** pay block, rather than
hardcoded `track`/`susans` arrays:

```jsonc
{"ts":"ISO","venue":"Track","week":"YYYY-MM-DD","hours":9.17,"tips":242,
 "notes":"9:20am-7:00pm","clockIn":null,"clockOut":null,
 "pay":{"gross":147.36,"net":111.86,"takeHome":353.86,"effHourly":38.59,
        "source":"sheet"},
 "dupeOf":null}
```

- `pay` is `null` for a venue with no withholding model (Susans), which
  instead carries `grossPay`. Adding a new employer becomes a wage rate plus
  a withholding config — an edit, not a rewrite.
- `pay.source` is `"sheet"` (values read from F–I) or `"computed"` (the
  pre-v4.5 rows, recomputed at read time — see below). The UI marks
  `"computed"` rows as estimated.
- `dupeOf` is set when another shift shares the same day, venue, and hours.

## Recomputing a pay week

`recomputeWeek(rows)` is one pure function serving two callers:

- **Read time** — the 16 pre-v4.5 Track rows have no stored pay. Their week
  is reconstructed in chronological order, applying withholding
  incrementally exactly as `handleTip` does, so June and July show real
  numbers instead of holes. **Display only — nothing is written.**
- **After a delete** — the surviving rows in that week are recomputed and
  rewritten, because their stored net was calculated as though the deleted
  shift's hours were in the week.

Withholding is progressive and assessed weekly, so order within the week is
significant and a row is always priced against the hours *before* it.

## Delete

Deleting a duplicate is the one operation that writes to rows the user did
not select, so it is deliberately narrow:

- Token required; script lock held for the whole operation.
- The client sends the row's expected `hours`, `tips`, and `ts`. The server
  **re-verifies them against the sheet before deleting** — a stale page
  cannot delete the wrong shift.
- Track: the row is removed, then every remaining Track row in that Mon–Sun
  week has F–I recomputed and rewritten, and `formatTrackRow` re-stamps the
  number formats (the Track tab is a Sheets Table; this is the bug v4.5 hit).
- Susans has no pay math, so a Susans delete is only a delete.
- The response names every row it changed, and the UI shows that list.

Row **deletion is by located row index, resolved from the timestamp at write
time under the lock** — never an index the client supplied.

## Access control

The Web App URL is baked into `CFG_DEFAULTS` and the repo is public. Today's
exposure is **write-only**. A read endpoint would make income history and the
idea list **world-readable**, so it gets a gate.

- `READ_TOKEN` lives in Apps Script Script Properties.
- The client keeps it in `localStorage` under `read_token`, **deliberately
  absent from `CFG_DEFAULTS`** — baking it into a public repo defeats it.
- **Prompted on the page that needs it.** `index.html` never reads, so it
  gets no settings field; its only change is the nav links.
- Apps Script always returns HTTP 200, so a rejection is
  `{success:false, code:'unauthorized'}`; the client branches on that code to
  show the key prompt rather than a generic error.

Accepted risk: anything running on the origin can read the token. The origin
serves only this app, so the practical failure mode is a cleared cache.

## Ideas and materials

**Status** is a new column `H Status` on Ideas. **A blank cell reads as
Active**, so nothing is backfilled and the sheet stays untouched until the
user taps something. States are Active → Done → Archived, cycling.

**Materials** gets a new column `G Got it`. `E Price` is also patchable —
it's already maintained by hand, and it makes the materials list a live
shopping list. `F Notes` stays read-only.

**Row identity:**

- An idea is identified by its column-A timestamp, compared as `getTime()`
  and only on cells that are actually `Date`s. Never a row index — that
  shifts the moment a row is sorted or deleted in Sheets.
- A material is identified by **timestamp + item text**, because every
  material from one idea shares that idea's timestamp.
- When the timestamp is blank (one row already is, hand-added), it falls back
  to **project + item**. If the fallback matches more than one row it
  **refuses to write** rather than guessing.
- No match returns `{success:false,error:'row not found'}`, shown as
  "couldn't find that idea — reload".

**Target columns are found by header name, not letter** — the Materials
mistake proves why. A missing header fails loudly, naming what it wanted.

**Patchable fields, whitelisted server-side:** `status` and `next_step` on an
idea; `acquired` and `price` on a material. Everything else is rejected.

## Wire contracts

```jsonc
{"op":"read","scope":"shifts","token":"…","sheet_ids":{"tip":"…"}}
→ {"success":true,"fetched_at":"ISO","shifts":[ …see shift shape above… ]}

{"op":"read","scope":"ideas","token":"…","sheet_ids":{"idea":"…"}}
→ {"success":true,"fetched_at":"ISO",
   "ideas":[{"ts":"ISO","title":"…","category":"…","effort":"…",
             "excitement":3,"nextStep":"…","tags":"…","status":"Active"}],
   "materials":[{"ts":"ISO|null","project":"…","item":"…","category":"…",
                 "price":57.42,"notes":"…","acquired":false}]}

{"op":"patch","target":"idea","ts":"ISO","field":"status","value":"Done",…}
{"op":"patch","target":"material","ts":"ISO|null","project":"…",
 "item":"drill bit","field":"acquired","value":true,…}
→ {"success":true,"field":"status","value":"Done"}

{"op":"delete","target":"shift","venue":"Track","ts":"ISO",
 "expect":{"hours":9.17,"tips":242},"token":"…",…}
→ {"success":true,"deleted":"ISO","recomputed":["ISO","ISO"]}
```

## Files

**New — server** (pure logic, no Apps Script APIs; pasted into the same Apps
Script project, pulled into the browser only under `?test=1`, exactly like
`tipRouting.js` and `trackPay.js`):

- `server/readApi.js` → `readApi.gs` — row→object normalizers, duplicate
  detection, `columnForHeader`, `recomputeWeek`.
- `server/sheetWrite.js` → `sheetWrite.gs` — the `PATCHABLE` whitelist, row
  location (timestamp, timestamp+item, project+item fallback), patch and
  delete validation.

**New — client:** `shifts.html`, `ideas.html`, `dataClient.js` (token, POST
transport, typed errors, localStorage cache), `shiftStats.js` (pure
aggregation), `ideaModel.js` (pure: status transitions, sort/filter,
materials grouped under their idea), `theme.css`.

The pure modules touch no DOM at load, so the existing harness on
`index.html` can test them without the pages being open.

**Modified:** `server/routerWebApp.gs` (op dispatch, token → v4.8);
`index.html` (nav links only); `tests.js`.

## Performance

Volumes are tiny — 33 shifts and 25 ideas today, tens of KB at any plausible
growth. No pagination, no incremental sync: fetch everything, every time.

Latency is the real problem. This project's execution history shows Apps
Script runs of 268s / 107s / 82s. Each page **renders from its localStorage
cache immediately**, fetches in the background, swaps in fresh data when it
lands, and marks the data "as of <time>" while stale. A first-ever load with
an empty cache shows a skeleton, not a spinner that might sit for a minute.

## Testing

- Pure-module tests: aggregation, week grouping, `recomputeWeek` against the
  real stored values (7/23–8/15 rows reproduce F–I to the penny), duplicate
  detection, status transitions, the patch whitelist, and every branch of row
  location including the blank-timestamp fallback and the refuse-on-ambiguous
  case.
- Source-inspecting tests on `routerWebApp.gs`, fetched through `fetchText`
  so they cache-bust — a cached `.gs` once made the harness validate the
  previous version of the file. They assert: the read branch precedes
  `LockService`; `log` is reachable with no token; the whitelist exists;
  delete re-verifies before removing.
- `shifts.html?mock=1` / `ideas.html?mock=1` render from fixtures, so the UI
  is verifiable without the live sheet or a token. Inert without the param.
- Every new test verified **red first**.
- Baseline to keep: `137 passed, 0 failed`.

## One-time setup by the user

1. Add a **`Status`** header in Ideas column H, and a **`Got it`** header in
   Materials column G.
2. Set `READ_TOKEN` in Apps Script → Project Settings → Script Properties to
   a long random string, and save it somewhere.
3. Paste `readApi.gs`, `sheetWrite.gs`, and the updated `routerWebApp.gs`,
   then publish via **Deploy → Manage deployments → pencil → Version: New
   version**. Not "New deployment" — that mints a fresh `/exec` URL while
   `CFG_DEFAULTS` still points at the old one.
4. Enter the token once when a page asks for it.

## Deferred

- Backfilling the 16 pre-v4.5 Track rows into the sheet. Display-only
  recompute was chosen; once `recomputeWeek` exists, making it write those
  rows is roughly a line of wiring.
- Meal and car views.
- A withholding model for the next employer — needs a real paystub to
  calibrate against, exactly as Track did.
