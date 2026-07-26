// Log It — dev test harness. Loaded only by index.html when ?test=1.
// Split out of index.html so production doesn't ship ~10KB of tests.
// Runs against the real page: index.html defines the app, this asserts on it.
// Self-gating below is deliberate — including this file directly still no-ops
// without ?test=1.
// ================================================================
// DEV TEST HARNESS  (active only with ?test=1)
// ================================================================
const TESTS = [];
function test(name, fn) { TESTS.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(actual, expected, msg) {
  if (actual !== expected) throw new Error((msg ? msg + ': ' : '') + 'expected ' + expected + ' got ' + actual);
}
// Always read repo files fresh. Without this the browser happily serves a cached
// copy and a source-inspecting test silently validates the PREVIOUS version of a
// file — it reported the v4.5 router as still being v4.4. Every fetch of a repo
// file in this harness must go through here.
const CACHE_BUST = 'cb=' + Date.now() + '-' + Math.random().toString(36).slice(2);
function bust(path) {
  return path + (path.indexOf('?') === -1 ? '?' : '&') + CACHE_BUST;
}
function fetchText(path) {
  return fetch(bust(path)).then((r) => r.text());
}
function fetchJson(path) {
  return fetch(bust(path)).then((r) => r.json());
}

async function runTests() {
  // Hide the app but keep the DOM intact — integration tests manipulate real
  // elements (text-input, fail-card). Wiping the body would delete them.
  const app = document.getElementById('app');
  if (app) app.style.display = 'none';
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
  test('nextBackoffMs: after attempt 1 waits 1000', () => {
    assertEq(nextBackoffMs(1), 1000);
  });
  test('nextBackoffMs: after attempt 2 waits 3000', () => {
    assertEq(nextBackoffMs(2), 3000);
  });
  test('nextBackoffMs: beyond schedule clamps to last (3000)', () => {
    assertEq(nextBackoffMs(5), 3000);
  });
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

  // helper: router that yields scripted outcomes
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
  test('processEntry: success clears pendingEntry and text input', async () => {
    document.getElementById('text-input').value = 'buy milk';
    window.__testRouter = async () => ({ success: true, category: 'idea', sub_route: '', message: 'Idea logged.' });
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
  test('localDayStamp: formats local Y-M-D', () => {
    const ts = new Date(2026, 6, 14, 9, 5).getTime();
    assertEq(localDayStamp(ts), '2026-07-14');
  });
  test('pruneToToday: keeps only today', () => {
    const now = new Date(2026, 6, 14, 9, 5).getTime();
    const kept = pruneToToday([
      { ts: now, day: '2026-07-14' },
      { ts: 1, day: '2000-01-01' }
    ], now);
    assertEq(kept.length, 1);
    assertEq(kept[0].day, '2026-07-14');
  });
  test('formatLogTime: morning', () => {
    assertEq(formatLogTime(new Date(2026,6,14,9,5).getTime()), '9:05 AM');
  });
  test('formatLogTime: afternoon', () => {
    assertEq(formatLogTime(new Date(2026,6,14,14,30).getTime()), '2:30 PM');
  });
  test('formatLogTime: midnight', () => {
    assertEq(formatLogTime(new Date(2026,6,14,0,0).getTime()), '12:00 AM');
  });
  test('formatLogTime: noon', () => {
    assertEq(formatLogTime(new Date(2026,6,14,12,0).getTime()), '12:00 PM');
  });
  test('escapeHtml: escapes markup chars', () => {
    assertEq(escapeHtml('<b>&"x'), '&lt;b&gt;&amp;&quot;x');
  });
  function fakeStore(seed) {
    const mem = { [TODAY_KEY]: seed === undefined ? '' : seed };
    return { get: (k) => mem[k] || '', set: (k, v) => { mem[k] = v; }, mem };
  }
  test('recordTodayLog: appends an entry', () => {
    const now = new Date(2026,6,14,9,5).getTime();
    const s = fakeStore();
    recordTodayLog('idea', '', 'Idea logged.', 'what if', { get: s.get, set: s.set, now });
    const logs = readTodayLogs({ get: s.get, now });
    assertEq(logs.length, 1);
    assertEq(logs[0].category, 'idea');
    assertEq(logs[0].message, 'Idea logged.');
  });
  test('recordTodayLog: prunes previous-day entries', () => {
    const now = new Date(2026,6,14,9,5).getTime();
    const s = fakeStore(JSON.stringify([{ ts: 1, day: '2000-01-01', category: 'x' }]));
    recordTodayLog('meal', '', 'Lunch.', 'lunch', { get: s.get, set: s.set, now });
    const logs = readTodayLogs({ get: s.get, now });
    assertEq(logs.length, 1);
    assertEq(logs[0].category, 'meal');
  });
  test('readTodayLogs: newest first', () => {
    const now = new Date(2026,6,14,9,5).getTime();
    const s = fakeStore();
    recordTodayLog('a', '', 'first', 't1', { get: s.get, set: s.set, now });
    recordTodayLog('b', '', 'second', 't2', { get: s.get, set: s.set, now: now + 1000 });
    const logs = readTodayLogs({ get: s.get, now: now + 2000 });
    assertEq(logs[0].message, 'second');
  });
  test('readTodayLogs: malformed JSON returns empty', () => {
    const s = fakeStore('not json{');
    assertEq(readTodayLogs({ get: s.get, now: Date.now() }).length, 0);
  });
  test('renderTodayView: renders one box per entry and shows section', () => {
    const now = new Date(2026,6,14,9,5).getTime();
    const s = fakeStore(JSON.stringify([
      { ts: now, day: '2026-07-14', category: 'idea', sub_route: '', message: 'Idea logged.', text: 'm' },
      { ts: now - 1000, day: '2026-07-14', category: 'meal', sub_route: '', message: 'Lunch.', text: 'l' }
    ]));
    renderTodayView({ get: s.get, now });
    assertEq(document.getElementById('today-row').children.length, 2);
    assert(document.getElementById('today-section').style.display !== 'none', 'section visible');
  });
  test('renderTodayView: empty hides the section', () => {
    const s = fakeStore('[]');
    renderTodayView({ get: s.get, now: Date.now() });
    assertEq(document.getElementById('today-section').style.display, 'none');
  });
  test('toggleTodayExpanded: toggles expanded class', () => {
    const row = document.getElementById('today-row');
    row.classList.remove('expanded');
    toggleTodayExpanded();
    assert(row.classList.contains('expanded'), 'should expand');
    toggleTodayExpanded();
    assert(!row.classList.contains('expanded'), 'should collapse');
  });
  test('renderLogBox: contains label, time, escaped message', () => {
    const html = renderLogBox({ ts: new Date(2026,6,14,9,5).getTime(), category: 'idea', sub_route: '', message: 'x <b>' });
    assert(html.indexOf('Idea') !== -1, 'has label');
    assert(html.indexOf('9:05 AM') !== -1, 'has time');
    assert(html.indexOf('&lt;b&gt;') !== -1, 'escaped message');
  });
  test('renderLogBox: emits --i for the fan stagger, defaulting to 0', () => {
    const entry = { ts: Date.now(), category: 'idea', sub_route: '', message: 'x' };
    assert(renderLogBox(entry, 3).indexOf('--i:3') !== -1, 'index 3 should set --i:3');
    assert(renderLogBox(entry).indexOf('--i:0') !== -1, 'bare call should default to --i:0');
    // map() passes (entry, i, array); the third arg must not corrupt --i.
    const html = [entry, entry].map(renderLogBox);
    assert(html[1].indexOf('--i:1') !== -1, 'map should stagger by position');
  });
  test('fan: every rendered box carries a distinct, ascending --i', () => {
    const now = Date.now();
    const logs = [1,2,3,4,5].map((n) => ({ ts: now, category: 'idea', sub_route: '', message: 'm' + n }));
    const row = document.createElement('div');
    row.innerHTML = logs.map(renderLogBox).join('');
    const vals = [...row.querySelectorAll('.today-box')].map((b) => b.style.getPropertyValue('--i').trim());
    assertEq(vals.join(','), '0,1,2,3,4', 'boxes should be indexed in order');
  });
  test('router: v4.2 source parses as valid JS', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    new Function(src); // parse check only — Google globals are only referenced at runtime
  });
  test('router: header bumped to v4.2', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    assert(src.indexOf('v4.2') !== -1, 'version bumped');
  });
  test('router: NaN "+ +" prompt bug fixed', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    // Guard the whole concat chain, not one line — a stray "+ +" anywhere in it
    // turns the prompt into NaN, which is how this shipped once already.
    assert(!/\+\s*\+\s*'/.test(src), 'stray "+ +" in the prompt concatenation');
    assert(/7 8 9 10 11 . AM/.test(src), 'am/pm disambiguation rule present');
  });
  test('router: the prompt extracts facts and never picks the tip tab', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    // The two-schema prompt is what let phrasing decide the tab. One shape now,
    // and routeTip() owns the decision — see server/tipRouting.js.
    assert(src.indexOf('"sub_route":"Susans"') === -1, 'Susans must not be a prompt-chosen sub_route');
    assert(src.indexOf('"sub_route":"Track"') === -1, 'Track must not be a prompt-chosen sub_route');
    assert(src.indexOf('sub_route = routeTip(data)') !== -1, 'doPost must route tips in code');
    assert(src.indexOf('shiftHours(data.clock_in') !== -1, 'handleTip must derive hours from the clock times');
  });
  test('router: no blocking Utilities.sleep', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    assert(src.indexOf('Utilities.sleep') === -1, 'no blocking sleeps');
  });
  test('router + client: grocery is fully retired', async () => {
    // Strip comments — the v4.4 header legitimately mentions grocery in prose;
    // what must be gone is executable grocery code and data.
    const raw = await fetchText('server/routerWebApp.gs');
    const code = raw.replace(/\/\/[^\n]*/g, '');
    assert(code.indexOf('handleGrocery') === -1, 'handleGrocery still defined/called');
    assert(code.indexOf("'grocery'") === -1, 'grocery category token still in code');
    assert(code.indexOf('GROCERY:') === -1, 'grocery schema still in the prompt');
    assert(!('grocery' in CAT_UI), 'CAT_UI still has a grocery entry');
    assert(!('sheet_grocery' in CFG_DEFAULTS), 'sheet_grocery default still present');
    assert(document.getElementById('cfg-grocery') === null, 'grocery config field still in the DOM');
  });
  test('manifest: valid JSON with the required install fields', async () => {
    const m = await fetchJson('manifest.json');
    assertEq(m.name, 'Log It');
    assertEq(m.short_name, 'Log It');
    assertEq(m.display, 'standalone');
    assert(Array.isArray(m.icons) && m.icons.length > 0, 'declares icons');
  });
  test('manifest: all paths relative (absolute would 404 on the /log-it/ subpath)', async () => {
    const m = await fetchJson('manifest.json');
    for (const [k, v] of [['start_url', m.start_url], ['scope', m.scope], ['id', m.id]]) {
      assert(!v.startsWith('/'), k + ' must be relative, got ' + v);
    }
    for (const i of m.icons) {
      assert(!i.src.startsWith('/'), 'icon src must be relative, got ' + i.src);
    }
  });
  test('manifest: colours match the app CSS variables', async () => {
    const m = await fetchJson('manifest.json');
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    assertEq(m.background_color, bg, 'background_color tracks --bg');
    assertEq(m.theme_color, bg, 'theme_color tracks --bg');
  });
  test('manifest: every declared icon actually resolves', async () => {
    const m = await fetchJson('manifest.json');
    for (const i of m.icons) {
      const r = await fetch(bust(i.src), { method: 'HEAD' });
      assert(r.ok, i.src + ' -> HTTP ' + r.status);
      assertEq(r.headers.get('content-type'), 'image/png', i.src + ' content-type');
    }
  });
  test('manifest: 192 and 512 icons are declared maskable', async () => {
    const m = await fetchJson('manifest.json');
    for (const size of ['192x192', '512x512']) {
      const i = m.icons.find((x) => x.sizes === size);
      assert(i, 'declares a ' + size + ' icon');
      assert(i.purpose.includes('maskable'), size + ' should be maskable');
    }
  });
  test('head: links the manifest and an apple-touch-icon (iOS ignores the manifest)', () => {
    assert(document.querySelector('link[rel="manifest"]'), 'manifest link present');
    const apple = document.querySelector('link[rel="apple-touch-icon"]');
    assert(apple, 'apple-touch-icon link present');
    assert(!apple.getAttribute('href').startsWith('/'), 'apple-touch-icon href must be relative');
  });
  test('apple-touch-icon: resolves at the 180px iOS size', async () => {
    const href = document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href');
    const r = await fetch(bust(href), { method: 'HEAD' });
    assert(r.ok, href + ' -> HTTP ' + r.status);
  });
  test('setMode(text): adds text-mode class + status "Type to log"', () => {
    setMode('text');
    assert(document.getElementById('app').classList.contains('text-mode'), 'app should have text-mode class');
    assertEq(document.getElementById('status').textContent, 'Type to log');
  });
  test('setMode(voice): removes text-mode class + status "Hold to log"', () => {
    setMode('voice');
    assert(!document.getElementById('app').classList.contains('text-mode'), 'app should not have text-mode class');
    assertEq(document.getElementById('status').textContent, 'Hold to log');
  });
  // ---- daily line: pure selection logic ----
  // NOTE: Date months are 0-indexed — new Date(2026, 6, 15) is July 15 2026.
  test('windowFor: 16:59 local is am', () => {
    assertEq(windowFor(new Date(2026, 6, 15, 16, 59)), 'am');
  });
  test('windowFor: 17:00 local is pm', () => {
    assertEq(windowFor(new Date(2026, 6, 15, 17, 0)), 'pm');
  });
  test('lineFor: deterministic for the same date + window', () => {
    const lines = [{ text: 'a' }, { text: 'b' }, { text: 'c' }];
    const d = new Date(2026, 6, 15, 9, 0);
    const first = lineFor(d, lines);
    assert(first, 'should pick a line');
    assertEq(lineFor(d, lines), first);
    assertEq(lineFor(new Date(2026, 6, 15, 11, 30), lines), first, 'same window, same pick');
  });
  test('lineFor: am/pm tags confine lines to their window', () => {
    const lines = [{ text: 'M', when: 'am' }, { text: 'E', when: 'pm' }];
    assertEq(lineFor(new Date(2026, 6, 15, 9, 0), lines).text, 'M');
    assertEq(lineFor(new Date(2026, 6, 15, 18, 0), lines).text, 'E');
  });
  test('lineFor: floaters are eligible in both windows', () => {
    const only = [{ text: 'F' }];
    assertEq(lineFor(new Date(2026, 6, 15, 9, 0), only).text, 'F');
    assertEq(lineFor(new Date(2026, 6, 15, 18, 0), only).text, 'F');
  });
  test('lineFor: empty, missing, or drained pool gives null', () => {
    assertEq(lineFor(new Date(), []), null);
    assertEq(lineFor(new Date(), null), null);
    assertEq(lineFor(new Date(2026, 6, 15, 9, 0), [{ text: 'x', when: 'pm' }]), null);
  });
  test('lineFor: picks vary across days (not stuck on one index)', () => {
    const pool = [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }, { text: 'e' }];
    const seen = new Set();
    for (let d = 1; d <= 30; d++) seen.add(lineFor(new Date(2026, 6, d, 9, 0), pool).text);
    assert(seen.size >= 2, '30 days drew ' + seen.size + ' distinct lines');
  });
  test('lineFor: consecutive days rarely repeat the same line (real pool)', () => {
    let repeats = 0, prev = null;
    for (let i = 0; i < 365; i++) {
      const cur = lineFor(new Date(2026, 0, 1 + i, 9, 0), DAILY_LINES).text;
      if (prev !== null && cur === prev) repeats++;
      prev = cur;
    }
    assert(repeats <= 12, 'morning line repeated the previous day ' + repeats + 'x in 2026 (chance is ~5; the pre-avalanche hash gave 24)');
  });
  test('dailyHash: no plausible pool size makes consecutive days repeat (avalanche guard)', () => {
    // The pre-avalanche djb2-xor was near-linear: consecutive-day keys produced
    // hash deltas that were exact multiples of certain pool sizes, repeating the
    // previous day's line up to 24x/year at size 77 (chance is ~5). Sweeping sizes
    // — rather than only today's pool — keeps the guarantee independent of the
    // content count, so editing DAILY_LINES can never silently reintroduce it.
    let worstSize = 0, worstRepeats = 0;
    for (let size = 60; size <= 120; size++) {
      const pool = Array.from({ length: size }, (_, i) => ({ text: 'line-' + i }));
      let repeats = 0, prev = null;
      for (let i = 0; i < 365; i++) {
        const cur = lineFor(new Date(2026, 0, 1 + i, 9, 0), pool).text;
        if (prev !== null && cur === prev) repeats++;
        prev = cur;
      }
      if (repeats > worstRepeats) { worstRepeats = repeats; worstSize = size; }
    }
    assert(worstRepeats <= 15, 'pool size ' + worstSize + ' repeated the previous day ' + worstRepeats + 'x in 2026 (chance ~5; the pre-avalanche hash hit 24)');
  });
  // ---- daily line: render ----
  test('renderDailyLine: text only, no attribution element', () => {
    renderDailyLine({ now: new Date(2026, 6, 15, 9, 0), lines: [{ text: 'Begin again.' }] });
    const hint = document.getElementById('hint');
    assertEq(hint.textContent.trim(), 'Begin again.');
    assert(!hint.querySelector('.hint-author'), 'no author element expected');
  });
  test('renderDailyLine: attribution renders when author present', () => {
    renderDailyLine({ now: new Date(2026, 6, 15, 9, 0), lines: [{ text: 'X.', author: 'Seneca' }] });
    const a = document.getElementById('hint').querySelector('.hint-author');
    assert(a, 'author element expected');
    assertEq(a.textContent, '— Seneca');
  });
  test('renderDailyLine: no lines, nothing rendered', () => {
    renderDailyLine({ lines: null });
    assertEq(document.getElementById('hint').textContent, '');
    renderDailyLine(); // restore the real line
  });
  // ---- daily line: content ----
  test('DAILY_LINES: every entry well-formed, no duplicate text', () => {
    assert(Array.isArray(DAILY_LINES), 'DAILY_LINES should be an array');
    const texts = new Set();
    for (const l of DAILY_LINES) {
      assert(typeof l.text === 'string' && l.text.trim().length > 0, 'bad text: ' + JSON.stringify(l));
      assert(l.when === undefined || l.when === 'am' || l.when === 'pm', 'bad when: ' + JSON.stringify(l));
      assert(l.author === undefined || (typeof l.author === 'string' && l.author.length > 0), 'bad author: ' + JSON.stringify(l));
      texts.add(l.text);
    }
    assertEq(texts.size, DAILY_LINES.length, 'duplicate line text');
  });
  test('DAILY_LINES: substantial pools in both windows', () => {
    assert(DAILY_LINES.length >= 90, 'want >= 90 lines, got ' + DAILY_LINES.length);
    const am = DAILY_LINES.filter((l) => !l.when || l.when === 'am').length;
    const pm = DAILY_LINES.filter((l) => !l.when || l.when === 'pm').length;
    assert(am >= 40, 'am pool only ' + am);
    assert(pm >= 40, 'pm pool only ' + pm);
  });
  test('CFG_DEFAULTS: all five fields baked in and non-empty', () => {
    const keys = ['router_url', 'sheet_tip', 'sheet_meal', 'sheet_idea', 'sheet_car'];
    assertEq(Object.keys(CFG_DEFAULTS).length, keys.length, 'unexpected default key count');
    assert(!('sheet_grocery' in CFG_DEFAULTS), 'grocery default should be gone');
    for (const k of keys) {
      assert(typeof CFG_DEFAULTS[k] === 'string' && CFG_DEFAULTS[k].length > 0, 'missing default: ' + k);
    }
    assert(CFG_DEFAULTS.router_url.endsWith('/exec'), 'router_url should be an /exec Web App URL');
  });
  test('LS.get: falls back to CFG_DEFAULTS, stored value wins', () => {
    const prior = localStorage.getItem('sheet_car');
    try {
      localStorage.removeItem('sheet_car');
      assertEq(LS.get('sheet_car'), CFG_DEFAULTS.sheet_car, 'cleared key should fall back');
      localStorage.setItem('sheet_car', 'OVERRIDE');
      assertEq(LS.get('sheet_car'), 'OVERRIDE', 'stored value should win');
      assertEq(LS.get('no_such_key_xyz'), '', 'keys without a default stay empty');
    } finally {
      if (prior === null) localStorage.removeItem('sheet_car');
      else localStorage.setItem('sheet_car', prior);
    }
  });
  // ---- TIP TAB ROUTING (server/tipRouting.js) ----
  // Routing used to live in the Gemini prompt and was decided by whichever of
  // two output schemas the entry's phrasing happened to fit. These cases are
  // the fields the model now emits; the tab is decided here, in code.
  const ROUTING_CASES = [
    // The three real failures. All went to Susans; all belong in Track.
    ['9:18 in, 6:50 out, 350 dollars in tips.',
      { venue: null, clock_in: '09:18', clock_out: '18:50', tips: 350 }, 'Track'],
    ['9:18am in, 6:50pm out, 350 dollars in tips.',
      { venue: null, clock_in: '09:18', clock_out: '18:50', tips: 350 }, 'Track'],
    ['9:18 in, 6:50 out, $350 in tips.',
      { venue: null, clock_in: '09:18', clock_out: '18:50', tips: 350 }, 'Track'],
    // Time-only entries fall back to the clock-in rule.
    ['2-4',   { venue: null, clock_in: '14:00', clock_out: '16:00', tips: null }, 'Susans'],
    ['8-4',   { venue: null, clock_in: '08:00', clock_out: '16:00', tips: null }, 'Track'],
    ['11-7',  { venue: null, clock_in: '11:00', clock_out: '19:00', tips: null }, 'Track'],
    // An explicit venue outranks everything, in both directions.
    ['susans 9am-2pm',
      { venue: 'susans', clock_in: '09:00', clock_out: '14:00', tips: null }, 'Susans'],
    ['track 2-8, 100 in tips',
      { venue: 'track', clock_in: '14:00', clock_out: '20:00', tips: 100 }, 'Track'],
    // Tips outrank an afternoon clock-in: Susans is flat hourly, never tipped.
    ['2-8, 100 in tips',
      { venue: null, clock_in: '14:00', clock_out: '20:00', tips: 100 }, 'Track'],
    // Nothing to go on → Track, the historical default.
    ['worked 6 hours',
      { venue: null, clock_in: null, clock_out: null, tips: null }, 'Track']
  ];
  for (const [entry, data, expected] of ROUTING_CASES) {
    test('routeTip: "' + entry + '" → ' + expected, () => {
      assertEq(routeTip(data), expected);
    });
  }
  test('routeTip: tolerates missing/garbage input without throwing', () => {
    assertEq(routeTip(), 'Track', 'undefined');
    assertEq(routeTip({}), 'Track', 'empty object');
    assertEq(routeTip({ venue: 'SUSANS' }), 'Susans', 'venue is case-insensitive');
    assertEq(routeTip({ venue: 'null' }), 'Track', 'the literal string "null" is not a venue');
    assertEq(routeTip({ tips: 0 }), 'Track', 'zero tips is not a tips signal');
    assertEq(routeTip({ tips: 'abc', clock_in: '14:00' }), 'Susans', 'unparseable tips ignored');
    assertEq(routeTip({ clock_in: 'half past nine' }), 'Track', 'unparseable time falls to default');
  });
  test('routeTip: venue survives the spellings the model actually emits', () => {
    // Track wins on tips alone, so pair each with an afternoon clock-in that
    // would otherwise say Susans — this asserts the venue is what decided it.
    for (const v of ['susans', "Susan's", 'susan', 'sue', 'Susans '])
      assertEq(routeTip({ venue: v, clock_in: '09:00' }), 'Susans', 'venue ' + JSON.stringify(v));
    for (const v of ['track', 'the track', 'valet', 'Valet'])
      assertEq(routeTip({ venue: v, clock_in: '14:00' }), 'Track', 'venue ' + JSON.stringify(v));
  });
  test('routeTip: noon is the boundary — 11:59 Track, 12:00 Susans', () => {
    assertEq(routeTip({ clock_in: '11:59' }), 'Track');
    assertEq(routeTip({ clock_in: '12:00' }), 'Susans');
  });

  test('shiftHours: computed from the clock times, not the model', () => {
    assertEq(shiftHours('09:18', '18:50', 99), 9.53, 'the reported failure, 99 must be ignored');
    assertEq(shiftHours('14:00', '16:00', null), 2);
  });
  test('shiftHours: wraps past midnight instead of going negative', () => {
    assertEq(shiftHours('22:00', '02:00', null), 4);
  });
  test('shiftHours: falls back to reported hours when times are absent', () => {
    assertEq(shiftHours(null, null, 6), 6);
    assertEq(shiftHours('09:00', null, 6), 6, 'one time alone is not enough');
    assertEq(shiftHours(null, null, null), 0, 'nothing at all → 0');
    assertEq(shiftHours(null, null, -3), 0, 'negative hours rejected');
  });

  test('to12h: renders the format the Susans columns already hold', () => {
    assertEq(to12h('18:50'), '6:50pm');
    assertEq(to12h('09:18'), '9:18am');
    assertEq(to12h('12:00'), '12:00pm', 'noon is pm');
    assertEq(to12h('00:30'), '12:30am', 'midnight is 12am');
    assertEq(to12h(null), '', 'missing time renders empty, never "NaN:NaN"');
    assertEq(to12h('nonsense'), '');
  });

  // ---- TRACK PAY / WITHHOLDING (server/trackPay.js) ----
  // The two real paystubs ARE the specification. If a refactor of the tax math
  // breaks, these are the tests that catch it.
  const STUBS = [
    { label: 'week ending 7/19/2026', hours: 35.50, gross: 570.49,
      fica: 35.37, medicare: 8.27, federal: 26.54, sdi: 0.60, pfl: 2.47, nyState: 19.96,
      total: 93.21, net: 477.28 },
    { label: 'week ending 7/5/2026',  hours: 26.75, gross: 429.87,
      fica: 26.65, medicare: 6.23, federal: 12.03, sdi: 0.60, pfl: 1.86, nyState: 12.36,
      total: 59.73, net: 370.14 }
  ];
  for (const s of STUBS) {
    test('trackPay: reproduces the real paystub, ' + s.label, () => {
      assertEq(round2(s.hours * TRACK_WAGE_RATE), s.gross, 'gross');
      const d = weeklyDeductions(s.gross);
      assertEq(d.fica, s.fica, 'FICA');
      assertEq(d.medicare, s.medicare, 'Medicare');
      assertEq(d.pfl, s.pfl, 'NY Paid Family Leave');
      assertEq(d.sdi, s.sdi, 'NY Disability');
      assertEq(d.federal, s.federal, 'federal withholding');
      assertEq(d.nyState, s.nyState, 'NY State withholding');
      assertEq(d.total, s.total, 'total deductions');
      assertEq(weeklyNet(s.gross), s.net, 'net earnings');
    });
  }

  // However the week is split into shifts, the per-shift nets must sum to the
  // real check. NOTE: this sum telescopes by construction — net(after)-net(before)
  // chains to net(total)-net(0) — so these cases are weak on their own. What they
  // genuinely pin is that weeklyNet(0) is 0 and that the week's total matches the
  // stub. The drift and isolation tests below are the ones with teeth.
  const SPLITS = [
    ['35.5h as 4 shifts',      [9, 9, 9, 8.5],           477.28],
    ['35.5h as 1 shift',       [35.5],                   477.28],
    ['35.5h as 7 short ones',  [5, 5, 5, 5, 5, 5, 5.5],  477.28],
    ['26.75h as 3 shifts',     [9, 9, 8.75],             370.14]
  ];
  for (const [label, shifts, expected] of SPLITS) {
    test('trackPay: per-shift nets sum to the paycheck — ' + label, () => {
      let prior = 0, sum = 0;
      for (const h of shifts) {
        sum = round2(sum + shiftPay(prior, h, 0).netWage);
        prior = round2(prior + h);
      }
      assertEq(sum, expected);
    });
  }

  test('trackPay: no rounding drift across many awkward shift lengths', () => {
    // Twelve shifts on ragged fractions — the case that actually catches drift.
    // Verified to fail (off by $0.01) if weeklyDeductions stops rounding each
    // deduction to cents the way the stubs do.
    const shifts = [1.33, 2.17, 3.41, 0.92, 4.08, 1.76, 2.83, 3.19, 5.07, 2.44, 3.66, 4.14];
    let prior = 0, sum = 0;
    for (const h of shifts) {
      sum = round2(sum + shiftPay(prior, h, 0).netWage);
      prior = round2(prior + h);
    }
    assertEq(prior, 35, 'fixture should total 35h');
    assertEq(sum, weeklyNet(round2(35 * TRACK_WAGE_RATE)), 'split must equal the direct week');
  });

  test('trackPay: a shift is taxed as part of its week, NOT in isolation', () => {
    // The core of the design. Taxing an 8h shift on its own annualizes to below
    // the standard deduction and withholds almost nothing; inside a 35h week the
    // same hours sit in the 12% bracket. Collapsing to the isolated calculation
    // is the ~$20/shift bug this whole module exists to avoid.
    const inWeek = shiftPay(27, 8, 0).netWage;
    const alone  = weeklyNet(round2(8 * TRACK_WAGE_RATE));
    assert(inWeek < alone - 10,
      'an 8h shift 27h into the week should net far less than taxed alone; got '
      + inWeek + ' vs ' + alone);
  });

  test('trackPay: later shifts in a week net less — progressive withholding is live', () => {
    const first  = shiftPay(0, 9, 0).netWage;
    const fourth = shiftPay(27, 9, 0).netWage;
    assert(fourth < first, 'same 9h should net less once the week is 27h deep, got '
      + fourth + ' vs ' + first);
    // A flat-rate model would make these identical; this is the guard against
    // silently regressing to one.
    assert(first - fourth > 5, 'gap too small to be real progression: ' + (first - fourth));
  });

  test('trackPay: tips are added untaxed and drive the effective hourly', () => {
    const p = shiftPay(0, 9.03, 350);
    assertEq(p.grossWage, round2(9.03 * TRACK_WAGE_RATE), 'gross wage');
    assertEq(p.takeHome, round2(p.netWage + 350), 'take-home = net wage + tips');
    assertEq(p.effectiveHourly, round2(p.takeHome / 9.03), 'effective hourly');
    assert(p.effectiveHourly > TRACK_WAGE_RATE, 'a $350 tip day must beat the base rate');
  });

  test('trackPay: zero gross means zero deductions, not a negative net', () => {
    const d = weeklyDeductions(0);
    assertEq(d.total, 0, 'total');
    assertEq(d.sdi, 0, 'the flat $0.60 SDI must not apply to a week with no pay');
    assertEq(weeklyNet(0), 0, 'net');
    assertEq(weeklyNet(-50), 0, 'negative gross');
  });

  test('trackPay: the first shift of the week carries the flat $0.60 SDI', () => {
    assertEq(weeklyDeductions(100).sdi, 0.60);
    // Charged once per week, not per shift: two 5h shifts and one 10h shift
    // must land on the same net.
    const split = round2(shiftPay(0, 5, 0).netWage + shiftPay(5, 5, 0).netWage);
    assertEq(split, shiftPay(0, 10, 0).netWage, 'SDI double-charged across shifts');
  });

  test('trackPay: NY withholding floors at zero instead of going negative', () => {
    assertEq(nyWeekly(50), 0, 'the fitted line is negative here');
    assertEq(nyWeekly(0), 0);
    assert(nyWeekly(570.49) > 0, 'still positive at real wages');
  });

  test('trackPay: degenerate input never yields NaN or Infinity', () => {
    for (const p of [shiftPay(0, 0, 0), shiftPay(null, undefined, 'abc'),
                     shiftPay(-5, -5, -5), shiftPay('x', 'y', 'z')]) {
      for (const k of ['grossWage', 'netWage', 'takeHome', 'effectiveHourly']) {
        assert(isFinite(p[k]), k + ' should be finite, got ' + p[k]);
      }
    }
    assertEq(shiftPay(0, 0, 0).effectiveHourly, 0, 'zero hours must not divide by zero');
  });

  test('payWeekStart: the pay week runs Monday to Sunday', () => {
    const mon = new Date(2026, 6, 13);            // Mon 7/13/2026
    assertEq(payWeekStart(mon).getTime(), mon.getTime(), 'Monday maps to itself');
    // The stubs' WeekEnd is a Sunday, so Sun 7/19 closes the week that began 7/13.
    assertEq(payWeekStart(new Date(2026, 6, 19)).getTime(), mon.getTime(), 'Sunday 7/19');
    assertEq(payWeekStart(new Date(2026, 6, 18)).getTime(), mon.getTime(), 'Saturday 7/18');
    assertEq(payWeekStart(new Date(2026, 6, 20)).getTime(),
      new Date(2026, 6, 20).getTime(), 'Monday 7/20 starts a new week');
    assert(!samePayWeek(new Date(2026, 6, 19), new Date(2026, 6, 20)),
      'Sun 7/19 and Mon 7/20 are different weeks');
  });
  test('payWeekStart: ignores the time of day', () => {
    assertEq(payWeekStart(new Date(2026, 6, 15, 23, 59)).getTime(),
             payWeekStart(new Date(2026, 6, 15, 0, 1)).getTime());
  });

  test('sumTrackHours: totals only this pay week, skipping the header row', () => {
    const ts = new Date(2026, 6, 15, 12, 0);      // Wed 7/15/2026
    const rows = [
      ['Timestamp', 'Hours', 'Tips'],             // header — must be skipped
      [new Date(2026, 6, 13, 9, 0), 9,    100],   // Mon, same week
      [new Date(2026, 6, 14, 9, 0), 8.5,  ''],    // Tue, same week
      [new Date(2026, 6, 20, 9, 0), 7,    ''],    // next week — excluded
      [new Date(2026, 6, 12, 9, 0), 6,    '']     // previous week — excluded
    ];
    assertEq(sumTrackHours(rows, ts), 17.5);
  });
  test('sumTrackHours: ignores legacy rows whose hours column holds a Date', () => {
    const ts = new Date(2026, 6, 15, 12, 0);
    const rows = [
      ['Timestamp', 'Hours'],
      // The legacy Auto Tips script wrote Timestamp | Date | Hours — a Date in
      // column B. Summing it blindly would corrupt every pay figure.
      [new Date(2026, 6, 13, 9, 0), new Date(2026, 6, 13), 9],
      [new Date(2026, 6, 14, 9, 0), 8.5]
    ];
    assertEq(sumTrackHours(rows, ts), 8.5, 'the Date row must contribute nothing');
  });
  test('sumTrackHours: survives junk rows and junk input', () => {
    const ts = new Date(2026, 6, 15, 12, 0);
    assertEq(sumTrackHours([['h'], [null], ['not a date', 5], [new Date(2026,6,14), 'abc'],
                            [new Date(2026,6,14), ''], [new Date(2026,6,14), -3]], ts), 0);
    assertEq(sumTrackHours(null, ts), 0);
    assertEq(sumTrackHours([], ts), 0);
    assertEq(sumTrackHours([['header only']], ts), 0);
  });
  test('sumTrackHours: string hours from a text-formatted cell still count', () => {
    const ts = new Date(2026, 6, 15, 12, 0);
    assertEq(sumTrackHours([['h'], [new Date(2026, 6, 14, 9, 0), '8.5']], ts), 8.5);
  });

  test('router: the Track branch reads the week BEFORE appending', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    // Order is load-bearing: append first and the new row counts itself, so the
    // shift would be taxed as if the week already included it.
    const readAt = src.indexOf('sumTrackHours');
    const appendAt = src.indexOf("getTab(ss, 'Track').appendRow") >= 0
      ? src.indexOf("getTab(ss, 'Track').appendRow")
      : src.indexOf('trackTab.appendRow');
    assert(readAt !== -1, 'router must sum the week via sumTrackHours');
    assert(appendAt !== -1, 'router must still append the Track row');
    assert(readAt < appendAt, 'the week must be summed before the row is appended');
    assert(src.indexOf('shiftPay(') !== -1, 'router must call shiftPay');
  });

  runTests();
}
