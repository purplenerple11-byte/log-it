# Read/Interact Front End — Design

**Date:** 2026-08-16
**Status:** Approved (brainstormed with user 2026-08-16)

## What

Two new pages in the same repo, reached from the mic screen:

- **`shifts.html`** — earnings over time (weekly and monthly totals, tips vs
  wage, effective $/hr trend, Track vs Susans) *and* a filterable log of
  individual shifts.
- **`ideas.html`** — every captured idea, browsable, with a small amount of
  write-back: move an idea between **Active / Done / Archived**, edit its
  next step, and tick off materials as acquired.

Meals and car maintenance are deliberately out of scope. The plumbing this
builds makes adding either one later a small job.

## Why

Log It is a one-way pipe. The only read-back is `today_logs` in
localStorage, pruned to the current day, so everything older is reachable
only by opening Google Sheets on a phone. Months of shift earnings and a
growing pile of captured ideas are effectively write-only.

Ideas in particular need the write-back: a list you can't cross things off
of goes stale, and then stops being worth opening.

Google Sheets stays the system of record. Nothing about the logging path
changes.

## Approach chosen

Extend the existing router with new ops, rather than standing up a second
Web App or publishing tabs as CSV.

- A **second Web App** would buy hard isolation but doubles the
  paste-and-republish ritual and adds a second URL to `CFG_DEFAULTS`. Given
  how much of this project's history is deploy discipline going wrong, that
  cost outweighs the isolation.
- **Published CSV** needs no server code but is public by definition, so it
  can't carry the read token, and gives no write path — the idea status
  changes would need a real endpoint anyway.

## Transport

One endpoint, one transport. `doPost` gains an `op` field:

| `op` | Meaning |
|---|---|
| absent / `log` | Today's behavior, byte for byte |
| `read` | Return rows for a scope |
| `patch` | Change one whitelisted field on one row |

Reads ride the same `POST text/plain` the logger uses. A `doGet` would put
the token in the query string — where it lands in referrers and logs — and
Apps Script GETs bounce through a redirect to `googleusercontent.com`,
which is a CORS surprise waiting to be discovered in production. The POST
path is already proven under real use.

## Three load-bearing invariants

1. **Reads take no script lock.** `doPost` holds the script lock for the
   whole request so retries are idempotent (v4.6). A read holding that lock
   would mean opening the shifts page blocks logging a shift. Reads branch
   out *before* the lock is acquired.
2. **The token gates `read`/`patch` only.** The `log` path never checks it.
   A missing or wrong token can never stop a log from being written.
3. **Pay-week boundaries come from the server.** Track rows are returned
   already tagged with `payWeekStart(ts)` from `trackPay.gs` — the same
   function that priced them. The dashboard cannot drift from the pay math
   because it never computes a week boundary itself.

## Access control

The Web App URL is baked into `CFG_DEFAULTS` and the repo is public. Today's
exposure is **write-only**: a stranger can push junk rows in. A read
endpoint would make income history and the idea list **world-readable**,
which is a different kind of exposure, so it gets a gate.

- `READ_TOKEN` lives in Apps Script Script Properties.
- The client keeps it in `localStorage` under `read_token`. It is
  **deliberately absent from `CFG_DEFAULTS`** — baking it into a public repo
  would defeat the entire point.
- Entered once in the ⚙ panel. localStorage is per-origin, so both new pages
  pick it up.
- Apps Script always returns HTTP 200, so a rejection is
  `{success:false, code:'unauthorized'}`; the client branches on that code to
  prompt for the key rather than showing a generic error.

Accepted risk: anything running on the origin can read the token. The origin
serves only this app, so the practical failure mode is a cleared cache, not
theft.

## Wire contracts

```jsonc
// read — shifts
{"op":"read","scope":"shifts","token":"…","sheet_ids":{"tip":"…"}}
→ {"success":true,"fetched_at":"ISO",
   "track":[{"ts":"ISO","week":"YYYY-MM-DD","hours":9.27,"tips":350,"notes":"",
             "gross":…,"net":…,"takeHome":…,"effHourly":…}],
   "susans":[{"ts":"ISO","clockIn":"9:00am","clockOut":"2:00pm","hours":5,
              "pay":100,"notes":""}]}

// read — ideas
{"op":"read","scope":"ideas","token":"…","sheet_ids":{"idea":"…"}}
→ {"success":true,"fetched_at":"ISO",
   "ideas":[{"ts":"ISO","title":"…","category":"…","effort":"…","excitement":3,
             "nextStep":"…","tags":"…","status":"Active"}],
   "materials":[{"ts":"ISO","title":"…","item":"…","category":"…",
                 "acquired":false}]}

// patch
{"op":"patch","target":"idea","ts":"ISO","field":"status","value":"Done",…}
{"op":"patch","target":"material","ts":"ISO","item":"drill bit",
 "field":"acquired","value":true,…}
→ {"success":true,"field":"status","value":"Done"}
```

### Patch safety rules

- **Row identity is the column-A timestamp**, compared as `getTime()` and
  only on cells that are actually `Date`s. Never the row index — that shifts
  the moment a row is sorted or deleted in Sheets, and would silently patch
  the wrong idea. No match returns `{success:false,error:'row not found'}`,
  which the UI shows as "couldn't find that idea — reload".
- **Target columns are found by header name, not letter.** The Materials
  handler already appends two blank columns (E and F) whose headers aren't
  visible from the repo; guessing a letter risks overwriting real data. A
  missing header fails loudly, naming the header it wanted.
- **Only whitelisted fields are patchable**: `status` and `next_step` on an
  idea, `acquired` on a material. Everything else is rejected server-side.
- A patch **does** take the script lock. It's fast, and it must not
  interleave with a log write mid-append.

## Files

**New — server** (pure logic, no Apps Script APIs; pasted into the same Apps
Script project, pulled into the browser only under `?test=1`, exactly like
`tipRouting.js` and `trackPay.js`):

- `server/readApi.js` → `readApi.gs` — row→object normalizers for Track,
  Susans, Ideas, Materials; `columnForHeader(headers, name)`.
- `server/ideaWrite.js` → `ideaWrite.gs` — the `PATCHABLE` whitelist,
  `findRowByTimestamp`, patch validation.

**New — client:**

- `shifts.html`, `ideas.html` — markup, styles, DOM wiring; self-contained.
- `dataClient.js` — token, POST transport, typed errors, localStorage cache.
- `shiftStats.js` — pure aggregation: group by `week`, monthly rollups,
  tips-vs-wage split, effective $/hr series, filter predicates.
- `ideaModel.js` — pure: status transitions, sort/filter, materials grouped
  under their idea.
- `theme.css` — the `:root` token block, shared by the two new pages.

The pure modules load without touching the DOM, so the existing harness on
`index.html` can test them without the pages being open.

**Modified:**

- `server/routerWebApp.gs` — `op` dispatch, token check → v4.8.
- `index.html` — exactly two changes: a `read_token` field in the ⚙ panel,
  and nav to the two pages. It is **not** refactored onto `theme.css`; it
  stays self-contained. The mic path is untouched.
- `tests.js` — new tests; the `?test=1` injector also loads the new pure
  modules.

## Performance

Volumes are tiny — a few hundred shift rows and a few hundred ideas per
year, tens of KB. No pagination, no incremental sync: fetch everything,
every time.

Latency is the real problem. This project's own execution history shows
Apps Script runs of 268s / 107s / 82s. So each page **renders from its
localStorage cache immediately**, fetches in the background, and swaps in
fresh data when it lands, marking the data "as of <time>" while it's stale.
A first-ever load with an empty cache shows a skeleton, not a spinner that
might sit for a minute.

## Testing

- Pure-module tests for aggregation, week grouping, status transitions, and
  the patch field whitelist.
- Source-inspecting tests on `routerWebApp.gs`, fetched through `fetchText`
  so they cache-bust — a cached `.gs` once made the harness validate the
  previous version of the file. They assert: the read branch precedes
  `LockService`; `log` is reachable with no token; the whitelist exists.
- `shifts.html?mock=1` / `ideas.html?mock=1` render from fixtures, so the UI
  is verifiable without the live sheet or a token. Inert without the param,
  mirroring the existing `?mock=` switch.
- Every new test verified **red first**, per this repo's practice.
- Baseline to keep: `137 passed, 0 failed`.

## One-time setup by the user

Nothing works until these are done:

1. Add a **`Status`** header to the Ideas tab, and an acquired-flag header to
   the Materials tab (named during implementation, once the existing headers
   are visible).
2. Set `READ_TOKEN` in Apps Script → Project Settings → Script Properties to
   a long random string, and save it somewhere — clearing phone storage means
   re-entering it.
3. Paste `readApi.gs`, `ideaWrite.gs`, and the updated `routerWebApp.gs`,
   then publish via **Deploy → Manage deployments → pencil → Version: New
   version**. Not "New deployment" — that mints a fresh `/exec` URL while
   `CFG_DEFAULTS` still points at the old one.
4. Enter the token once in the ⚙ panel.

## Open questions

None. Idea states are Active/Done/Archived; materials are tick-off-able;
meals and car are out of scope.
