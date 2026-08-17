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
  test('lineFor: picks vary across days (5-line pool rotates cleanly)', () => {
    const pool = [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }, { text: 'e' }];
    const seen = new Set();
    for (let d = 1; d <= 30; d++) seen.add(lineFor(new Date(2026, 6, d, 9, 0), pool).text);
    assertEq(seen.size, 5, '30 days over a 5-line pool should draw all 5, got ' + seen.size);
  });
  test('lineFor: no repeats over a full year (real pool, rotation guarantee)', () => {
    let repeats = 0, prev = null;
    for (let i = 0; i < 365; i++) {
      const cur = lineFor(new Date(2026, 0, 1 + i, 9, 0), DAILY_LINES).text;
      if (prev !== null && cur === prev) repeats++;
      prev = cur;
    }
    assertEq(repeats, 0, 'morning line repeated the previous day ' + repeats + 'x in 2026 — the old hash-mod sampled with replacement and repeated far more');
  });
  // Cycles are anchored to the absolute epoch day number (dayNumber), not to
  // whichever date a test happens to start on — so "the first n days" only
  // lines up with "one full cycle" if the start date's day number is itself a
  // multiple of n. Advance a day at a time (dayNumber always advances by
  // exactly 1) until that alignment holds, then run the window from there.
  function alignedCycleStart(win, n) {
    let d = new Date(2026, 0, 1, win === 'am' ? 9 : 18, 0);
    while (dayNumber(d) % n !== 0) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, d.getHours(), d.getMinutes());
    return d;
  }
  test('lineFor: rotation guarantee sweep (once per cycle, min gap, no back-to-back)', () => {
    // Replaces the old "avalanche guard" tolerance test. That test allowed up to
    // 15 same-day-next-day repeats per year, which was the old hash-mod's actual
    // failure mode dressed up as a guard rail. The rotation algorithm makes a
    // much stronger guarantee: every index appears exactly once per cycle, and
    // no repeat lands closer than minGapFor(n) across a cycle boundary. Sweep
    // pool sizes — not just today's content — so editing DAILY_LINES can never
    // silently regress this.
    for (let size = 60; size <= 200; size += 10) {
      const pool = Array.from({ length: size }, (_, i) => ({ text: 'line-' + i }));
      const start = alignedCycleStart('am', size);

      // (a) one full cycle (n consecutive days, from a cycle boundary) uses
      // every entry exactly once
      const firstCycle = new Set();
      for (let i = 0; i < size; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 9, 0);
        firstCycle.add(lineFor(d, pool).text);
      }
      assertEq(firstCycle.size, size, 'pool size ' + size + ': first cycle only drew ' + firstCycle.size + ' distinct lines');

      // (b) zero back-to-back repeats and (c) no repeat closer than minGapFor(n)
      // over ~5 cycles
      const gap = minGapFor(size);
      const lastSeen = {};
      let worstViolation = Infinity;
      for (let i = 0; i < size * 5; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 9, 0);
        const cur = lineFor(d, pool).text;
        const day = dayNumber(d);
        if (lastSeen[cur] !== undefined) {
          const g = day - lastSeen[cur];
          assert(g !== 0, 'pool size ' + size + ': back-to-back repeat at day ' + i);
          if (g < worstViolation) worstViolation = g;
        }
        lastSeen[cur] = day;
      }
      assert(worstViolation >= gap, 'pool size ' + size + ': min gap ' + worstViolation + ' < required ' + gap);
    }
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
  test('DAILY_LINES: substantial pools in both windows (~6-month rotation)', () => {
    assert(DAILY_LINES.length >= 210, 'want >= 210 lines, got ' + DAILY_LINES.length);
    const am = DAILY_LINES.filter((l) => !l.when || l.when === 'am').length;
    const pm = DAILY_LINES.filter((l) => !l.when || l.when === 'pm').length;
    assert(am >= 180, 'am pool only ' + am);
    assert(pm >= 180, 'pm pool only ' + pm);
  });
  test('dayNumber: stable within a calendar day, +1 across consecutive days', () => {
    const early = dayNumber(new Date(2026, 6, 15, 0, 1));
    const late = dayNumber(new Date(2026, 6, 15, 23, 59));
    assertEq(early, late, 'same calendar date should give the same day number');
    assertEq(dayNumber(new Date(2026, 6, 16, 0, 1)), early + 1, 'consecutive days should differ by exactly 1');
  });
  test('lineFor: one full am cycle over the real pool uses every am-pool line once', () => {
    const amPool = DAILY_LINES.filter((l) => !l.when || l.when === 'am');
    const start = alignedCycleStart('am', amPool.length);
    const seen = new Set();
    for (let i = 0; i < amPool.length; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 9, 0);
      seen.add(lineFor(d, DAILY_LINES).text);
    }
    assertEq(seen.size, amPool.length, 'one am cycle drew ' + seen.size + ' of ' + amPool.length + ' lines');
  });
  test('lineFor: real pools respect minGapFor over ~5 cycles', () => {
    for (const win of ['am', 'pm']) {
      const pool = DAILY_LINES.filter((l) => !l.when || l.when === win);
      const gap = minGapFor(pool.length);
      const hour = win === 'am' ? 9 : 18;
      const lastSeen = {};
      for (let i = 0; i < pool.length * 5; i++) {
        const d = new Date(2026, 0, 1 + i, hour, 0);
        const cur = lineFor(d, DAILY_LINES).text;
        const day = dayNumber(d);
        if (lastSeen[cur] !== undefined) {
          const g = day - lastSeen[cur];
          assert(g >= gap, win + ' pool: repeat gap ' + g + ' < required ' + gap);
        }
        lastSeen[cur] = day;
      }
    }
  });
  test('lineFor: morning and evening lines never collide over 10 years', () => {
    for (let i = 0; i < 365 * 10; i++) {
      const am = lineFor(new Date(2026, 0, 1 + i, 9, 0), DAILY_LINES).text;
      const pm = lineFor(new Date(2026, 0, 1 + i, 18, 0), DAILY_LINES).text;
      assert(am !== pm, 'day ' + i + ': same-day am/pm collision on "' + am + '"');
    }
  });
  test('lineFor: small and degenerate pools still work', () => {
    const one = [{ text: 'only' }];
    for (let d = 1; d <= 10; d++) assertEq(lineFor(new Date(2026, 6, d, 9, 0), one).text, 'only');
    const two = [{ text: 'x' }, { text: 'y' }];
    const seen = new Set();
    for (let d = 1; d <= 10; d++) seen.add(lineFor(new Date(2026, 6, d, 9, 0), two).text);
    assertEq(seen.size, 2, '2-line pool should still surface both lines');
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

  // ---- DUPLICATE GUARD (request id + server dedupe) ----
  test('SUBMIT_TIMEOUT_MS: 30s, above the observed 16.3s worst case', () => {
    assertEq(SUBMIT_TIMEOUT_MS, 30000);
  });
  test('callRouter: sends request_id in the payload', async () => {
    let sent = null;
    const fake = async (url, opts) => {
      sent = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ success: true, message: 'ok' }) };
    };
    await callRouter('hi', { fetchImpl: fake, requestId: 'abc-123' });
    assertEq(sent.request_id, 'abc-123');
  });
  test('callRouter: omitted request id sends an empty string, never "undefined"', async () => {
    let sent = null;
    const fake = async (url, opts) => {
      sent = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ success: true, message: 'ok' }) };
    };
    await callRouter('hi', { fetchImpl: fake });
    assertEq(sent.request_id, '');
  });
  test('submitWithRetry: every retry carries the SAME request_id', async () => {
    // This is the mechanism. If the id changed per attempt the server could not
    // tell a retry from a new entry, and a slow-but-successful first attempt
    // would be written twice — the 2026-07-27 duplicate.
    const ids = [];
    const router = async (text, deps) => {
      ids.push(deps.requestId);
      if (ids.length < 3) throw new SubmitError('timeout', 'slow');
      return { success: true, message: 'ok' };
    };
    await submitWithRetry('hi', {
      router, sleep: () => Promise.resolve(), requestId: 'stable-1'
    });
    assertEq(ids.length, 3, 'should have taken 3 attempts');
    assert(ids.every((v) => v === 'stable-1'), 'ids drifted across retries: ' + ids.join(','));
  });
  test('newRequestId: unique, non-empty, and stable in type', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const id = newRequestId();
      assert(typeof id === 'string' && id.length > 8, 'bad id: ' + id);
      assert(!seen.has(id), 'duplicate id generated: ' + id);
      seen.add(id);
    }
  });
  test('processEntry: a fresh submit gets a new id, a retry reuses it', async () => {
    const priorEntry = pendingEntry, priorId = pendingRequestId;
    const ids = [];
    window.__testRouter = async (text, deps) => {
      ids.push(deps.requestId);
      throw new SubmitError('server', 'nope');   // permanent: keeps pendingEntry
    };
    window.__testSleep = () => Promise.resolve();
    try {
      await processEntry('first');
      const idA = ids[ids.length - 1];
      await processEntry('first', { reuseRequestId: true });   // the Retry button
      const idB = ids[ids.length - 1];
      assertEq(idB, idA, 'Retry must reuse the id so the router can dedupe');
      await processEntry('second');                            // a new submission
      assert(ids[ids.length - 1] !== idA, 'a fresh submit must get a new id');
    } finally {
      delete window.__testRouter; delete window.__testSleep;
      pendingEntry = priorEntry; pendingRequestId = priorId;
      hideFailCard();
    }
  });
  test('router: dedupes by request id under a lock, and only caches successes', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    assert(src.indexOf('body.request_id') !== -1, 'router must read request_id');
    assert(src.indexOf('LockService.getScriptLock') !== -1, 'router must take the script lock');
    assert(src.indexOf('CacheService.getScriptCache') !== -1, 'router must use the cache');
    // The lock has to be held across the work, not just the cache read: the
    // retry starts before the original writes, so an unlocked check sees nothing.
    const lockAt  = src.indexOf('tryLock');
    const writeAt = src.indexOf('switch (category)');
    const cacheAt = src.indexOf('cache.put');
    const relAt   = src.indexOf('lock.releaseLock');
    assert(lockAt !== -1 && writeAt !== -1 && cacheAt !== -1 && relAt !== -1, 'missing a piece');
    assert(lockAt < writeAt, 'lock must be taken before the sheet write');
    assert(writeAt < cacheAt, 'result must be cached after the write');
    assert(cacheAt < relAt, 'lock must be released only after caching');
    // A failed request must stay retryable.
    assert(src.indexOf('if (cacheKey) cache.put') !== -1, 'cache only on the success path');
  });
  test('router: appended Track rows get their number formats stamped', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    assert(src.indexOf('function formatTrackRow') !== -1, 'formatTrackRow must exist');
    assert(src.indexOf('formatTrackRow(trackTab') !== -1, 'and be called after the append');
    const appendAt = src.indexOf('trackTab.appendRow');
    const fmtAt    = src.indexOf('formatTrackRow(trackTab');
    assert(appendAt < fmtAt, 'format the row after appending it');
  });

  // ---- SHIFT DATE (server/tipRouting.js) ----
  // Today is fixed so these never drift: Wed 2026-08-05.
  const TODAY = new Date(2026, 7, 5, 14, 30);
  const RSD = (v) => resolveShiftDate(v, TODAY);

  test('resolveShiftDate: a named past day back-dates the shift', () => {
    const r = RSD('2026-08-02');                 // the Sunday before
    assertEq(r.backdated, true);
    assertEq(r.reason, 'ok');
    assertEq(r.date.getFullYear(), 2026);
    assertEq(r.date.getMonth(), 7);
    assertEq(r.date.getDate(), 2);
    assertEq(r.date.getHours(), 20, 'evening stamp, well clear of midnight/DST');
  });
  test("resolveShiftDate: today's own date is not treated as a back-date", () => {
    const r = RSD('2026-08-05');
    assertEq(r.backdated, false);
    assertEq(r.reason, 'today');
    assertEq(r.date.getTime(), TODAY.getTime(), 'keeps the real log time');
  });
  test('resolveShiftDate: absent date falls back to today', () => {
    for (const v of [null, undefined, '']) {
      const r = RSD(v);
      assertEq(r.backdated, false, JSON.stringify(v));
      assertEq(r.reason, 'absent', JSON.stringify(v));
      assertEq(r.date.getTime(), TODAY.getTime());
    }
  });
  test('resolveShiftDate: rejects anything that is not an exact YYYY-MM-DD', () => {
    // A hallucinated or reformatted date must never be trusted — it would file
    // the shift in the wrong pay week and misprice it silently.
    for (const v of ['yesterday', 'Aug 2', '08/02/2026', '2026-8', 'Sunday',
                     '2026-08-02T00:00', 'null', '20260802', 42, {}]) {
      const r = RSD(v);
      assertEq(r.backdated, false, 'should reject ' + JSON.stringify(v));
      assert(r.date.getTime() === TODAY.getTime(), 'should fall back for ' + JSON.stringify(v));
    }
  });
  test('resolveShiftDate: rejects dates that do not exist', () => {
    for (const v of ['2026-02-30', '2026-13-01', '2026-04-31', '2026-00-10']) {
      const r = RSD(v);
      assertEq(r.backdated, false, v);
      assert(/not a real date|unparseable/.test(r.reason), v + ' → ' + r.reason);
    }
  });
  test('resolveShiftDate: refuses future dates', () => {
    for (const v of ['2026-08-06', '2026-09-01', '2027-01-01']) {
      const r = RSD(v);
      assertEq(r.backdated, false, v);
      assert(r.reason.indexOf('future') !== -1, v + ' → ' + r.reason);
    }
  });
  test('resolveShiftDate: refuses dates older than the back-date window', () => {
    const inside = RSD('2026-06-21');   // 45 days back — the boundary
    assertEq(inside.backdated, true, '45 days back should be allowed');
    const outside = RSD('2026-06-20');  // 46 days back
    assertEq(outside.backdated, false, '46 days back should be refused');
    assert(outside.reason.indexOf('too old') !== -1, outside.reason);
    assertEq(RSD('2025-08-02').backdated, false, 'a year back is refused');
  });
  test('resolveShiftDate: never returns a non-Date, whatever the input', () => {
    for (const v of [null, 'junk', '2026-08-02', '2099-01-01', NaN, [], true]) {
      assert(RSD(v).date instanceof Date, 'not a Date for ' + JSON.stringify(v));
    }
    assert(resolveShiftDate('2026-08-02', 'not-a-date').date instanceof Date,
      'a bad fallback must still yield a Date');
  });

  test('shift date drives the pay week, which is the whole point', () => {
    // Sun 2026-08-02 closes the Mon 7/27-8/2 week. Logged on Wed 8/5 without a
    // shift date it would land in 8/3-8/9 and be taxed as a fresh week.
    const shifted = resolveShiftDate('2026-08-02', TODAY).date;
    assertEq(payWeekStart(shifted).getTime(), new Date(2026, 6, 27).getTime(),
      'a 8/2 shift belongs to the week starting Mon 7/27');
    assertEq(payWeekStart(TODAY).getTime(), new Date(2026, 7, 3).getTime(),
      'logging on 8/5 would otherwise use the week starting Mon 8/3');
    assert(payWeekStart(shifted).getTime() !== payWeekStart(TODAY).getTime(),
      'the two weeks must differ or this test proves nothing');
  });
  test('shift date changes the money, not just the label', () => {
    // 27.69h already logged in the 7/27-8/2 week; a 9.17h shift on top.
    const inWeek = shiftPay(27.69, 9.17, 242).netWage;
    const asFresh = shiftPay(0, 9.17, 242).netWage;
    assert(asFresh - inWeek > 20,
      'mis-dating should visibly overstate the net; got ' + asFresh + ' vs ' + inWeek);
  });

  test('router: resolves the shift date before summing the week', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    assert(src.indexOf('resolveShiftDate(data.shift_date') !== -1,
      'doPost must resolve shift_date');
    assert(src.indexOf('handleTip(ss, sub_route, data, shift)') !== -1,
      'the resolved date must reach handleTip');
    // Order is load-bearing: the week sum keys off the shift date, so resolution
    // has to happen before sumTrackHours runs.
    assert(src.indexOf('resolveShiftDate(data.shift_date') < src.indexOf('sumTrackHours'),
      'resolve the date before summing the week');
    assert(src.indexOf('shortDateLabel(ts)') !== -1,
      'a back-dated shift must be echoed on the confirmation card');
  });
  test('router: the prompt asks for shift_date and supplies the current date', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    assert(src.indexOf('"shift_date":"<YYYY-MM-DD|null>"') !== -1, 'schema must carry shift_date');
    assert(src.indexOf('SHIFT DATE:') !== -1, 'prompt must explain when to set it');
    assert(src.indexOf('CURRENT DATE: ') !== -1, 'relative dates need an anchor');
    assert(src.indexOf('SYSTEM_PROMPT + currentDateLine()') !== -1,
      'the date must be appended per request, not baked into the const');
  });

  // ---- READ API (server/readApi.js) ----
  // Column layouts confirmed against the live sheets on 2026-08-16.
  const TRACK_HEADERS = ['Timestamp', 'Hours', 'Tips', 'Hourly Rate', 'Notes',
                         'Gross Wage', 'Est. Net Wage', 'Total Take-Home', 'Eff. $/hr'];
  const SUSANS_HEADERS = ['Timestamp', 'Clock In', 'Clock Out', 'Hours', 'Pay @ $20/hr', 'Notes'];
  const IDEA_HEADERS = ['Timestamp', 'Title', 'Category', 'Effort', 'Excitement (1-5)',
                        'Next Step', 'Tags', 'Status'];
  const MATERIAL_HEADERS = ['Timestamp', 'Project', 'Item', 'Category', 'Price', 'Notes', 'Got it'];

  test('columnForHeader: finds a header regardless of case and spacing', () => {
    assertEq(columnForHeader(TRACK_HEADERS, 'hours'), 1);
    assertEq(columnForHeader(TRACK_HEADERS, 'Total Take-Home'), 7);
    assertEq(columnForHeader(MATERIAL_HEADERS, 'got it'), 6);
  });
  test('columnForHeader: matches a header carrying a parenthetical', () => {
    // The real Ideas sheet says "Excitement (1-5)", not "Excitement".
    assertEq(columnForHeader(IDEA_HEADERS, 'Excitement'), 4);
  });
  test('columnForHeader: returns -1 rather than guessing when absent', () => {
    // Guessing a letter is what put empty strings into Materials' real
    // Price and Notes columns. A miss must be loud, not silently column 0.
    assertEq(columnForHeader(IDEA_HEADERS, 'Got it'), -1);
  });

  test('payWeekKey: keys a Sunday to the Monday six days earlier', () => {
    // 2026-07-26 is a Sunday; its pay week began Monday 2026-07-20.
    assertEq(payWeekKey(new Date(2026, 6, 26, 21, 0, 0)), '2026-07-20');
    assertEq(payWeekKey(new Date(2026, 6, 20, 9, 0, 0)), '2026-07-20');
  });

  test('recomputeWeek: reproduces a real stored pay week to the penny', () => {
    // Week of Mon 2026-07-20, exactly as the Track tab stores it.
    const out = recomputeWeek([
      { hours: 9.03, tips: 350 },
      { hours: 9.28, tips: 516 },
      { hours: 9.73, tips: 470 },
      { hours: 9.27, tips: 294 }
    ]);
    assertEq(out[0].grossWage, 145.11); assertEq(out[0].netWage, 132.78);
    assertEq(out[0].takeHome, 482.78);  assertEq(out[0].effectiveHourly, 53.46);
    assertEq(out[1].grossWage, 149.13); assertEq(out[1].netWage, 132.05);
    assertEq(out[1].takeHome, 648.05);  assertEq(out[1].effectiveHourly, 69.83);
    assertEq(out[2].grossWage, 156.36); assertEq(out[2].netWage, 121.17);
    assertEq(out[2].takeHome, 591.17);  assertEq(out[2].effectiveHourly, 60.76);
    assertEq(out[3].grossWage, 148.97); assertEq(out[3].netWage, 112.96);
    assertEq(out[3].takeHome, 406.96);  assertEq(out[3].effectiveHourly, 43.9);
  });
  test('recomputeWeek: prices each shift against the hours before it', () => {
    // Two identical shifts must NOT net the same — the first absorbs the flat
    // weekly SDI and the second is taxed at a higher marginal rate. A model
    // that taxes shifts in isolation returns equal values here.
    const out = recomputeWeek([{ hours: 9, tips: 0 }, { hours: 9, tips: 0 }]);
    assert(out[0].netWage !== out[1].netWage, 'identical shifts cannot net the same');
    assert(out[1].netWage < out[0].netWage, 'the later shift nets less');
  });
  test('recomputeWeek: an empty week yields nothing', () => {
    assertEq(recomputeWeek([]).length, 0);
  });

  test('readTrackShifts: keeps pay the sheet already carries', () => {
    const rows = [TRACK_HEADERS,
      [new Date(2026, 7, 2, 19, 30, 0), 9.17, 242, '$26.39', '9:20am-7:00pm',
       147.36, 111.86, 353.86, 38.59]];
    const s = readTrackShifts(rows);
    assertEq(s.length, 1);
    assertEq(s[0].venue, 'Track');
    assertEq(s[0].hours, 9.17);
    assertEq(s[0].tips, 242);
    assertEq(s[0].notes, '9:20am-7:00pm');
    assertEq(s[0].pay.takeHome, 353.86);
    assertEq(s[0].pay.source, 'sheet');
  });
  test('readTrackShifts: reports no pay for a pre-v4.5 row', () => {
    // 16 of the 33 live rows look like this — F-I blank.
    const rows = [TRACK_HEADERS,
      [new Date(2026, 6, 5, 19, 49, 31), 8.3, 130, '$15.66', 'Clocked in at 9:39am',
       '', '', '', '']];
    assertEq(readTrackShifts(rows)[0].pay, null);
  });
  test('readTrackShifts: skips rows whose timestamp is not a date', () => {
    const rows = [TRACK_HEADERS, ['', 9, 100, '', '', '', '', '', ''],
                                 [new Date(2026, 7, 2), 9.17, 242, '', '', '', '', '', '']];
    assertEq(readTrackShifts(rows).length, 1);
  });

  test('fillMissingPay: computes the gaps and leaves stored rows alone', () => {
    const stored = { gross: 147.36, net: 111.86, takeHome: 353.86,
                     effHourly: 38.59, source: 'sheet' };
    const shifts = [
      { ts: new Date(2026, 6, 13, 13, 56, 36), venue: 'Track', hours: 9.5, tips: 130, pay: null },
      { ts: new Date(2026, 6, 16, 18, 23, 38), venue: 'Track', hours: 8.13, tips: 334, pay: null },
      { ts: new Date(2026, 7, 2, 19, 30, 0),   venue: 'Track', hours: 9.17, tips: 242, pay: stored }
    ];
    const out = fillMissingPay(shifts);
    assertEq(out[0].pay.source, 'computed');
    assertEq(out[1].pay.source, 'computed');
    assertEq(out[2].pay.source, 'sheet');
    assertEq(out[2].pay.takeHome, 353.86, 'a stored row must not be overwritten');
    // Both blank rows sit in the week beginning Mon 2026-07-13, so the second
    // must be priced against the first's hours, not as a fresh week.
    assertEq(out[0].pay.net, 139.73);
    assertEq(out[1].pay.net, 115.63);
  });
  test('fillMissingPay: starts each pay week over', () => {
    // Same shift, two different weeks — each is the first of its week, so both
    // absorb the flat SDI and net identically. Bucketing by week is what makes
    // this true; a model that ran one running total across all history wouldn't.
    const shifts = [
      { ts: new Date(2026, 6, 13, 12, 0, 0), venue: 'Track', hours: 9, tips: 0, pay: null },
      { ts: new Date(2026, 6, 20, 12, 0, 0), venue: 'Track', hours: 9, tips: 0, pay: null }
    ];
    const out = fillMissingPay(shifts);
    assertEq(out[0].pay.net, out[1].pay.net);
  });
  test('fillMissingPay: ignores venues that carry no withholding model', () => {
    const shifts = [{ ts: new Date(2026, 6, 15, 14, 0, 0), venue: 'Susans',
                      hours: 2, grossPay: 40, pay: null }];
    assertEq(fillMissingPay(shifts)[0].pay, null);
  });

  test('markDuplicates: flags same day, same venue, same hours', () => {
    // The live Susans tab holds exactly this pair, logged an hour apart.
    const shifts = [
      { ts: new Date(2026, 6, 15, 7, 41, 54), venue: 'Susans', hours: 2 },
      { ts: new Date(2026, 6, 15, 8, 41, 56), venue: 'Susans', hours: 2 }
    ];
    const out = markDuplicates(shifts);
    assertEq(out[0].dupeOf, null, 'the first occurrence is not the duplicate');
    assert(out[1].dupeOf !== null, 'the second must point at the first');
  });
  test('markDuplicates: does not flag different hours or different days', () => {
    const out = markDuplicates([
      { ts: new Date(2026, 6, 15, 7, 0, 0), venue: 'Susans', hours: 2 },
      { ts: new Date(2026, 6, 15, 8, 0, 0), venue: 'Susans', hours: 5 },
      { ts: new Date(2026, 6, 16, 7, 0, 0), venue: 'Susans', hours: 2 }
    ]);
    assertEq(out[1].dupeOf, null);
    assertEq(out[2].dupeOf, null);
  });
  test('markDuplicates: is independent of the order rows arrive in', () => {
    // The router concatenates two tabs and may hand these over newest-first.
    // Whichever way they come, the ORIGINAL must never be the one flagged for
    // deletion — otherwise the UI offers to remove the wrong row.
    const early = new Date(2026, 6, 15, 7, 41, 54);
    const late  = new Date(2026, 6, 15, 8, 41, 56);
    const out = markDuplicates([
      { ts: late,  venue: 'Susans', hours: 2 },
      { ts: early, venue: 'Susans', hours: 2 }
    ]);
    assertEq(out[1].dupeOf, null, 'the earlier row is the original');
    assertEq(out[0].dupeOf, early.toISOString(), 'the later row is the copy');
  });
  test('markDuplicates: does not flag the same shift at different venues', () => {
    const out = markDuplicates([
      { ts: new Date(2026, 6, 15, 7, 0, 0), venue: 'Track', hours: 2 },
      { ts: new Date(2026, 6, 15, 8, 0, 0), venue: 'Susans', hours: 2 }
    ]);
    assertEq(out[1].dupeOf, null);
  });

  test('readSusansShifts: carries gross pay and no withholding block', () => {
    const rows = [SUSANS_HEADERS,
      [new Date(2026, 5, 11, 17, 35, 17), '2:35 PM', '8:30 PM', 5.42, '$108.40',
       'there was an hour long rush']];
    const s = readSusansShifts(rows);
    assertEq(s[0].venue, 'Susans');
    assertEq(s[0].hours, 5.42);
    assertEq(s[0].grossPay, 108.4);
    assertEq(s[0].clockIn, '2:35 PM');
    assertEq(s[0].pay, null, 'Susans pay is gross — it must not pose as take-home');
  });

  test('readIdeas: a blank status cell reads as Active', () => {
    // Nothing is backfilled, so all 25 live rows arrive with column H empty.
    const rows = [IDEA_HEADERS,
      [new Date(2026, 7, 14, 8, 0, 27), 'Get better toothbrush holder for wall',
       'Personal', 'Quick Win', 2, 'Search for wall-mounted holders', 'home', '']];
    const i = readIdeas(rows);
    assertEq(i[0].status, 'Active');
    assertEq(i[0].excitement, 2);
    assertEq(i[0].title, 'Get better toothbrush holder for wall');
  });
  test('readIdeas: an explicit status is preserved', () => {
    const rows = [IDEA_HEADERS,
      [new Date(2026, 7, 14), 'x', '', '', 3, '', '', 'Archived']];
    assertEq(readIdeas(rows)[0].status, 'Archived');
  });
  test('readIdeas: tolerates a sheet with no Status column yet', () => {
    // Until the header is added, every idea is simply Active.
    const rows = [IDEA_HEADERS.slice(0, 7),
      [new Date(2026, 7, 14), 'x', '', '', 3, '', '']];
    assertEq(readIdeas(rows)[0].status, 'Active');
  });

  test('readMaterials: reads the hand-maintained price and the acquired flag', () => {
    const rows = [MATERIAL_HEADERS,
      [new Date(2026, 5, 18, 9, 28, 37), 'Get new shoes for track season',
       'track shoes', 'Other', 57.42, 'ebay', true]];
    const m = readMaterials(rows);
    assertEq(m[0].price, 57.42);
    assertEq(m[0].notes, 'ebay');
    assertEq(m[0].acquired, true);
    assertEq(m[0].project, 'Get new shoes for track season');
  });
  test('readMaterials: keeps a row whose timestamp is blank', () => {
    // The live immersion-blender row has no timestamp. Dropping it would hide
    // a real material; it is kept with ts null and identified another way.
    const rows = [MATERIAL_HEADERS,
      ['', 'Purchase and use an immersion blender', 'immersion blender',
       'Tools', 26.3, '', '']];
    const m = readMaterials(rows);
    assertEq(m.length, 1);
    assertEq(m[0].ts, null);
    assertEq(m[0].acquired, false);
  });

  // ---- READ TOKEN ----
  test('tokenMatches: accepts the configured token', () => {
    assertEq(tokenMatches('s3cret', 's3cret'), true);
  });
  test('tokenMatches: rejects a wrong token', () => {
    assertEq(tokenMatches('nope', 's3cret'), false);
  });
  test('tokenMatches: fails closed when READ_TOKEN is not configured', () => {
    // The dangerous case. If Script Properties has no READ_TOKEN, a naive
    // equality check would compare '' to '' and let everyone in — turning a
    // forgotten setup step into a public feed of income and ideas.
    assertEq(tokenMatches('', null), false);
    assertEq(tokenMatches('', ''), false);
    assertEq(tokenMatches('anything', null), false);
    assertEq(tokenMatches('anything', ''), false);
  });
  test('tokenMatches: rejects an empty token against a real one', () => {
    assertEq(tokenMatches('', 's3cret'), false);
    assertEq(tokenMatches(null, 's3cret'), false);
  });

  // ---- ROUTER OP DISPATCH (server/routerWebApp.gs) ----
  test('router: a read is answered before any lock is taken', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    const read = src.indexOf("op === 'read'");
    const lock = src.indexOf('LockService.getScriptLock()');
    assert(read !== -1, 'doPost must dispatch on op');
    assert(lock !== -1, 'the log path still needs the lock');
    // doPost holds the script lock for a whole log request so retries are
    // idempotent (v4.6). If a read took that lock, opening the shifts page
    // would block logging a shift — the reads are pure and need no lock.
    assert(read < lock, 'the read branch must precede any lock acquisition');
  });
  test('router: logging never checks the read token', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    const lastCheck = src.lastIndexOf('requireReadToken(body.token)');
    const gemini = src.indexOf('callGeminiWithFallback(text)');
    assert(lastCheck !== -1, 'read and write ops must check the token');
    assert(gemini !== -1, 'the log path must still reach Gemini');
    // A missing or wrong token can never stop a log being written.
    assert(lastCheck < gemini, 'every token check must sit in the op branches');
  });
  test('router: the token comes from Script Properties, not the repo', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    assert(src.indexOf("getProperty('READ_TOKEN')") !== -1,
      'READ_TOKEN must be read from Script Properties');
    assert(!/READ_TOKEN\s*=\s*['"][^'"]+['"]/.test(src),
      'the token must never be hardcoded in a public repo');
  });
  test('router: an unauthorized reply is coded so the client can prompt', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    // Apps Script always answers 200, so the client cannot read a status code.
    assert(src.indexOf("'unauthorized'") !== -1, 'rejections need a code');
    assert(src.indexOf('code:') !== -1, 'the error reply must carry it');
  });
  test('router: patch and delete are serialized against writes', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    const branch = src.indexOf("op === 'patch'");
    assert(branch !== -1, 'doPost must dispatch patch');
    assert(src.indexOf("op === 'delete'") !== -1, 'doPost must dispatch delete');
    // They mutate the sheet, so unlike reads they must not interleave with an
    // append mid-write.
    assert(src.indexOf('LockService.getScriptLock()', branch) !== -1,
      'patch and delete must take the lock');
  });

  // ---- WRITE-BACK (server/sheetWrite.js) ----
  const IDEA_ROWS = [
    IDEA_HEADERS,
    [new Date(2026, 6, 27, 15, 45, 30), 'Buy fly tape for the garage', 'Personal',
     'Quick Win', 1, 'Purchase fly tape', 'garage', ''],
    [new Date(2026, 7, 14, 8, 0, 27), 'Get better toothbrush holder for wall',
     'Personal', 'Quick Win', 2, 'Search for holders', 'home', '']
  ];

  test('locateIdeaRow: finds the sheet row for a timestamp', () => {
    // Row 3 of the sheet — headers are row 1.
    assertEq(locateIdeaRow(IDEA_ROWS, new Date(2026, 7, 14, 8, 0, 27).toISOString()), 3);
  });
  test('locateIdeaRow: reports not-found rather than a wrong row', () => {
    assertEq(locateIdeaRow(IDEA_ROWS, new Date(2026, 7, 15).toISOString()), ROW_NOT_FOUND);
  });
  test('locateIdeaRow: never matches on position', () => {
    // Sorting or deleting a row in Sheets shifts every index. Identity has to
    // come from the timestamp, so a garbage timestamp finds nothing at all.
    assertEq(locateIdeaRow(IDEA_ROWS, 'not-a-date'), ROW_NOT_FOUND);
  });

  const MAT_ROWS = [
    MATERIAL_HEADERS,
    [new Date(2026, 5, 24, 7, 3, 57), 'Build custom wooden oil bottle holders',
     'wooden strips', 'Supplies', '', '', ''],
    [new Date(2026, 5, 24, 7, 3, 57), 'Build custom wooden oil bottle holders',
     'wood glue', 'Supplies', '', '', ''],
    ['', 'Purchase and use an immersion blender', 'immersion blender',
     'Tools', 26.3, '', '']
  ];

  test('locateMaterialRow: separates two materials sharing one timestamp', () => {
    // handleIdea stamps every material of an idea with that idea's timestamp,
    // so the timestamp alone cannot identify one. Item text is what splits them.
    const ts = new Date(2026, 5, 24, 7, 3, 57).toISOString();
    assertEq(locateMaterialRow(MAT_ROWS, { ts: ts, item: 'wooden strips' }), 2);
    assertEq(locateMaterialRow(MAT_ROWS, { ts: ts, item: 'wood glue' }), 3);
  });
  test('locateMaterialRow: falls back to project + item when the timestamp is blank', () => {
    // The live immersion-blender row was hand-added with no timestamp.
    assertEq(locateMaterialRow(MAT_ROWS, {
      ts: null, project: 'Purchase and use an immersion blender',
      item: 'immersion blender'
    }), 4);
  });
  test('locateMaterialRow: refuses to write when the fallback is ambiguous', () => {
    // Two undated rows that look alike must never be resolved by guessing.
    const rows = [MATERIAL_HEADERS,
      ['', 'Shop', 'screws', 'Parts', '', '', ''],
      ['', 'Shop', 'screws', 'Parts', '', '', '']];
    assertEq(locateMaterialRow(rows, { ts: null, project: 'Shop', item: 'screws' }),
      ROW_AMBIGUOUS);
  });
  test('locateMaterialRow: item match is case and space tolerant', () => {
    const ts = new Date(2026, 5, 24, 7, 3, 57).toISOString();
    assertEq(locateMaterialRow(MAT_ROWS, { ts: ts, item: '  Wooden Strips ' }), 2);
  });

  test('validatePatch: accepts the whitelisted fields', () => {
    assertEq(validatePatch({ target: 'idea', field: 'status', value: 'Done' }).field, 'status');
    assertEq(validatePatch({ target: 'idea', field: 'next_step', value: 'x' }).field, 'next_step');
    assertEq(validatePatch({ target: 'material', field: 'acquired', value: true }).field, 'acquired');
    assertEq(validatePatch({ target: 'material', field: 'price', value: '$57.42' }).value, 57.42);
  });
  // These assert on the message, not merely that something threw: a bare
  // "it threw" passes even when the function does not exist, because calling
  // an undefined name throws ReferenceError. Three of these were vacuously
  // green before the implementation was written.
  function refusal(fn) {
    try { fn(); } catch (e) { return e.message; }
    return '(did not throw)';
  }
  test('validatePatch: rejects a field that is not whitelisted', () => {
    // Without this, a typo or a tampered request could rewrite hours, tips, or
    // any other column the page never meant to expose.
    assert(/not patchable: title/.test(
      refusal(() => validatePatch({ target: 'idea', field: 'title', value: 'x' }))),
      'title is not patchable');
  });
  test('validatePatch: rejects a field belonging to the other target', () => {
    assert(/not patchable: price/.test(
      refusal(() => validatePatch({ target: 'idea', field: 'price', value: 1 }))),
      'price belongs to a material, not an idea');
  });
  test('validatePatch: rejects an unknown target', () => {
    assert(/unknown patch target: shift/.test(
      refusal(() => validatePatch({ target: 'shift', field: 'hours', value: 1 }))));
  });
  test('validatePatch: only the three real statuses are accepted', () => {
    assertEq(validatePatch({ target: 'idea', field: 'status', value: 'archived' }).value, 'Archived');
    assert(/not a valid status: Maybe/.test(
      refusal(() => validatePatch({ target: 'idea', field: 'status', value: 'Maybe' }))),
      'a free-text status would break every filter');
  });
  test('validatePatch: a price must be a real non-negative number', () => {
    assertEq(validatePatch({ target: 'material', field: 'price', value: '' }).value, '');
    assert(/not a number: lots/.test(
      refusal(() => validatePatch({ target: 'material', field: 'price', value: 'lots' }))));
    assert(/not a number: -5/.test(
      refusal(() => validatePatch({ target: 'material', field: 'price', value: -5 }))));
  });

  test('router: a delete verifies the row before removing it', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    const verify = src.indexOf('verifyShiftRow(rows[row - 1]');
    const del = src.indexOf('tab.deleteRow(row)');
    assert(verify !== -1 && del !== -1, 'delete must verify then remove');
    assert(verify < del, 'verification has to happen before the row is gone');
  });
  test('router: a Track delete repairs the pay week afterwards', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    const del = src.indexOf('tab.deleteRow(row)');
    const fix = src.indexOf('recomputeTrackWeek(tab, ts)');
    assert(fix !== -1, 'the surviving rows in that week must be recomputed');
    // Their stored net was calculated as though the deleted shift's hours were
    // in the week — the $23.37 error cleaned up by hand on 2026-07-27.
    assert(del < fix, 'recompute the week only after the row is actually gone');
  });
  test('router: the deleted timestamp is captured before deletion', async () => {
    const src = await fetchText('server/routerWebApp.gs');
    // Reading rows[row-1][0] after deleteRow would read a different shift.
    assert(src.indexOf('var ts = rows[row - 1][0];') < src.indexOf('tab.deleteRow(row)'),
      'grab the timestamp while the row still exists');
  });

  test('verifyShiftRow: confirms the row still holds what the page showed', () => {
    const row = [new Date(2026, 7, 2, 19, 30, 0), 9.17, 242, '$26.39', ''];
    assertEq(verifyShiftRow(row, { hours: 9.17, tips: 242 }), true);
  });
  test('verifyShiftRow: refuses when the sheet has moved on', () => {
    // A page left open while the sheet was edited must not delete a row whose
    // contents no longer match what the user was looking at.
    const row = [new Date(2026, 7, 2, 19, 30, 0), 9.17, 242, '$26.39', ''];
    assertEq(verifyShiftRow(row, { hours: 8.5, tips: 242 }), false);
    assertEq(verifyShiftRow(row, { hours: 9.17, tips: 300 }), false);
  });

  // ---- SHIFT STATS (shiftStats.js, client-side aggregation) ----
  const TRACK = (ts, hours, tips, takeHome, net) => ({
    ts: ts, venue: 'Track', week: payWeekKey(ts), hours: hours, tips: tips,
    pay: { gross: 0, net: net, takeHome: takeHome, effHourly: 0, source: 'sheet' }
  });
  const SUSANS = (ts, hours, gross) => ({
    ts: ts, venue: 'Susans', week: payWeekKey(ts), hours: hours, tips: 0,
    grossPay: gross, pay: null
  });

  test('bucketShifts: groups by pay week, oldest first', () => {
    const b = bucketShifts([
      TRACK(new Date(2026, 7, 2, 19, 30), 9.17, 242, 353.86, 111.86),
      TRACK(new Date(2026, 6, 23, 18, 53), 9.03, 350, 482.78, 132.78)
    ], 'week');
    assertEq(b.length, 2);
    assertEq(b[0].key, '2026-07-20', 'oldest bucket first, so a chart reads left to right');
    assertEq(b[1].key, '2026-07-27');
  });
  test('bucketShifts: groups by calendar month', () => {
    const b = bucketShifts([
      TRACK(new Date(2026, 6, 23), 9.03, 350, 482.78, 132.78),
      TRACK(new Date(2026, 7, 2), 9.17, 242, 353.86, 111.86),
      TRACK(new Date(2026, 7, 9), 9.68, 219, 334.90, 115.90)
    ], 'month');
    assertEq(b.length, 2);
    assertEq(b[0].key, '2026-07');
    assertEq(b[1].shifts.length, 2);
  });
  test('bucketShifts: splits take-home into tips and net wage', () => {
    // The stacked bar reads tips on top of net wage; together they are
    // take-home, so the two parts must sum to it exactly.
    const b = bucketShifts([TRACK(new Date(2026, 7, 2), 9.17, 242, 353.86, 111.86)], 'week');
    assertEq(b[0].tips, 242);
    assertEq(b[0].netWage, 111.86);
    assertEq(b[0].takeHome, 353.86);
    assertEq(b[0].tips + b[0].netWage, b[0].takeHome);
  });
  test('bucketShifts: never folds Susans gross into Track take-home', () => {
    // Track's figure is after withholding; Susans' $20/hr is before it. One
    // number built from both would be part post-tax and part pre-tax.
    const b = bucketShifts([
      TRACK(new Date(2026, 6, 23), 9.03, 350, 482.78, 132.78),
      SUSANS(new Date(2026, 6, 22), 5, 100)
    ], 'week');
    assertEq(b.length, 1, 'same pay week');
    assertEq(b[0].takeHome, 482.78, 'Susans gross must stay out of take-home');
    assertEq(b[0].susansGross, 100, 'and be reported on its own');
  });
  test('bucketShifts: an unpriced shift contributes hours but no money', () => {
    const noPay = { ts: new Date(2026, 5, 3), venue: 'Track', week: payWeekKey(new Date(2026, 5, 3)),
                    hours: 8.17, tips: 338, pay: null };
    const b = bucketShifts([noPay], 'week');
    assertEq(b[0].hours, 8.17);
    assertEq(b[0].takeHome, 0, 'no invented money for a row that has none');
  });

  test('summarize: reports Track and Susans side by side, never added', () => {
    const s = summarize([
      TRACK(new Date(2026, 7, 2), 9.17, 242, 353.86, 111.86),
      TRACK(new Date(2026, 7, 9), 9.68, 219, 334.90, 115.90),
      SUSANS(new Date(2026, 7, 5), 5, 100)
    ]);
    assertEq(s.trackTakeHome, 688.76);
    assertEq(s.trackHours, 18.85);
    assertEq(s.susansGross, 100);
    assertEq(s.shifts, 3);
  });
  test('summarize: effective hourly is take-home over Track hours', () => {
    const s = summarize([TRACK(new Date(2026, 7, 2), 10, 242, 350, 108)]);
    assertEq(s.trackEffHourly, 35);
  });
  test('summarize: no Track hours yields no divide-by-zero', () => {
    const s = summarize([SUSANS(new Date(2026, 7, 5), 5, 100)]);
    assertEq(s.trackEffHourly, 0);
    assertEq(s.trackTakeHome, 0);
  });

  test('filterShifts: by venue', () => {
    const all = [TRACK(new Date(2026, 7, 2), 9.17, 242, 353.86, 111.86),
                 SUSANS(new Date(2026, 7, 5), 5, 100)];
    assertEq(filterShifts(all, { venue: 'Track' }).length, 1);
    assertEq(filterShifts(all, { venue: 'all' }).length, 2);
  });

  test('dataClient: its router URL matches the one index.html logs to', async () => {
    // The URL is duplicated on purpose — index.html is the logging path and is
    // not being refactored onto a shared config file for this. Duplication is
    // only safe if it cannot drift, so this is the thing that stops it.
    const [page, client] = await Promise.all([fetchText('index.html'), fetchText('dataClient.js')]);
    const inPage = /router_url:\s*'([^']+)'/.exec(page);
    const inClient = /DC_ROUTER_DEFAULT\s*=\s*\n?\s*'([^']+)'/.exec(client);
    assert(inPage && inClient, 'both files must declare a router URL');
    assertEq(inClient[1], inPage[1], 'the two router URLs have drifted apart');
  });
  test('dataClient: carries sheet id defaults, not empty strings', async () => {
    // index.html resolves sheet ids through LS.get, which falls back to
    // CFG_DEFAULTS *without writing to localStorage*. A device that never
    // opened the ⚙ panel therefore has no sheet_tip key, so reading it with an
    // '' fallback sent '' to the server, which fell back to its own placeholder
    // and answered "Illegal spreadsheet id or key: YOUR_TIPS_SHEET_ID".
    // Verified against the live endpoint on 2026-08-17.
    const [page, client] = await Promise.all([fetchText('index.html'), fetchText('dataClient.js')]);
    for (const kind of ['tip', 'idea']) {
      const inPage = new RegExp('sheet_' + kind + ":\\s*'([^']+)'").exec(page);
      const inClient = new RegExp('\\b' + kind + ":\\s*'([^']+)'").exec(client);
      assert(inPage, 'index.html must define sheet_' + kind);
      assert(inClient, 'dataClient.js must default sheet ' + kind);
      assertEq(inClient[1], inPage[1], 'sheet ' + kind + ' id has drifted');
      assert(inClient[1].indexOf('YOUR_') !== 0, 'placeholder id in dataClient');
    }
  });
  for (const page of ['shifts.html', 'ideas.html']) {
    test(page + ': never asks for a sheet id with an empty fallback', async () => {
      const src = await fetchText(page);
      assert(!/sheetId\(\s*'[a-z]+'\s*,\s*''\s*\)/.test(src),
        'an empty fallback silently sends no sheet id at all');
    });
  }
  for (const page of ['shifts.html', 'ideas.html']) {
    test(page + ': production never loads server logic', async () => {
      const src = await fetchText(page);
      const mockBlock = src.indexOf('if (MOCK)');
      assert(mockBlock !== -1, 'the page must gate its dev switch');
      assert(src.indexOf("'server/readApi.js'") > mockBlock,
        'server modules may only be pulled in under ?mock=1');
      assert(src.indexOf('mockSheet.js') > mockBlock, 'the fixture is dev-only too');
    });
  }
  for (const page of ['shifts.html', 'ideas.html']) {
    test(page + ': uses in-app dialogs, never the browser\'s', async () => {
      const src = await fetchText(page);
      // window.prompt/confirm/alert render in browser chrome — grey, wrong
      // typeface, and on a phone they read as a security warning.
      for (const bad of ['prompt(', 'confirm(', 'alert(']) {
        const re = new RegExp('(^|[^.\\w])' + bad.replace('(', '\\('), 'g');
        const hits = (src.match(re) || []).filter((h) => !/ui(Prompt|Confirm|Alert)/i.test(h));
        assertEq(hits.length, 0, 'found a native ' + bad + ' in ' + page);
      }
      assert(src.indexOf('ui.js') !== -1, 'the page must load the dialog helpers');
    });
  }
  test('index.html: links to both read pages with relative paths', async () => {
    const src = await fetchText('index.html');
    // Relative only — these have to resolve under the /log-it/ Pages subpath.
    assert(/href="shifts\.html"/.test(src), 'the mic screen must reach the shifts page');
    assert(/href="ideas\.html"/.test(src), 'and the ideas page');
    assert(!/href="\/(shifts|ideas)\.html"/.test(src), 'no domain-root paths');
  });
  test('index.html: the logging path still carries no read token', async () => {
    const src = await fetchText('index.html');
    // The token is prompted on the pages that read. Baking it into
    // CFG_DEFAULTS here would publish it — the repo is public.
    assert(src.indexOf('read_token') === -1,
      'index.html neither stores nor sends the read token');
  });

  // ---- IDEA MODEL (ideaModel.js, client-side) ----
  const IDEA = (ts, title, status, exc) => ({
    ts, title, category: 'Personal', effort: 'Quick Win',
    excitement: exc == null ? 3 : exc, nextStep: '', tags: '',
    status: status || 'Active'
  });
  const MAT = (ts, project, item, price, acquired) => ({
    ts, project, item, category: 'Supplies', price: price == null ? null : price,
    notes: '', acquired: !!acquired
  });

  test('nextStatus: cycles Active to Done to Archived and back', () => {
    assertEq(nextStatus('Active'), 'Done');
    assertEq(nextStatus('Done'), 'Archived');
    assertEq(nextStatus('Archived'), 'Active');
  });
  test('nextStatus: anything unrecognised lands on Active', () => {
    assertEq(nextStatus(''), 'Active');
    assertEq(nextStatus('Nonsense'), 'Active');
  });

  test('groupMaterials: attaches materials by their idea timestamp', () => {
    const ts = new Date(2026, 5, 24, 7, 3, 57);
    const g = groupMaterials([IDEA(ts, 'Build custom wooden oil bottle holders')],
                             [MAT(ts, 'Build custom wooden oil bottle holders', 'wooden strips'),
                              MAT(ts, 'Build custom wooden oil bottle holders', 'wood glue')]);
    assertEq(g.ideas[0].materials.length, 2);
    assertEq(g.orphans.length, 0);
  });
  test('groupMaterials: matches a blank-timestamp material by project name', () => {
    // The live immersion-blender row was hand-added with no timestamp. Falling
    // back to the project title is what keeps it visible under its idea.
    const ts = new Date(2026, 5, 25, 5, 48, 26);
    const g = groupMaterials([IDEA(ts, 'Purchase and use an immersion blender')],
                             [MAT(null, 'Purchase and use an immersion blender',
                                  'immersion blender', 26.3)]);
    assertEq(g.ideas[0].materials.length, 1);
    assertEq(g.orphans.length, 0);
  });
  test('groupMaterials: surfaces a material matching no idea instead of dropping it', () => {
    // Silently swallowing a row would hide something the user actually wrote.
    const g = groupMaterials([IDEA(new Date(2026, 5, 24), 'Some idea')],
                             [MAT(null, 'A project that no longer exists', 'widget')]);
    assertEq(g.ideas[0].materials.length, 0);
    assertEq(g.orphans.length, 1);
  });
  test('groupMaterials: does not attach one idea\'s materials to another', () => {
    const a = new Date(2026, 5, 24, 7, 0, 0);
    const b = new Date(2026, 5, 25, 7, 0, 0);
    const g = groupMaterials([IDEA(a, 'Idea A'), IDEA(b, 'Idea B')],
                             [MAT(a, 'Idea A', 'thing')]);
    assertEq(g.ideas[0].materials.length, 1);
    assertEq(g.ideas[1].materials.length, 0);
  });

  test('ideaSpend: totals the prices actually recorded', () => {
    const ts = new Date(2026, 5, 18, 9, 35, 28);
    const idea = IDEA(ts, 'Organize my room with new storage');
    idea.materials = [MAT(ts, 'x', 'organizers', 22.47, true),
                      MAT(ts, 'x', 'shelf', null, false)];
    assertEq(ideaSpend(idea), 22.47);
  });
  test('ideaSpend: no prices means no total, not zero-dollar noise', () => {
    const idea = IDEA(new Date(2026, 5, 18), 'x');
    idea.materials = [MAT(null, 'x', 'thing', null, false)];
    assertEq(ideaSpend(idea), null);
  });

  test('filterIdeas: by status', () => {
    const list = [IDEA(new Date(2026, 5, 1), 'a', 'Active'),
                  IDEA(new Date(2026, 5, 2), 'b', 'Done'),
                  IDEA(new Date(2026, 5, 3), 'c', 'Archived')];
    assertEq(filterIdeas(list, 'Active').length, 1);
    assertEq(filterIdeas(list, 'all').length, 3);
  });
  test('statusCounts: counts every state, including the empty ones', () => {
    const c = statusCounts([IDEA(new Date(2026, 5, 1), 'a', 'Active'),
                            IDEA(new Date(2026, 5, 2), 'b', 'Active')]);
    assertEq(c.Active, 2);
    assertEq(c.Done, 0);
    assertEq(c.Archived, 0);
  });

  test('sortIdeas: newest first by default', () => {
    const list = [IDEA(new Date(2026, 5, 1), 'old'), IDEA(new Date(2026, 7, 1), 'new')];
    assertEq(sortIdeas(list, 'newest')[0].title, 'new');
  });
  test('sortIdeas: by excitement, newest breaking the tie', () => {
    const list = [IDEA(new Date(2026, 5, 1), 'low', 'Active', 2),
                  IDEA(new Date(2026, 5, 2), 'highOld', 'Active', 5),
                  IDEA(new Date(2026, 7, 1), 'highNew', 'Active', 5)];
    const s = sortIdeas(list, 'excitement');
    assertEq(s[0].title, 'highNew');
    assertEq(s[1].title, 'highOld');
    assertEq(s[2].title, 'low');
  });
  test('sortIdeas: does not mutate the caller\'s array', () => {
    const list = [IDEA(new Date(2026, 5, 1), 'old'), IDEA(new Date(2026, 7, 1), 'new')];
    sortIdeas(list, 'newest');
    assertEq(list[0].title, 'old');
  });

  runTests();
}
