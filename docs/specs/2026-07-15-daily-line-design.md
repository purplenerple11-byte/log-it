# Daily Line — Design

**Date:** 2026-07-15
**Status:** Approved (brainstormed with user; revised same day for time windows)

## What

A rotating line — a mix of mantras, reflection prompts, and attributed
quotes — shown in the `#hint` slot under the mic, replacing the static
"speak naturally — it figures out the rest" hint. The day has two windows:
**morning** (midnight–4:59pm) and **evening** (5pm–midnight). One line per
window; it holds still within its window, rolls once at 5pm and again at
midnight.

## Why

The user wants something to spark a thought or serve as a mantra each day,
and some prompts only make sense at certain times — "What did today
actually cost you?" belongs to the end of the day, not the start. The
static hint is dead weight (single user, knows how the app works), so the
slot is reclaimed at zero screen-space cost.

## Content model

A flat list of entries in a new top-level `daily.js`:

```js
const DAILY_LINES = [
  { text: 'Begin again.' },                                  // floater: any window
  { text: "What's the one thing worth writing down today?",
    when: 'am' },                                            // morning-only
  { text: 'What did today actually cost you?', when: 'pm' }, // evening-only
  { text: 'The impediment to action advances action.',
    author: 'Marcus Aurelius' },                             // quote, floater
];
```

- `when` is optional: `'am'` (morning window only), `'pm'` (evening window
  only), absent = floater, eligible in both windows.
- `author` is optional. Mantras/prompts stand alone; quotes render a
  small `— Name` attribution beneath the text.
- No `type` field — nothing branches on it.
- Tone: grounded/practical with a dry edge. No incense, no greeting-card.
- Seed size: ~100 lines (quality over filler). Voice check: user reviews
  a ~15-line draft before the rest are written.

## Architecture

- **`daily.js`** — new file at repo root, loaded via a plain relative
  `<script src="daily.js">` tag (subpath invariant: relative paths only).
  Holds `DAILY_LINES` and the pure selector. Kept out of `index.html`
  deliberately — the tests.js split just slimmed index.html by 29%;
  editing lines must never touch app code.
- **Window rule** — `windowFor(date)`: local hour < 17 → `'am'`,
  else `'pm'`. The 5pm boundary is fixed, not configurable.
- **`lineFor(date, lines)`** — pure function. Filters `lines` to the
  current window's pool (matching `when` + floaters), then hashes the
  local date key **plus the window** to an index. Hashing date+window
  makes the evening pick independent of the morning pick. Hash, not
  `dayOfYear % length`: modulo would repeat identically on the same date
  every year and walk the list in order on consecutive days.
- **Render** — on init, set the `#hint` element's content from
  `lineFor(new Date(), DAILY_LINES)`. Text plus optional attribution
  line. The element keeps its existing id, styling hooks, and the
  text-mode fade-out, so the mic morph is untouched.

## Error handling

- `daily.js` missing / failed to load / empty list / a window's pool is
  empty → the hint area renders nothing. App is otherwise unaffected.
  No error surfaced.
- Guarded by checking `typeof DAILY_LINES !== 'undefined'` (or
  `window.DAILY_LINES`) before rendering.

## Time boundaries

Local time, consistent with the Today view's `today_logs` pruning. No
timer; the line is computed once per page load. (A PWA left open across
5pm or midnight shows the previous window's line until next open —
accepted, same behavior as the Today view. The app is a quick-open tool;
every open recomputes.)

## Testing (tests.js, in-page harness)

- Same date + same window → same line (deterministic, stable across calls).
- Morning vs evening of the same date → drawn from the correct pools
  (an `'am'`-tagged line never appears after 5pm and vice versa).
- Floaters are eligible in both windows.
- `windowFor`: 16:59 → `'am'`, 17:00 → `'pm'`; boundary is local time,
  not UTC.
- Empty list / undefined list / empty pool → returns null, render skips
  cleanly.
- Attribution renders only when `author` present.
- Existing 54 tests stay green.

## Out of scope (deliberate)

- Tap-to-reshuffle / "next line" control.
- A timer that swaps the line at 5pm while the app sits open.
- Configurable window boundaries or more than two windows.
- Gemini-generated lines or any network source.
- Per-category or log-aware line selection.
- Any storage; selection is a pure function of date + window.
