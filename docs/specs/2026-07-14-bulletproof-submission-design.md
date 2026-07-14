# Design — Feature #1: Bulletproof Submission

**Date:** 2026-07-14
**Project:** Log It (voice/text → structured Google Sheets logger)
**Scope:** Client-side only (`index.html` PWA). The Apps Script router and Gemini
prompt are untouched by this feature.

## Problem

Two linked problems in the current submit flow:

1. **Data loss on failure.** When a send fails, the user's input is gone and must
   be retyped.
   - Text mode: `submitText()` runs `input.value = ''` *immediately* after firing
     the request, before the result returns. On failure, the box is already empty.
   - Voice mode: `recognition.onend` sets `currentText = ''` and the `catch` block
     in `processEntry` wipes `#transcript`. The only copy of the words is lost.
2. **Perceived slowness / hangs.** `processEntry` blocks on a single `fetch` with
   **no timeout** (`callRouter`). If the request hangs, the UI is stuck on
   "Thinking…" forever with no recovery.

## Chosen approach

**Option B — "wait, but bulletproof."** Keep waiting for the real, enriched
server confirmation message (e.g. *"Track shift logged — 6h, $120 in tips
($20/hr)"*), but make the flow safe: input is never lost, requests can't hang,
transient failures auto-retry, and permanent failures surface a manual retry
card with the text preserved.

Rejected alternatives:
- **A (optimistic fire-and-forget):** would show a generic "Saved" instead of the
  enriched server message. User wants to see the real confirmation land.
- **C (hybrid optimistic + update-in-place):** more moving parts than needed.

## Behavior model — submission state machine

Submission becomes a small state machine rather than a single blocking `await`:

```
idle → sending → (retrying…) → confirmed        (success)
                              → failed (manual)  (gave up / permanent error)
```

- The user's text is held in a `pendingEntry` variable for the entire lifecycle.
- `pendingEntry` is **only** cleared once the server returns `success: true`.
- Text mode: move `input.value = ''` to *after* confirmed success.
- Voice mode: stop wiping `#transcript` until confirmed success.

## Error taxonomy

Two buckets, handled oppositely:

| Bucket | Conditions | Handling |
|---|---|---|
| **Transient** | `fetch` rejects (offline/DNS), request **times out**, HTTP **5xx** or **429** | auto-retry |
| **Permanent** | HTTP **4xx**, or `{success:false, error:…}` from router (Gemini refused / bad parse) | straight to manual |

Rationale: retrying a permanent error wastes the user's time and can't succeed.

## Timeout + retry policy

- **Per-attempt timeout: 15s** via `AbortController` (fixes the infinite
  "Thinking…" hang).
- **Transient failure:** up to **2 auto-retries** (3 attempts total).
- **Backoff:** 1s before retry #1, 3s before retry #2.
- During auto-retry, `#status` shows **"Connection hiccup — retrying…"** (visible,
  not silent-dead) so the user knows work is ongoing. (Configurable to fully
  silent later if desired.)
- After 3 failed attempts, or on any permanent error → **manual failure state**.

## UI changes

- **Sending state:** `#status` = "Thinking…" (unchanged text), but now bounded by
  the 15s timeout — can no longer hang forever.
- **Retrying state:** `#status` = "Connection hiccup — retrying…".
- **Manual-failure card:** replaces the current transient `#err-toast` for
  submission failures. A **persistent** card showing:
  - the user's exact text,
  - a primary **Retry** button (re-sends the held `pendingEntry`),
  - a secondary **Dismiss / Copy** action.
  One tap re-sends; nothing to retype.
- **Success:** unchanged UX — the enriched server message still renders in the
  existing confirm card (`showConfirm`), and *that* is the moment the input
  clears / transcript resets.

Note: `#err-toast` remains for non-submission errors (e.g. mic errors, missing
config). Only submission failures route to the new manual-failure card.

## Testing

The app is single-file vanilla JS with no test harness. To verify "bulletproof"
honestly, add a **dev-only mock-router toggle**: a hidden flag that makes
`callRouter` simulate each outcome without hitting the live Apps Script:

- `timeout` (never resolves within 15s),
- `network-fail` (immediate reject),
- `server-error` (`{success:false, error:…}`),
- `http-5xx` / `http-4xx`,
- `success` (canned enriched message).

Every branch of the state machine (auto-retry path, backoff, manual card, retry
from card, success clearing) must be exercised against this mock before any live
testing. The toggle ships disabled by default and leaves production behavior
unchanged.

## Out of scope (parked)

- **Feature #2 — "Today" read-back view** (next sub-project).
- **Cost/efficiency (D):** Gemini model choice + prompt size — server-side, folded
  into the audit follow-up.
- **Minor audit items:** hardcoded 3.8s confirmation timing duplicated in three
  places; `card-fill` `!important`; missing `manifest.json` for true PWA install.
