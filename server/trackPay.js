// ================================================================
// Log It — Track Pay & Withholding (pure logic, no Apps Script APIs)
// File: server/trackPay.js   →   paste into Apps Script as trackPay.gs
//
// WHAT THIS IS
// An ESTIMATE of the Track paycheck, for planning. Not a tax document.
// Reverse-engineered from two real paystubs (weeks ending 7/5/2026 and
// 7/19/2026, weekly pay period, NY) and reproduces both to the penny —
// gross, every individual deduction, and net. tests.js locks that in.
//
// WHY PER-SHIFT NET IS COMPUTED FROM THE WEEK
// Withholding is progressive and assessed on the whole week, but logging
// happens per shift. Taxing one shift in isolation badly understates it: an 8h
// shift alone models as $117.57 net (8.5% withheld), while the same 8h inside a
// typical 35.5h week is really worth $97.91 (23.8% marginal) — a ~$20 gap.
// So shiftPay() takes the hours already logged this pay week and returns the
// DIFFERENCE the shift makes to the week's net. Those differences sum to the
// real check exactly, however the week is split up (tests.js proves this).
//
// CALIBRATION — RE-FIT IF ANYTHING CHANGES
// The federal piece is the real 2026 percentage method and generalizes. The NY
// piece is a LINE FITTED TO TWO DATA POINTS: New York's withholding tables are
// piecewise and build in the tax-table benefit recapture, so the published
// income-tax brackets land $0.22-$0.35/week off. Exact on both stubs and within
// ~$0.23 of a bracket model at 20h, but it is calibration, not derivation.
// A raise, a filing-status change, or a new tax year invalidates it — compare
// against a fresh stub and re-fit.
//
// No module syntax and no Apps Script calls on purpose: the same file runs in
// the browser test harness and inside Apps Script, where files share one global
// scope so routerWebApp.gs can call these directly.
// ================================================================

var TRACK_WAGE_RATE = 16.07;   // $/hr. Update on a raise, then re-check a stub.

// Flat rates, exact on both stubs.
var FICA_RATE     = 0.062;     // EFica    — Social Security
var MEDICARE_RATE = 0.0145;    // EMed     — Medicare
var NY_PFL_RATE   = 0.004327;  // NYFAMILY — NY Paid Family Leave
var NY_SDI_WEEKLY = 0.60;      // NYDisabE — flat per WEEK, not a rate

// 2026 percentage method, filing Single, W-4 step 2 unchecked, no adjustments
// (the stubs read: Fed Marital S, Dependents/Other Income/Deductions all $0.00,
// Add'l Job N).
var FED_STD_DEDUCTION = 16100;
var FED_BRACKETS = [   // [ceiling of annual taxable income, marginal rate]
  [12400, 0.10],
  [50400, 0.12],
  [Infinity, 0.22]
];

// NY line fitted to the two stubs: weekly tax = slope * gross - intercept.
var NY_SLOPE     = 0.054045;
var NY_INTERCEPT = 10.874;

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Midnight on the Monday of the Mon-Sun pay week containing `date`.
// The stubs' WeekEnd values (7/5, 7/19/2026) are Sundays, paid the Thursday after.
function payWeekStart(date) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var dow = d.getDay();               // 0=Sun .. 6=Sat
  var back = dow === 0 ? 6 : dow - 1; // Sunday belongs to the week that began 6 days earlier
  d.setDate(d.getDate() - back);
  return d;
}

function samePayWeek(a, b) {
  return payWeekStart(a).getTime() === payWeekStart(b).getTime();
}

// Federal withholding for one weekly paycheck.
function federalWeekly(gross) {
  if (!(gross > 0)) return 0;
  var taxable = Math.max(0, gross * 52 - FED_STD_DEDUCTION);
  var tax = 0, floor = 0;
  for (var i = 0; i < FED_BRACKETS.length; i++) {
    var ceiling = FED_BRACKETS[i][0], rate = FED_BRACKETS[i][1];
    if (taxable <= ceiling) { tax += (taxable - floor) * rate; break; }
    tax += (ceiling - floor) * rate;
    floor = ceiling;
  }
  return tax / 52;
}

// NY State withholding for one weekly paycheck. Floored at 0 — the fitted line
// goes negative below ~$201 gross, which would otherwise pay you to work.
function nyWeekly(gross) {
  if (!(gross > 0)) return 0;
  return Math.max(0, NY_SLOPE * gross - NY_INTERCEPT);
}

// Every deduction on one weekly paycheck, each rounded to cents the way the
// stubs are. Rounding here (not at the end) is what makes per-shift nets sum
// exactly to the week's total.
//
// A zero-gross week returns all zeros: there is no paycheck, so the flat SDI
// must not apply. Without this guard a 0-hour week would net -$0.60.
function weeklyDeductions(gross) {
  if (!(gross > 0)) {
    return { fica: 0, medicare: 0, pfl: 0, sdi: 0, federal: 0, nyState: 0, total: 0 };
  }
  var d = {
    fica:     round2(gross * FICA_RATE),
    medicare: round2(gross * MEDICARE_RATE),
    pfl:      round2(gross * NY_PFL_RATE),
    sdi:      NY_SDI_WEEKLY,
    federal:  round2(federalWeekly(gross)),
    nyState:  round2(nyWeekly(gross))
  };
  d.total = round2(d.fica + d.medicare + d.pfl + d.sdi + d.federal + d.nyState);
  return d;
}

function weeklyNet(gross) {
  if (!(gross > 0)) return 0;
  return round2(gross - weeklyDeductions(gross).total);
}

// What one shift is actually worth, given the hours already logged this pay week.
//
// netWage is the shift's INCREMENTAL contribution to the week's net, not its
// gross taxed in isolation. The week's first shift absorbs the whole $0.60 SDI,
// which is correct — the week is charged once — and later shifts in the same
// week net less per hour as the progressive brackets bite.
//
// Tips are treated as untaxed cash: on both stubs gross equals units x rate
// exactly, with no tip income present.
function shiftPay(priorWeekHours, shiftHours, tips) {
  var prior = parseFloat(priorWeekHours);
  if (!isFinite(prior) || prior < 0) prior = 0;
  var hrs = parseFloat(shiftHours);
  if (!isFinite(hrs) || hrs < 0) hrs = 0;
  var tip = parseFloat(tips);
  if (!isFinite(tip) || tip < 0) tip = 0;

  var netBefore = weeklyNet(prior * TRACK_WAGE_RATE);
  var netAfter  = weeklyNet((prior + hrs) * TRACK_WAGE_RATE);

  var grossWage = round2(hrs * TRACK_WAGE_RATE);
  var netWage   = round2(netAfter - netBefore);
  var takeHome  = round2(netWage + tip);

  return {
    grossWage: grossWage,
    netWage: netWage,
    takeHome: takeHome,
    effectiveHourly: hrs > 0 ? round2(takeHome / hrs) : 0
  };
}

// Sum the Track hours already logged in the same pay week as `ts`.
// `rows` is a sheet's getDataRange().getValues() — row 0 is headers.
//
// The numeric guard on the hours column is load-bearing: the legacy Auto Tips
// script wrote Timestamp | Date | Hours | ..., putting a DATE in column B. If
// such rows survive in the Track tab, summing column B blindly would corrupt
// the week total and every pay figure derived from it.
function sumTrackHours(rows, ts) {
  if (!Array.isArray(rows)) return 0;
  var sum = 0;
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row || !(row[0] instanceof Date)) continue;
    if (!samePayWeek(row[0], ts)) continue;
    var h = typeof row[1] === 'number' ? row[1] : parseFloat(row[1]);
    if (isFinite(h) && h > 0) sum += h;
  }
  return round2(sum);
}
