// ================================================================
// Log It — Dorset Inn pay & withholding (pure logic, no Apps Script APIs)
// File: server/dorsetPay.js   →   paste into Apps Script as dorsetPay.gs
//
// WHAT THIS IS
// Busser at the Dorset Inn: $10/hr plus tips. Tips arrive ONCE A WEEK, not
// per shift, and they go through payroll — so they are taxed together with the
// wage. That one fact shapes everything below.
//
// WHY A SHIFT'S PAY IS A SHARE OF ITS WEEK
// Withholding is assessed on the whole weekly paycheck (wage + tips), and the
// tips for a week are not known until the week is over. So a shift has no pay
// of its own: the week is priced as a whole, and each shift gets the slice of
// it proportional to its hours. Every shift in a week therefore shows the same
// effective $/hr — no single night can claim the tips, because nobody knows
// which night earned them. When the weekly tips are logged, every shift in
// that week is recomputed.
//
// ESTIMATE, NOT CALIBRATED
// Track's withholding was fitted to two real paystubs and reproduces both to
// the penny. This has no paystub yet. Federal and FICA are standard; Vermont
// is the real 2026 table (Vermont Dept of Taxes GB-1210-2026), but the
// allowance count and the pay-week boundary are assumptions. Re-check both
// against the first stub: VT_ALLOWANCES, and whether the week is Mon-Sun.
//
// No module syntax and no Apps Script calls on purpose: the same file runs in
// the browser test harness and inside Apps Script, where every file shares ONE
// global scope. Every top-level name here is prefixed dorset/DORSET/vt/VT so it
// cannot collide with trackPay.gs, which it calls into (round2, federalWeekly,
// payWeekStart, FICA_RATE, MEDICARE_RATE) along with readApi.gs
// (columnForHeader, cellNumber, cellText, payWeekKey).
// ================================================================

var DORSET_VENUE     = 'Dorset Inn';
var DORSET_WAGE_RATE = 10.00;   // $/hr cash wage. Update on a raise.

// The router creates the tab with exactly this layout on first use, so the
// column positions in formatDorsetRow can rely on it. Lookups still go by
// header name. 'Tips' must stay before 'Tips Share': columnForHeader matches
// on prefix and returns the first hit.
var DORSET_HEADERS = ['Timestamp', 'Clock In', 'Clock Out', 'Hours', 'Tips', 'Notes',
                      'Gross Wage', 'Tips Share', 'Est. Net Wage', 'Total Take-Home',
                      'Eff. $/hr'];

// Vermont 2026, Single. Annual wages less allowances, then this table, then /52.
// Cross-checked against the weekly wage chart in the same publication: $3,925/52
// and $54,675/52 are its $75 and $1,051 cutoffs, and $1,700.13 is exactly
// 3.35% x $50,750.
var VT_ALLOWANCE_ANNUAL = 5400;
var VT_ALLOWANCES       = 0;    // ASSUMED. Zero withholds slightly more, so take-home
                                // errs low. Each allowance is worth ~$3.48/week.
var VT_BRACKETS = [             // [ceiling of annual taxable wages, rate]
  [3925, 0],
  [54675, 0.0335],
  [126775, 0.066],
  [260225, 0.076],
  [Infinity, 0.0875]
];

// Vermont withholding for one weekly paycheck, unrounded.
function vtWeekly(gross) {
  if (!(gross > 0)) return 0;
  var taxable = Math.max(0, gross * 52 - VT_ALLOWANCES * VT_ALLOWANCE_ANNUAL);
  var tax = 0, floor = 0;
  for (var i = 0; i < VT_BRACKETS.length; i++) {
    var ceiling = VT_BRACKETS[i][0], rate = VT_BRACKETS[i][1];
    if (taxable <= ceiling) { tax += (taxable - floor) * rate; break; }
    tax += (ceiling - floor) * rate;
    floor = ceiling;
  }
  return tax / 52;
}

// Every deduction on one weekly Dorset paycheck, each rounded to cents the way
// a stub prints them. No NY Paid Family Leave and no NY disability: those are
// New York payroll lines, and this is a Vermont employer.
function dorsetWeeklyDeductions(gross) {
  if (!(gross > 0)) return { fica: 0, medicare: 0, federal: 0, vt: 0, total: 0 };
  var d = {
    fica:     round2(gross * FICA_RATE),
    medicare: round2(gross * MEDICARE_RATE),
    federal:  round2(federalWeekly(gross)),
    vt:       round2(vtWeekly(gross))
  };
  d.total = round2(d.fica + d.medicare + d.federal + d.vt);
  return d;
}

function dorsetWeekNet(gross) {
  if (!(gross > 0)) return 0;
  return round2(gross - dorsetWeeklyDeductions(gross).total);
}

// Split `total` across `weights`, rounded to cents, summing to `total` EXACTLY.
// The last part takes the rounding remainder; without that the rows of a week
// drift a cent or two away from the week they came from.
function dorsetSplit(total, weights) {
  var sum = 0, i;
  for (i = 0; i < weights.length; i++) sum += weights[i];
  var out = [], used = 0;
  for (i = 0; i < weights.length; i++) {
    if (i === weights.length - 1) { out.push(round2(total - used)); break; }
    var part = sum > 0 ? round2(total * weights[i] / sum) : 0;
    out.push(part);
    used = round2(used + part);
  }
  return out;
}

// Price a whole week, then share it out by hours.
//
// `hoursList` is the week's shifts, chronological. `weeklyTips` is everything
// tipped that week — 0 until the tips are logged. No break is deducted.
//
// netWage is take-home minus the tips share: what is left of the wage once the
// tax on wage AND tips has come out of it. That is how payroll handles tipped
// work, and it keeps the tips figure equal to what you were actually tipped.
function allocateDorsetWeek(hoursList, weeklyTips) {
  var hrs = [], i;
  for (i = 0; i < (hoursList || []).length; i++) {
    var h = parseFloat(hoursList[i]);
    hrs.push(isFinite(h) && h > 0 ? h : 0);
  }
  var tips = parseFloat(weeklyTips);
  if (!isFinite(tips) || tips < 0) tips = 0;

  var hoursTotal = 0;
  for (i = 0; i < hrs.length; i++) hoursTotal += hrs[i];
  hoursTotal = round2(hoursTotal);

  var wageGross = round2(hoursTotal * DORSET_WAGE_RATE);
  var gross     = round2(wageGross + tips);
  var net       = dorsetWeekNet(gross);
  var eff       = hoursTotal > 0 ? round2(net / hoursTotal) : 0;

  var takeHomes = dorsetSplit(net, hrs);
  var tipShares = dorsetSplit(tips, hrs);

  var rows = [];
  for (i = 0; i < hrs.length; i++) {
    rows.push({
      grossWage: round2(hrs[i] * DORSET_WAGE_RATE),
      tipsShare: tipShares[i],
      netWage: round2(takeHomes[i] - tipShares[i]),
      takeHome: takeHomes[i],
      effectiveHourly: eff
    });
  }
  return {
    rows: rows,
    week: {
      hours: hoursTotal, wageGross: wageGross, tips: tips, gross: gross, net: net,
      effectiveHourly: eff, deductions: dorsetWeeklyDeductions(gross)
    }
  };
}

// Which week a tips entry belongs to when it doesn't name a day: the week that
// just ended. Logged Monday through Saturday, that is the previous Mon-Sun
// week; logged on a Sunday, it is the week ending today. Stamped 20:00 on that
// Sunday — any time inside the week buckets correctly, and the evening is far
// from midnight so no DST shift can move the day.
//
// This is the v4.7 lesson applied in advance: Track priced a shift logged on
// Wednesday as a fresh week and overstated it by ~$23. Tips logged on payday
// would do the same thing to the wrong week.
function dorsetTipsWeekDate(logDate) {
  var d = logDate instanceof Date ? logDate : new Date();
  if (d.getDay() === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 20, 0, 0);
  var monday = payWeekStart(d);
  return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1, 20, 0, 0);
}

// Price every week found in a Dorset tab. `rows` is getDataRange().getValues().
//
// Returns { byRow: {sheetRow: shiftPay}, weeks: {weekKey: weekSummary} }.
// Rows with hours are shifts; rows with only tips are the weekly tips entries.
// Tips are pooled per week from ANY row, so a tip amount said alongside a shift
// still counts instead of vanishing.
function dorsetComputeRows(rows) {
  var out = { byRow: {}, weeks: {} };
  if (!Array.isArray(rows) || rows.length < 2) return out;
  var h = rows[0];
  var cTs = columnForHeader(h, 'Timestamp');
  var cH  = columnForHeader(h, 'Hours');
  var cT  = columnForHeader(h, 'Tips');

  var groups = {}, i;
  for (i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r || !(r[cTs] instanceof Date)) continue;
    var key = payWeekKey(r[cTs]);
    if (!groups[key]) groups[key] = { shifts: [], tips: 0 };
    var tip = cellNumber(r[cT]) || 0;
    if (tip > 0) groups[key].tips = round2(groups[key].tips + tip);
    var hrs = cellNumber(r[cH]) || 0;
    if (hrs > 0) groups[key].shifts.push({ row: i + 1, ts: r[cTs], hours: hrs });
  }

  for (var k in groups) {
    if (!Object.prototype.hasOwnProperty.call(groups, k)) continue;
    var g = groups[k];
    g.shifts.sort(function (a, b) { return a.ts.getTime() - b.ts.getTime(); });
    var hoursList = [];
    for (i = 0; i < g.shifts.length; i++) hoursList.push(g.shifts[i].hours);
    var a = allocateDorsetWeek(hoursList, g.tips);
    a.week.tipsLogged = g.tips > 0;
    a.week.shifts = g.shifts.length;
    out.weeks[k] = a.week;
    for (i = 0; i < g.shifts.length; i++) out.byRow[g.shifts[i].row] = a.rows[i];
  }
  return out;
}

// Dorset rows → shift objects for the shifts page, same shape as Track's.
//
// Pay is computed here from hours and tips rather than read back from the
// stored columns, so a hand edit to hours or tips in the sheet shows up
// immediately. The stored columns are a convenience for reading the sheet.
// Tips-only rows are not shifts and are left out.
function readDorsetShifts(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  var h = rows[0];
  var cTs    = columnForHeader(h, 'Timestamp');
  var cIn    = columnForHeader(h, 'Clock In');
  var cOut   = columnForHeader(h, 'Clock Out');
  var cH     = columnForHeader(h, 'Hours');
  var cNotes = columnForHeader(h, 'Notes');
  var calc   = dorsetComputeRows(rows);

  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r || !(r[cTs] instanceof Date)) continue;
    var hrs = cellNumber(r[cH]) || 0;
    if (!(hrs > 0)) continue;
    var c  = calc.byRow[i + 1];
    var wk = calc.weeks[payWeekKey(r[cTs])];
    out.push({
      ts: r[cTs],
      venue: DORSET_VENUE,
      week: payWeekKey(r[cTs]),
      hours: hrs,
      tips: c.tipsShare,
      notes: cNotes === -1 ? '' : cellText(r[cNotes]),
      clockIn: cIn === -1 ? null : (cellText(r[cIn]) || null),
      clockOut: cOut === -1 ? null : (cellText(r[cOut]) || null),
      pay: {
        gross: c.grossWage,
        net: c.netWage,
        takeHome: c.takeHome,
        effHourly: c.effectiveHourly,
        // 'estimate', not 'sheet': uncalibrated until a real stub. The page
        // marks these the way it marks Track's recomputed pre-v4.5 rows.
        source: 'estimate',
        tipsLogged: !!(wk && wk.tipsLogged)
      },
      dupeOf: null
    });
  }
  return out;
}
