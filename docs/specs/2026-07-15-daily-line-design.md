# Daily Line — Design

**Date:** 2026-07-15
**Status:** Approved (brainstormed with user)

## What

A daily rotating line — a mix of mantras, reflection prompts, and attributed
quotes — shown in the `#hint` slot under the mic, replacing the static
"speak naturally — it figures out the rest" hint. One line per local day;
it holds still all day and rolls at midnight.

## Why

The user wants something to spark a thought or serve as a mantra each day.
The static hint is dead weight (single user, knows how the app works), so
the slot is reclaimed at zero screen-space cost.

## Content model

A flat list of entries in a new top-level `daily.js`:

```js
const DAILY_LINES = [
  { text: 'Begin again.' },                                  // mantra
  { text: 'What did today actually cost you?' },             // prompt
  { text: 'The impediment to action advances action.',
    author: 'Marcus Aurelius' },                             // quote
];
```

- `author` is optional. Mantras/prompts stand alone; quotes render a
  small `— Name` attribution beneath the text.
- No `type` field — nothing branches on it.
- Tone: grounded/practical with a dry edge. No incense, no greeting-card.
- Seed size: ~100 lines (a season without repeats; quality over filler).
  Voice check: user reviews a ~15-line draft before the rest are written.

## Architecture

- **`daily.js`** — new file at repo root, loaded via a plain relative
  `<script src="daily.js">` tag (subpath invariant: relative paths only).
  Holds `DAILY_LINES` and the pure selector. Kept out of `index.html`
  deliberately — the tests.js split just slimmed index.html by 29%;
  editing lines must never touch app code.
- **`lineForDay(date, lines)`** — pure function. Hashes the full local
  date string (year-month-day) to an index into `lines`. Hash, not
  `dayOfYear % length`: modulo would repeat identically on the same date
  every year and walk the list in order on consecutive days.
- **Render** — on init, set the `#hint` element's content from
  `lineForDay(new Date(), DAILY_LINES)`. Text plus optional attribution
  line. The element keeps its existing id, styling hooks, and the
  text-mode fade-out, so the mic morph is untouched.

## Error handling

- `daily.js` missing / failed to load / empty list → the hint area renders
  nothing. App is otherwise unaffected. No error surfaced.
- Guarded by checking `typeof DAILY_LINES !== 'undefined'` (or
  `window.DAILY_LINES`) before rendering.

## Day boundary

Local time, consistent with the Today view's `today_logs` pruning. No
timer; the line is computed once per page load. (A PWA left open across
midnight shows yesterday's line until next open — accepted, same behavior
as the Today view.)

## Testing (tests.js, in-page harness)

- Same date → same line (deterministic).
- Two different dates → can differ (spot-check a pair known to differ).
- Repeated calls with the same date are stable.
- Empty list / undefined list → returns null, render skips cleanly.
- Attribution renders only when `author` present.
- Date key is local, not UTC (construct a Date near midnight UTC and
  assert the local day is used).
- Existing 54 tests stay green.

## Out of scope (deliberate)

- Tap-to-reshuffle / "next line" control.
- Gemini-generated lines or any network source.
- Per-category or log-aware line selection.
- Any storage; selection is a pure function of the date.
