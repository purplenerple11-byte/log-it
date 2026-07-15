# Router v4.2 + Mic Morph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox steps.

**Goal:** (1) Bring the Apps Script router into the repo with aligned retry budgets and the NaN prompt fix; (2) replace the jarring voice⇄text swap with a 320ms morph of the mic circle into the text box.

**Architecture:** Two independent tasks on one branch. Task 1 transcribes `Log It router.rtf` → `server/routerWebApp.gs` with three surgical changes, verified by an in-browser prompt regression test. Task 2 is CSS-class-driven morphing in `index.html` (a `text-mode` class replaces the `display:none` swap), keeping all JS contracts (`#text-input`, `#send-btn`, `submitText`, 41-test suite) intact.

**Tech Stack:** Vanilla JS/CSS single-file PWA; Apps Script (V8 JS) file delivered as repo artifact; `?test=1` in-page harness via `python3 -m http.server 8777`.

## Global Constraints

- Branch: `feature/router-v42-and-morph` off `Main`. Do not push.
- Suite must end ≥41 passed, 0 failed (plus any new tests).
- Specs govern exact values: `docs/specs/2026-07-15-router-v42-aligned-budgets-design.md`, `docs/specs/2026-07-15-mic-morph-design.md`.
- Task 2 must not touch Today-view boxes, confirm/fail cards, settings panel, or submission logic.

---

### Task 1: server/routerWebApp.gs (v4.2)

**Files:** Create `server/routerWebApp.gs`. Modify `index.html` (add prompt regression tests to `?test=1` block).

- [ ] Extract source: `textutil -convert txt -stdout "Log It router.rtf"` (repo root; file is untracked — do not delete/modify it). Clean RTF artifacts: smart quotes → ASCII, `薔` arrows → `→` only inside prompt strings where present, verify no stray `\'a0` remain.
- [ ] Apply exactly three changes: (a) header comment: v4.1 → v4.2 + note "aligned retry budgets; fixed NaN prompt bug"; (b) fix `+ +` → `+` on the SYSTEM_PROMPT ambiguous-times line; (c) in `callGeminiSingleModel`, remove the `for (attempt…)` loop and all `Utilities.sleep`: single fetch → if code===200 parse+return; else throw Error(errMsg). Delete `GEMINI_RETRY_DELAY`. Everything else byte-equivalent.
- [ ] Syntax check: in browser (`?test=1` page loaded), fetch `server/routerWebApp.gs` text and `new Function(src)` with stubs — but simpler and sufficient: add harness test below.
- [ ] Add to `?test=1` block: fetch `'server/routerWebApp.gs'`, assert (1) `new Function(src)` doesn't throw (parse check — Apps Script globals are only referenced at runtime), (2) source contains `'- Ambiguous times'` NOT preceded by `+ +` (regex `/\+\s*\+\s*'- Ambiguous/` absent), (3) source does not contain `Utilities.sleep`, (4) source contains `v4.2`. Async test using `fetch()` — the harness supports async fns.
- [ ] Run suite: expect 45 passed, 0 failed. Commit: `feat: add router v4.2 (aligned budgets, NaN fix) under server/`.

### Task 2: Mic ⇄ text morph

**Files:** Modify `index.html` only.

- [ ] Per the morph spec: add `text-mode` class mechanics to `setMode` (toggle class on `#app`; stop recording first if active; keep `#btn-voice`/`#btn-text` active-state logic and transcript clearing). Status text: voice "Tap to log", text "Type to log" (update `setMode`, `stopRecordingUI`, `processEntry` timeout restore, and anywhere `'Type your entry'` appears — replace all with "Type to log").
- [ ] CSS: transition `#mic-btn` (width/height/border-radius/border/background, 320ms `cubic-bezier(.4,0,.2,1)`); in text-mode it becomes full-width×120px, 16px radius, 1px `var(--border)`, `var(--surface)` bg. Rings fade 280ms; mic SVG fades 180ms. Real `#text-input` overlays the shell (absolute within `#mic-wrap` or shell container), opacity 0→1 (250ms, 140ms delay on expand; 100ms, 0 delay on collapse), `pointer-events` gated by mode. `#send-btn` slides up (250ms, 100ms delay). `#hint` fades out in text mode. `#mic-btn`'s click handler must be disabled in text mode (it's now the text surface — guard `toggleRecording` with mode check; it already effectively no-ops via `startRecording`'s `!recognition` guard only, so add explicit `if (mode !== 'voice') return;`).
- [ ] Keep working unchanged: `#text-input` id + Ctrl/Cmd+Enter handler, `submitText`, `#send-btn` onclick, `validateConfig`, no-SpeechRecognition fallback (`setMode('text')` at init → morph applies instantly; acceptable).
- [ ] Harness tests (+3): `setMode('text')` → `#app` has class + status "Type to log"; `setMode('voice')` → class removed + "Tap to log"; submitText integration still passes (existing test covers). Run suite: expect 48 passed, 0 failed.
- [ ] Manual browser: toggle both ways, screenshot each, verify input focusable (set value via JS + submitText with `?mock=success` → confirm card, input clears). Commit: `feat: morph mic circle into text box on mode toggle`.

### Task 3: Wrap-up

- [ ] Full suite green (48/0). Production smoke (no params). Report; controller reviews, merges to Main on user approval, pushes on user approval. User pastes `server/routerWebApp.gs` into Apps Script and redeploys.

## Self-Review

Spec coverage: router 3 changes ✓ (Task 1), prompt regression test ✓, morph timings/heading/unfreeze ✓ (Task 2), suite floor ✓. No placeholders — exact values inline or in the two committed specs. Type consistency: ids/classes match existing file (`#mic-btn`, `#mic-wrap`, `#text-input`, `#send-btn`, `setMode`, `toggleRecording`).
