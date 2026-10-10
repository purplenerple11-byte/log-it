// Run the real Apps Script server code against an in-memory spreadsheet.
//
//   node tools/gas-sim.js
//
// Loads every server/ file into ONE vm context — exactly as Apps Script does,
// one shared global scope — with SpreadsheetApp, Logger, Utilities and friends
// stubbed. It also fails on any top-level name defined in two files. Loading
// alone would NOT catch that: a repeated `function` or `var` silently
// overwrites (only let/const throw), which is precisely the Apps Script trap.
//
// This is the only way to exercise the code paths that WRITE (handleDorset,
// recomputeTrackWeek, delete, writeCells) without touching the user's real
// sheets. The browser harness tests the pure logic; this tests the plumbing.
// Add a scenario to SCENARIOS when you change a handler.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = ['server/trackPay.js', 'server/tipRouting.js', 'server/readApi.js',
               'server/sheetWrite.js', 'server/dorsetPay.js', 'server/routerWebApp.gs'];

// ---- a tab is a 2-D array; row/col are 1-based like Sheets ----------------
function makeTab(name, rows) {
  const data = rows.map((r) => r.slice());
  const calls = { setValue: 0, setValues: 0 };
  const width = () => Math.max(0, ...data.map((r) => r.length));
  const cell = (r, c) => { while (data.length < r) data.push([]); return data[r - 1]; };
  const tab = {
    name, data, calls,
    getDataRange: () => ({ getValues: () => data.map((r) => {
      const w = width(), out = r.slice(); while (out.length < w) out.push(''); return out;
    }) }),
    getLastRow: () => data.length,
    appendRow: (vals) => { data.push(vals.slice()); },
    deleteRow: (r) => { data.splice(r - 1, 1); },
    setFrozenRows: () => {},
    getRange: (r, c, nr, nc) => ({
      setValue: (v) => { calls.setValue++; cell(r, c)[c - 1] = v; },
      setValues: (vals) => {
        calls.setValues++;
        if (vals.length !== (nr || 1) || vals[0].length !== (nc || 1)) {
          throw new Error('setValues shape ' + vals.length + 'x' + vals[0].length
                        + ' != range ' + (nr || 1) + 'x' + (nc || 1));
        }
        vals.forEach((line, i) => line.forEach((v, j) => { cell(r + i, c + j)[c + j - 1] = v; }));
      },
      setNumberFormat: () => {}
    })
  };
  return tab;
}

function makeSpreadsheet(tabs) {
  const byName = {};
  tabs.forEach((t) => { byName[t.name] = t; });
  return {
    tabs: byName,
    getSheetByName: (n) => byName[n] || null,
    insertSheet: (n) => (byName[n] = makeTab(n, []))
  };
}

function loadServer(now) {
  const logs = [];
  const ctx = {
    console, Math, Date, JSON, Object, Array, String, Number, isFinite, parseFloat, parseInt,
    Logger: { log: (m) => logs.push(String(m)) },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: { formatDate: (d) => d.toDateString() },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    ContentService: { MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) }
  };
  vm.createContext(ctx);
  const src = FILES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  vm.runInContext(src, ctx, { filename: 'server-bundle.js' });
  if (now) vm.runInContext('now = function () { return new Date(' + now.getTime() + '); };', ctx);
  ctx.logs = logs;
  return ctx;
}

// ---- scenarios -----------------------------------------------------------
let failures = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || !detail ? '' : ' — ' + detail));
  if (!cond) failures++;
}

// Same name defined at top level in two files = last loaded silently wins.
(function duplicateNames() {
  const owner = {}, dupes = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/^(?:function|var|const|let)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (owner[m[1]] && owner[m[1]] !== f) dupes.push(m[1] + ' in ' + owner[m[1]] + ' and ' + f);
      owner[m[1]] = f;
    }
  }
  console.log('# one global scope');
  check('no top-level name defined in two server files', dupes.length === 0, dupes.join('; '));
})();

const SCENARIOS = {
  'Dorset: first shift creates the tab and prices the shift'() {
    const G = loadServer(new Date(2026, 9, 9, 23, 48));
    const ss = makeSpreadsheet([]);
    const msg = G.handleTip(ss, 'Dorset Inn',
      { clock_in: '16:00', clock_out: '22:24', hours: null, tips: null, notes: '' },
      { date: new Date(2026, 9, 9, 23, 48), backdated: false, reason: 'absent' });
    const t = ss.tabs['Dorset Inn'];
    check('tab created with headers', t && t.data[0].join('|') === G.DORSET_HEADERS.join('|'));
    check('one shift row', t.data.length === 2);
    const h = G.DORSET_HEADERS, row = t.data[1];
    check('take-home written = 59.10', row[h.indexOf('Total Take-Home')] === 59.1, row.join(','));
    check('message quotes it', /take-home \$59\.10/.test(msg), msg);
    check('one setValues for the row, no per-cell writes',
      t.calls.setValues === 1 && t.calls.setValue === 0, JSON.stringify(t.calls));
  },

  'Dorset: weekly tips re-price every shift in that week'() {
    const G = loadServer(new Date(2026, 9, 12, 10, 0));          // Monday
    const ss = makeSpreadsheet([]);
    const shift = (d, a, b) => G.handleTip(ss, 'Dorset Inn', { clock_in: a, clock_out: b },
      { date: d, backdated: false, reason: 'absent' });
    shift(new Date(2026, 9, 6, 22), '16:00', '22:00');           // 6h
    shift(new Date(2026, 9, 7, 22), '17:00', '22:00');           // 5h
    shift(new Date(2026, 9, 9, 23), '16:00', '23:00');           // 7h
    const msg = G.handleTip(ss, 'Dorset Inn', { tips: 300 },
      { date: new Date(2026, 9, 12, 10), backdated: false, reason: 'absent' });
    const t = ss.tabs['Dorset Inn'], h = G.DORSET_HEADERS;
    const take = t.data.slice(1, 4).map((r) => r[h.indexOf('Total Take-Home')]);
    check('takes match the hand-computed week', take.join(',') === '137.56,114.64,160.49', take.join(','));
    check('tips row stamped in the week just ended (Sun Oct 11)',
      t.data[4][0].getDate() === 11 && t.data[4][0].getDay() === 0, String(t.data[4][0]));
    check('message gives the week', /412\.69/.test(msg), msg);
  },

  'Track: closed for the season, nothing written'() {
    const G = loadServer(new Date(2026, 9, 9, 12));
    const track = makeTab('Track', [['Timestamp', 'Hours', 'Tips']]);
    let threw = '';
    try { G.handleTip(makeSpreadsheet([track]), 'Track', { clock_in: '09:30', clock_out: '19:00', tips: 300 },
                      { date: new Date(), reason: 'absent' }); }
    catch (e) { threw = e.message; }
    check('refused', /Track is closed/.test(threw), threw);
    check('Track tab untouched', track.data.length === 1);
  }
};

// handleDeleteShift opens the sheet itself, so this one swaps SpreadsheetApp.
SCENARIOS['Track: deleting a row repairs its week through one write per row'] = function () {
  const G = loadServer(new Date(2026, 6, 28));
  const H = ['Timestamp', 'Hours', 'Tips', 'Hourly Rate', 'Notes',
             'Gross Wage', 'Est. Net Wage', 'Total Take-Home', 'Eff. $/hr'];
  const dupeTs = new Date(2026, 6, 24, 19, 30, 0);
  const track = makeTab('Track', [H,
    [new Date(2026, 6, 23, 18, 53, 54), 9.03, 350, '', '', 0, 0, 0, 0],
    [new Date(2026, 6, 24, 19, 19, 26), 9.28, 516, '', '', 0, 0, 0, 0],
    [dupeTs, 9.28, 516, '', 'dupe', 0, 0, 0, 0]]);
  G.SpreadsheetApp = { openById: () => makeSpreadsheet([track]) };
  const res = G.handleDeleteShift({ venue: 'Track', ts: dupeTs.toISOString(),
    expect: { hours: 9.28, tips: 516 }, sheet_ids: { tip: 'x' } });
  check('duplicate removed', track.data.length === 3);
  // The stored values the real sheet holds for 7/23 and 7/24.
  check('survivors repriced to the sheet values',
    track.data[1][7] === 482.78 && track.data[2][7] === 648.05,
    track.data.slice(1).map((r) => r[7]).join(','));
  check('one setValues per surviving row', track.calls.setValues === 2 && track.calls.setValue === 0,
    JSON.stringify(track.calls));
  check('reports what it recomputed', res.recomputed.length === 2);
};

for (const [name, fn] of Object.entries(SCENARIOS)) {
  console.log('\n# ' + name);
  try { fn(); } catch (e) { failures++; console.log('FAIL threw: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }
}
console.log('\n' + (failures ? failures + ' FAILED' : 'all scenarios passed'));
process.exit(failures ? 1 : 0);
