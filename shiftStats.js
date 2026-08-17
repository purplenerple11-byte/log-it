// ================================================================
// Log It — Shift aggregation (pure; no DOM, no network)
// Loaded by shifts.html, and by the harness under ?test=1.
//
// The one rule this file exists to enforce: Track's take-home is net of
// withholding plus tips, while Susans' $20/hr is GROSS with no withholding
// modeled at all. They are reported side by side and never added — a single
// figure built from both would be part post-tax and part pre-tax.
//
// Pay weeks are NOT computed here. Every shift arrives from the server already
// tagged with the Monday of its pay week, produced by the same payWeekStart
// that priced it, so the dashboard cannot drift from the pay math.
// ================================================================

// Money rounding. Deliberately NOT trackPay.gs's round2: that file is server
// logic and production must never load it, and a same-named copy would shadow
// it inside the test harness where both are present.
function cents(n) {
  return Math.round(n * 100) / 100;
}

// 'week' uses the server's tag; 'month' is calendar. Oldest bucket first, so a
// chart reads left to right without the caller reversing anything.
function bucketShifts(shifts, granularity) {
  if (!Array.isArray(shifts)) return [];
  const byKey = new Map();

  for (const s of shifts) {
    if (!s) continue;
    const ts = s.ts instanceof Date ? s.ts : new Date(s.ts);
    if (isNaN(ts.getTime())) continue;

    const key = granularity === 'month'
      ? ts.getFullYear() + '-' + String(ts.getMonth() + 1).padStart(2, '0')
      : s.week;
    if (!key) continue;

    if (!byKey.has(key)) {
      byKey.set(key, {
        key, label: bucketLabel(key, granularity),
        tips: 0, netWage: 0, takeHome: 0,
        susansGross: 0, hours: 0, shifts: []
      });
    }
    const b = byKey.get(key);
    b.shifts.push(s);
    b.hours = cents(b.hours + (Number(s.hours) || 0));

    if (s.venue === 'Susans') {
      b.susansGross = cents(b.susansGross + (Number(s.grossPay) || 0));
      continue;
    }
    // A pre-v4.5 row the server could not price contributes its hours and
    // nothing else. Inventing a figure here would be worse than a gap.
    if (!s.pay) continue;
    b.tips = cents(b.tips + (Number(s.tips) || 0));
    b.netWage = cents(b.netWage + (Number(s.pay.net) || 0));
    b.takeHome = cents(b.takeHome + (Number(s.pay.takeHome) || 0));
  }

  return Array.from(byKey.values()).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function bucketLabel(key, granularity) {
  const p = key.split('-');
  if (granularity === 'month') return MONTH_NAMES[parseInt(p[1], 10) - 1] || '';
  // Numeric, because ten "Jun 15"-style labels wrap to two lines at 375px and
  // turn the axis into a thicket.
  return parseInt(p[1], 10) + '/' + parseInt(p[2], 10);
}

// Drop empty buckets before the data starts. A zero week in the middle is
// information — you didn't work — but a run of zeros before you ever worked at
// that venue is just dead space on a phone-width chart.
function trimLeadingEmpty(buckets, valueOf) {
  if (!Array.isArray(buckets)) return [];
  let i = 0;
  while (i < buckets.length && !(Number(valueOf(buckets[i])) > 0)) i++;
  return buckets.slice(i);
}

function summarize(shifts) {
  const out = {
    trackTakeHome: 0, trackTips: 0, trackNetWage: 0, trackHours: 0,
    susansGross: 0, susansHours: 0, trackEffHourly: 0, shifts: 0, trackShifts: 0
  };
  if (!Array.isArray(shifts)) return out;

  for (const s of shifts) {
    if (!s) continue;
    out.shifts++;
    if (s.venue !== 'Susans') out.trackShifts++;
    if (s.venue === 'Susans') {
      out.susansGross = cents(out.susansGross + (Number(s.grossPay) || 0));
      out.susansHours = cents(out.susansHours + (Number(s.hours) || 0));
      continue;
    }
    out.trackHours = cents(out.trackHours + (Number(s.hours) || 0));
    if (!s.pay) continue;
    out.trackTips = cents(out.trackTips + (Number(s.tips) || 0));
    out.trackNetWage = cents(out.trackNetWage + (Number(s.pay.net) || 0));
    out.trackTakeHome = cents(out.trackTakeHome + (Number(s.pay.takeHome) || 0));
  }

  out.trackEffHourly = out.trackHours > 0 ? cents(out.trackTakeHome / out.trackHours) : 0;
  return out;
}

// Chart labels. Ten bars across a phone screen leaves room for "483", not
// "$483.21" — and a hover tooltip is nothing on a touchscreen, so the number
// has to be on the bar itself.
function compactMoney(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) < 1000) return String(Math.round(v));
  return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
}

function filterShifts(shifts, opts) {
  if (!Array.isArray(shifts)) return [];
  const venue = (opts && opts.venue) || 'all';
  return shifts.filter((s) => s && (venue === 'all' || s.venue === venue));
}

// The server sends dates as ISO strings over the wire; every consumer here
// wants a real Date and a chronological order, newest first for the log.
function hydrateShifts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => Object.assign({}, s, { ts: s.ts instanceof Date ? s.ts : new Date(s.ts) }))
    .filter((s) => !isNaN(s.ts.getTime()))
    .sort((a, b) => b.ts.getTime() - a.ts.getTime());
}
