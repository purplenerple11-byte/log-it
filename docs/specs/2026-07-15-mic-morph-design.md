# Design — Feature #4: Voice ⇄ Text Morph Transition

**Date:** 2026-07-15
**Scope:** Client only (`index.html`). Mockup-validated (Option A, pure shape
morph), with user-tuned timing.

## Problem

Toggling Voice/Type hard-swaps `#mic-wrap` for `#text-wrap` via `display:none`
(`setMode`) — a jarring jump.

## Approved interaction (from mockup)

- The mic circle itself **morphs** into the text box: border-radius circle→16px,
  size 90×90 → full-width×120px, border 3px white → 1px `var(--border)`,
  background `var(--bg)` → `var(--surface)`. Duration **320ms**,
  `cubic-bezier(.4,0,.2,1)`.
- Pulse rings fade out (~280ms). Mic SVG fades out (~180ms).
- Placeholder/"Log It →": fade in on expand (placeholder ~250ms with ~140ms
  delay; button slides up ~250ms, ~100ms delay). On collapse the placeholder
  fades **fast** (~100ms, no delay).
- The "speak naturally" hint fades out in text mode.
- Status heading: voice = "Tap to log", text mode = **"Type to log"** (changed
  from "Type your entry" to parallel "Tap to log").
- Reverse animation on toggling back.

## Implementation approach

- The existing `#mic-btn` (with `#mic-wrap` rings) becomes the morphing shell:
  a `text-mode` class on `#app` (or body) drives all transitions in CSS —
  `setMode` toggles the class instead of `display:none` swaps.
- The real `#text-input` textarea fades in **inside/over** the morphed shell at
  the end of the transition (opacity + pointer-events), so focus/keyboard work
  natively; `#send-btn` is the "Log It →" that slides up. `#text-wrap` may be
  repurposed or absorbed — implementation detail, but the DOM ids `#text-input`
  and `#send-btn` and all existing JS handlers (submitText, validateConfig,
  Ctrl/Cmd+Enter) must keep working unchanged.
- Recording state (`.recording` class, ring animation) only applies in voice
  mode; toggling to text while recording stops recording first (existing
  `stopRecording` call path).
- `initSpeech`'s no-SpeechRecognition fallback (`setMode('text')`) must still
  work — the morph just runs instantly on load in that case.
- This feature **intentionally unfreezes** `#mic-wrap`/`#text-wrap`/`#hint`
  styling frozen during Feature #2. Today-view boxes, confirm card, fail card,
  settings panel are untouched.

## Testing

- Existing 41-test suite must stay green (no behavioral JS contract changes).
- Add harness tests where feasible: `setMode('text')` adds the mode class +
  status reads "Type to log"; `setMode('voice')` removes it + "Tap to log";
  submitText path still works in text mode (integration test with __testRouter).
- Manual: drive both toggles in browser, screenshot both states, verify morph
  runs and input is focusable/editable; verify voice mode still records
  (visual check of recording class only — SpeechRecognition can't be driven
  headlessly).

## Out of scope

Any change to submission logic, Today view, or server.
