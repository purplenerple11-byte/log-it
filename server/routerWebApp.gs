// ================================================================
// Log It — Router Web App  (v4.9 — Dorset Inn; Track closed for the season)
// Live project "Log It - Router". Deploy: Web App | Execute as: Me | Anyone.
//
// FILES — one Apps Script project, ONE shared global scope. Live names differ
// from the repo's; deploy with tools/deploy-apps-script.sh, which maps them:
//   Code        ← server/routerWebApp.gs   (this file: doPost, Gemini, handlers)
//   tipRouter   ← server/tipRouting.js     (routeTip, seasonGate, shift times)
//   trackPay    ← server/trackPay.js       (Track wage + NY withholding)
//   dorsetPay   ← server/dorsetPay.js      (Dorset wage + VT withholding)
//   readApi     ← server/readApi.js        (row → object readers)
//   sheetWrite  ← server/sheetWrite.js     (patch/delete validation)
//
// SCRIPT PROPERTIES (by hand — no CLI or API can set these):
//   GEMINI_API_KEY   from aistudio.google.com
//   READ_TOKEN       long random string, also entered once per page on the phone
//
// PUBLISH = new VERSION of the existing deployment (the script does this).
// Never "New deployment": it mints a new /exec URL, and the current one is
// baked into CFG_DEFAULTS, so the app would silently keep hitting old code.
//
// Why things are the way they are: CLAUDE.md (invariants), docs/HANDOFF.md
// (history), git log. Release notes no longer live in this header.
// ================================================================

// 2-Tier Locked Chain: Pinned primary prevents math/routing regression;
// 3.5-flash escalates complex/rambling edge cases.
var GEMINI_MODELS = [
  'gemini-3.1-flash-lite', // Primary workhorse (stable, cheap, fast)
  'gemini-3.5-flash'       // True fallback (separate quota pool, higher reasoning capacity)
];

var SUSAN_HOURLY_RATE   = 20.00;
var BREAK_DEDUCTION_HRS = 0.5;

// Fallback sheet IDs
var SHEET_IDS = {
  tip:     'YOUR_TIPS_SHEET_ID',
  meal:    'YOUR_MEALS_SHEET_ID',
  idea:    'YOUR_IDEAS_SHEET_ID',
  car:     'YOUR_CAR_SHEET_ID'
};

// ================================================================
// GEMINI MASTER PROMPT
// ================================================================
var SYSTEM_PROMPT = 'You are a personal log entry parser. Extract structured data from the user\'s voice or text entry.\n\n'
+ 'CATEGORY CLASSIFICATION:\n'
+ '- "tip":     shift work, hours worked, tips made, track / valet work, susan\'s, Dorset Inn / the inn / bussing, weekly tips, clock in/out\n'
+ '- "meal":    eating, food items, meal types, supplements (creatine, fish oil, MCT, multivitamin)\n'
+ '- "idea":    idea, thought, concept, "what if", future plan, something to build or try\n'
+ '- "car":     oil change, repair, mileage, car maintenance, parts replaced, shop\n\n'
+ 'TIME FORMAT: emit every time as 24-hour "HH:MM". Explicit am/pm is literal.\n'
+ '- Bare hours without am/pm: 7 8 9 10 11 → AM  |  12 1 2 3 4 5 6 → PM\n'
+ '- Examples: "9:18 in, 6:50 out" → clock_in "09:18", clock_out "18:50".\n'
+ '  "2-4" → "14:00"/"16:00". "8-4" → "08:00"/"16:00". "11-7" → "11:00"/"19:00".\n\n'
+ 'SHIFT DATE: set "shift_date" (YYYY-MM-DD) ONLY when the entry says which day the\n'
+ 'shift happened — "yesterday", "last night", "Sunday", "Aug 2", "the 2nd", "two days\n'
+ 'ago". Resolve it against CURRENT DATE below. If no day is named, use null and the\n'
+ 'server assumes today. Never guess or infer a date from anything but an explicit\n'
+ 'mention: a wrong date files the shift in the wrong pay week.\n\n'
+ 'TIP VENUE: set "venue" ONLY when the text explicitly names one — susan/sue/susans\n'
+ '(any spelling) → "susans"; track/valet → "track"; dorset/dorset inn/the inn → "dorset".\n'
+ 'Otherwise null. Never infer venue\n'
+ 'from times or tip amounts, and never choose the tab yourself — the server does that.\n\n'
+ 'WEEKLY TIPS: an entry that only reports tips ("dorset tips 380", "380 in tips this\n'
+ 'week") is still category "tip": set "tips", leave hours and clock times null.\n\n'
+ 'TOLERANCE: Fix obvious typos (wokred→worked, susand→susans). Any variation of susan/sue/susans counts.\n\n'
+ 'IDEA MATERIALS: If an idea entry also mentions needing to buy/get something for the project (e.g. "fix the shop vac, need a new hose"), extract materials too. If no purchases mentioned, omit the "materials" key entirely.\n\n'
+ 'Return EXACTLY one of these JSON structures matching the category:\n\n'
+ 'TIP:        {"category":"tip","data":{"venue":"<susans|track|dorset|null>","shift_date":"<YYYY-MM-DD|null>","clock_in":"<HH:MM|null>","clock_out":"<HH:MM|null>","hours":<number|null>,"tips":<number|null>,"notes":"<string>"}}\n'
+ 'MEAL:       {"category":"meal","sub_route":"Log","data":{"meal":"<Breakfast|Lunch|Dinner|Snack>","foods":"<comma-separated>","creatine":"<\u2713 or empty>","fish_oil":"<\u2713 or empty>","mct":"<\u2713 or empty>","multivitamin":"<\u2713 or empty>","notes":"<string>"}}\n'
+ 'IDEA:       {"category":"idea","sub_route":"Ideas","data":{"title":"<5-7 words>","category":"<Business|Money|Creative|Personal|Random>","effort":"<Quick Win|Medium Project|Big Swing>","excitement":<1-5>,"next_step":"<string>","tags":"<comma-separated>","materials":[{"item":"<thing to buy>","category":"<Hardware|Tools|Supplies|Parts|Other>"}]}}\n'
+ 'CAR:        {"category":"car","sub_route":"Maintenance Log","data":{"type":"<Oil Change|Repair>","mileage":<number|null>,"description":"<string>","parts_replaced":"<string>","cost":<number|null>,"shop_diy":"<string>","notes":"<string>"}}\n\n'
+ 'Never invent missing data — use null or empty string.';

// ================================================================
// ENTRY POINT
// ================================================================
function doPost(e) {
  var lock = null;
  try {
    var body      = JSON.parse(e.postData.contents);
    var op        = String(body.op || 'log');

    // ------------------------------------------------------------
    // READ — answered here, deliberately BEFORE any lock is taken.
    //
    // The log path below holds the script lock for the WHOLE request so that
    // client retries are idempotent (see the duplicate guard). If a read took
    // that same lock, opening the shifts page would block logging a shift —
    // and Apps Script runs of 82s/107s/268s are in this project's history, so
    // that block would be long. Reads mutate nothing and need no ordering.
    // ------------------------------------------------------------
    if (op === 'read') {
      requireReadToken(body.token);
      return jsonOk(handleRead(body));
    }

    // Patch and delete DO mutate, so unlike reads they must not interleave
    // with an append that is halfway through writing a row.
    if (op === 'patch' || op === 'delete') {
      requireReadToken(body.token);
      lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) {
        lock = null;
        throw new Error('Sheet is busy — try again');
      }
      return jsonOk(op === 'patch' ? handlePatch(body) : handleDeleteShift(body));
    }

    var text      = (body.text || '').trim();
    var sheetIds  = body.sheet_ids || {};
    var requestId = String(body.request_id || '').trim();

    if (!text) throw new Error('No text received');

    // ------------------------------------------------------------
    // DUPLICATE GUARD — do not remove. This, not timing, is what makes
    // client retries safe.
    //
    // On 2026-07-27 a doPost ran 16.3s against the client's then-15s timeout.
    // The client gave up, called it transient, and retried; the original was
    // still alive, finished, and wrote its row, so the retry wrote a second one.
    // Execution history shows runs of 268s/107s/82s, so no client timeout is
    // ever high enough to rely on.
    //
    // The client sends a request_id that stays constant across its retries. We
    // hold the script lock for the WHOLE request, so a retry blocks until the
    // original finishes and then finds its cached response and returns that
    // without writing. Checking the cache without the lock would not help: the
    // retry started BEFORE the original wrote anything.
    // ------------------------------------------------------------
    var cache    = CacheService.getScriptCache();
    var cacheKey = requestId ? 'req_' + requestId : '';

    if (cacheKey) {
      lock = LockService.getScriptLock();
      // Best effort: if the wait expires we still check the cache below and
      // proceed. Logging a row late beats refusing to log at all.
      if (!lock.tryLock(45000)) {
        lock = null;
        Logger.log('doPost: lock wait expired for ' + requestId);
      }
      var prior = cache.get(cacheKey);
      if (prior) {
        Logger.log('doPost: duplicate request ' + requestId + ' — returning cached result, no write');
        return ContentService.createTextOutput(prior)
                            .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // Call Gemini with automatic model fallback
    var parsed    = callGeminiWithFallback(text);
    var category  = parsed.category;
    var sub_route = parsed.sub_route;
    var data      = parsed.data || {};

    // Resolve sheet ID
    var sheetId = sheetIds[category] || SHEET_IDS[category];
    if (!sheetId || sheetId.indexOf('YOUR_') === 0) {
      throw new Error('Sheet ID not configured for "' + category + '". Add it in the app settings.');
    }

    // Write to sheet
    var ss      = SpreadsheetApp.openById(sheetId);
    var message = '';

    switch (category) {
      // The tab is decided here, not by Gemini — see tipRouting.gs. Overwrite
      // sub_route so the client's confirmation card shows where it actually went.
      case 'tip':
        // Before anything reads the times: an evening clock-out the model
        // returned as AM would otherwise price as an 18-hour shift.
        data.clock_out = fixClockOut(data.clock_in, data.clock_out);
        sub_route = seasonGate(routeTip(data), data);
        // Which DAY the shift happened decides its pay week, so resolve it
        // before handleTip sums the week — see resolveShiftDate in tipRouting.gs.
        var shift = resolveShiftDate(data.shift_date, now());
        if (shift.reason !== 'ok' && shift.reason !== 'absent' && shift.reason !== 'today') {
          Logger.log('shift_date rejected, using today instead — ' + shift.reason);
        }
        message   = handleTip(ss, sub_route, data, shift);
        break;
      case 'meal':    message = handleMeal(ss, data);            break;
      case 'idea':    message = handleIdea(ss, data);            break;
      case 'car':     message = handleCar(ss, data);             break;
      default: throw new Error('Unknown category: ' + category);
    }

    var result = { success: true, message: message, category: category, sub_route: sub_route };

    // Only successes are remembered — a failed request wrote nothing, so a
    // retry of it must be allowed to run for real. 6h is CacheService's max and
    // far longer than the seconds a retry actually takes.
    if (cacheKey) cache.put(cacheKey, JSON.stringify(result), 21600);

    return jsonOk(result);

  } catch (err) {
    Logger.log('doPost error: ' + err.message);
    // Apps Script always answers HTTP 200, so the client cannot read a status
    // code. `code` is how it tells "wrong key, ask for it" apart from a real
    // failure it should surface as an error.
    return jsonOk({ success: false, error: err.message, code: err.code || '' });
  } finally {
    if (lock) lock.releaseLock();
  }
}

// ================================================================
// GEMINI WITH MODEL FALLBACK CHAIN
// ================================================================
function callGeminiWithFallback(text) {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    throw new Error('GEMINI_API_KEY not set. Go to Apps Script → Project Settings → Script Properties.');
  }

  var lastError = '';

  // Try each model in the chain
  for (var modelIndex = 0; modelIndex < GEMINI_MODELS.length; modelIndex++) {
    var model = GEMINI_MODELS[modelIndex];
    Logger.log('Attempting Gemini call with model: ' + model);

    try {
      return callGeminiSingleModel(model, text, key);
    } catch (err) {
      lastError = err.message;
      Logger.log('Model ' + model + ' failed: ' + lastError);

      // If not the last model in the chain, continue to next
      if (modelIndex < GEMINI_MODELS.length - 1) {
        Logger.log('Trying next model in fallback chain...');
        continue;
      }
    }
  }

  // All models exhausted
  throw new Error('All Gemini models unavailable: ' + lastError);
}

// ================================================================
// SINGLE MODEL ATTEMPT (single fetch — no internal retries)
// ================================================================
function callGeminiSingleModel(model, text, key) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/'
          + model + ':generateContent?key=' + key;

  var payload = JSON.stringify({
    // Today's date is appended at call time, not baked into SYSTEM_PROMPT, so
    // "yesterday"/"Sunday" can be resolved. SYSTEM_PROMPT stays a static const
    // that tests can fetch and assert on.
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT + currentDateLine() }] },
    contents: [{ role: 'user', parts: [{ text: text }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json', // Native API structural locking
      maxOutputTokens: 512
    }
  });

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: payload,
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();

  // Success
  if (code === 200) {
    var result = JSON.parse(response.getContentText());
    var raw    = result.candidates[0].content.parts[0].text;
    // Strip markdown fences just in case older endpoints ignore responseMimeType
    var clean  = raw.replace(/```json|```/gi, '').trim();
    Logger.log('Success with ' + model);
    return JSON.parse(clean);
  }

  var errMsg;
  try {
    var errBody = JSON.parse(response.getContentText());
    errMsg  = (errBody.error && errBody.error.message) || ('HTTP ' + code);
  } catch (e) {
    errMsg = 'HTTP ' + code;
  }

  Logger.log(model + ': ' + code + ' — ' + errMsg);

  throw new Error(errMsg);
}

// ================================================================
// READ / WRITE-BACK OPS  (v4.8)
// ================================================================
// The Web App URL is baked into CFG_DEFAULTS and the repo is public. Writing
// junk rows was the accepted exposure; letting anyone READ income history and
// the idea list is a different one, so read, patch and delete are gated.
//
// The token lives in Script Properties and in the phone's localStorage —
// never in the repo. tokenMatches (readApi.gs) fails closed when READ_TOKEN
// is unset, so forgetting the setup step denies everyone rather than
// publishing everything.
//
// Deliberately NOT applied to logging: a missing or wrong token must never
// stop a shift being logged.
function requireReadToken(provided) {
  var expected = PropertiesService.getScriptProperties().getProperty('READ_TOKEN');
  if (!tokenMatches(provided, expected)) {
    var err = new Error('Wrong or missing read key');
    err.code = 'unauthorized';
    throw err;
  }
}

// Everything the shifts or ideas page needs, in one round trip. Volumes are
// tiny (33 shifts, 25 ideas), so there is no pagination and no incremental
// sync — the cost of a request here is Apps Script's cold start, not the rows.
function handleRead(body) {
  var scope    = String(body.scope || '');
  var sheetIds = body.sheet_ids || {};

  if (scope === 'shifts') {
    var ss = SpreadsheetApp.openById(sheetIds.tip || SHEET_IDS.tip);
    var shifts = readTrackShifts(getTab(ss, 'Track').getDataRange().getValues())
      .concat(readSusansShifts(getTab(ss, 'Susans').getDataRange().getValues()));
    // getSheetByName, not getTab: getTab throws on a missing tab, and the Dorset
    // tab only exists once the first Dorset shift has been logged. A throw here
    // would take the whole shifts page down with it.
    var dorsetTab = ss.getSheetByName(DORSET_VENUE);
    if (dorsetTab) {
      shifts = shifts.concat(readDorsetShifts(dorsetTab.getDataRange().getValues()));
    }
    // Order of these two matters only for clarity: the pay repair works per
    // week and the duplicate scan sorts its own view, so neither depends on
    // how the two tabs were concatenated above.
    fillMissingPay(shifts);
    markDuplicates(shifts);
    return { success: true, fetched_at: now().toISOString(), shifts: shifts };
  }

  if (scope === 'ideas') {
    var is = SpreadsheetApp.openById(sheetIds.idea || SHEET_IDS.idea);
    return {
      success: true,
      fetched_at: now().toISOString(),
      ideas: readIdeas(getTab(is, 'Ideas').getDataRange().getValues()),
      materials: readMaterials(getTab(is, 'Materials').getDataRange().getValues())
    };
  }

  throw new Error('Unknown read scope: ' + scope);
}

// Change one whitelisted field on one row. Validation and row location live in
// sheetWrite.gs; this is only the Sheets plumbing.
function handlePatch(body) {
  var p       = validatePatch(body);
  var tabName = p.target === 'idea' ? 'Ideas' : 'Materials';
  var ss      = SpreadsheetApp.openById((body.sheet_ids || {}).idea || SHEET_IDS.idea);
  var tab     = getTab(ss, tabName);
  var rows    = tab.getDataRange().getValues();

  // Located by header, never by letter. If the header is missing, say so
  // instead of writing into whatever column happens to sit there — Materials
  // columns E and F look spare and are not.
  var col = columnForHeader(rows[0], p.header);
  if (col === -1) {
    throw new Error('Add a "' + p.header + '" column to the ' + tabName + ' tab first');
  }

  var row = p.target === 'idea'
    ? locateIdeaRow(rows, body.ts)
    : locateMaterialRow(rows, { ts: body.ts, project: body.project, item: body.item });

  if (row === ROW_AMBIGUOUS) {
    throw new Error('More than one row matches that item — fix it in Sheets');
  }
  if (row === ROW_NOT_FOUND) {
    throw new Error('row not found');
  }

  tab.getRange(row, col + 1).setValue(p.value);
  return { success: true, field: p.field, value: p.value };
}

// Remove one duplicate shift, then repair the pay week it was in.
function handleDeleteShift(body) {
  var asked   = String(body.venue || '');
  var venue   = asked === 'Susans' ? 'Susans' : asked === DORSET_VENUE ? DORSET_VENUE : 'Track';
  var ss      = SpreadsheetApp.openById((body.sheet_ids || {}).tip || SHEET_IDS.tip);
  var tab     = getTab(ss, venue);
  var rows    = tab.getDataRange().getValues();

  var row = locateRowByTimestamp(rows, body.ts);
  if (row === ROW_NOT_FOUND) throw new Error('row not found');

  var cols = {
    hours: columnForHeader(rows[0], 'Hours'),
    tips:  venue === 'Track' ? columnForHeader(rows[0], 'Tips') : -1
  };
  // Deleting is destructive and irreversible from here, so the row has to
  // still hold what the page was showing when it was tapped.
  if (!verifyShiftRow(rows[row - 1], body.expect || {}, cols)) {
    throw new Error('That shift has changed since the page loaded — reload and try again');
  }

  var ts = rows[row - 1][0];
  tab.deleteRow(row);

  // Susans is flat $20/hr with nothing derived from the week, so there is
  // nothing to repair. Track's stored net for every OTHER row in the week was
  // computed as though these hours were in it, so they are all now wrong.
  // Dorset re-prices the whole week too: one fewer shift changes everyone's
  // share of the week's tips and withholding.
  var recomputed = venue === 'Track' ? recomputeTrackWeek(tab, ts)
                 : venue === DORSET_VENUE ? recomputeDorsetWeek(tab, ts).changed
                 : [];
  return { success: true, deleted: ts.toISOString(), recomputed: recomputed };
}

// Write several cells of one row — a single setValues when the columns are
// adjacent (contiguousRow, sheetWrite.gs), cell by cell when they are not.
// `cols` are 0-based header indexes.
function writeCells(tab, row, cols, values) {
  var w = contiguousRow(cols, values);
  if (w) {
    tab.getRange(row, w.start + 1, 1, w.line.length).setValues([w.line]);
    return;
  }
  for (var i = 0; i < cols.length; i++) tab.getRange(row, cols[i] + 1).setValue(values[i]);
}

// Rewrite F-I for every Track row in the pay week containing `ts`.
//
// This is the automated form of the hand cleanup done on 2026-07-27, when a
// duplicate row was deleted and the survivor's take-home was left $23.37 too
// high because it had been priced against the duplicate's hours.
function recomputeTrackWeek(tab, ts) {
  var rows  = tab.getDataRange().getValues();
  var h     = rows[0];
  var cTs   = columnForHeader(h, 'Timestamp');
  var cH    = columnForHeader(h, 'Hours');
  var cT    = columnForHeader(h, 'Tips');
  var money = [
    columnForHeader(h, 'Gross Wage'),
    columnForHeader(h, 'Est. Net Wage'),
    columnForHeader(h, 'Total Take-Home'),
    columnForHeader(h, 'Eff. $/hr')
  ];
  for (var m = 0; m < money.length; m++) {
    if (money[m] === -1) throw new Error('Track is missing its pay columns (F-I)');
  }

  var members = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i] || !(rows[i][cTs] instanceof Date)) continue;
    if (!samePayWeek(rows[i][cTs], ts)) continue;
    members.push({
      row: i + 1,
      ts: rows[i][cTs],
      hours: cellNumber(rows[i][cH]) || 0,
      tips: cellNumber(rows[i][cT]) || 0
    });
  }
  // Chronological: withholding is progressive, so each shift is priced against
  // the hours logged before it.
  members.sort(function (a, b) { return a.ts.getTime() - b.ts.getTime(); });

  var pay = recomputeWeek(members);
  var changed = [];
  for (var j = 0; j < members.length; j++) {
    var vals = [pay[j].grossWage, pay[j].netWage, pay[j].takeHome, pay[j].effectiveHourly];
    // Columns come from the header lookup, so an inserted column can't
    // scramble them; writeCells only batches when they are still adjacent.
    writeCells(tab, members[j].row, money, vals);
    formatTrackRow(tab, members[j].row);
    changed.push(members[j].ts.toISOString());
  }
  return changed;
}

// ================================================================
// UTILITIES
// ================================================================
function jsonOk(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function now() { return new Date(); }

// Appended to SYSTEM_PROMPT per request so relative dates ("yesterday",
// "Sunday") have something to resolve against. Day name included so the model
// doesn't have to work out the weekday itself.
function currentDateLine() {
  var d = new Date();
  return '\n\nCURRENT DATE: ' +
         Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEEE, yyyy-MM-dd') + '.';
}

// "Sun Aug 2" — used to echo a back-dated shift back at the user.
function shortDateLabel(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEE MMM d');
}

function dateFmt(d) {
  return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy');
}

function getTab(ss, name) {
  var t = ss.getSheetByName(name);
  if (!t) throw new Error('Tab "' + name + '" not found. Check your sheet setup.');
  return t;
}

// A=timestamp, B=hours, C=tips, D=tips/hr (written as a "$0.00" string, left
// alone), E=notes, F-I=Gross Wage | Est. Net Wage | Total Take-Home | Eff. $/hr.
function formatTrackRow(tab, row) {
  try {
    tab.getRange(row, 1).setNumberFormat('M/d/yyyy H:mm:ss');
    tab.getRange(row, 2, 1, 2).setNumberFormat('0.##');     // hours, tips
    tab.getRange(row, 6, 1, 4).setNumberFormat('0.00');     // the money columns
  } catch (err) {
    // Cosmetic only — never lose a logged row over formatting.
    Logger.log('formatTrackRow: ' + err.message);
  }
}

// ================================================================
// TIP HANDLER
// ================================================================
function handleTip(ss, sub_route, data, shift) {
  // The row is stamped with the day the shift HAPPENED, not when it was logged.
  // That stamp is what sumTrackHours reads to pick the pay week, so a shift
  // logged Wednesday for the previous Sunday is priced against the right week.
  var ts   = (shift && shift.date instanceof Date) ? shift.date : now();
  var back = !!(shift && shift.backdated);
  // Derived from the clock times when we have them — Gemini's own arithmetic
  // is only a fallback for entries that state hours and no times.
  var hrs  = shiftHours(data.clock_in, data.clock_out, data.hours);

  // Dorset is priced by the week, not the shift — see dorsetPay.gs.
  if (sub_route === DORSET_VENUE) return handleDorset(ss, data, shift);

  if (sub_route === 'Track') {
    // Closed for the season. seasonGate already stops this in doPost; checked
    // again here so no other caller can write a Track row by accident.
    if (!TRACK_SEASON_OPEN) throw new Error('Track is closed until next season — nothing was logged.');
    // Deduct 0.5 hours exclusively for Track shifts (the break is unpaid)
    hrs = Math.max(0, hrs - BREAK_DEDUCTION_HRS);

    var tips = parseFloat(data.tips) || 0;
    var rate = (hrs > 0 && tips > 0) ? '$' + (tips / hrs).toFixed(2) : '';

    // Pay is computed against the whole Mon-Sun pay week, because withholding is
    // progressive — see trackPay.gs. ORDER IS LOAD-BEARING: sum the week BEFORE
    // appending, or the new row counts itself and the shift is taxed as though
    // the week already included it.
    var trackTab = getTab(ss, 'Track');
    var prior    = sumTrackHours(trackTab.getDataRange().getValues(), ts);
    var pay      = shiftPay(prior, hrs, tips);

    trackTab.appendRow([ts, hrs, tips > 0 ? tips : '', rate, data.notes || '',
                        pay.grossWage, pay.netWage, pay.takeHome, pay.effectiveHourly]);

    // Stamp the formats explicitly. The Track tab is a Sheets *Table*, and a row
    // appended past the table's managed range inherits whatever formatting the
    // cells happened to carry — one row came out with every number rendered as a
    // 1900-era date. Setting them here is independent of the table.
    formatTrackRow(trackTab, trackTab.getLastRow());

    // Echo the date back whenever it isn't today, so a misread day is visible
    // on the confirmation card rather than silently mispricing the week.
    var msg = 'Track shift logged' + (back ? ' for ' + shortDateLabel(ts) : '') + ' — ' + hrs + 'h';
    if (tips) msg += ', $' + tips + ' tips';
    msg += ' · take-home $' + pay.takeHome.toFixed(2)
         + ' ($' + pay.effectiveHourly.toFixed(2) + '/hr)';
    return msg;
  } else {
    // Susans: flat hourly, no break deduction, no tips. Times are stored as
    // h:mma to match what the columns already hold.
    var pay = '$' + (hrs * SUSAN_HOURLY_RATE).toFixed(2);
    var inStr  = to12h(data.clock_in);
    var outStr = to12h(data.clock_out);
    getTab(ss, 'Susans').appendRow([ts, inStr, outStr, hrs, pay, data.notes || '']);
    return 'Susans logged' + (back ? ' for ' + shortDateLabel(ts) : '') + ' — '
         + (inStr || '?') + ' to ' + (outStr || '?') + ', ' + pay + ' pay';
  }
}

// ================================================================
// DORSET INN HANDLER  (v4.9)
// ================================================================
// The tab creates itself the first time it is needed — no manual sheet setup.
function getOrCreateTab(ss, name, headers) {
  var t = ss.getSheetByName(name);
  if (t) return t;
  t = ss.insertSheet(name);
  t.appendRow(headers);
  t.setFrozenRows(1);
  return t;
}

// Two shapes of entry land here: a shift (hours, usually clock times) and the
// weekly tips (tips only). Either way the row is appended and then the WHOLE
// week is re-priced, because tips taxed through payroll change the withholding
// on every shift in that paycheck.
function handleDorset(ss, data, shift) {
  var tab  = getOrCreateTab(ss, DORSET_VENUE, DORSET_HEADERS);
  var hrs  = shiftHours(data.clock_in, data.clock_out, data.hours);   // no break
  var tips = parseFloat(data.tips);
  if (!isFinite(tips) || tips < 0) tips = 0;

  var tipsOnly = !(hrs > 0) && tips > 0;
  if (!(hrs > 0) && !tipsOnly) {
    throw new Error('No hours or tips found for the Dorset Inn entry');
  }

  var ts;
  if (tipsOnly) {
    // A named day wins ("tips for last week"); otherwise the week just ended,
    // so tips logged on payday do not land in the week they were paid in.
    ts = (shift && shift.reason === 'ok') ? shift.date : dorsetTipsWeekDate(now());
  } else {
    ts = (shift && shift.date instanceof Date) ? shift.date : now();
  }

  tab.appendRow([ts, to12h(data.clock_in), to12h(data.clock_out),
                 hrs > 0 ? hrs : '', tips > 0 ? tips : '', data.notes || '',
                 '', '', '', '', '']);
  formatDorsetRow(tab, tab.getLastRow());
  var result = recomputeDorsetWeek(tab, ts);
  var week   = result.week;
  var weekOf = shortDateLabel(payWeekStart(ts));

  if (tipsOnly) {
    if (!week || !week.shifts) {
      return 'Dorset tips $' + tips + ' logged for the week of ' + weekOf
           + ' — no shifts logged that week yet; it will price when they are';
    }
    return 'Dorset tips $' + tips + ' logged for the week of ' + weekOf
         + ' · week take-home est. $' + week.net.toFixed(2)
         + ' ($' + week.effectiveHourly.toFixed(2) + '/hr)';
  }

  var back = !!(shift && shift.backdated);
  var mine = result.mine;
  var msg  = 'Dorset Inn logged' + (back ? ' for ' + shortDateLabel(ts) : '')
           + ' — ' + hrs + 'h, $' + (hrs * DORSET_WAGE_RATE).toFixed(2) + ' wage';
  if (mine) msg += ' · est. take-home $' + mine.takeHome.toFixed(2);
  if (week && !week.tipsLogged) msg += ' before tips';
  return msg;
}

// Rewrite the computed columns for every shift in the pay week containing ts.
// Returns { week, changed, mine } — `mine` is the row just appended, if it is
// a shift, so the confirmation card can quote its share.
function recomputeDorsetWeek(tab, ts) {
  var rows = tab.getDataRange().getValues();
  var h    = rows[0];
  var cTs  = columnForHeader(h, 'Timestamp');
  var cols = {
    grossWage:       columnForHeader(h, 'Gross Wage'),
    tipsShare:       columnForHeader(h, 'Tips Share'),
    netWage:         columnForHeader(h, 'Est. Net Wage'),
    takeHome:        columnForHeader(h, 'Total Take-Home'),
    effectiveHourly: columnForHeader(h, 'Eff. $/hr')
  };
  for (var f in cols) {
    if (cols[f] === -1) throw new Error('Dorset Inn tab is missing a pay column (' + f + ')');
  }

  var calc = dorsetComputeRows(rows);
  var key  = payWeekKey(ts);
  var changed = [], mine = null, last = rows.length;

  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r || !(r[cTs] instanceof Date) || payWeekKey(r[cTs]) !== key) continue;
    var out = calc.byRow[i + 1];
    if (!out) continue;   // the tips row: its own columns stay blank
    writeCells(tab, i + 1,
      [cols.grossWage, cols.tipsShare, cols.netWage, cols.takeHome, cols.effectiveHourly],
      [out.grossWage, out.tipsShare, out.netWage, out.takeHome, out.effectiveHourly]);
    changed.push(r[cTs].toISOString());
    if (i + 1 === last) mine = out;
  }
  return { week: calc.weeks[key] || null, changed: changed, mine: mine };
}

// Positions follow DORSET_HEADERS, which this file wrote when it created the
// tab. Cosmetic only — never lose a logged row over formatting.
function formatDorsetRow(tab, row) {
  try {
    tab.getRange(row, 1).setNumberFormat('M/d/yyyy H:mm:ss');
    tab.getRange(row, 4, 1, 2).setNumberFormat('0.##');    // hours, tips
    tab.getRange(row, 7, 1, 5).setNumberFormat('0.00');    // the money columns
  } catch (err) {
    Logger.log('formatDorsetRow: ' + err.message);
  }
}

// ================================================================
// MEAL HANDLER
// ================================================================
function handleMeal(ss, data) {
  var logTab = getTab(ss, 'Log');
  var ts     = now();
  var date   = dateFmt(ts);

  var alreadyTaken = getSupplementsTakenToday(logTab, ts);

  var creatine     = (data.creatine     === '✓' || alreadyTaken.creatine)     ? '✓' : '';
  var fish_oil     = (data.fish_oil     === '✓' || alreadyTaken.fish_oil)     ? '✓' : '';
  var mct          = (data.mct          === '✓' || alreadyTaken.mct)          ? '✓' : '';
  var multivitamin = (data.multivitamin === '✓' || alreadyTaken.multivitamin) ? '✓' : '';

  var suppLabels = ['Creatine 5g', 'Fish Oil 3x', 'MCT 1tbsp', 'Multivitamin 2x'];
  var suppVals   = [creatine, fish_oil, mct, multivitamin];
  var missing    = suppLabels.filter(function(_, i) { return suppVals[i] !== '✓'; });

  logTab.appendRow([
    ts, date,
    data.meal  || '',
    data.foods || '',
    creatine, fish_oil, mct, multivitamin,
    missing.join(', '),
    data.notes || ''
  ]);

  try { updateDailySummary(ss, ts); } catch (e) { Logger.log('Daily summary: ' + e.message); }

  var taken = suppLabels.filter(function(_, i) { return suppVals[i] === '✓'; });
  var msg   = (data.meal || 'Meal') + ' logged';
  if (data.foods) msg += ' — ' + data.foods;
  if (taken.length > 0) msg += ' (' + taken.join(', ') + ')';
  return msg;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

function getSupplementsTakenToday(logTab, ts) {
  var result  = { creatine: false, fish_oil: false, mct: false, multivitamin: false };
  var allRows = logTab.getDataRange().getValues();

  for (var i = 1; i < allRows.length; i++) {
    var rowTs = allRows[i][0];
    if (!(rowTs instanceof Date)) continue;
    if (!sameDay(rowTs, ts))    continue;

    if (allRows[i][4] === '✓') result.creatine     = true;
    if (allRows[i][5] === '✓') result.fish_oil     = true;
    if (allRows[i][6] === '✓') result.mct          = true;
    if (allRows[i][7] === '✓') result.multivitamin = true;

    Logger.log('Found today row ' + i + ': C=' + result.creatine + ' F=' + result.fish_oil + ' M=' + result.mct + ' V=' + result.multivitamin);
  }

  return result;
}

function updateDailySummary(ss, ts) {
  var logTab  = getTab(ss, 'Log');
  var sumTab  = getTab(ss, 'Daily Summary');
  var allRows = logTab.getDataRange().getValues();
  if (allRows.length <= 1) return;

  var todayRows = allRows.slice(1).filter(function(r) {
    return (r[0] instanceof Date) && sameDay(r[0], ts);
  });
  if (todayRows.length === 0) return;

  var c = false, f = false, m = false, v = false;
  var mealTypes = [];

  todayRows.forEach(function(r) {
    if (r[4] === '✓') c = true;
    if (r[5] === '✓') f = true;
    if (r[6] === '✓') m = true;
    if (r[7] === '✓') v = true;
    if (r[2]) mealTypes.push(r[2]);
  });

  var newRow = [
    dateFmt(ts),
    mealTypes.join(', '),
    c ? '✓' : '', f ? '✓' : '', m ? '✓' : '', v ? '✓' : ''
  ];

  var sumAll  = sumTab.getDataRange().getValues();
  var isEmpty = sumAll.length === 0 || (sumAll.length === 1 && !sumAll[0][0]);
  if (isEmpty) {
    sumTab.clear();
    sumTab.appendRow(['Date', 'Meals', 'Creatine 5g', 'Fish Oil 3x', 'MCT 1tbsp', 'Multivitamin 2x']);
    sumAll = sumTab.getDataRange().getValues();
  }

  var existingRow = -1;
  var todayDateStr = dateFmt(ts);
  for (var i = 1; i < sumAll.length; i++) {
    var sumDate = sumAll[i][0];
    var sumDateStr = (sumDate instanceof Date) ? dateFmt(sumDate) : String(sumDate);
    if (sumDateStr === todayDateStr) { existingRow = i + 1; break; }
  }
  if (existingRow > 0) {
    sumTab.getRange(existingRow, 1, 1, newRow.length).setValues([newRow]);
  } else {
    sumTab.appendRow(newRow);
  }
}

// ================================================================
// IDEA HANDLER — handles linked materials
// ================================================================
function handleIdea(ss, data) {
  var ideaTab = getTab(ss, 'Ideas');
  var ts      = now();

  var title = data.title || 'Untitled';

  ideaTab.appendRow([
    ts,
    title,
    data.category   || '',
    data.effort     || '',
    data.excitement || '',
    data.next_step  || '',
    data.tags       || ''
  ]);

  if (data.materials && Array.isArray(data.materials) && data.materials.length > 0) {
    try {
      var materialsTab = getTab(ss, 'Materials');
      var date = dateFmt(ts);

      data.materials.forEach(function(material) {
        materialsTab.appendRow([
          ts,
          title,
          material.item    || '',
          material.category || 'Other',
          '',
          ''
        ]);
      });
    } catch (e) {
      Logger.log('Materials tab write failed: ' + e.message);
    }
  }

  return 'Idea captured — "' + title + '"'
       + (data.category ? ' (' + data.category + ')' : '')
       + (data.materials && data.materials.length > 0 ? ' + ' + data.materials.length + ' material' + (data.materials.length > 1 ? 's' : '') : '');
}

// ================================================================
// CAR HANDLER
// ================================================================
function handleCar(ss, data) {
  var ts = now();
  getTab(ss, 'Maintenance Log').appendRow([
    ts, dateFmt(ts), data.type || '', data.mileage || '',
    data.description || '', data.parts_replaced || '',
    data.cost || '', data.shop_diy || '', data.notes || ''
  ]);
  var msg = (data.type || 'Car entry') + ' logged';
  if (data.mileage) msg += ' — ' + data.mileage + ' miles';
  if (data.cost)    msg += ' ($' + data.cost + ')';
  return msg;
}
