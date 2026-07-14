# Bulletproof Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Log It's submit flow lossless and hang-proof — the user's text is never lost, requests can't hang forever, transient failures auto-retry, and permanent failures surface a manual retry card with the text preserved.

**Architecture:** Refactor the inline submit logic in `index.html` into small, dependency-injectable units (typed error model, error classifier, backoff schedule, single-attempt `callRouter`, and a `submitWithRetry` state machine). Wire those into a rewritten `processEntry` that manages a `pendingEntry` buffer and a new manual-failure card. Because the project has no Node/npm/test runner, verification is done with an **in-page test harness** gated behind `?test=1` (assertions on the pure/injectable units) plus a `?mock=<scenario>` dev switch for hand-driving the full UI in a browser.

**Tech Stack:** Vanilla HTML/CSS/JS, single file (`index.html`), no build step. `AbortController` for timeouts, `fetch` for the router call. Served by GitHub Pages; tested locally via `file://` in a browser.

## Global Constraints

- Single self-contained file: `index.html`. No new files, no npm dependencies, no build step.
- Per-attempt timeout: **15000 ms** (`SUBMIT_TIMEOUT_MS`).
- Max attempts: **3** total (`SUBMIT_MAX_ATTEMPTS`).
- Backoff before retries: **1000 ms** then **3000 ms** (`SUBMIT_BACKOFFS_MS = [1000, 3000]`).
- Transient (retry): `fetch` reject (network), timeout, HTTP 5xx, HTTP 429. Permanent (no retry): HTTP 4xx (except 429), `{success:false}` server response, unparseable body.
- Retrying status text (verbatim): `Connection hiccup — retrying…`
- The enriched server `message` must still be shown on success (unchanged confirm-card behavior).
- Input/transcript is cleared **only** on confirmed success.
- Test harness and mock switch are dev-only, gated behind URL params (`?test=1`, `?mock=…`), and must not change production behavior when the params are absent.
- Existing color palette / dark theme unchanged. Action color `#cc785c`, error surface reuses `#2a1111`/`#7f1d1d` family.

**Verification model (applies to every "Run test" step):** Open the file in a browser (the Browser pane, or any Chrome/Safari) at
`file:///Users/pigote/Desktop/log-it/index.html?test=1`
and read the rendered PASS/FAIL report. There is no CLI test runner. Reload after each edit (no cache concerns on `file://`).

---

## File Structure

- **Modify:** `index.html` — all changes live here. New JS units are added inside the existing `<script>`; new markup for the failure card is added near `#err-toast`; new CSS near the `#err-toast` / `#confirm-card` blocks.

There are stale copies `indexv2.html` and `Indexv3.html` in the repo. They are **not** touched by this plan (out of scope; candidate for a later cleanup commit).

---

## Task 1: Test harness + typed error model + classifier

Establishes the in-page test runner and the first pure units: the `SubmitError` type and `isTransient()` classifier.

**Files:**
- Modify: `index.html` (inside `<script>`, near the top of the logic section after the `LS` helper)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class SubmitError extends Error` with `.kind` (`'timeout'|'network'|'http'|'server'`) and `.status` (number|undefined).
  - `isTransient(err) -> boolean`.
  - Test harness: `test(name, fn)`, `assert(cond, msg)`, `assertEq(actual, expected, msg)`, `runTests()`.

- [ ] **Step 1: Add the test harness (runs only under `?test=1`)**

Add this block at the very end of the `<script>` (just before `</script>`), replacing nothing yet:

```javascript
// ================================================================
// DEV TEST HARNESS  (active only with ?test=1)
// ================================================================
const TESTS = [];
function test(name, fn) { TESTS.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(actual, expected, msg) {
  if (actual !== expected) throw new Error((msg ? msg + ': ' : '') + 'expected ' + expected + ' got ' + actual);
}
async function runTests() {
  document.body.innerHTML = '';
  const out = document.createElement('pre');
  out.style.cssText = 'padding:16px;font:13px Menlo,monospace;color:#f4f4f5;white-space:pre-wrap';
  document.body.appendChild(out);
  let pass = 0, fail = 0;
  for (const t of TESTS) {
    try { await t.fn(); pass++; out.innerHTML += '<span style="color:#22c55e">PASS</span> ' + t.name + '\n'; }
    catch (e) { fail++; out.innerHTML += '<span style="color:#fca5a5">FAIL</span> ' + t.name + ' — ' + e.message + '\n'; }
  }
  out.innerHTML += '\n' + (fail ? '<span style="color:#fca5a5">' : '<span style="color:#22c55e">')
    + pass + ' passed, ' + fail + ' failed</span>\n';
}
```

- [ ] **Step 2: Add the error model and classifier**

Add directly above the test harness block:

```javascript
// ================================================================
// SUBMIT ERROR MODEL + CLASSIFIER
// ================================================================
class SubmitError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = 'SubmitError';
    this.kind = kind;        // 'timeout' | 'network' | 'http' | 'server'
    this.status = status;    // HTTP status for kind==='http', else undefined
  }
}

function isTransient(err) {
  if (!(err instanceof SubmitError)) return false;
  if (err.kind === 'timeout' || err.kind === 'network') return true;
  if (err.kind === 'http') return err.status >= 500 || err.status === 429;
  return false; // 'server' (logic error) and http 4xx are permanent
}
```

- [ ] **Step 3: Register the failing tests**

Add above `runTests` is fine, but register tests inside a `?test=1` guard at the very end of the `<script>`:

```javascript
// ---- TEST REGISTRATION + RUN (dev only) ----
if (new URLSearchParams(location.search).get('test') === '1') {
  test('isTransient: network is transient', () => {
    assertEq(isTransient(new SubmitError('network', 'x')), true);
  });
  test('isTransient: timeout is transient', () => {
    assertEq(isTransient(new SubmitError('timeout', 'x')), true);
  });
  test('isTransient: http 500 is transient', () => {
    assertEq(isTransient(new SubmitError('http', 'x', 500)), true);
  });
  test('isTransient: http 429 is transient', () => {
    assertEq(isTransient(new SubmitError('http', 'x', 429)), true);
  });
  test('isTransient: http 400 is permanent', () => {
    assertEq(isTransient(new SubmitError('http', 'x', 400)), false);
  });
  test('isTransient: server error is permanent', () => {
    assertEq(isTransient(new SubmitError('server', 'x')), false);
  });
  test('isTransient: plain Error is not transient', () => {
    assertEq(isTransient(new Error('x')), false);
  });
  runTests();
}
```

- [ ] **Step 4: Run to verify they PASS**

Open `file:///Users/pigote/Desktop/log-it/index.html?test=1`.
Expected: 7 lines, all `PASS`, footer `7 passed, 0 failed`.
(These pass immediately because Steps 2–3 were added together; this task has no red phase because the type and its tests are inseparable — the classifier cannot be exercised without the type existing.)

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "test: add in-page harness + SubmitError model and isTransient classifier"
```

---

## Task 2: Backoff schedule

Pure function returning the wait before each retry.

**Files:**
- Modify: `index.html` (below the classifier)

**Interfaces:**
- Consumes: `SUBMIT_BACKOFFS_MS`.
- Produces: `nextBackoffMs(completedAttempts) -> number`.

- [ ] **Step 1: Write the failing tests**

Add to the `?test=1` registration block (after the existing tests):

```javascript
  test('nextBackoffMs: after attempt 1 waits 1000', () => {
    assertEq(nextBackoffMs(1), 1000);
  });
  test('nextBackoffMs: after attempt 2 waits 3000', () => {
    assertEq(nextBackoffMs(2), 3000);
  });
  test('nextBackoffMs: beyond schedule clamps to last (3000)', () => {
    assertEq(nextBackoffMs(5), 3000);
  });
```

- [ ] **Step 2: Run to verify FAIL**

Open `…/index.html?test=1`.
Expected: the three `nextBackoffMs` tests `FAIL` with "nextBackoffMs is not defined".

- [ ] **Step 3: Add the constants + implementation**

Add near the top of the logic section (just after the `STATE` block), the config constants:

```javascript
// ================================================================
// SUBMIT CONFIG
// ================================================================
const SUBMIT_TIMEOUT_MS  = 15000;
const SUBMIT_MAX_ATTEMPTS = 3;
const SUBMIT_BACKOFFS_MS = [1000, 3000]; // before retry #1, retry #2
```

And add below the classifier:

```javascript
function nextBackoffMs(completedAttempts) {
  const i = completedAttempts - 1;
  return SUBMIT_BACKOFFS_MS[i] ?? SUBMIT_BACKOFFS_MS[SUBMIT_BACKOFFS_MS.length - 1];
}
```

- [ ] **Step 4: Run to verify PASS**

Open `…/index.html?test=1`.
Expected: all `nextBackoffMs` tests `PASS`; footer `10 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add submit config constants and nextBackoffMs schedule"
```

---

## Task 3: Single-attempt callRouter with timeout + typed errors

Replace the existing `callRouter` with a dependency-injectable, timeout-bounded version that throws `SubmitError`.

**Files:**
- Modify: `index.html` — replace the existing `callRouter` (currently lines ~668–695).

**Interfaces:**
- Consumes: `SubmitError`, `SUBMIT_TIMEOUT_MS`, `LS`.
- Produces: `async callRouter(text, deps = {}) -> data`. `deps.fetchImpl` (default `window.fetch`), `deps.timeoutMs` (default `SUBMIT_TIMEOUT_MS`). Throws `SubmitError` on any failure.

- [ ] **Step 1: Write the failing tests**

Add to the `?test=1` block. These inject a fake `fetchImpl` so no network is used:

```javascript
  test('callRouter: success returns parsed data', async () => {
    const fake = async () => ({ ok: true, json: async () => ({ success: true, message: 'ok' }) });
    const data = await callRouter('hi', { fetchImpl: fake });
    assertEq(data.message, 'ok');
  });
  test('callRouter: network reject -> SubmitError network', async () => {
    const fake = async () => { throw new TypeError('Failed to fetch'); };
    try { await callRouter('hi', { fetchImpl: fake }); assert(false, 'should throw'); }
    catch (e) { assertEq(e.kind, 'network'); }
  });
  test('callRouter: http 500 -> SubmitError http 500', async () => {
    const fake = async () => ({ ok: false, status: 500, json: async () => ({}) });
    try { await callRouter('hi', { fetchImpl: fake }); assert(false, 'should throw'); }
    catch (e) { assertEq(e.kind, 'http'); assertEq(e.status, 500); }
  });
  test('callRouter: {success:false} -> SubmitError server', async () => {
    const fake = async () => ({ ok: true, json: async () => ({ success: false, error: 'nope' }) });
    try { await callRouter('hi', { fetchImpl: fake }); assert(false, 'should throw'); }
    catch (e) { assertEq(e.kind, 'server'); assertEq(e.message, 'nope'); }
  });
  test('callRouter: timeout -> SubmitError timeout', async () => {
    const fake = (url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
      });
    });
    try { await callRouter('hi', { fetchImpl: fake, timeoutMs: 50 }); assert(false, 'should throw'); }
    catch (e) { assertEq(e.kind, 'timeout'); }
  });
```

- [ ] **Step 2: Run to verify FAIL**

Open `…/index.html?test=1`.
Expected: the `callRouter` tests `FAIL` (old `callRouter` throws plain `Error`, so `.kind` is `undefined` and the timeout/injection cases fail).

- [ ] **Step 3: Replace callRouter**

Replace the entire existing `callRouter` function with:

```javascript
// ================================================================
// SINGLE ATTEMPT TO APPS SCRIPT (timeout-bounded, typed errors)
// ================================================================
async function callRouter(text, deps = {}) {
  const fetchImpl = deps.fetchImpl || window.fetch.bind(window);
  const timeoutMs = deps.timeoutMs ?? SUBMIT_TIMEOUT_MS;
  const url = LS.get('router_url');

  const payload = {
    text,
    sheet_ids: {
      tip:     LS.get('sheet_tip'),
      meal:    LS.get('sheet_meal'),
      grocery: LS.get('sheet_grocery'),
      idea:    LS.get('sheet_idea'),
      car:     LS.get('sheet_car')
    }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') throw new SubmitError('timeout', 'Request timed out');
    throw new SubmitError('network', 'Network error');
  }
  clearTimeout(timer);

  if (!res.ok) throw new SubmitError('http', 'Router error ' + res.status, res.status);

  let data;
  try { data = await res.json(); }
  catch { throw new SubmitError('server', 'Bad response from router'); }

  if (!data.success) throw new SubmitError('server', data.error || 'Something went wrong');
  return data;
}
```

- [ ] **Step 4: Run to verify PASS**

Open `…/index.html?test=1`.
Expected: all `callRouter` tests `PASS`; footer `15 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: timeout-bounded callRouter with typed SubmitError outcomes"
```

---

## Task 4: submitWithRetry state machine

The retry loop: transient → backoff + `onRetrying` + retry (up to max); permanent → throw immediately; success → return.

**Files:**
- Modify: `index.html` (below `callRouter`)

**Interfaces:**
- Consumes: `callRouter`, `isTransient`, `nextBackoffMs`, `SUBMIT_MAX_ATTEMPTS`.
- Produces: `async submitWithRetry(text, deps = {}, hooks = {}) -> data`.
  - `deps.router` (default `callRouter`), `deps.sleep` (default real `setTimeout` promise), `deps.maxAttempts` (default `SUBMIT_MAX_ATTEMPTS`); `deps` is also forwarded to `router`.
  - `hooks.onRetrying(completedAttempts)` called before each backoff wait.
  - Throws the last `SubmitError` when exhausted or on a permanent error.

- [ ] **Step 1: Write the failing tests**

Add to the `?test=1` block. A helper builds a fake router from a scripted list of outcomes:

```javascript
  // helper: router that yields scripted outcomes; records calls + sleeps
  function scriptedRouter(outcomes) {
    let i = 0;
    return async () => {
      const o = outcomes[i++];
      if (o instanceof Error) throw o;
      return o;
    };
  }

  test('submitWithRetry: succeeds first try (no sleep, no retry)', async () => {
    const sleeps = [];
    const data = await submitWithRetry('hi', {
      router: scriptedRouter([{ success: true, message: 'ok' }]),
      sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); }
    });
    assertEq(data.message, 'ok');
    assertEq(sleeps.length, 0);
  });

  test('submitWithRetry: transient then success (retries once, waits 1000)', async () => {
    const sleeps = []; let retried = 0;
    const data = await submitWithRetry('hi', {
      router: scriptedRouter([new SubmitError('network', 'x'), { success: true, message: 'ok' }]),
      sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); }
    }, { onRetrying: () => retried++ });
    assertEq(data.message, 'ok');
    assertEq(retried, 1);
    assertEq(sleeps[0], 1000);
  });

  test('submitWithRetry: 3 transient -> throws after 3 attempts', async () => {
    const sleeps = [];
    try {
      await submitWithRetry('hi', {
        router: scriptedRouter([
          new SubmitError('timeout', 'x'),
          new SubmitError('timeout', 'x'),
          new SubmitError('timeout', 'x')
        ]),
        sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); }
      });
      assert(false, 'should throw');
    } catch (e) {
      assertEq(e.kind, 'timeout');
      assertEq(sleeps.length, 2); // waited before attempt 2 and 3 only
    }
  });

  test('submitWithRetry: permanent throws immediately (no retry)', async () => {
    const sleeps = [];
    try {
      await submitWithRetry('hi', {
        router: scriptedRouter([new SubmitError('server', 'nope'), { success: true }]),
        sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); }
      });
      assert(false, 'should throw');
    } catch (e) {
      assertEq(e.kind, 'server');
      assertEq(sleeps.length, 0);
    }
  });
```

- [ ] **Step 2: Run to verify FAIL**

Open `…/index.html?test=1`.
Expected: the four `submitWithRetry` tests `FAIL` with "submitWithRetry is not defined".

- [ ] **Step 3: Implement submitWithRetry**

Add directly below `callRouter`:

```javascript
// ================================================================
// RETRY STATE MACHINE
// ================================================================
async function submitWithRetry(text, deps = {}, hooks = {}) {
  const router = deps.router || callRouter;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = deps.maxAttempts ?? SUBMIT_MAX_ATTEMPTS;

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await router(text, deps);
    } catch (err) {
      const canRetry = isTransient(err) && attempt < maxAttempts;
      if (!canRetry) throw err;
      if (hooks.onRetrying) hooks.onRetrying(attempt);
      await sleep(nextBackoffMs(attempt));
    }
  }
}
```

- [ ] **Step 4: Run to verify PASS**

Open `…/index.html?test=1`.
Expected: all four `submitWithRetry` tests `PASS`; footer `19 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: submitWithRetry state machine (auto-retry transient, fail-fast permanent)"
```

---

## Task 5: Manual-failure card (markup, styles, controls)

The persistent card that preserves the user's text with Retry / Copy / Dismiss.

**Files:**
- Modify: `index.html` — add CSS near `#err-toast` rules; add markup near the `#err-toast` element; add JS control functions.

**Interfaces:**
- Consumes: `SubmitError`, `pendingEntry` (declared here as a module-level `let`), `processEntry` (used by Retry — defined in Task 6; Retry is wired now but only fires on user click).
- Produces:
  - `let pendingEntry` (module-level, initialized `null`).
  - `showFailCard(text, err)`, `hideFailCard()`, `failReason(err) -> string`, `retryPending()`, `copyPending()`.

- [ ] **Step 1: Write the failing tests**

Add to the `?test=1` block. These assert on the DOM (the harness clears `document.body` in `runTests`, so build the card into a detached fragment check instead — assert the functions manipulate the real elements before the harness wipes them). To keep it deterministic, test `failReason` (pure) and the show/hide class toggles:

```javascript
  test('failReason: timeout message', () => {
    assert(failReason(new SubmitError('timeout', 'x')).indexOf('imed out') !== -1);
  });
  test('failReason: network message', () => {
    assert(failReason(new SubmitError('network', 'x')).toLowerCase().indexOf('connection') !== -1);
  });
  test('failReason: http includes status', () => {
    assert(failReason(new SubmitError('http', 'x', 503)).indexOf('503') !== -1);
  });
  test('failReason: server uses its message', () => {
    assertEq(failReason(new SubmitError('server', 'router said no')), 'router said no');
  });
```

> Note: DOM show/hide is verified by hand in Task 7 (the `?test=1` harness replaces `document.body`, so it cannot also assert on the live card without fighting itself). `failReason` is the pure part and is unit-tested here.

- [ ] **Step 2: Run to verify FAIL**

Open `…/index.html?test=1`.
Expected: the four `failReason` tests `FAIL` with "failReason is not defined".

- [ ] **Step 3: Add the CSS**

Add after the `#err-toast` CSS block:

```css
    /* ── MANUAL FAILURE CARD ── */
    #fail-card {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      background: #2a1111;
      border-top: 1px solid #7f1d1d;
      border-radius: 24px 24px 0 0;
      padding: 24px 24px 40px;
      transform: translateY(110%);
      transition: transform .35s cubic-bezier(0.34, 1.4, 0.64, 1);
      z-index: 250;
      box-shadow: 0 -10px 40px rgba(0,0,0,0.5);
    }
    #fail-card.show { transform: translateY(0); }
    #fail-title { font-size: 16px; font-weight: 700; color: #fca5a5; margin-bottom: 4px; }
    #fail-reason { font-size: 13px; color: #f0a0a0; margin-bottom: 14px; }
    #fail-text {
      background: rgba(0,0,0,.25);
      border: 1px solid #7f1d1d;
      border-radius: 12px;
      padding: 12px 14px;
      color: var(--text);
      font-size: 15px; line-height: 1.5;
      user-select: text;
      max-height: 120px; overflow-y: auto;
      margin-bottom: 16px;
    }
    #fail-actions { display: flex; gap: 10px; }
    .fail-btn {
      flex: 1;
      border: none; border-radius: 12px;
      padding: 14px; font-size: 15px; font-weight: 600;
      cursor: pointer;
    }
    #fail-retry { background: var(--action); color: #fff; }
    #fail-copy, #fail-dismiss { background: rgba(255,255,255,.08); color: var(--text); }
```

- [ ] **Step 4: Add the markup**

Add directly after the `#err-toast` element (after its closing `</div>`):

```html
<div id="fail-card">
  <div id="fail-title">Couldn't send</div>
  <div id="fail-reason"></div>
  <div id="fail-text"></div>
  <div id="fail-actions">
    <button class="fail-btn" id="fail-retry"   onclick="retryPending()">Retry</button>
    <button class="fail-btn" id="fail-copy"     onclick="copyPending()">Copy</button>
    <button class="fail-btn" id="fail-dismiss"  onclick="hideFailCard()">Dismiss</button>
  </div>
</div>
```

- [ ] **Step 5: Add the JS control functions + pendingEntry**

In the `STATE` block, add:

```javascript
let pendingEntry = null;
```

Add a new section below the UI helpers (near `showError`):

```javascript
// ================================================================
// MANUAL FAILURE CARD
// ================================================================
function failReason(err) {
  if (!(err instanceof SubmitError)) return 'Something went wrong.';
  switch (err.kind) {
    case 'timeout': return 'Timed out after several tries.';
    case 'network': return 'No connection after several tries.';
    case 'http':    return 'Server error (' + err.status + ').';
    default:        return err.message || 'The router rejected it.';
  }
}

function showFailCard(text, err) {
  document.getElementById('fail-text').textContent = text;
  document.getElementById('fail-reason').textContent = failReason(err);
  document.getElementById('fail-card').classList.add('show');
}

function hideFailCard() {
  document.getElementById('fail-card').classList.remove('show');
}

function retryPending() {
  if (pendingEntry) processEntry(pendingEntry);
}

async function copyPending() {
  try { await navigator.clipboard.writeText(pendingEntry || ''); } catch {}
}
```

- [ ] **Step 6: Run to verify PASS**

Open `…/index.html?test=1`.
Expected: the four `failReason` tests `PASS`; footer `23 passed, 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: manual-failure card with preserved text, retry/copy/dismiss"
```

---

## Task 6: Wire processEntry + preserve input on failure

Rewrite `processEntry` to drive the state machine, manage `pendingEntry`, clear input only on success, and route failures to the fail card. Remove the input-clearing and transcript-wiping data-loss bugs.

**Files:**
- Modify: `index.html` — replace `processEntry` (~645–663); edit `submitText` (~617–624); edit voice `onerror`/`onend`/`stopRecordingUI` path only where it wipes text.

**Interfaces:**
- Consumes: `submitWithRetry`, `showConfirm`, `showFailCard`, `hideFailCard`, `setStatus`, `pendingEntry`, `mode`.
- Produces: rewritten `async processEntry(text)`; `clearInputs()`.

- [ ] **Step 1: Add integration tests (injected router, drive processEntry)**

Add to the `?test=1` block. These call the real `processEntry` after overriding its router via a module-level test hook. First we need `processEntry` to accept an injectable router; do that by reading an optional `window.__testRouter`. Add these tests:

```javascript
  test('processEntry: success clears pendingEntry and text input', async () => {
    document.getElementById('text-input').value = 'buy milk';
    window.__testRouter = async () => ({ success: true, category: 'grocery', sub_route: '', message: 'Milk logged.' });
    window.__testSleep = () => Promise.resolve();
    await processEntry('buy milk');
    assertEq(pendingEntry, null);
    assertEq(document.getElementById('text-input').value, '');
    delete window.__testRouter; delete window.__testSleep;
  });

  test('processEntry: permanent failure keeps pendingEntry + shows fail card', async () => {
    document.getElementById('text-input').value = 'weird entry';
    window.__testRouter = async () => { throw new SubmitError('server', 'router rejected'); };
    window.__testSleep = () => Promise.resolve();
    await processEntry('weird entry');
    assertEq(pendingEntry, 'weird entry');
    assert(document.getElementById('fail-card').classList.contains('show'), 'fail card should show');
    assertEq(document.getElementById('fail-text').textContent, 'weird entry');
    hideFailCard();
    delete window.__testRouter; delete window.__testSleep;
  });

  test('processEntry: transient x3 keeps text (never lost)', async () => {
    window.__testRouter = async () => { throw new SubmitError('network', 'down'); };
    window.__testSleep = () => Promise.resolve();
    await processEntry('important note');
    assertEq(pendingEntry, 'important note');
    assertEq(document.getElementById('fail-text').textContent, 'important note');
    hideFailCard();
    delete window.__testRouter; delete window.__testSleep;
  });
```

> These tests run before `runTests()` wipes the body, so the elements still exist. Order matters: registration runs top-to-bottom, `runTests()` is the final call.

- [ ] **Step 2: Run to verify FAIL**

Open `…/index.html?test=1`.
Expected: the three `processEntry` tests `FAIL` (current `processEntry` ignores `__testRouter`, calls real network → throws plain error / wrong state).

- [ ] **Step 3: Rewrite processEntry**

Replace the entire `processEntry` function with:

```javascript
// ================================================================
// CORE FLOW
// ================================================================
async function processEntry(text) {
  pendingEntry = text;
  hideFailCard();
  setStatus('Thinking…');
  document.getElementById('transcript').textContent = text;

  const deps = {};
  if (window.__testRouter) deps.router = window.__testRouter;
  if (window.__testSleep)  deps.sleep  = window.__testSleep;

  try {
    const result = await submitWithRetry(text, deps, {
      onRetrying: () => setStatus('Connection hiccup — retrying…')
    });
    showConfirm(result.category, result.sub_route, result.message);
    setStatus('Logged ✓');
    pendingEntry = null;
    clearInputs();
    setTimeout(() => {
      setStatus(mode === 'voice' ? 'Tap to log' : 'Type your entry');
      document.getElementById('transcript').textContent = '';
    }, 3800);
  } catch (err) {
    setStatus(mode === 'voice' ? 'Tap to log' : 'Type your entry');
    showFailCard(text, err);
  }
}

function clearInputs() {
  const input = document.getElementById('text-input');
  if (input) input.value = '';
}
```

- [ ] **Step 4: Fix submitText (do not clear input eagerly)**

Replace `submitText` with:

```javascript
function submitText() {
  const input = document.getElementById('text-input');
  const text  = input.value.trim();
  if (!text) return;
  if (!validateConfig()) return;
  processEntry(text);
  // input is cleared only on confirmed success (see processEntry -> clearInputs)
}
```

- [ ] **Step 5: Run to verify PASS**

Open `…/index.html?test=1`.
Expected: all three `processEntry` tests `PASS`; footer `26 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: wire processEntry to retry machine; never lose input on failure"
```

---

## Task 7: Dev mock switch + full manual verification

Add `?mock=<scenario>` for hand-driving the real UI (no test hooks), then verify every path in a browser.

**Files:**
- Modify: `index.html` — add mock plumbing read at init; small branch in `callRouter`'s default `fetchImpl` selection.

**Interfaces:**
- Consumes: `callRouter` deps path.
- Produces: `mockFetchFor(scenario) -> fetchImpl`; init reads `?mock=` and optional `?to=<ms>`.

- [ ] **Step 1: Add the mock fetch factory + init wiring**

Add near the config constants:

```javascript
// ================================================================
// DEV MOCK ROUTER  (active only with ?mock=<scenario>)
// ================================================================
let __mockScenario = null;
function mockFetchFor(scenario) {
  return (url, opts) => {
    switch (scenario) {
      case 'success': return Promise.resolve({ ok: true, json: async () => ({ success: true, category: 'grocery', sub_route: '', message: 'Mock: item logged ✓' }) });
      case 'server':  return Promise.resolve({ ok: true, json: async () => ({ success: false, error: 'Mock: router rejected this' }) });
      case 'http5xx': return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
      case 'http4xx': return Promise.resolve({ ok: false, status: 400, json: async () => ({}) });
      case 'network': return Promise.reject(new TypeError('Mock: failed to fetch'));
      case 'timeout': return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
      });
      default: return Promise.reject(new Error('unknown mock scenario: ' + scenario));
    }
  };
}
```

- [ ] **Step 2: Make callRouter honor the mock when no explicit fetchImpl is given**

In `callRouter`, change the `fetchImpl` line from:

```javascript
  const fetchImpl = deps.fetchImpl || window.fetch.bind(window);
```

to:

```javascript
  const fetchImpl = deps.fetchImpl
    || (__mockScenario ? mockFetchFor(__mockScenario) : window.fetch.bind(window));
```

- [ ] **Step 3: Read the URL params at init**

Add to the `INIT` section (before `initSpeech()`):

```javascript
(function initDevFlags() {
  const p = new URLSearchParams(location.search);
  if (p.get('mock')) __mockScenario = p.get('mock');
  if (p.get('to'))   window.__DEV_TIMEOUT_OVERRIDE = parseInt(p.get('to'), 10);
})();
```

And, so `?to=` can shorten the 15s wait during a manual timeout test, change `callRouter`'s `timeoutMs` line from:

```javascript
  const timeoutMs = deps.timeoutMs ?? SUBMIT_TIMEOUT_MS;
```

to:

```javascript
  const timeoutMs = deps.timeoutMs ?? window.__DEV_TIMEOUT_OVERRIDE ?? SUBMIT_TIMEOUT_MS;
```

- [ ] **Step 4: Confirm the unit suite still passes**

Open `…/index.html?test=1`.
Expected: footer `26 passed, 0 failed` (mock plumbing is inert without `?mock=`).

- [ ] **Step 5: Manual verification in a browser (the real UI)**

For each URL below, open it, switch to **Type** mode, enter `test entry`, tap **Log It**, and confirm the observed behavior. (Add `&to=2000` to the timeout case so it fails in ~2s instead of 15s.) A router URL must be saved in Settings for the app to proceed past `validateConfig` — enter any non-empty URL; the mock intercepts before real network.

| URL | Expected |
|---|---|
| `index.html?mock=success` | Confirm card shows "Mock: item logged ✓"; textarea clears. |
| `index.html?mock=server` | Fail card appears immediately; reason = "Mock: router rejected this"; text `test entry` preserved in the card; textarea NOT cleared. |
| `index.html?mock=http4xx` | Fail card immediately; reason "Server error (400)."; text preserved. |
| `index.html?mock=http5xx` | Status flips to "Connection hiccup — retrying…" (twice), then fail card; reason "Server error (503)."; text preserved. |
| `index.html?mock=network` | Retry status shown, then fail card; reason mentions connection; text preserved. |
| `index.html?mock=timeout&to=2000` | After ~2s, retry status, then (after ~3 tries) fail card; reason "Timed out…"; text preserved. |
| From the fail card (any case) | Tap **Retry** re-sends `test entry`; tap **Copy** copies it; tap **Dismiss** hides the card. |

Record the result of each row. All must pass.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: dev ?mock= router switch + timeout override for manual verification"
```

---

## Task 8: Final review pass + push

**Files:**
- Modify: none (verification only), then push branch.

- [ ] **Step 1: Full unit run**

Open `…/index.html?test=1`. Expected: `26 passed, 0 failed`.

- [ ] **Step 2: Production smoke (no dev params)**

Open `index.html` with NO query params. Confirm: app renders normally, `?test=1` UI absent, mock inert. Save a real router + sheet IDs in Settings and log one real entry end-to-end; confirm the enriched server message appears and the input clears.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feature/bulletproof-submission
```

- [ ] **Step 4: Report** the commit list and the manual-verification table results to the user, and ask whether to open a PR to `Main` or deploy.

---

## Self-Review

**Spec coverage:**
- Data-loss bug (text mode eager clear) → Task 6 (Step 4). ✅
- Data-loss bug (voice transcript wipe) → Task 6 removes the wipe (catch no longer clears transcript; success path clears after 3.8s). ✅
- State machine `idle→sending→retrying→confirmed/failed` → Tasks 4 + 6. ✅
- Error taxonomy (transient vs permanent, 5xx/429 vs 4xx/server) → Tasks 1 + 3. ✅
- 15s timeout via AbortController → Task 3. ✅
- 2 auto-retries / 3 attempts, backoff 1s/3s → Tasks 2 + 4. ✅
- "Connection hiccup — retrying…" visible status → Task 6. ✅
- Manual-failure card (text + Retry + Copy/Dismiss) → Task 5. ✅
- Enriched success message preserved → Task 6 (`showConfirm` unchanged). ✅
- Dev mock toggle simulating timeout/network/server/http/success → Task 7. ✅
- Ships disabled by default, no prod behavior change → Tasks 1/7 guards + Task 8 Step 2. ✅
- `#err-toast` retained for non-submission errors → untouched (mic/config errors still call `showError`). ✅

**Placeholder scan:** No TBD/TODO; every code step contains complete code. ✅

**Type consistency:** `SubmitError(kind, message, status)`, `.kind`/`.status`, `isTransient`, `nextBackoffMs`, `callRouter(text, deps)`, `submitWithRetry(text, deps, hooks)`, `pendingEntry`, `showFailCard`/`hideFailCard`/`failReason`/`retryPending`/`copyPending`, `clearInputs`, `mockFetchFor`, `__mockScenario` — names used consistently across tasks. ✅

**Known intentional deviation:** DOM show/hide of the fail card is verified in Task 7 (manual) rather than in `?test=1`, because the harness replaces `document.body`; the pure `failReason` is unit-tested. Documented in Task 5 Step 1. ✅
