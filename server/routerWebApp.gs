// ================================================================
// Log It — Router Web App  (v4.5 — Track Pay & Withholding)
// File:    routerWebApp.gs
// Deploy:  Web App  |  Execute as: Me  |  Who has access: Anyone
//
// REQUIRES two more script files in this project:
//          tipRouting.gs  (paste from server/tipRouting.js)
//          trackPay.gs    (paste from server/trackPay.js)
//
// SETUP: Apps Script → Project Settings → Script Properties
//        Add:  GEMINI_API_KEY = your key from aistudio.google.com
//
// v4.5 changes: Track rows now carry pay — columns F-I hold Gross Wage,
// Est. Net Wage, Total Take-Home, and Eff. $/hr. The withholding model lives in
// trackPay.gs and is CALIBRATED from two real stubs (weeks ending 7/5 and
// 7/19/2026); it is an estimate for planning, not a tax document. Because
// withholding is progressive and assessed weekly, a shift's net is its
// incremental contribution to the Mon-Sun week, so handleTip sums the week's
// existing Track hours BEFORE appending. Track tab needs headers in F-I.
//
// v4.4 changes: grocery category retired — the user moved groceries to a
// dedicated app. Dropped the category, its schema, handleGrocery/
// insertGroceryItem, and the grocery SHEET_IDS slot. No routing guardrail was
// added, so a grocery-ish entry ("out of milk") now gets classified into
// whatever remaining category the model finds closest, by deliberate choice.
//
// v4.3 changes: tip tab routing moved out of the prompt and into tipRouting.gs.
// Gemini now returns one tip shape carrying every field; routeTip() picks the
// tab and shiftHours() derives the hours. The old two-schema prompt let the
// entry's phrasing pick the tab — an in/out pair fit the Susans schema and
// routed there even when every written rule said Track, silently dropping the
// tip amount (Susans has no tips field) and writing a bogus hours × $20 row.
//
// v4.2 changes: removed per-model retry loop/sleep so server worst case
// stays under the client's 15s timeout; fixed "+ +" NaN bug in SYSTEM_PROMPT.
//
// After any change: Deploy → Manage deployments → pencil → Version: New version.
// NOT "New deployment" — that mints a fresh /exec URL, and the old one is baked
// into CFG_DEFAULTS in index.html, so the app would keep hitting the old code.
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
+ '- "tip":     shift work, hours worked, tips made, track / valet work, susan\'s, clock in/out\n'
+ '- "meal":    eating, food items, meal types, supplements (creatine, fish oil, MCT, multivitamin)\n'
+ '- "idea":    idea, thought, concept, "what if", future plan, something to build or try\n'
+ '- "car":     oil change, repair, mileage, car maintenance, parts replaced, shop\n\n'
+ 'TIME FORMAT: emit every time as 24-hour "HH:MM". Explicit am/pm is literal.\n'
+ '- Bare hours without am/pm: 7 8 9 10 11 → AM  |  12 1 2 3 4 5 6 → PM\n'
+ '- Examples: "9:18 in, 6:50 out" → clock_in "09:18", clock_out "18:50".\n'
+ '  "2-4" → "14:00"/"16:00". "8-4" → "08:00"/"16:00". "11-7" → "11:00"/"19:00".\n\n'
+ 'TIP VENUE: set "venue" ONLY when the text explicitly names one — susan/sue/susans\n'
+ '(any spelling) → "susans"; track/valet → "track". Otherwise null. Never infer venue\n'
+ 'from times or tip amounts, and never choose the tab yourself — the server does that.\n\n'
+ 'TOLERANCE: Fix obvious typos (wokred→worked, susand→susans). Any variation of susan/sue/susans counts.\n\n'
+ 'IDEA MATERIALS: If an idea entry also mentions needing to buy/get something for the project (e.g. "fix the shop vac, need a new hose"), extract materials too. If no purchases mentioned, omit the "materials" key entirely.\n\n'
+ 'Return EXACTLY one of these JSON structures matching the category:\n\n'
+ 'TIP:        {"category":"tip","data":{"venue":"<susans|track|null>","clock_in":"<HH:MM|null>","clock_out":"<HH:MM|null>","hours":<number|null>,"tips":<number|null>,"notes":"<string>"}}\n'
+ 'MEAL:       {"category":"meal","sub_route":"Log","data":{"meal":"<Breakfast|Lunch|Dinner|Snack>","foods":"<comma-separated>","creatine":"<\u2713 or empty>","fish_oil":"<\u2713 or empty>","mct":"<\u2713 or empty>","multivitamin":"<\u2713 or empty>","notes":"<string>"}}\n'
+ 'IDEA:       {"category":"idea","sub_route":"Ideas","data":{"title":"<5-7 words>","category":"<Business|Money|Creative|Personal|Random>","effort":"<Quick Win|Medium Project|Big Swing>","excitement":<1-5>,"next_step":"<string>","tags":"<comma-separated>","materials":[{"item":"<thing to buy>","category":"<Hardware|Tools|Supplies|Parts|Other>"}]}}\n'
+ 'CAR:        {"category":"car","sub_route":"Maintenance Log","data":{"type":"<Oil Change|Repair>","mileage":<number|null>,"description":"<string>","parts_replaced":"<string>","cost":<number|null>,"shop_diy":"<string>","notes":"<string>"}}\n\n'
+ 'Never invent missing data — use null or empty string.';

// ================================================================
// ENTRY POINT
// ================================================================
function doPost(e) {
  try {
    var body     = JSON.parse(e.postData.contents);
    var text     = (body.text || '').trim();
    var sheetIds = body.sheet_ids || {};

    if (!text) throw new Error('No text received');

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
        sub_route = routeTip(data);
        message   = handleTip(ss, sub_route, data);
        break;
      case 'meal':    message = handleMeal(ss, data);            break;
      case 'idea':    message = handleIdea(ss, data);            break;
      case 'car':     message = handleCar(ss, data);             break;
      default: throw new Error('Unknown category: ' + category);
    }

    return jsonOk({ success: true, message: message, category: category, sub_route: sub_route });

  } catch (err) {
    Logger.log('doPost error: ' + err.message);
    return jsonOk({ success: false, error: err.message });
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
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
// UTILITIES
// ================================================================
function jsonOk(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function now() { return new Date(); }

function dateFmt(d) {
  return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy');
}

function getTab(ss, name) {
  var t = ss.getSheetByName(name);
  if (!t) throw new Error('Tab "' + name + '" not found. Check your sheet setup.');
  return t;
}

// ================================================================
// TIP HANDLER
// ================================================================
function handleTip(ss, sub_route, data) {
  var ts   = now();
  // Derived from the clock times when we have them — Gemini's own arithmetic
  // is only a fallback for entries that state hours and no times.
  var hrs  = shiftHours(data.clock_in, data.clock_out, data.hours);

  if (sub_route === 'Track') {
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

    var msg = 'Track shift logged — ' + hrs + 'h';
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
    return 'Susans logged — ' + (inStr || '?') + ' to ' + (outStr || '?') + ', ' + pay + ' pay';
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
