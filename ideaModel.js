// ================================================================
// Log It — Idea list model (pure; no DOM, no network)
// Loaded by ideas.html, and by the harness under ?test=1.
//
// The interesting part is matching materials to ideas. handleIdea stamps every
// material with its parent idea's timestamp, so the timestamp is the join key —
// but one live row was hand-added with no timestamp at all, and more will be,
// because this sheet gets edited by hand. Those fall back to the project title.
// Anything still unmatched is handed back rather than silently dropped: a
// material that vanishes from the page is a note the user wrote and can no
// longer see.
// ================================================================

const IDEA_STATUS_CYCLE = { Active: 'Done', Done: 'Archived', Archived: 'Active' };

function nextStatus(status) {
  return IDEA_STATUS_CYCLE[status] || 'Active';
}

function sameMoment(a, b) {
  return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
}

function looseEq(a, b) {
  return String(a == null ? '' : a).trim().toLowerCase()
       === String(b == null ? '' : b).trim().toLowerCase();
}

// Returns { ideas, orphans }. `ideas` is a new array; each gets a `materials`
// array. `orphans` are materials that matched no idea at all.
function groupMaterials(ideas, materials) {
  const list = (Array.isArray(ideas) ? ideas : []).map((i) =>
    Object.assign({}, i, { materials: [] }));
  const orphans = [];

  for (const m of (Array.isArray(materials) ? materials : [])) {
    if (!m) continue;
    let owner = null;
    if (m.ts) {
      owner = list.find((i) => sameMoment(i.ts, m.ts)) || null;
    }
    // No timestamp, or a timestamp matching no idea: fall back to the title.
    if (!owner) {
      owner = list.find((i) => looseEq(i.title, m.project)) || null;
    }
    if (owner) owner.materials.push(m);
    else orphans.push(m);
  }
  return { ideas: list, orphans };
}

// What this idea has actually cost so far. Null rather than 0 when no price
// has been recorded — "$0.00" reads as free, which is a different claim.
function ideaSpend(idea) {
  const mats = (idea && idea.materials) || [];
  let total = 0, any = false;
  for (const m of mats) {
    const p = Number(m && m.price);
    if (m && m.price != null && isFinite(p)) { total += p; any = true; }
  }
  return any ? Math.round(total * 100) / 100 : null;
}

function filterIdeas(ideas, status) {
  if (!Array.isArray(ideas)) return [];
  if (!status || status === 'all') return ideas.slice();
  return ideas.filter((i) => i && i.status === status);
}

function statusCounts(ideas) {
  // Every state is present even at zero, so the filter chips don't jump around
  // as the list empties out.
  const out = { Active: 0, Done: 0, Archived: 0 };
  for (const i of (Array.isArray(ideas) ? ideas : [])) {
    if (i && Object.prototype.hasOwnProperty.call(out, i.status)) out[i.status]++;
  }
  return out;
}

// The identity used for ordering and for addressing a row on the server.
// Timestamp when there is one; the title otherwise, because one live material
// row was hand-added with no timestamp and its idea may follow.
function ideaKey(i) {
  return i && i.ts ? i.ts.toISOString() : 'title:' + ((i && i.title) || '');
}

// Reorder to a stored list of keys. Anything not in the list — a new idea
// logged since you last dragged — sorts to the end, newest first, rather than
// silently jumping to the top of a list you arranged by hand.
function applyManualOrder(ideas, keys) {
  const pos = new Map((Array.isArray(keys) ? keys : []).map((k, i) => [k, i]));
  return (Array.isArray(ideas) ? ideas : []).slice().sort((a, b) => {
    const pa = pos.has(ideaKey(a)) ? pos.get(ideaKey(a)) : Infinity;
    const pb = pos.has(ideaKey(b)) ? pos.get(ideaKey(b)) : Infinity;
    if (pa !== pb) return pa - pb;
    return tsOf(b) - tsOf(a);
  });
}

function tsOf(i) {
  return i && i.ts instanceof Date ? i.ts.getTime() : 0;
}

function sortIdeas(ideas, mode, manualKeys) {
  const list = (Array.isArray(ideas) ? ideas : []).slice();
  if (mode === 'manual') return applyManualOrder(list, manualKeys);
  if (mode === 'excitement') {
    // Excitement first, newest breaking the tie — an old 5 shouldn't outrank
    // one written yesterday.
    return list.sort((a, b) =>
      (Number(b.excitement) || 0) - (Number(a.excitement) || 0) || tsOf(b) - tsOf(a));
  }
  return list.sort((a, b) => tsOf(b) - tsOf(a));
}

function hydrateIdeas(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((i) => Object.assign({}, i, {
    ts: i.ts ? new Date(i.ts) : null
  }));
}

function hydrateMaterials(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => Object.assign({}, m, {
    ts: m.ts ? new Date(m.ts) : null
  }));
}
