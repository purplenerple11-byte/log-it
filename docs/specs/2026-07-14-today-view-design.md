# Design — Feature #2: "Today" Read-Back View

**Date:** 2026-07-14
**Project:** Log It (voice/text → structured Google Sheets logger)
**Scope:** Client-side only (`index.html`). **No** server / Apps Script / Gemini
changes. Purely additive — see the "Do-not-touch" boundary below.

## Problem / goal

The app is write-only: you log things but can't see what you've logged. Add a
minimal, at-a-glance read-back of **today's** logs, directly on the main screen.

Approved interaction (validated via mockup):
- Under the mic, a row of tiny orange squares — **one square per log made today**.
- Tap the row → each square expands into a full-width orange "bullet" row showing
  the log's icon, category, summary, and time. The squares read as a bullet list.
- Tap again → collapses back to the tiny squares.
- Tapping does **nothing else** (no per-row action, no edit, no delete).
- At local midnight the view resets; today's logs persist until then.

## Chosen approach — local mirror (client-only)

Each time a log **succeeds**, the app already receives
`{ success, category, sub_route, message }` and holds the original `text`. We save
a copy of that to `localStorage` on the device. The Today view renders from this
local list. **No backend work; no read endpoint.**

Accepted trade-offs (confirmed with user): shows only logs made from *this
device/browser*; does not reflect rows edited directly in the Sheet; cleared if
browser data is wiped. For a personal phone logger this is sufficient.

## Data model

One `localStorage` key holds an array of today's entries. Each entry:

```json
{
  "ts": 1752521100000,        // epoch ms, client clock (log time)
  "day": "2026-07-14",        // local YYYY-MM-DD, for cheap filtering
  "category": "grocery",      // from server response
  "sub_route": "",            // from server response ("Track"/"Susans" for tips)
  "message": "Shop vac hose logged.",  // enriched server confirmation
  "text": "Bought a shop vac hose for 15 bucks"  // original user input
}
```

- **Key:** `today_logs`.
- Icon + label are **not** stored — they are derived at render time from the
  existing `CAT_UI` map via the existing `catKey(category, sub_route)` helper, so
  the Today view reuses the single source of category styling already in the file.
- On every write, entries whose `day` ≠ today's local day are **pruned**, so the
  store only ever holds the current day. This is what makes "reset at midnight"
  automatic — no timer needed.

## Data flow

1. **Record (write):** In the success branch of `processEntry`, immediately after
   the existing `showConfirm(result.category, result.sub_route, result.message)`
   call (index.html:735), add one call:
   `recordTodayLog(result.category, result.sub_route, result.message, text)`.
   This is the **only** line added to existing logic. `recordTodayLog` builds the
   entry, prunes to today, saves, and re-renders the Today component.
2. **Render (read):** On app load, and after each successful log, read the store,
   filter to today, and render the squares/rows. Expanded/collapsed state is
   preserved across re-renders.

## Component & rendering

A new self-contained block inserted **after** `#mic-wrap` (index.html:395),
before `#hint`. New markup, new CSS classes, new JS — all namespaced (`today-*`),
nothing existing modified.

- **Collapsed:** a centered row of tiny **15×15px**, 4px-radius, solid orange
  (`#cc785c`) squares — one per today's entry. No text, no icon. A dim
  "tap to see today" hint sits under it.
- **Expanded:** each square animates into a full-width orange row (14px radius,
  ~58px tall) revealing, left→right: category emoji (from `CAT_UI`), category
  label + summary (`message`), and the log **time** right-aligned
  (formatted `h:mm AM/PM` from `ts`). Rows are ordered **newest first**.
- **Empty state (0 logs today):** the entire component is `display:none` — the
  main screen is pixel-identical to its current appearance. (No "0 logged" text,
  no empty boxes.)
- Colors/sizes/animation match the approved mockup (orange squares → orange bullet
  rows, ~280–300ms morph, staggered).

## Layout constraint (important) — chosen: push-down (Option B)

The current `#app` is a vertically-centered flex column (`justify-content:center`).
The user requires the **status heading and mic to stay visually fixed** during
expand/collapse (the mic must not move) **and** the mockup's push-down behavior
(the toggle/input slide down to make room). Under center-justification these
conflict: growing content in flow re-centers the column and shifts the mic up.

**Resolution (Option B, user-approved):** change `#app` from vertically-centered
to **top-anchored** — `justify-content: center` → `flex-start`, with top padding
tuned so the resting layout matches the approved mockup (content anchored from the
top rather than floating in the middle). Then:
- The status + mic sit at a fixed top position and **do not move** on expand —
  **acceptance criterion**.
- Expanding the list grows the column downward in normal flow, pushing `#hint`,
  `#mode-toggle`, `#transcript`, `#text-wrap` **down** — the mockup behavior.
- Collapsing returns them to rest.

This is the **single intentional change to an existing style** (the `#app`
container's vertical alignment + its padding). It changes the app's resting look
from centered to top-anchored — which matches the mockup the user approved as
"clean." The mic, rings, status, toggle, input, and all other components keep
their own markup and styles unchanged; they are merely anchored differently by the
container. Collapsed squares add ~15px between mic and hint; zero when empty
(`display:none`).

## Do-not-touch boundary (explicit)

This feature modifies **only** `index.html` and adds only new, namespaced code,
with exactly **two** authorized touches to existing code:
1. The single additive `recordTodayLog(...)` call in the `processEntry` success
   branch (index.html:735).
2. The `#app` container's vertical alignment + padding change (center →
   top-anchored), per the Layout constraint section above.

It must **not** alter, restyle, or reposition any of: `#status`, `#mic-wrap`,
`#mic-btn`, `.pulse` (mic + rings), `#hint`, `#mode-toggle` / `.mode-btn`,
`#transcript`, `#text-wrap` / `#text-input`, `#confirm-card`, `#fail-card`,
`#gear-btn`, existing CSS variables, or any existing JS function's behavior. No
server changes. (The mic's own appearance is unchanged; it simply sits at a fixed
top position instead of a centered one.)

## Error handling / edge cases

- **localStorage unavailable** (private mode): the existing `LS` helper already
  swallows errors; reads return empty, so the Today view simply renders nothing.
  Logging still works.
- **Log added while expanded:** re-render keeps the expanded state; the new row
  appears at top.
- **Crossing midnight with app open:** "today" is computed at render time; the
  next render (next log or next expand) reflects the new day. No background timer.
- **Malformed/legacy stored data:** reads are defensive (JSON parse in try/catch,
  ignore entries missing required fields).

## Testing

Reuse the `?test=1` in-page harness from Feature #1.

Unit tests (pure/injectable functions):
- `localDayStamp(ts)` → correct local `YYYY-MM-DD`.
- `pruneToToday(entries, now)` → keeps only today's, drops others.
- `formatLogTime(ts)` → `h:mm AM/PM` (e.g. leading-hour, midnight/noon edge).
- `recordTodayLog(...)` with injected storage → appends, prunes, persists.
- `readTodayLogs(...)` with injected storage → returns today's, newest first;
  tolerates malformed JSON.

Integration (harness, real DOM): render N entries → N collapsed squares; expand →
rows show correct icon/label/summary/time; empty store → component hidden.

Manual (browser): drive the real UI — log via `?mock=success`, confirm a square
appears; tap to expand/collapse; confirm the mic and header do not move.

## Out of scope / non-goals (YAGNI)

- Editing or deleting logs from the view.
- Multi-day history, search, or totals.
- Server read-back / cross-device sync.
- Reflecting manual edits made directly in the Sheet.
- Any change to the mic, recording, or submission logic, or to the styling of
  existing elements — except the one authorized `#app` alignment/padding change
  (see Layout constraint).
