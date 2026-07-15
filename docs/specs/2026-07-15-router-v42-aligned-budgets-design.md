# Design — Feature #3: Router v4.2 (Aligned Retry Budgets + NaN Fix)

**Date:** 2026-07-15
**Scope:** Server-side only (`server/routerWebApp.gs`, new to repo). No client changes.

## Problems

1. **Duplicate-write risk.** Client aborts at 15s and retries, but Apps Script
   keeps running and may still write the row → duplicate sheet rows. Root cause:
   server worst case (2 models × 3 attempts + `Utilities.sleep(1500*attempt)`
   ≈ 9s sleeping + 6 Gemini calls) can exceed the client's 15s timeout.
2. **Confirmed `+ +` NaN bug.** In `SYSTEM_PROMPT`, the ambiguous AM/PM time
   rule line is prefixed `+ +` (binary plus then unary plus) → the string
   coerces to `NaN`; Gemini receives the literal text "NaN" instead of the rule.
   Empirically verified in a JS engine.
3. **Rate-limit reality** (free tier): primary `gemini-3.1-flash-lite`
   15 RPM / 500 RPD; fallback `gemini-3.5-flash` only **20 RPD**. The current
   chain can burn 3 fallback requests on one bad log.

Cost is a non-issue (~$0.0005/log) — this design optimizes latency and
correctness only.

## Chosen approach — Option A: align the budgets

**Invariant: the server's worst case always finishes inside the client's 15s
timeout.** Then a client timeout always means genuine server failure, so the
client's retry (the only retry layer that preserves the user's text and shows
"retrying…") is always safe, and the duplicate window closes.

Rejected: idempotency key (Option B) — adds a stateful dedupe store to a
stateless single-user system; blast radius of a freak duplicate is one
hand-deleted row. YAGNI.

## Changes to `routerWebApp.gs` (v4.1 → v4.2)

1. `callGeminiSingleModel`: remove the internal 3-attempt loop and all
   `Utilities.sleep` calls. One fetch per model; any failure throws
   immediately and the chain falls through to the next model.
   Delete the now-unused `GEMINI_RETRY_DELAY`.
2. Fix `+ +` → `+` on the ambiguous-time line of `SYSTEM_PROMPT`, restoring:
   `- Ambiguous times without am/pm: 7 8 9 10 11 → AM | 12 1 2 3 4 5 6 → PM`.
3. Header comment bump to v4.2 with a one-line change note.
4. Everything else byte-identical in behavior: handlers, prompt content,
   model list, response shape, error paths.

New worst case: ~5-9s (2 sequential Gemini calls + Sheets write) vs. client
15s. Max Gemini calls per log: 6 (3 client attempts × 2 models) vs. 18 before.
Fallback model spends ≤1 RPD per bad log instead of 3.

## Delivery

- Corrected file committed to **`server/routerWebApp.gs`** — brings the router
  under version control (the NaN bug hid precisely because it wasn't).
- User pastes into Apps Script and creates a new deployment (same URL flow).

## Testing

- **Prompt regression test (automated):** `SYSTEM_PROMPT` is plain JS string
  concatenation. Evaluate the corrected expression in the browser harness;
  assert the AM/PM rule text IS present and `NaN` is NOT.
- **Syntax pass:** the file is V8 JS minus Google APIs; parse-check it
  (e.g. `new Function(src)` in browser with Google globals stubbed).
- **End-to-end (user):** after deploy, log "worked 2-4 at susans" → expect
  Susans routing with 2:00pm-4:00pm and the enriched confirmation.

## Out of scope (YAGNI)

Idempotency keys; prompt token trimming; Sheets I/O optimization
(`getSupplementsTakenToday` / grocery insert scans); client changes; legacy
form-based scripts (Auto Tips / Car / Food / Idea Capture — superseded by the
router for PWA use).
