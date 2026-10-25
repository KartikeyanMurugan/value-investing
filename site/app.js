import { value, METHOD_LABEL, TYPE_LABEL, DEFAULTS } from './engine.js';
import { RESTRICTED, MIN_QUALITY, MIN_MCAP_CR } from './config.js';

// ---------- small utilities ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const nf = new Intl.NumberFormat('en-IN');
const inr = (x) => {
  if (x == null || !isFinite(x)) return '—';
  if (Math.abs(x) >= 100) return '₹' + nf.format(Math.round(x));
  return '₹' + x.toFixed(Math.abs(x) < 10 ? 2 : 1);
};
const crore = (x) => {
  if (x == null || !isFinite(x)) return '—';
  if (x >= 1e5) return `₹${(x / 1e5).toFixed(2)} lakh cr`;
  return `₹${nf.format(Math.round(x))} cr`;
};
const pct = (x, d = 0) => (x == null || !isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);

const ZONES = [
  { key: 'strong', label: 'Strong buy zone' },
  { key: 'buy', label: 'Buy zone' },
  { key: 'fair', label: 'Fairly priced' },
  { key: 'over', label: 'Overvalued' },
  { key: 'bubble', label: 'Priced for perfection' },
  { key: 'verify', label: 'Verify data' },
  { key: 'na', label: 'Not valued' },
];
const CAP_STEPS = [0, 100, 500, 1000, 5000, 20000];
const SIZE = { large: [20000, Infinity], mid: [5000, 20000], small: [500, 5000], micro: [0, 500] };
const TYPE_SHORT = { financial: 'bank or NBFC', cyclical: 'cyclical', utility: 'utility', growth: 'high growth', compounder: 'steady compounder', default: 'general', loss: 'loss-making' };
const zoneVar = (k) => `var(--v-${k === 'restricted' ? 'na' : k})`;

// ---------- state ----------
const state = {
  data: null, results: [], view: [],
  erp: store.get('erp', DEFAULTS.erp), mos: store.get('mos', DEFAULTS.mos),
  minCapIdx: store.get('minCapIdx', CAP_STEPS.indexOf(MIN_MCAP_CR) >= 0 ? CAP_STEPS.indexOf(MIN_MCAP_CR) : 2),
  per: store.get('per', 50),
  stars: new Set(store.get('stars', [])),
  growth: store.get('growth', {}),
  restricted: store.get('restricted', {}),
  // URL-driven
  tab: 'picks', page: 1, q: '', z: '', t: '', size: '', sort: 'gap', stock: null,
};
const minCap = () => CAP_STEPS[state.minCapIdx];

// ---------- URL state (shareable links, back button works) ----------
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.tab = p.get('tab') || 'picks';
  state.page = Math.max(1, +p.get('page') || 1);
  state.q = p.get('q') || ''; state.z = p.get('z') || ''; state.t = p.get('t') || '';
  state.size = p.get('size') || ''; state.sort = p.get('sort') || 'gap';
  state.stock = p.get('stock');
}
function writeHash(replace = false) {
  const p = new URLSearchParams();
  if (state.tab !== 'picks') p.set('tab', state.tab);
  if (state.page > 1) p.set('page', state.page);
  for (const k of ['q', 'z', 't', 'size']) if (state[k]) p.set(k, state[k]);
  if (state.sort !== 'gap') p.set('sort', state.sort);
  if (state.stock) p.set('stock', state.stock);
  const s = p.toString();
  const target = s ? '#' + s : location.pathname + location.search;
  if ((s ? '#' + s : '') !== location.hash) (replace ? history.replaceState : history.pushState).call(history, null, '', target);
}

// ---------- load & compute ----------
async function load() {
  try {
    const r = await fetch('data/stocks.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    state.data = await r.json();
  } catch {
    $('#pulseTitle').textContent = 'Today\'s data could not be loaded.';
    $('#updated').textContent = 'Run the "Daily valuation" workflow on GitHub, then reload this page.';
    return;
  }
  for (const s of state.data.meta.watchlist || []) state.stars.add(s);
  const m = state.data.meta;
  const when = m.date ? new Date(m.date).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  $('#updated').innerHTML = `${m.demo ? '<strong>Demo data.</strong> ' : ''}Prices as of ${esc(when)}<br>${nf.format(m.count)} of ${nf.format(m.universe)} NSE stocks valued`;
  $('#fZone').innerHTML = '<option value="">All verdicts</option>' + ZONES.map((z) => `<option value="${z.key}">${z.label}</option>`).join('') + '<option value="restricted">Restricted by you</option>';
  $('#fType').innerHTML = '<option value="">All business types</option>' + Object.entries(TYPE_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  $('#erp').value = state.erp; $('#mos').value = state.mos; $('#minCap').value = state.minCapIdx;
  readHash();
  compute();
}

function opts(sym) {
  const o = { gsec: state.data.meta.gsec, erp: state.erp, mos: state.mos };
  if (state.growth[sym] != null) o.growthOverride = state.growth[sym];
  return o;
}

function compute() {
  const g = state.data.meta.gsec;
  $('#erpV').textContent = `${(+state.erp).toFixed(1)}%`;
  $('#gsecV').textContent = `${g.toFixed(2)}%`;
  $('#rV').textContent = `${(g + +state.erp).toFixed(1)}% a year`;
  $('#mosV').textContent = `${state.mos}%`;
  $('#minCapV').textContent = minCap() ? `₹${nf.format(minCap())} cr` : 'Any size';
  $('#settingsSummary').textContent = `Required return ${(g + +state.erp).toFixed(1)}%, safety margin ${state.mos}%`;
  state.results = state.data.companies.map((c) => {
    const v = value(c, opts(c.s));
    v.c = c;
    v.mcap = c.px * c.sh;
    if (RESTRICTED[c.s]) v.restricted = RESTRICTED[c.s];
    else if (state.restricted[c.s]) v.restricted = 'You marked this stock as restricted (for example, your employer). Check your company\'s trading window and pre-clearance rules before any trade.';
    return v;
  });
  render();
}

const isPick = (v) => !v.restricted && (v.zone.key === 'strong' || v.zone.key === 'buy')
  && v.quality.score >= MIN_QUALITY && v.mcap >= minCap();

// ---------- render ----------
function render() {
  renderPulse();
  const picks = state.results.filter(isPick);
  const watch = state.results.filter((v) => state.stars.has(v.symbol));
  $('#nPicks').textContent = nf.format(picks.length);
  $('#nWatch').textContent = nf.format(watch.length);
  $('#nAll').textContent = nf.format(state.results.length);
  document.querySelectorAll('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));

  const how = state.tab === 'how';
  $('#how').hidden = !how; $('#toolbar').hidden = how; $('#table').hidden = how; $('#pager').hidden = how; $('#context').hidden = how;
  if (how) { renderHow(); syncDrawer(); return; }

  $('#q').value = state.q; $('#fZone').value = state.z; $('#fType').value = state.t; $('#fSize').value = state.size; $('#sort').value = state.sort;
  let rows = state.tab === 'picks' ? picks : state.tab === 'watch' ? watch : state.results;
  const q = state.q.trim().toLowerCase();
  if (q) rows = rows.filter((v) => v.symbol.toLowerCase().includes(q) || (v.name || '').toLowerCase().includes(q));
  if (state.z) rows = rows.filter((v) => (v.restricted ? 'restricted' : v.zone.key) === state.z);
  if (state.t) rows = rows.filter((v) => v.type === state.t);
  if (state.size) { const [a, b] = SIZE[state.size]; rows = rows.filter((v) => v.mcap >= a && v.mcap < b); }
  const S = {
    gap: (a, b) => a.zone.rank - b.zone.rank || (b.discount ?? -99) - (a.discount ?? -99),
    quality: (a, b) => b.quality.score - a.quality.score || (b.discount ?? -99) - (a.discount ?? -99),
    mcap: (a, b) => b.mcap - a.mcap,
    chg: (a, b) => (a.c.tech?.chg1d ?? 99) - (b.c.tech?.chg1d ?? 99),
    name: (a, b) => a.symbol.localeCompare(b.symbol),
  };
  rows = [...rows].sort(S[state.sort] || S.gap);
  state.view = rows;

  const pages = Math.max(1, Math.ceil(rows.length / state.per));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * state.per;
  const shown = rows.slice(start, start + state.per);

  $('#context').textContent = {
    picks: `Companies passing at least ${Math.round(MIN_QUALITY * 100)}% of quality checks, worth at least ${minCap() ? '₹' + nf.format(minCap()) + ' crore' : 'any amount'}, and trading ${state.mos}% or more below fair value.`,
    watch: 'Stocks you starred. Stars are saved in this browser.',
    all: 'Every company with enough data to value.',
  }[state.tab];

  $('#table').innerHTML = rows.length ? headHtml() + shown.map(rowHtml).join('') : emptyHtml();
  renderPager(rows.length, pages, start, shown.length);
  syncDrawer();
}

function renderPulse() {
  const all = state.results.filter((v) => v.zone.key !== 'na');
  const counts = Object.fromEntries(ZONES.map((z) => [z.key, 0]));
  for (const v of state.results) counts[v.zone.key]++;
  const below = all.filter((v) => (v.discount ?? -1) > 0).length;
  const picks = state.results.filter(isPick).length;
  $('#pulseTitle').innerHTML = `<strong>${nf.format(below)}</strong> of ${nf.format(all.length)} valued stocks trade below fair value today. <strong>${nf.format(picks)}</strong> also pass the quality checks.`;
  const total = state.results.length || 1;
  $('#pulseBar').innerHTML = ZONES.map((z) => counts[z.key] ? `<button style="flex:${counts[z.key]};background:${zoneVar(z.key)}" data-zone="${z.key}" aria-pressed="${state.z === z.key && state.tab === 'all'}" title="${z.label}: ${nf.format(counts[z.key])} stocks" aria-label="${z.label}, ${nf.format(counts[z.key])} stocks"></button>` : '').join('');
  $('#pulseLegend').innerHTML = ZONES.map((z) => `<li><i style="background:${zoneVar(z.key)}"></i>${z.label} <strong>${nf.format(counts[z.key])}</strong> <span>(${Math.round(counts[z.key] / total * 100)}%)</span></li>`).join('');
}

function headHtml() {
  const sb = (key, label) => `<button data-sort="${key}" ${state.sort === key ? 'aria-sort="descending"' : ''}>${label}</button>`;
  return `<div class="tr th" role="row">
    <span role="columnheader">${sb('name', 'Company')}</span>
    <span role="columnheader" class="r">${sb('chg', 'Price')}</span>
    <span role="columnheader" class="c-vb">Price against fair-value range</span>
    <span role="columnheader" class="r c-fv">Fair value</span>
    <span role="columnheader" class="r c-bb">Buy below</span>
    <span role="columnheader" class="r c-gap">${sb('gap', 'Gap')}</span>
    <span role="columnheader" class="c-q">${sb('quality', 'Quality')}</span>
    <span role="columnheader"><span class="sr">Watchlist</span></span>
  </div>`;
}

function band(v, big = false) {
  if (!v.fair) return '<div class="band empty-band" aria-hidden="true"></div>';
  let lo = Math.min(v.low, v.buyBelow, v.price) * 0.9;
  let hi = Math.max(v.high, v.price) * 1.06;
  const cap = v.high * 2.4; const clipped = v.price > cap; if (clipped) hi = cap;
  const X = (x) => Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
  const zk = v.restricted ? 'na' : v.zone.key;
  const px = clipped ? 100 : X(v.price), xf = X(v.fair), xb = X(v.buyBelow);
  const align = (x) => (x > 82 ? 'end' : x < 18 ? 'start' : 'mid');
  // "now" label goes on the row (top/bottom) that is less crowded
  const nowTop = Math.abs(px - xf) >= Math.abs(px - xb);
  const labels = big ? `
    <span class="lab top ${align(xf)}" style="left:${xf}%">Fair ${inr(v.fair)}</span>
    <span class="lab bot ${align(xb)}" style="left:${xb}%">Buy below ${inr(v.buyBelow)}</span>
    <span class="lab ${nowTop ? 'top' : 'bot'} now ${align(px)}" style="left:${px}%">Now ${inr(v.price)}${clipped ? ', off scale' : ''}</span>` : '';
  return `<div class="band ${big ? 'big' : ''}" aria-hidden="true">
    <span class="track"></span>
    <span class="rng" style="left:${X(v.low)}%;width:${X(v.high) - X(v.low)}%"></span>
    <span class="tick buy" style="left:${xb}%"></span>
    <span class="tick fair" style="left:${xf}%"></span>
    <span class="dot ${clipped ? 'clip' : ''}" style="left:${px}%;background:${zoneVar(zk)}"></span>${labels}
  </div>`;
}

function gapHtml(v) {
  if (v.discount == null) return '<span class="gap">—</span>';
  const below = v.discount > 0;
  return `<span class="gap" style="color:${below ? 'var(--v-buy)' : 'var(--v-over)'}">${pct(Math.abs(v.discount))}</span><small>${below ? 'below fair' : 'above fair'}</small>`;
}

function rowHtml(v) {
  const zk = v.restricted ? 'restricted' : v.zone.key;
  const chg = v.c.tech?.chg1d;
  const starred = state.stars.has(v.symbol);
  return `<div class="tr" role="row" tabindex="0" data-s="${esc(v.symbol)}" aria-label="${esc(v.name)}, ${esc(v.restricted ? 'restricted' : v.zone.label)}">
    <span class="co" role="cell"><b title="${esc(v.name)}">${esc(v.name)}</b><small>${esc(v.symbol)}, ${esc(TYPE_SHORT[v.type] || v.typeLabel)}</small></span>
    <span class="num r c-px" role="cell">${inr(v.price)}<small class="${chg > 0 ? 'up' : chg < 0 ? 'down' : ''}">${chg != null ? (chg > 0 ? '+' : '') + chg.toFixed(1) + '% today' : '&nbsp;'}</small></span>
    <span class="vb c-vb" role="cell">${band(v)}<span class="meta"><span class="pill z-${zk}" style="padding:1px 8px;font-size:12px">${esc(v.restricted ? 'Restricted' : v.zone.label)}</span><span>${v.fair ? inr(v.low) + '–' + inr(v.high) : ''}</span></span></span>
    <span class="num r c-fv" role="cell">${inr(v.fair)}<small>fair value</small></span>
    <span class="num r c-bb" role="cell">${inr(v.buyBelow)}<small>buy below</small></span>
    <span class="num r c-gap" role="cell">${gapHtml(v)}</span>
    <span class="c-q" role="cell" title="${v.quality.passed} of ${v.quality.total} quality checks passed"><span class="dots">${v.quality.checks.map((q) => `<i class="${q.pass ? 'on' : ''}"></i>`).join('')}</span></span>
    <button class="star" data-star="${esc(v.symbol)}" aria-pressed="${starred}" aria-label="${starred ? 'Remove from' : 'Add to'} watchlist">${starIcon(starred)}</button>
  </div>`;
}
const starIcon = (on) => `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9z"/></svg>`;

function emptyHtml() {
  const filtered = state.q || state.z || state.t || state.size;
  if (filtered) return `<div class="empty"><strong>No stocks match these filters.</strong><button class="btn" id="clearFilters">Clear filters</button></div>`;
  if (state.tab === 'picks') return `<div class="empty"><strong>Nothing passes both the price and quality tests today.</strong>That happens when markets are expensive. Check back tomorrow, or lower the margin of safety in Assumptions.</div>`;
  if (state.tab === 'watch') return `<div class="empty"><strong>Your watchlist is empty.</strong>Select the star on any stock to follow it here.</div>`;
  return '<div class="empty"><strong>No data yet.</strong></div>';
}

function renderPager(n, pages, start, count) {
  const b = (p, label = p, extra = '') => `<button data-page="${p}" ${p === state.page && label === p ? 'aria-current="page"' : ''} ${extra}>${label}</button>`;
  const nums = [];
  for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - state.page) <= 1) nums.push(p);
  let html = ''; let prev = 0;
  for (const p of nums) { if (p - prev > 1) html += '<span aria-hidden="true">…</span>'; html += b(p); prev = p; }
  $('#pager').innerHTML = n ? `<span class="info">Showing ${nf.format(start + 1)}–${nf.format(start + count)} of ${nf.format(n)}</span>
    ${b(state.page - 1, 'Previous', state.page === 1 ? 'disabled' : '')}${pages > 1 ? html : ''}${b(state.page + 1, 'Next', state.page === pages ? 'disabled' : '')}
    <label><span class="sr">Rows per page</span><select id="per">${[25, 50, 100].map((x) => `<option value="${x}" ${x === state.per ? 'selected' : ''}>${x} per page</option>`).join('')}</select></label>` : '';
}

// ---------- stock drawer ----------
let lastFocus = null;
function syncDrawer() {
  const dr = $('#drawer');
  if (!state.stock) {
    if (!dr.hidden) { dr.hidden = true; $('#scrim').hidden = true; document.body.style.overflow = ''; lastFocus?.focus?.(); }
    return;
  }
  const v = state.results.find((x) => x.symbol === state.stock);
  if (!v) { state.stock = null; writeHash(true); syncDrawer(); return; }
  const wasHidden = dr.hidden;
  if (wasHidden) lastFocus = document.activeElement;
  dr.innerHTML = drawerHtml(v);
  dr.hidden = false; $('#scrim').hidden = false; document.body.style.overflow = 'hidden';
  if (wasHidden) $('.close', dr).focus();
}

function drawerHtml(v) {
  const c = v.c, d = v.derived, t = v.timing;
  const zk = v.restricted ? 'restricted' : v.zone.key;
  const starred = state.stars.has(v.symbol);
  const used = new Set(v.used);
  const wsum = v.used.reduce((s, u) => s + v.weights[u], 0);
  const all = Object.entries(v.methods).filter(([, x]) => x != null);
  const usedM = all.filter(([k]) => used.has(k)).sort(([a], [b]) => v.weights[b] - v.weights[a]);
  const refM = all.filter(([k]) => !used.has(k));
  const maxV = Math.max(v.price || 0, ...all.map(([, x]) => x)) * 1.05;
  const mRow = (k, x, ref) => `<div class="m ${ref ? 'ref' : ''}"><span class="lbl">${METHOD_LABEL[k]}${ref ? '' : ` <small>${Math.round(v.weights[k] / wsum * 100)}% weight</small>`}</span>
    <span class="val">${inr(x)}</span><span class="bar"><i style="width:${Math.min(100, x / maxV * 100)}%"></i><b style="left:${Math.min(100, (v.price || 0) / maxV * 100)}%" title="Today's price"></b></span></div>`;

  let lead;
  if (!v.fair) {
    lead = v.type === 'loss'
      ? 'The company made a loss recently or on average over the last five years, so a formula value would be meaningless. Treat it as a turnaround bet, not a value buy.'
      : 'There isn\'t enough financial history to value this company.';
  } else {
    const above = v.discount < 0;
    lead = `At ${inr(v.price)}, the share trades <strong>${pct(Math.abs(v.discount))} ${above ? 'above' : 'below'}</strong> its estimated fair value of ${inr(v.fair)}. With your ${v.params.mos}% safety margin, the buy-below price is <strong>${inr(v.buyBelow)}</strong>.`;
  }
  const yrs = v.type === 'compounder' ? 10 : 5;
  const hist = v.histGrowth == null ? 'Past growth is unknown.'
    : v.histGrowth >= 0 ? `Over the last five years it grew ${pct(v.histGrowth)} a year.` : `Over the last five years it shrank ${pct(-v.histGrowth)} a year.`;
  const igLine = v.impliedGrowth == null ? '' : v.impliedGrowth >= 0
    ? `<p class="lead">To justify today's price, profit would need to grow about <strong>${pct(v.impliedGrowth)} a year</strong> for ${yrs} years. ${hist}</p>`
    : `<p class="lead">Today's price is justified even if profit <strong>shrinks about ${pct(-v.impliedGrowth)} a year</strong> for ${yrs} years. ${hist}</p>`;

  const notes = [];
  if (v.restricted) notes.push(`<p class="note">${esc(v.restricted)} Formula verdict: ${esc(v.zone.label)}.</p>`);
  if (v.zone.key === 'verify') notes.push('<p class="note">The fair value is more than three times the price. That almost always means a data problem, such as a wrong share count or an unusual one-time profit, rather than a real bargain. Check the annual report before relying on it.</p>');
  if (d.oneOffYears?.length) notes.push(`<p class="note info">Profit jumped unusually in ${esc(d.oneOffYears.join(', '))}. That year is treated as a one-off, and normal earnings are used instead.</p>`);
  for (const m of d.dataChecks || []) notes.push(`<p class="note info">${esc(m)}</p>`);

  const pe = d.eps > 0 ? v.price / d.eps : null;
  const pb = d.bvps > 0 ? v.price / d.bvps : null;
  const de = d.eq > 0 ? d.debt / d.eq : null;
  const dps = (c.div || []).filter((x) => x != null).slice(-1)[0];
  const dy = dps && c.sh ? dps / c.sh / v.price : null;
  const cy = (c.y || []).filter(Boolean);

  return `<div class="d-head"><div class="d-top"><div><h2 id="dTitle">${esc(c.n)}</h2>
      <p>${esc(v.symbol)}${c.sec ? ', ' + esc(c.sec) : ''}${c.ind ? ', ' + esc(c.ind) : ''}. Valued as a ${esc(TYPE_SHORT[v.type] || v.typeLabel)} business.</p></div>
      <button class="btn ghost close" aria-label="Close stock details">Close</button></div>
    <div class="d-actions"><span class="pill z-${zk}">${esc(v.restricted ? 'Restricted' : v.zone.label)}</span>
      <button class="btn" data-dstar="${esc(v.symbol)}" aria-pressed="${starred}">${starIcon(starred)} ${starred ? 'In watchlist' : 'Add to watchlist'}</button>
      <button class="btn ghost" data-restrict="${esc(v.symbol)}">${state.restricted[v.symbol] ? 'Remove restriction' : 'Mark as restricted'}</button></div></div>
  <div class="d-body">
    <section><p class="lead">${lead}</p>${igLine}</section>
    ${notes.join('')}
    ${v.fair ? `<section class="bigband" aria-label="Fair value range ${inr(v.low)} to ${inr(v.high)}, price ${inr(v.price)}">${band(v, true)}</section>` : ''}
    <dl class="kv">
      <div><dt>Market cap</dt><dd>${crore(v.mcap)}</dd></div>
      <div><dt>P/E, last 12 months</dt><dd>${pe ? pe.toFixed(1) : '—'}</dd></div>
      <div><dt>Price to book</dt><dd>${pb ? pb.toFixed(2) : '—'}</dd></div>
      <div><dt>Return on equity</dt><dd>${pct(d.roeLatest, 1)}</dd></div>
      <div><dt>Debt to equity</dt><dd>${de != null ? de.toFixed(2) : '—'}</dd></div>
      <div><dt>Dividend yield</dt><dd>${pct(dy, 1)}</dd></div>
    </dl>
    ${usedM.length ? `<section><h3>How the fair value is built</h3><div class="methods">${usedM.map(([k, x]) => mRow(k, x)).join('')}</div>
      ${refM.length ? `<details class="ref-methods"><summary>Other methods, for reference (${refM.length})</summary><div class="methods">${refM.map(([k, x]) => mRow(k, x, true)).join('')}</div></details>` : ''}
      <p style="margin:10px 0 0;color:var(--ink-3);font-size:13px">The dark tick on each bar is today's price.</p></section>` : ''}
    ${used.has('dcf') ? `<section class="growth"><label for="gSl">Profit growth, years 1 to ${v.type === 'compounder' ? 10 : 5} <output>${pct(v.params.g1)}</output></label>
      <input id="gSl" type="range" min="0" max="50" step="1" value="${Math.round(v.params.g1 * 100)}">
      <p>${state.growth[v.symbol] != null ? '<button class="btn" id="gReset">Use the automatic estimate</button> ' : 'Estimated from the last five years. '}Growth then slows to ${pct(v.params.gT)} over five years, discounted at ${pct(v.params.r, 1)} a year.</p></section>` : ''}
    <section class="hist"><h3>Sales and profit history</h3>${histChart(c)}</section>
    <div class="two">
      <section><h3>Quality checks, ${v.quality.passed} of ${v.quality.total}</h3><ul class="checks">${v.quality.checks.map((q) => `<li><span class="${q.pass ? 'ok' : 'no'}" aria-label="${q.pass ? 'Pass' : 'Fail'}">${q.pass ? '✓' : '✗'}</span><span>${esc(q.label)}</span><small>${esc(q.detail)}</small></li>`).join('')}</ul></section>
      <section><h3>Entry timing</h3><p style="margin:0 0 8px">${esc(t.label)}</p>
        <ul class="checks">
          ${t.dma200 ? `<li><span class="${t.above200 ? 'ok' : 'no'}">${t.above200 ? '↑' : '↓'}</span><span>200-day average</span><small>${inr(t.dma200)}</small></li>` : ''}
          ${t.h52 ? `<li><span>↕</span><span>52-week range</span><small>${inr(t.l52)}–${inr(t.h52)}</small></li>` : ''}
          ${t.rsi != null ? `<li><span>~</span><span>RSI, 14 days</span><small>${t.rsi}</small></li>` : ''}
        </ul>
        <p style="margin:8px 0 0;color:var(--ink-3);font-size:13px">For a 3+ year holder, timing only suggests how to buy (all at once or in parts), never whether to buy.</p></section>
    </div>
    <section><h3>Check the numbers yourself</h3><div class="links">
      <a href="https://www.screener.in/company/${encodeURIComponent(v.symbol)}/consolidated/" target="_blank" rel="noopener">Screener.in</a>
      <a href="https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(v.symbol)}" target="_blank" rel="noopener">NSE quote</a>
      <a href="https://www.tradingview.com/symbols/NSE-${encodeURIComponent(v.symbol)}/" target="_blank" rel="noopener">TradingView chart</a>
    </div><p style="margin:8px 0 0;color:var(--ink-3);font-size:13px">Financials from ${c.src === 'screener' ? 'a Screener.in export' : 'Yahoo Finance'}${cy.length ? `, FY${String(cy[0]).slice(-2)} to FY${String(cy[cy.length - 1]).slice(-2)}` : ''}. Amounts in ₹ crore.</p></section>
  </div>`;
}

function histChart(c) {
  const ys = c.y || [];
  const sales = c.sales || [], np = c.np || [];
  const idx = ys.map((_, i) => i).filter((i) => sales[i] != null || np[i] != null);
  if (!idx.length) return '<p style="color:var(--ink-3)">No history available.</p>';
  const maxV = Math.max(...idx.map((i) => Math.max(sales[i] ?? 0, Math.abs(np[i] ?? 0)))) || 1;
  const h = (x) => `${Math.max(1, Math.abs(x) / maxV * 100)}%`;
  const lastOf = (a) => a.filter((x) => x != null).slice(-1)[0];
  return `<div class="chart" role="img" aria-label="Yearly sales and net profit">
    ${idx.map((i) => `<div class="yr"><div class="bars">
        ${sales[i] != null ? `<span class="b sales" style="height:${h(sales[i])}" title="Sales ₹${nf.format(Math.round(sales[i]))} cr"></span>` : ''}
        ${np[i] != null ? `<span class="b profit ${np[i] < 0 ? 'neg' : ''}" style="height:${h(np[i])}" title="Net profit ₹${nf.format(Math.round(np[i]))} cr"></span>` : ''}
      </div><span class="yl">${ys[i] ? 'FY' + String(ys[i]).slice(-2) : ''}</span></div>`).join('')}
  </div>
  <p class="legend"><i class="sw sales"></i>Sales <i class="sw profit"></i>Net profit. Latest year: sales ${crore(lastOf(sales))}, profit ${crore(lastOf(np))}.</p>`;
}

// ---------- how it works ----------
function renderHow() {
  if ($('#how').dataset.done) return;
  const g = state.data.meta.gsec;
  $('#how').dataset.done = '1';
  $('#how').innerHTML = `
  <h2>How to read this page</h2>
  <p>Every weekday evening after the market closes, each NSE company is valued with the methods that suit its kind of business, and its closing price is compared with that value. Nothing here needs your input. The Assumptions button lets you make valuations stricter or looser.</p>
  <h3>The value band</h3>
  <p>Each row shows a green band: the range in which the company's fair value probably lies. The dark tick is the central estimate, and the green tick is the buy-below price (fair value minus your margin of safety). The dot is today's price, coloured by verdict.</p>
  <h3>Verdicts</h3>
  <table><tr><th>Verdict</th><th>Meaning</th></tr>
    <tr><td><span class="pill z-strong">Strong buy zone</span></td><td>Price is below the bottom of the range and the buy-below price.</td></tr>
    <tr><td><span class="pill z-buy">Buy zone</span></td><td>Price is at least your margin of safety below fair value.</td></tr>
    <tr><td><span class="pill z-fair">Fairly priced</span></td><td>Price is inside the range. Not cheap, not expensive.</td></tr>
    <tr><td><span class="pill z-over">Overvalued</span></td><td>Price is above the top of the range.</td></tr>
    <tr><td><span class="pill z-bubble">Priced for perfection</span></td><td>The growth the price assumes is more than twice what the company has actually achieved.</td></tr>
    <tr><td><span class="pill z-verify">Verify data</span></td><td>Fair value is over three times the price, which usually means a data error. Excluded from picks.</td></tr>
    <tr><td><span class="pill z-na">Not valued</span></td><td>Loss-making, or not enough data.</td></tr></table>
  <h3>Different businesses, different methods</h3>
  <table><tr><th>Business type</th><th>Valued with</th></tr>
    <tr><td>Banks, NBFCs, insurers</td><td>Price-to-book justified by sustainable return on equity, plus the stock's own history of P/B and P/E</td></tr>
    <tr><td>Cyclicals: metals, cement, energy, chemicals, realty</td><td>Average earnings across the cycle, mid-cycle EV/EBITDA, and the median P/E applied to normal earnings</td></tr>
    <tr><td>Utilities and dividend payers</td><td>Dividend discount model, DCF and earnings power</td></tr>
    <tr><td>High-growth companies and stable compounders</td><td>Discounted cash flow, the stock's median P/E, and earnings power as a floor</td></tr>
    <tr><td>Everything else</td><td>DCF, median P/E, Graham's growth formula and earnings power</td></tr></table>
  <h3>Your required return</h3>
  <p>Future profits are discounted at the 10-year government bond yield (now ${g.toFixed(2)}%) plus a risk premium (default 4.5%). The bond yield is what you earn with no risk at all, so a share has to beat it. The repo rate isn't used: it's an overnight rate and would make every stock look cheap.</p>
  <h3>Quality checks</h3>
  <p>A cheap price only helps if the business is sound. Today's picks must pass most of these: profit in every recent year, operating cash flow of at least 60% of profit, debt below equity, pre-tax return on capital above 15%, and other income below 20% of profit. Banks are checked on return on equity and growth in book value instead.</p>
  <h3>Limits to keep in mind</h3>
  <ul>
    <li>Yahoo Finance often has only four years of Indian financials, so "long-term" averages are short.</li>
    <li>One-time gains and data errors are caught by rules, not judgment. Open the annual report before buying.</li>
    <li>A low price can be low for a good reason, such as new regulation, governance risk or a shrinking industry. The model can't see that.</li>
  </ul>
  <p><a href="https://github.com/KartikeyanMurugan/value-investing#readme">Full method details on GitHub</a></p>`;
}

// ---------- events ----------
function go(patch, replace = false) {
  Object.assign(state, patch);
  writeHash(replace);
  render();
}
document.querySelectorAll('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => go({ tab: b.dataset.tab, page: 1, z: '' })));
$('#q').addEventListener('input', (e) => go({ q: e.target.value, page: 1 }, true));
$('#fZone').addEventListener('change', (e) => go({ z: e.target.value, page: 1 }));
$('#fType').addEventListener('change', (e) => go({ t: e.target.value, page: 1 }));
$('#fSize').addEventListener('change', (e) => go({ size: e.target.value, page: 1 }));
$('#sort').addEventListener('change', (e) => go({ sort: e.target.value, page: 1 }));
$('#pulseBar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-zone]'); if (!b) return;
  go({ tab: 'all', z: state.z === b.dataset.zone && state.tab === 'all' ? '' : b.dataset.zone, page: 1 });
});
$('#pager').addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]'); if (!b || b.disabled) return;
  go({ page: +b.dataset.page }); $('#main').scrollIntoView({ block: 'start' });
});
$('#pager').addEventListener('change', (e) => { if (e.target.id === 'per') { state.per = +e.target.value; store.set('per', state.per); go({ page: 1 }); } });
$('#table').addEventListener('click', (e) => {
  const st = e.target.closest('[data-star]');
  if (st) { toggleStar(st.dataset.star); return; }
  const sb = e.target.closest('[data-sort]');
  if (sb) { go({ sort: sb.dataset.sort, page: 1 }); return; }
  if (e.target.id === 'clearFilters') { go({ q: '', z: '', t: '', size: '', page: 1 }); return; }
  const row = e.target.closest('.tr[data-s]');
  if (row) go({ stock: row.dataset.s });
});
$('#table').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.tr[data-s]')) { e.preventDefault(); go({ stock: e.target.dataset.s }); }
});
function toggleStar(s) {
  state.stars.has(s) ? state.stars.delete(s) : state.stars.add(s);
  store.set('stars', [...state.stars]); render();
}
const closeDrawer = () => go({ stock: null });
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.stock) closeDrawer(); });
$('#drawer').addEventListener('click', (e) => {
  if (e.target.closest('.close')) { closeDrawer(); return; }
  const ds = e.target.closest('[data-dstar]'); if (ds) { toggleStar(ds.dataset.dstar); return; }
  const rs = e.target.closest('[data-restrict]');
  if (rs) {
    const s = rs.dataset.restrict;
    if (state.restricted[s]) delete state.restricted[s]; else state.restricted[s] = true;
    store.set('restricted', state.restricted); compute(); return;
  }
  if (e.target.id === 'gReset') { delete state.growth[state.stock]; store.set('growth', state.growth); compute(); }
});
$('#drawer').addEventListener('input', (e) => {
  if (e.target.id !== 'gSl') return;
  state.growth[state.stock] = +e.target.value; store.set('growth', state.growth);
  const top = $('#drawer').scrollTop; compute(); $('#drawer').scrollTop = top; $('#gSl')?.focus();
});
$('#settingsBtn').addEventListener('click', () => {
  const s = $('#settings'); s.hidden = !s.hidden; $('#settingsBtn').setAttribute('aria-expanded', String(!s.hidden));
});
$('#erp').addEventListener('input', (e) => { state.erp = +e.target.value; store.set('erp', state.erp); compute(); });
$('#mos').addEventListener('input', (e) => { state.mos = +e.target.value; store.set('mos', state.mos); compute(); });
$('#minCap').addEventListener('input', (e) => { state.minCapIdx = +e.target.value; store.set('minCapIdx', state.minCapIdx); compute(); });
$('#resetSettings').addEventListener('click', () => {
  state.erp = DEFAULTS.erp; state.mos = DEFAULTS.mos; state.minCapIdx = 2;
  store.set('erp', state.erp); store.set('mos', state.mos); store.set('minCapIdx', 2);
  $('#erp').value = state.erp; $('#mos').value = state.mos; $('#minCap').value = 2; compute();
});
window.addEventListener('popstate', () => { readHash(); render(); });

load();
