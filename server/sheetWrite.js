// ================================================================
// Log It — Write-Back Validation (pure logic, no Apps Script APIs)
// File: server/sheetWrite.js   →   paste into Apps Script as sheetWrite.gs
//
// WHAT THIS IS
// Everything that decides WHETHER a write is allowed and WHICH row it lands
// on. The Apps Script calls that actually write live in routerWebApp.gs; the
// judgement lives here so it can be tested.
//
// WHY THE WHITELIST
// The pages only ever change four things. Anything else arriving in a patch —
// a typo, a stale client, a tampered request — is refused rather than written,
// so no request can rewrite hours, tips, or a computed pay column.
//
// WHY IDENTITY IS NEVER A ROW INDEX
// Sorting or deleting a row in Sheets renumbers everything below it. A patch
// that trusted an index would silently hit the wrong idea. Rows are found by
// their column-A timestamp, and materials by timestamp PLUS item text, because
// handleIdea stamps every material of one idea with that idea's timestamp.
// One live row was hand-added with no timestamp at all, so there is a
// project + item fallback — which refuses to write when it is ambiguous rather
// than picking one.
//
// No module syntax and no Apps Script calls on purpose: the same file runs in
// the browser test harness and inside Apps Script, where files share one global
// scope, so it can use readApi.gs's helpers directly.
// ================================================================

var ROW_NOT_FOUND = 0;
var ROW_AMBIGUOUS = -1;

// field → the sheet header it writes to, and how its value is checked.
// Adding to this is the ONLY way to make a column writable from a page.
var PATCHABLE = {
  idea: {
    status:    { header: 'Status',    coerce: coerceStatus },
    next_step: { header: 'Next Step', coerce: coerceText }
  },
  material: {
    acquired: { header: 'Got it', coerce: coerceBool },
    price:    { header: 'Price',  coerce: coercePrice }
  }
};

function coerceStatus(v) {
  var want = normalizeHeader(v);
  for (var i = 0; i < IDEA_STATUSES.length; i++) {
    if (normalizeHeader(IDEA_STATUSES[i]) === want) return IDEA_STATUSES[i];
  }
  // Free text here would quietly break every filter and count on the page.
  throw new Error('not a valid status: ' + v);
}

function coerceText(v) {
  return String(v == null ? '' : v).trim();
}

function coerceBool(v) {
  return cellBool(v);
}

// Blank clears the cell — that is a legitimate edit, not an error.
function coercePrice(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = cellNumber(v);
  if (n === null || n < 0) throw new Error('not a number: ' + v);
  return n;
}

// Returns { target, field, header, value } or throws with a message the client
// can show as-is.
function validatePatch(body) {
  var b = body || {};
  var target = String(b.target || '');
  var fields = PATCHABLE[target];
  if (!fields) throw new Error('unknown patch target: ' + target);

  var field = String(b.field || '');
  var spec = Object.prototype.hasOwnProperty.call(fields, field) ? fields[field] : null;
  if (!spec) throw new Error('not patchable: ' + field);

  return {
    target: target,
    field: field,
    header: spec.header,
    value: spec.coerce(b.value)
  };
}

// 1-based SHEET row (headers are row 1), or ROW_NOT_FOUND.
function locateRowByTimestamp(rows, tsIso) {
  if (!Array.isArray(rows) || rows.length < 2) return ROW_NOT_FOUND;
  var want = new Date(String(tsIso == null ? '' : tsIso));
  if (isNaN(want.getTime())) return ROW_NOT_FOUND;

  var cTs = columnForHeader(rows[0], 'Timestamp');
  if (cTs === -1) return ROW_NOT_FOUND;

  for (var i = 1; i < rows.length; i++) {
    var cell = rows[i] ? rows[i][cTs] : null;
    if (cell instanceof Date && cell.getTime() === want.getTime()) return i + 1;
  }
  return ROW_NOT_FOUND;
}

// An idea is identified by its timestamp alone.
function locateIdeaRow(rows, tsIso) {
  return locateRowByTimestamp(rows, tsIso);
}

function normalizeItem(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}

// A material needs timestamp AND item, because every material an idea creates
// carries that idea's timestamp. When the row has no timestamp — one live row
// does not — it falls back to project + item, and refuses on a tie.
function locateMaterialRow(rows, spec) {
  if (!Array.isArray(rows) || rows.length < 2) return ROW_NOT_FOUND;
  var s = spec || {};
  var h = rows[0];
  var cTs   = columnForHeader(h, 'Timestamp');
  var cProj = columnForHeader(h, 'Project');
  var cItem = columnForHeader(h, 'Item');
  if (cItem === -1) return ROW_NOT_FOUND;

  var item = normalizeItem(s.item);
  if (!item) return ROW_NOT_FOUND;

  var want = s.ts ? new Date(String(s.ts)) : null;
  var haveTs = want && !isNaN(want.getTime());

  var hits = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r) continue;
    if (normalizeItem(r[cItem]) !== item) continue;

    if (haveTs) {
      if (cTs !== -1 && r[cTs] instanceof Date && r[cTs].getTime() === want.getTime()) {
        hits.push(i + 1);
      }
    } else if (cProj !== -1 && normalizeItem(r[cProj]) === normalizeItem(s.project)) {
      hits.push(i + 1);
    }
  }

  if (hits.length === 1) return hits[0];
  // Two rows that look alike must never be resolved by picking the first.
  if (hits.length > 1) return ROW_AMBIGUOUS;
  return ROW_NOT_FOUND;
}

// Does the row still hold what the page was showing?
//
// A page left open while the sheet was edited must not delete a row whose
// contents have moved on. `cols` says where hours and tips live, because Track
// and Susans put them in different columns; tips is skipped when absent.
function verifyShiftRow(row, expect, cols) {
  if (!row) return false;
  var c = cols || { hours: 1, tips: 2 };
  var e = expect || {};

  var wantHours = cellNumber(e.hours);
  if (wantHours === null) return false;
  var gotHours = cellNumber(row[c.hours]);
  if (gotHours === null || Math.abs(gotHours - wantHours) > 0.005) return false;

  if (c.tips !== null && c.tips !== undefined && c.tips !== -1 &&
      e.tips !== null && e.tips !== undefined) {
    var gotTips = cellNumber(row[c.tips]) || 0;
    if (Math.abs(gotTips - (cellNumber(e.tips) || 0)) > 0.005) return false;
  }
  return true;
}
