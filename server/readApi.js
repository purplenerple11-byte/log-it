// ================================================================
// Log It — Read API (pure logic, no Apps Script APIs)
// File: server/readApi.js   →   paste into Apps Script as readApi.gs
//
// WHAT THIS IS
// Turns raw sheet rows into the objects the shifts and ideas pages consume,
// and repairs the pay values the sheet is missing.
//
// WHY COLUMNS ARE FOUND BY HEADER, NOT BY LETTER
// handleIdea appends '' into Materials columns E and F on the assumption they
// were spare. They are not — they are Price and Notes, filled in by hand
// ($57.42, "ebay", "Part At Home"). Every lookup here goes through
// columnForHeader so a layout change misses loudly instead of writing into a
// column that already means something.
//
// WHY PAY IS RECOMPUTED
// Columns F-I arrived in router v4.5, so the 16 Track rows from 6/3-7/19/2026
// carry no wage or take-home at all — half the history. recomputeWeek rebuilds
// them for DISPLAY ONLY, nothing is written back. The same function repairs a
// pay week after a duplicate row is deleted, where the surviving rows really
// are rewritten, because their stored net was computed as though the deleted
// shift's hours were in the week.
//
// No module syntax and no Apps Script calls on purpose: the same file runs in
// the browser test harness and inside Apps Script, where files share one global
// scope, so routerWebApp.gs can call these directly and they can call
// trackPay.gs (shiftPay, payWeekStart, round2) right back.
// ================================================================

// Venues whose pay is modeled well enough to state a take-home figure.
// Susans is deliberately absent: its $20/hr is GROSS, with no withholding
// modeled, so it must never be summed with or displayed like Track's net.
// The next job — bartending or cooking after track season — gets added here
// alongside its own wage rate and a withholding line re-fit to a real paystub.
var PAY_MODELED_VENUES = { Track: true };

// Loose enough to survive a header being retitled slightly, strict enough not
// to collide: compare on letters and digits only, and let a header carry a
// suffix the caller didn't ask for ("Excitement (1-5)" answers to "Excitement").
function normalizeHeader(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// 0-based column index for `name`, or -1. Callers MUST treat -1 as a hard
// failure and say which header they wanted — never fall back to a guess.
function columnForHeader(headers, name) {
  if (!Array.isArray(headers)) return -1;
  var want = normalizeHeader(name);
  if (!want) return -1;
  for (var i = 0; i < headers.length; i++) {
    if (normalizeHeader(headers[i]).indexOf(want) === 0) return i;
  }
  return -1;
}

// Cell → number. Sheets hands back real numbers for numeric cells, but a
// hand-typed "$108.40" arrives as a string, and blanks arrive as ''.
function cellNumber(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v == null ? '' : v).replace(/[$,\s]/g, '');
  if (!s) return null;
  var n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function cellText(v) {
  return String(v == null ? '' : v).trim();
}

// Checkbox cells come back as real booleans; a hand-typed cell might say
// anything. Blank is false.
function cellBool(v) {
  if (typeof v === 'boolean') return v;
  var s = cellText(v).toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === 'x' || s === '1';
}

// 'YYYY-MM-DD' for the Monday that starts this date's pay week. Built on
// payWeekStart (trackPay.gs) so the dashboard's week boundaries are the same
// ones the shifts were priced against — it never computes its own.
function payWeekKey(date) {
  var d = payWeekStart(date);
  var m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

function localDayKey(date) {
  var m = date.getMonth() + 1, day = date.getDate();
  return date.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

// Price one pay week's shifts, in order.
//
// ORDER IS LOAD-BEARING. Withholding is progressive and assessed on the whole
// week, so each shift is worth its INCREMENTAL contribution given the hours
// already logged before it. The week's first shift also absorbs the flat $0.60
// SDI. Pricing every shift as though it were alone understates the week by
// roughly $20 per shift.
//
// Takes [{hours, tips}] chronologically; returns one pay object each.
function recomputeWeek(shifts) {
  if (!Array.isArray(shifts)) return [];
  var out = [];
  var prior = 0;
  for (var i = 0; i < shifts.length; i++) {
    var s = shifts[i] || {};
    var hrs = cellNumber(s.hours) || 0;
    var pay = shiftPay(prior, hrs, cellNumber(s.tips) || 0);
    out.push(pay);
    // Round as we accumulate, the way sumTrackHours does, so a long week
    // doesn't drift a cent through float addition.
    prior = round2(prior + hrs);
  }
  return out;
}

// ---------------------------------------------------------------
// ROW → OBJECT
// ---------------------------------------------------------------

// `rows` is always a sheet's getDataRange().getValues() — row 0 is headers.
function readTrackShifts(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  var h = rows[0];
  var cTs    = columnForHeader(h, 'Timestamp');
  var cHours = columnForHeader(h, 'Hours');
  var cTips  = columnForHeader(h, 'Tips');
  var cNotes = columnForHeader(h, 'Notes');
  var cGross = columnForHeader(h, 'Gross Wage');
  var cNet   = columnForHeader(h, 'Est. Net Wage');
  var cTake  = columnForHeader(h, 'Total Take-Home');
  var cEff   = columnForHeader(h, 'Eff. $/hr');

  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    // A row with no real timestamp cannot be placed in a pay week or
    // identified for a delete, so it is not a shift as far as this app cares.
    if (!r || !(r[cTs] instanceof Date)) continue;

    var gross = cGross === -1 ? null : cellNumber(r[cGross]);
    var net   = cNet   === -1 ? null : cellNumber(r[cNet]);
    var take  = cTake  === -1 ? null : cellNumber(r[cTake]);
    var eff   = cEff   === -1 ? null : cellNumber(r[cEff]);

    out.push({
      ts: r[cTs],
      venue: 'Track',
      week: payWeekKey(r[cTs]),
      hours: cellNumber(r[cHours]) || 0,
      tips: cellNumber(r[cTips]) || 0,
      notes: cNotes === -1 ? '' : cellText(r[cNotes]),
      clockIn: null,
      clockOut: null,
      // Blank F-I is the pre-v4.5 shape. Reported as null here and filled in
      // by fillMissingPay, which marks it as computed rather than stored.
      pay: (gross === null || net === null || take === null) ? null : {
        gross: gross, net: net, takeHome: take,
        effHourly: eff === null ? 0 : eff,
        source: 'sheet'
      },
      dupeOf: null
    });
  }
  return out;
}

function readSusansShifts(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  var h = rows[0];
  var cTs    = columnForHeader(h, 'Timestamp');
  var cIn    = columnForHeader(h, 'Clock In');
  var cOut   = columnForHeader(h, 'Clock Out');
  var cHours = columnForHeader(h, 'Hours');
  var cPay   = columnForHeader(h, 'Pay');
  var cNotes = columnForHeader(h, 'Notes');

  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r || !(r[cTs] instanceof Date)) continue;
    out.push({
      ts: r[cTs],
      venue: 'Susans',
      week: payWeekKey(r[cTs]),
      hours: cellNumber(r[cHours]) || 0,
      tips: 0,
      notes: cNotes === -1 ? '' : cellText(r[cNotes]),
      clockIn: cIn === -1 ? null : cellText(r[cIn]),
      clockOut: cOut === -1 ? null : cellText(r[cOut]),
      // GROSS, not take-home. Kept in its own field precisely so nothing can
      // add it to a Track net by accident.
      grossPay: cPay === -1 ? 0 : (cellNumber(r[cPay]) || 0),
      pay: null,
      dupeOf: null
    });
  }
  return out;
}

var IDEA_STATUSES = ['Active', 'Done', 'Archived'];

function readIdeas(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  var h = rows[0];
  var cTs    = columnForHeader(h, 'Timestamp');
  var cTitle = columnForHeader(h, 'Title');
  var cCat   = columnForHeader(h, 'Category');
  var cEff   = columnForHeader(h, 'Effort');
  var cExc   = columnForHeader(h, 'Excitement');
  var cNext  = columnForHeader(h, 'Next Step');
  var cTags  = columnForHeader(h, 'Tags');
  var cStat  = columnForHeader(h, 'Status');

  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r) continue;
    var title = cTitle === -1 ? '' : cellText(r[cTitle]);
    if (!title && !(r[cTs] instanceof Date)) continue;
    out.push({
      ts: r[cTs] instanceof Date ? r[cTs] : null,
      title: title,
      category: cCat === -1 ? '' : cellText(r[cCat]),
      effort: cEff === -1 ? '' : cellText(r[cEff]),
      excitement: cExc === -1 ? null : cellNumber(r[cExc]),
      nextStep: cNext === -1 ? '' : cellText(r[cNext]),
      tags: cTags === -1 ? '' : cellText(r[cTags]),
      // A blank cell reads as Active, which is what makes the 25 existing rows
      // work with no backfill: the sheet is not touched until something is
      // actually tapped. A missing Status column behaves the same way.
      status: normalizeStatus(cStat === -1 ? '' : r[cStat])
    });
  }
  return out;
}

function normalizeStatus(v) {
  var s = normalizeHeader(v);
  for (var i = 0; i < IDEA_STATUSES.length; i++) {
    if (normalizeHeader(IDEA_STATUSES[i]) === s) return IDEA_STATUSES[i];
  }
  return 'Active';
}

function readMaterials(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  var h = rows[0];
  var cTs   = columnForHeader(h, 'Timestamp');
  var cProj = columnForHeader(h, 'Project');
  var cItem = columnForHeader(h, 'Item');
  var cCat  = columnForHeader(h, 'Category');
  var cPrice = columnForHeader(h, 'Price');
  var cNotes = columnForHeader(h, 'Notes');
  var cGot   = columnForHeader(h, 'Got it');

  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r) continue;
    var item = cItem === -1 ? '' : cellText(r[cItem]);
    if (!item) continue;
    out.push({
      // Deliberately kept when null. One live row (the immersion blender) was
      // hand-added with no timestamp; dropping it would hide a real material.
      // It gets identified by project + item instead — see sheetWrite.gs.
      ts: r[cTs] instanceof Date ? r[cTs] : null,
      project: cProj === -1 ? '' : cellText(r[cProj]),
      item: item,
      category: cCat === -1 ? '' : cellText(r[cCat]),
      price: cPrice === -1 ? null : cellNumber(r[cPrice]),
      notes: cNotes === -1 ? '' : cellText(r[cNotes]),
      acquired: cGot === -1 ? false : cellBool(r[cGot])
    });
  }
  return out;
}

// ---------------------------------------------------------------
// REPAIR + ANNOTATE
// ---------------------------------------------------------------

// Fill in pay for shifts the sheet has none for, week by week.
//
// Display only — nothing here writes. A shift that already has stored values
// keeps them: the sheet stays the source of truth wherever it actually spoke.
// Recomputing the whole week anyway (including stored rows) is what makes the
// gaps correct, since a missing row still has to be priced against the hours
// logged before it.
//
// Mutates and returns the same array.
function fillMissingPay(shifts) {
  if (!Array.isArray(shifts)) return [];

  var weeks = {};
  for (var i = 0; i < shifts.length; i++) {
    var s = shifts[i];
    if (!s || !PAY_MODELED_VENUES[s.venue] || !(s.ts instanceof Date)) continue;
    var key = s.venue + '|' + payWeekKey(s.ts);
    if (!weeks[key]) weeks[key] = [];
    weeks[key].push(s);
  }

  for (var k in weeks) {
    if (!Object.prototype.hasOwnProperty.call(weeks, k)) continue;
    var week = weeks[k];
    // Chronological, because each shift is priced against the ones before it.
    week.sort(function (a, b) { return a.ts.getTime() - b.ts.getTime(); });
    if (!week.some(function (s) { return !s.pay; })) continue;

    var computed = recomputeWeek(week);
    for (var j = 0; j < week.length; j++) {
      if (week[j].pay) continue;
      week[j].pay = {
        gross: computed[j].grossWage,
        net: computed[j].netWage,
        takeHome: computed[j].takeHome,
        effHourly: computed[j].effectiveHourly,
        source: 'computed'
      };
    }
  }
  return shifts;
}

// Flag a shift that looks like a second copy of an earlier one: same venue,
// same calendar day, same hours. The v4.6 request_id dedupe stops new ones,
// so this catches hand-entry mistakes and the rows written before that fix —
// including the two identical 7/15 Susans rows.
//
// Points at the earlier row and never the first occurrence, so the UI can
// offer to remove the copy rather than the original.
//
// Mutates and returns the same array.
function markDuplicates(shifts) {
  if (!Array.isArray(shifts)) return [];
  var seen = {};
  for (var i = 0; i < shifts.length; i++) {
    var s = shifts[i];
    if (!s) continue;
    s.dupeOf = null;
    if (!(s.ts instanceof Date)) continue;
    var key = s.venue + '|' + localDayKey(s.ts) + '|' + (cellNumber(s.hours) || 0);
    if (seen[key]) {
      s.dupeOf = seen[key].toISOString();
    } else {
      seen[key] = s.ts;
    }
  }
  return shifts;
}
