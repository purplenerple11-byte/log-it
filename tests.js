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
    recordTodayLog('grocery', '', 'Milk logged.', 'buy milk', { get: s.get, set: s.set, now });
    const logs = readTodayLogs({ get: s.get, now });
    assertEq(logs.length, 1);
    assertEq(logs[0].category, 'grocery');
    assertEq(logs[0].message, 'Milk logged.');
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
      { ts: now, day: '2026-07-14', category: 'grocery', sub_route: '', message: 'Milk logged.', text: 'm' },
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
    const html = renderLogBox({ ts: new Date(2026,6,14,9,5).getTime(), category: 'grocery', sub_route: '', message: 'x <b>' });
    assert(html.indexOf('Grocery') !== -1, 'has label');
    assert(html.indexOf('9:05 AM') !== -1, 'has time');
    assert(html.indexOf('&lt;b&gt;') !== -1, 'escaped message');
  });
  test('router: v4.2 source parses as valid JS', async () => {
    const src = await (await fetch('server/routerWebApp.gs')).text();
    new Function(src); // parse check only — Google globals are only referenced at runtime
  });
  test('router: header bumped to v4.2', async () => {
    const src = await (await fetch('server/routerWebApp.gs')).text();
    assert(src.indexOf('v4.2') !== -1, 'version bumped');
  });
  test('router: NaN "+ +" prompt bug fixed', async () => {
    const src = await (await fetch('server/routerWebApp.gs')).text();
    assert(!/\+\s*\+\s*'- Ambiguous/.test(src), 'NaN ++ bug fixed');
    assert(src.indexOf("'- Ambiguous times") !== -1, 'ambiguous rule present');
  });
  test('router: no blocking Utilities.sleep', async () => {
    const src = await (await fetch('server/routerWebApp.gs')).text();
    assert(src.indexOf('Utilities.sleep') === -1, 'no blocking sleeps');
  });
  test('manifest: valid JSON with the required install fields', async () => {
    const m = await (await fetch('manifest.json')).json();
    assertEq(m.name, 'Log It');
    assertEq(m.short_name, 'Log It');
    assertEq(m.display, 'standalone');
    assert(Array.isArray(m.icons) && m.icons.length > 0, 'declares icons');
  });
  test('manifest: all paths relative (absolute would 404 on the /log-it/ subpath)', async () => {
    const m = await (await fetch('manifest.json')).json();
    for (const [k, v] of [['start_url', m.start_url], ['scope', m.scope], ['id', m.id]]) {
      assert(!v.startsWith('/'), k + ' must be relative, got ' + v);
    }
    for (const i of m.icons) {
      assert(!i.src.startsWith('/'), 'icon src must be relative, got ' + i.src);
    }
  });
  test('manifest: colours match the app CSS variables', async () => {
    const m = await (await fetch('manifest.json')).json();
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    assertEq(m.background_color, bg, 'background_color tracks --bg');
    assertEq(m.theme_color, bg, 'theme_color tracks --bg');
  });
  test('manifest: every declared icon actually resolves', async () => {
    const m = await (await fetch('manifest.json')).json();
    for (const i of m.icons) {
      const r = await fetch(i.src, { method: 'HEAD' });
      assert(r.ok, i.src + ' -> HTTP ' + r.status);
      assertEq(r.headers.get('content-type'), 'image/png', i.src + ' content-type');
    }
  });
  test('manifest: 192 and 512 icons are declared maskable', async () => {
    const m = await (await fetch('manifest.json')).json();
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
    const r = await fetch(href, { method: 'HEAD' });
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
  runTests();
}
