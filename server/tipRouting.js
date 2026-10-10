// ================================================================
// Log It — Tip Tab Routing (pure logic, no Apps Script APIs)
// File: server/tipRouting.js   →   paste into Apps Script as tipRouting.gs
//
// WHY THIS FILE EXISTS
// Tip tab routing used to live in the Gemini prompt, which gave the model two
// mutually exclusive output shapes — only the Susans one had clock_in/clock_out.
// An entry phrased as an in/out pair ("9:18 in, 6:50 out") dropped into the
// Susans schema slot-for-slot, so it routed there even though every written
// rule said Track. Schema shape beat prose. Worse, the Susans schema has no
// tips field, so the tip amount was silently dropped and a fabricated
// hours × $20 payroll row was written instead.
//
// Now Gemini extracts facts and this code picks the tab. Same entry, same tab,
// every time — and the rule is testable (see tests.js).
//
// No module syntax and no Apps Script calls on purpose: the same file runs in
// the browser test harness and inside Apps Script, where files share one global
// scope so routerWebApp.gs can call these directly.
// ================================================================

// "09:18" → 558 (minutes since midnight). Null on anything unparseable.
function parseHHMM(s) {
  var m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s == null ? '' : s));
  if (!m) return null;
  var h = parseInt(m[1], 10);
  var min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// "18:50" → "6:50pm". Matches the format already stored in the Susans columns.
function to12h(s) {
  var mins = parseHHMM(s);
  if (mins === null) return '';
  var h = Math.floor(mins / 60);
  var min = mins % 60;
  var suffix = h < 12 ? 'am' : 'pm';
  var h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return h12 + ':' + (min < 10 ? '0' + min : min) + suffix;
}

// Shift length in hours. Computed from the clock times when both are present —
// the model's own arithmetic is not trusted. Wraps past midnight so an
// overnight shift doesn't come out negative. Falls back to the reported hours.
function shiftHours(clockIn, clockOut, fallbackHours) {
  var start = parseHHMM(clockIn);
  var end = parseHHMM(clockOut);

  if (start !== null && end !== null) {
    var span = end - start;
    if (span < 0) span += 24 * 60; // crossed midnight
    return Math.round((span / 60) * 100) / 100;
  }

  var n = parseFloat(fallbackHours);
  return isFinite(n) && n > 0 ? n : 0;
}

// How far back a shift may be dated. Long enough to cover "I forgot last week",
// short enough that a hallucinated year can't quietly land somewhere plausible.
var SHIFT_BACKDATE_MAX_DAYS = 45;

// Which calendar day a shift actually happened on.
//
// Gemini fills shift_date ("YYYY-MM-DD") only when the entry names a day —
// "yesterday", "last night", "Sunday", "Aug 2" — and leaves it null otherwise.
// Everything here is a guard: a wrong date silently files the shift in the wrong
// pay week and misprices it, which is the exact bug this function exists to
// prevent. Anything not an exact YYYY-MM-DD, not a real calendar date, in the
// future, or older than SHIFT_BACKDATE_MAX_DAYS falls back to `fallback` and
// says why, so the caller can surface it instead of trusting it silently.
//
// Returns { date, backdated, reason }.
function resolveShiftDate(shiftDate, fallback) {
  var today = (fallback instanceof Date) ? fallback : new Date();
  var raw = String(shiftDate == null ? '' : shiftDate);
  var m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(raw);
  if (!m) {
    return { date: today, backdated: false, reason: raw ? 'unparseable: ' + raw : 'absent' };
  }

  var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  // Round-trip check rejects things like 2026-02-30 that Date would roll over.
  var probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) {
    return { date: today, backdated: false, reason: 'not a real date: ' + raw };
  }

  var startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  var deltaDays = Math.round((probe.getTime() - startOfToday.getTime()) / 86400000);
  if (deltaDays > 0) {
    return { date: today, backdated: false, reason: 'in the future: ' + raw };
  }
  if (deltaDays < -SHIFT_BACKDATE_MAX_DAYS) {
    return { date: today, backdated: false, reason: 'too old (' + deltaDays + 'd): ' + raw };
  }
  if (deltaDays === 0) {
    // Already today — keep the real log time rather than a synthetic one.
    return { date: today, backdated: false, reason: 'today' };
  }

  // 20:00 local: a neutral evening stamp, matching how same-day shifts get
  // logged, and far from midnight so no DST shift can move the calendar day.
  return { date: new Date(y, mo - 1, d, 20, 0, 0), backdated: true, reason: 'ok' };
}

// Which tab a tip entry belongs in. First match wins.
//
//   1. venue names one             → that tab   explicit name always wins
//   2. tips, but no hours or times → Dorset Inn  the weekly tips entry
//   3. clock-in before noon        → Track
//   4. clock-in noon or later      → Dorset Inn  (was Susans; Susans is finished)
//   5. tips with hours, no times   → Track       Track logs tips with each shift
//   6. nothing to go on            → Dorset Inn  the current job
//
// Tips used to outrank the clock because Susans was flat hourly and never
// tipped, so a tip amount meant Track. Dorset Inn IS tipped, so a tip amount no
// longer distinguishes the two and the clock decides again. Rule 6 used to say
// Track; it is safe to move because a Track entry always carries tips (rule 5).
function routeTip(data) {
  var d = data || {};

  // Substring match, not equality: the model is told to emit "susans"/"track"/
  // "dorset", but "Susan's", "the track", "the inn" are all the same answer and
  // depending on an exact token is the fragility this file exists to remove.
  var venue = String(d.venue == null ? '' : d.venue).toLowerCase();
  if (venue.indexOf('dorset') !== -1 || venue.indexOf('inn') !== -1) return 'Dorset Inn';
  if (venue.indexOf('susan') !== -1 || venue.indexOf('sue') !== -1) return 'Susans';
  if (venue.indexOf('track') !== -1 || venue.indexOf('valet') !== -1) return 'Track';

  var tips  = parseFloat(d.tips);
  var tipped = isFinite(tips) && tips > 0;
  var start = parseHHMM(d.clock_in);
  var hours = parseFloat(d.hours);
  var hasHours = isFinite(hours) && hours > 0;

  if (tipped && start === null && parseHHMM(d.clock_out) === null && !hasHours) {
    return 'Dorset Inn';
  }
  if (start !== null) return start < 12 * 60 ? 'Track' : 'Dorset Inn';
  if (tipped) return 'Track';
  return 'Dorset Inn';
}
