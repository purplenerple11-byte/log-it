// ================================================================
// Log It — transport + cache for the read pages
// Loaded by shifts.html and ideas.html. No DOM access at load.
//
// Same POST text/plain transport the logger uses, deliberately: it avoids a
// CORS preflight, it is proven in production, and it keeps the read token in
// the body rather than a query string where it would land in referrers and
// logs.
//
// CACHE FIRST, ALWAYS. Apps Script cold starts in this project's own execution
// history have taken 82s, 107s and 268s. A page that waits for the network
// before drawing anything is a page that looks broken. Every read renders from
// localStorage immediately and swaps in fresh data when it arrives.
// ================================================================

// Duplicated from CFG_DEFAULTS in index.html on purpose — index.html is the
// logging path and is not being refactored to share a config file for this.
// A test asserts the two strings are identical, so they cannot drift silently.
const DC_ROUTER_DEFAULT =
  'https://script.google.com/macros/s/AKfycbx4VyyLzfafaKkAsNP2LUbSaLOFxS-vX34c-3lHIQPLIHIoqBqOEXghIRzS4n8vQ-24/exec';

const DC_TIMEOUT_MS = 45000;   // reads can be slower than a log; nothing retries here

function lsGet(k, fallback) {
  try { return localStorage.getItem(k) || fallback || ''; } catch { return fallback || ''; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, v); } catch {}
}

function readToken()          { return lsGet('read_token', ''); }
function setReadToken(v)      { lsSet('read_token', String(v || '').trim()); }
function routerUrl()          { return lsGet('router_url', DC_ROUTER_DEFAULT); }
function sheetId(kind, dflt)  { return lsGet('sheet_' + kind, dflt); }

class ReadError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'ReadError';
    this.kind = kind;   // 'unauthorized' | 'network' | 'timeout' | 'server'
  }
}

// One request. No retry loop: unlike a log, nothing is lost by failing — the
// user is looking at cached data and can pull again.
async function callApi(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DC_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(routerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    throw new ReadError(e && e.name === 'AbortError' ? 'timeout' : 'network',
      e && e.name === 'AbortError' ? 'Took too long — try again' : 'No connection');
  }
  clearTimeout(timer);

  let data;
  try { data = await res.json(); }
  catch { throw new ReadError('server', 'Unreadable reply from the router'); }

  if (!data.success) {
    // Apps Script always answers 200, so the code in the body is the only way
    // to tell "wrong key, ask for it" from a genuine failure.
    throw new ReadError(data.code === 'unauthorized' ? 'unauthorized' : 'server',
      data.error || 'Something went wrong');
  }
  return data;
}

function cacheKey(scope) { return 'cache_' + scope; }

function readCache(scope) {
  try {
    const raw = localStorage.getItem(cacheKey(scope));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(scope, data) {
  try { localStorage.setItem(cacheKey(scope), JSON.stringify(data)); } catch {}
}

// Renders twice: once from cache (instantly, possibly stale), once from the
// network. onData is called with (data, isFresh); onError only ever fires for
// the network leg, so a failure still leaves cached data on screen.
async function loadScope(scope, sheetIds, onData, onError) {
  const cached = readCache(scope);
  if (cached) onData(cached, false);

  try {
    const fresh = await callApi({
      op: 'read', scope, token: readToken(), sheet_ids: sheetIds
    });
    writeCache(scope, fresh);
    onData(fresh, true);
  } catch (err) {
    onError(err, !!cached);
  }
}

function patchField(body)  { return callApi(Object.assign({ op: 'patch',  token: readToken() }, body)); }
function deleteShift(body) { return callApi(Object.assign({ op: 'delete', token: readToken() }, body)); }

function money(n)   { return '$' + (Number(n) || 0).toFixed(2); }
function money0(n)  { return '$' + Math.round(Number(n) || 0).toLocaleString(); }

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(d) {
  return DAY_NAMES[d.getDay()] + ' ' + MON_NAMES[d.getMonth()] + ' ' + d.getDate();
}

function timeLabel(d) {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return h + ':' + m + ' ' + ap;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
