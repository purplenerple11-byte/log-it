// ================================================================
// Log It — Dorset Inn pay & withholding (pure logic, no Apps Script APIs)
// File: server/dorsetPay.js   →   live file dorsetPay
//
// WHAT THIS IS
// Busser at the Dorset Inn (Church Street Hospitality): $10/hr plus tips. Tips
// go through payroll ("Charge Tips" on the stub), so they are taxed together
// with the wage. That one fact shapes everything below.
//
// FITTED TO THE FIRST PAYSTUB (check 10/23/2026, period 10/4–10/17)
// Paid BIWEEKLY, Sunday to Saturday. On $910.02 gross the stub withheld
// Fed (Single) 29.08, OASDI 56.42, Medicare 13.20, VT (S/0) 25.43,
// VT CCC 1.00 → net 784.89. This file reproduces every line to the penny
// (tests.js, "Dorset paystub"). That stub also paid 12.9 training hours at
// $14.42 (Vermont's full minimum wage); training is over, so it isn't modelled.
//
// WHY A SHIFT'S PAY IS A SHARE OF ITS PAY PERIOD
// Withholding is assessed on the whole paycheck (two weeks of wage + tips),
// and tips are only known after the week. So a shift has no pay of its own:
// the period is priced as a whole, and each shift gets the slice proportional
// to its hours. Every shift in a period therefore shows the same effective
// $/hr. When tips are logged, every shift in that period is recomputed.
//
// No module syntax and no Apps Script calls on purpose: the same file runs in
// the browser test harness and inside Apps Script, where every file shares ONE
// global scope. Every top-level name here is prefixed dorset/DORSET/vt/VT so it
// cannot collide with trackPay.gs, which it calls into (round2, federalForPeriod,
// FICA_RATE, MEDICARE_RATE) along with readApi.gs (columnForHeader, cellNumber,
// cellText, cellClock, payWeekKey, localDayKey).
// ================================================================

var DORSET_VENUE     = 'Dorset Inn';
var DORSET_WAGE_RATE = 10.00;   // $/hr cash wage. Update on a raise.

// Pay periods start on a Sunday and are counted from the first stub's Period
// Begin. 26 a year (14 days) is what that stub's withholding was computed by —
// weekly tables would have withheld ~$67 federal, not $29.08. If a later stub
// turns out weekly, set 52: period length and withholding both follow.
var DORSET_PERIOD_ANCHOR    = [2026, 9, 4];   // Sun Oct 4 2026 (month is 0-based)
var DORSET_PERIODS_PER_YEAR = 26;

// The router creates the tab with exactly this layout on first use, so the
// column positions in formatDorsetRow can rely on it. Lookups still go by
// header name. 'Tips' must stay before 'Tips Share': columnForHeader matches
// on prefix and returns the first hit.
var DORSET_HEADERS = ['Timestamp', 'Clock In', 'Clock Out', 'Hours', 'Tips', 'Notes',
                      'Gross Wage', 'Tips Share', 'Est. Net Wage', 'Total Take-Home',
                      'Eff. $/hr'];

// Vermont 2026, Single (GB-1210-2026). Annual wages less allowances, then this
// table, then divided back per paycheck. The stub says "VT (S/0)": 0 allowances.
var VT_ALLOWANCE_ANNUAL = 5400;
var VT_ALLOWANCES       = 0;    // confirmed by the 10/23/2026 stub
var VT_BRACKETS = [             // [ceiling of annual taxable wages, rate]
  [3925, 0],
  [54675, 0.0335],
  [126775, 0.066],
  [260225, 0.076],
  [Infinity, 0.0875]
];
// Vermont Child Care Contribution, employee share ("VT CCC EE" on the stub):
// 0.11% of gross. $1.00 on $910.02.
var VT_CCC_RATE = 0.0011;

// Midnight on the Sunday that starts the pay period containing `date`.
// Math.round absorbs the DST hour: day counts between local midnights are
// 23 or 25 hours once a year.
function dorsetPeriodStart(date) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var a = new Date(DORSET_PERIOD_ANCHOR[0], DORSET_PERIOD_ANCHOR[1], DORSET_PERIOD_ANCHOR[2]);
  var len  = 364 / DORSET_PERIODS_PER_YEAR;    // 14 days, or 7 if weekly
  var days = Math.round((d.getTime() - a.getTime()) / 86400000);
  var back = ((days % len) + len) % len;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
}

function dorsetPeriodKey(date) {
  return localDayKey(dorsetPeriodStart(date));
}

// Vermont withholding for one biweekly paycheck, unrounded.
function vtPerPeriod(gross) {
  if (!(gross > 0)) return 0;
  var n = DORSET_PERIODS_PER_YEAR;
  var taxable = Math.max(0, gross * n - VT_ALLOWANCES * VT_ALLOWANCE_ANNUAL);
  var tax = 0, floor = 0;
  for (var i = 0; i < VT_BRACKETS.length; i++) {
    var ceiling = VT_BRACKETS[i][0], rate = VT_BRACKETS[i][1];
    if (taxable <= ceiling) { tax += (taxable - floor) * rate; break; }
    tax += (ceiling - floor) * rate;
    floor = ceiling;
  }
  return tax / n;
}

// Every deduction on one Dorset paycheck, each rounded to cents the way the
// stub prints them. No NY lines: this is a Vermont employer.
function dorsetPaycheckDeductions(gross) {
  if (!(gross > 0)) return { fica: 0, medicare: 0, federal: 0, vt: 0, ccc: 0, total: 0 };
  var d = {
    fica:     round2(gross * FICA_RATE),
    medicare: round2(gross * MEDICARE_RATE),
    federal:  round2(federalForPeriod(gross, DORSET_PERIODS_PER_YEAR)),
    vt:       round2(vtPerPeriod(gross)),
    ccc:      round2(gross * VT_CCC_RATE)
  };
  d.total = round2(d.fica + d.medicare + d.federal + d.vt + d.ccc);
  return d;
}

function dorsetPaycheckNet(gross) {
  if (!(gross > 0)) return 0;
  return round2(gross - dorsetPaycheckDeductions(gross).total);
}

// Split `total` across `weights`, rounded to cents, summing to `total` EXACTLY.
// The last part takes the rounding remainder; without that the rows of a
// period drift a cent or two away from the paycheck they came from.
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

// Price a whole pay period, then share it out by hours.
//
// `hoursList` is the period's shifts, chronological. `tips` is everything
// tipped in the period — 0 until logged. No break is deducted.
//
// netWage is take-home minus the tips share: what is left of the wage once the
// tax on wage AND tips has come out of it. That is how payroll handles tipped
// work, and it keeps the tips figure equal to what you were actually tipped.
function allocateDorsetPeriod(hoursList, tips) {
  var hrs = [], i;
  for (i = 0; i < (hoursList || []).length; i++) {
    var h = parseFloat(hoursList[i]);
    hrs.push(isFinite(h) && h > 0 ? h : 0);
  }
  tips = parseFloat(tips);
  if (!isFinite(tips) || tips < 0) tips = 0;

  var hoursTotal = 0;
  for (i = 0; i < hrs.length; i++) hoursTotal += hrs[i];
  hoursTotal = round2(hoursTotal);

  var wageGross = round2(hoursTotal * DORSET_WAGE_RATE);
  var gross     = round2(wageGross + tips);
  var net       = dorsetPaycheckNet(gross);
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
    period: {
      hours: hoursTotal, wageGross: wageGross, tips: tips, gross: gross, net: net,
      effectiveHourly: eff, deductions: dorsetPaycheckDeductions(gross)
    }
  };
}

// Which week a tips entry belongs to when it doesn't name a day: the Sun–Sat
// week that just ended. Logged Sunday through Friday, that is the week ending
// last Saturday; logged on a Saturday, the week ending today. Stamped 20:00 on
// that Saturday — inside the right week and pay period either way, and far
// from midnight so no DST shift can move the day.
function dorsetTipsWeekDate(logDate) {
  var d = logDate instanceof Date ? logDate : new Date();
  var back = d.getDay() === 6 ? 0 : d.getDay() + 1;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 20, 0, 0);
}

// Price every pay period found in a Dorset tab. `rows` is getDataRange().getValues().
//
// Returns { byRow: {sheetRow: shiftPay}, periods: {periodKey: summary} }.
// Rows with hours are shifts; rows with only tips are tips entries. Tips are
// pooled per period from ANY row, so a tip amount said alongside a shift
// still counts instead of vanishing.
function dorsetComputeRows(rows) {
  var out = { byRow: {}, periods: {} };
  if (!Array.isArray(rows) || rows.length < 2) return out;
  var h = rows[0];
  var cTs = columnForHeader(h, 'Timestamp');
  var cH  = columnForHeader(h, 'Hours');
  var cT  = columnForHeader(h, 'Tips');

  var groups = {}, i;
  for (i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r || !(r[cTs] instanceof Date)) continue;
    var key = dorsetPeriodKey(r[cTs]);
    if (!groups[key]) groups[key] = { shifts: [], tips: 0, start: dorsetPeriodStart(r[cTs]) };
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
    var a = allocateDorsetPeriod(hoursList, g.tips);
    a.period.tipsLogged = g.tips > 0;
    a.period.shifts = g.shifts.length;
    a.period.start = g.start;
    out.periods[k] = a.period;
    for (i = 0; i < g.shifts.length; i++) out.byRow[g.shifts[i].row] = a.rows[i];
  }
  return out;
}

// Dorset rows → shift objects for the shifts page, same shape as Track's.
//
// Pay is computed here from hours and tips rather than read back from the
// stored columns, so a hand edit to hours or tips in the sheet shows up
// immediately. The stored columns are a convenience for reading the sheet.
// Tips-only rows are not shifts and are left out. `week` stays the Mon–Sun
// display bucket every venue shares; pricing is by pay period.
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
    var p  = calc.periods[dorsetPeriodKey(r[cTs])];
    out.push({
      ts: r[cTs],
      venue: DORSET_VENUE,
      week: payWeekKey(r[cTs]),
      hours: hrs,
      tips: c.tipsShare,
      notes: cNotes === -1 ? '' : cellText(r[cNotes]),
      clockIn: cIn === -1 ? null : (cellClock(r[cIn]) || null),
      clockOut: cOut === -1 ? null : (cellClock(r[cOut]) || null),
      pay: {
        gross: c.grossWage,
        net: c.netWage,
        takeHome: c.takeHome,
        effHourly: c.effectiveHourly,
        // 'period': priced as a share of its biweekly paycheck. The page
        // explains that every shift in the period shows the same $/hr.
        source: 'period',
        tipsLogged: !!(p && p.tipsLogged)
      },
      dupeOf: null
    });
  }
  return out;
}
