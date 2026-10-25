import { value, METHOD_LABEL, TYPE_LABEL, DEFAULTS } from './engine.js';
import { RESTRICTED, MIN_QUALITY } from './config.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = {
  data: null, results: [], tab: 'picks',
  erp: store.get('erp', DEFAULTS.erp), mos: store.get('mos', DEFAULTS.mos),
  stars: new Set(store.get('stars', [])),
  growth: store.get('growth', {}),        // per-stock growth overrides
  restricted: store.get('restricted', {}), // stocks you marked restricted — saved only in this browser
};
const restrictNote = 'Marked restricted by you (e.g. your employer — insider-trading rules). Check your trading window / pre-clearance before any trade.';

const inr = (x) => x == null ? '—' : '₹' + (x >= 1000 ? Math.round(x).toLocaleString('en-IN') : x.toFixed(x < 100 ? 1 : 0));
const pct = (x, d = 0) => x == null ? '—' : `${(x * 100).toFixed(d)}%`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function load() {
  try {
    const r = await fetch('data/stocks.json', { cache: 'no-cache' });
    state.data = await r.json();
  } catch {
    $('#asof').textContent = 'Could not load data/stocks.json — the daily job has not run yet.';
    return;
  }
  const m = state.data.meta;
  for (const s of m.watchlist || []) state.stars.add(s);
  const when = m.date ? new Date(m.date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '?';
  $('#asof').textContent = `${m.demo ? 'DEMO DATA (synthetic companies) — real data appears after the first GitHub run · ' : ''}Prices as of ${when} · ${m.count} of ${m.universe} NSE stocks valued`;
  const types = [...new Set(Object.keys(TYPE_LABEL))];
  $('#fType').innerHTML += types.map((t) => `<option value="${t}">${TYPE_LABEL[t]}</option>`).join('');
  $('#erp').value = state.erp; $('#mos').value = state.mos;
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
  $('#gV').textContent = `${g.toFixed(2)}%`;
  $('#rV').textContent = `${(g + +state.erp).toFixed(1)}%`;
  $('#mosV').textContent = `${state.mos}%`;
  state.results = state.data.companies.map((c) => {
    const v = value(c, opts(c.s));
    v.c = c;
    if (RESTRICTED[c.s]) v.restricted = RESTRICTED[c.s];
    else if (state.restricted[c.s]) v.restricted = restrictNote;
    return v;
  });
  render();
}

function isPick(v) {
  return !v.restricted && (v.zone.key === 'strong' || v.zone.key === 'buy') && v.quality.score >= MIN_QUALITY;
}

function render() {
  const q = $('#q').value.trim().toLowerCase();
  const fz = $('#fZone').value, ft = $('#fType').value;
  const picks = state.results.filter(isPick);
  const watch = state.results.filter((v) => state.stars.has(v.symbol));
  $('#nPicks').textContent = picks.length; $('#nWatch').textContent = watch.length; $('#nAll').textContent = state.results.length;

  let rows = state.tab === 'picks' ? picks : state.tab === 'watch' ? watch : state.results;
  if (q) rows = rows.filter((v) => v.symbol.toLowerCase().includes(q) || (v.name || '').toLowerCase().includes(q));
  if (fz) rows = rows.filter((v) => v.zone.key === fz);
  if (ft) rows = rows.filter((v) => v.type === ft);
  rows = [...rows].sort((a, b) => a.zone.rank - b.zone.rank || (b.discount ?? -9) - (a.discount ?? -9));

  $('#hint').textContent = {
    picks: `Quality stocks (pass ≥ ${Math.round(MIN_QUALITY * 100)}% of checks) trading at least ${state.mos}% below fair value. Sorted by discount.`,
    watch: 'Your starred stocks and any Screener exports in the repo. Tap ☆ on any row to add.',
    all: 'Every stock with enough data, best value first.',
  }[state.tab];

  const shown = rows.slice(0, 300);
  $('#list').innerHTML = rows.length ? `
    <div class="row head"><span>Company</span><span class="num">Price</span><span class="num">Fair value</span>
      <span class="num">Buy below</span><span class="num">Discount</span><span>Verdict · timing</span><span></span></div>
    ${shown.map(rowHtml).join('')}
    ${rows.length > shown.length ? `<p class="empty">Showing 300 of ${rows.length} — search or filter to narrow.</p>` : ''}`
    : `<p class="empty">${state.tab === 'picks' ? 'No stock passes both the quality and price tests today. That is normal in expensive markets — patience is the strategy.' : 'Nothing matches.'}</p>`;
}

function rowHtml(v) {
  const zk = v.restricted ? 'restricted' : v.zone.key;
  const zl = v.restricted ? 'Restricted' : v.zone.label;
  return `<div class="row" role="button" tabindex="0" data-s="${esc(v.symbol)}">
    <span class="nm"><b>${esc(v.symbol)}</b><span>${esc(v.name)} · ${esc(v.typeLabel)}</span></span>
    <span class="num c-px">${inr(v.price)}<small>${v.c.tech?.chg1d != null ? (v.c.tech.chg1d >= 0 ? '+' : '') + v.c.tech.chg1d + '% today' : 'price'}</small></span>
    <span class="num c-fv">${inr(v.fair)}<small>${v.low ? inr(v.low) + '–' + inr(v.high) : 'fair value'}</small></span>
    <span class="num c-bb">${inr(v.buyBelow)}<small>buy below</small></span>
    <span class="num c-dc ${v.discount > 0 ? 'pos' : 'neg'}">${v.discount == null ? '—' : (v.discount > 0 ? '' : '+') + pct(Math.abs(v.discount))}<small>${v.discount > 0 ? 'below fair' : 'above fair'}</small></span>
    <span class="zc"><span class="pill z-${zk}">${zl}</span><small>${esc(v.timing.label)} · Q ${v.quality.passed}/${v.quality.total}</small></span>
    <button class="star ${state.stars.has(v.symbol) ? 'on' : ''}" data-star="${esc(v.symbol)}" aria-label="Star">${state.stars.has(v.symbol) ? '★' : '☆'}</button>
  </div>`;
}

function detail(sym) {
  const v = state.results.find((x) => x.symbol === sym);
  if (!v) return;
  const c = v.c, d = v.derived, t = v.timing;
  const used = new Set(v.used);
  const methods = Object.entries(v.methods).filter(([, x]) => x != null)
    .sort(([a], [b]) => (used.has(b) - used.has(a)) || (v.weights[b] ?? 0) - (v.weights[a] ?? 0));

  // range bar scale
  const pts = [v.low, v.high, v.price, v.buyBelow].filter((x) => x > 0);
  const lo = Math.min(...pts) * 0.85, hi = Math.max(...pts) * 1.1;
  const X = (x) => `${((x - lo) / (hi - lo)) * 100}%`;
  const g1 = v.params.g1;

  let verdict;
  if (!v.fair) verdict = v.type === 'loss' ? 'Loss-making or negative 5-year profits — formula valuation is not meaningful. Skip unless you have a turnaround thesis.' : 'Not enough data to value.';
  else verdict = `At <b>${inr(v.price)}</b> the stock is <b>${v.discount > 0 ? pct(v.discount) + ' below' : pct(-v.discount) + ' above'}</b> its fair value of <b>${inr(v.fair)}</b>. Buy-below price with ${v.params.mos}% safety margin: <b>${inr(v.buyBelow)}</b>.`;
  const igLine = v.impliedGrowth != null
    ? `Today's price assumes profit grows <b>${pct(v.impliedGrowth, 0)}/yr</b> for ${v.type === 'compounder' ? 10 : 5} years. It actually grew <b>${pct(v.histGrowth, 0)}/yr</b> over the last 5 years.`
    : '';

  $('#detail').innerHTML = `
    <div class="d-head"><div><h2>${esc(c.n)} <span class="pill z-${v.restricted ? 'restricted' : v.zone.key}">${v.restricted ? 'Restricted' : v.zone.label}</span></h2>
      <p>${esc(v.symbol)} · ${esc(c.sec || '')}${c.ind ? ' / ' + esc(c.ind) : ''} · valued as <b>${v.typeLabel}</b> · data: ${c.src === 'screener' ? 'your Screener export' : 'Yahoo Finance'}</p></div>
      <button class="x" aria-label="Close">×</button></div>
    <div class="d-body">
      <p style="margin:0"><button id="rToggle" class="linkbtn">${state.restricted[sym] ? 'Remove restricted mark' : 'Mark as restricted (my employer / insider)'}</button></p>
      ${v.restricted ? `<p class="alert">${esc(v.restricted)} Formula verdict: ${v.zone.label}.</p>` : ''}
      <p class="verdict">${verdict}<br>${igLine}</p>
      ${v.fair ? `<div class="range" aria-hidden="true"><div class="track"></div>
        <div class="band" style="left:${X(v.low)};width:calc(${X(v.high)} - ${X(v.low)})"></div>
        <div class="mk up" style="left:${X(v.fair)}"><span>fair ${inr(v.fair)}</span></div>
        <div class="mk buyb dn" style="left:${X(v.buyBelow)}"><span>buy ${inr(v.buyBelow)}</span></div>
        <div class="mk price ${Math.abs(v.price - v.fair) / v.fair < 0.12 ? 'dn' : 'up'}" style="left:${X(v.price)}"><span>now ${inr(v.price)}</span></div>
      </div>` : ''}
      <div>
        <h3>Valuation methods for a ${v.typeLabel.toLowerCase()} business</h3>
        <table>${methods.map(([k, x]) => `<tr class="${used.has(k) ? '' : 'unused'}"><td>${METHOD_LABEL[k]}${used.has(k) ? '' : ' <small>(reference only)</small>'}</td>
          <td class="v">${used.has(k) ? Math.round((v.weights[k] / v.used.reduce((s, u) => s + v.weights[u], 0)) * 100) + '%' : ''}</td><td class="v">${inr(x)}</td></tr>`).join('')}</table>
      </div>
      <div class="grid2">
        <div><h3>Quality ${v.quality.passed}/${v.quality.total}</h3>
          <ul class="checks">${v.quality.checks.map((q) => `<li class="${q.pass ? 'ok' : ''}">${esc(q.label)} <small>${esc(q.detail)}</small></li>`).join('')}</ul></div>
        <div><h3>Entry timing (3+ yr holder)</h3>
          <p style="margin:0 0 6px">${esc(t.label)}</p>
          <ul class="checks" style="font-size:13px">
            ${t.dma200 ? `<li class="${t.above200 ? 'ok' : ''}">200-day average <small>${inr(t.dma200)}</small></li>` : ''}
            ${t.h52 ? `<li class="ok">52-wk range <small>${inr(t.l52)} – ${inr(t.h52)} (${pct(t.offHigh)} from high)</small></li>` : ''}
            ${t.rsi != null ? `<li class="${t.rsi >= 30 && t.rsi <= 70 ? 'ok' : ''}">RSI(14) <small>${t.rsi}</small></li>` : ''}
          </ul></div>
      </div>
      ${v.type !== 'financial' && v.type !== 'loss' ? `<label class="gctl">
        <span>Growth assumption, years 1–${v.type === 'compounder' ? 10 : 5}: <b id="gOut">${pct(g1, 0)}</b>
        ${state.growth[sym] != null ? '<button id="gReset" style="margin-left:8px">reset to auto</button>' : '<small>(auto from 5-yr history)</small>'}</span>
        <input id="gSl" type="range" min="0" max="50" step="1" value="${Math.round(g1 * 100)}">
        <small>Then fades to ${pct(v.params.gT, 0)} over 5 years. Discount rate ${pct(v.params.r, 1)}. ROCE used: ${pct(Math.max(d.roic ?? 0, d.roicLatest ?? 0), 0)}.</small>
      </label>` : ''}
    </div>`;
  const dlg = $('#detail');
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('.x').onclick = () => dlg.close();
  const sl = dlg.querySelector('#gSl');
  if (sl) sl.oninput = () => { state.growth[sym] = +sl.value; store.set('growth', state.growth); compute(); detail(sym); };
  dlg.querySelector('#rToggle').onclick = () => {
    state.restricted[sym] ? delete state.restricted[sym] : (state.restricted[sym] = true);
    store.set('restricted', state.restricted); compute(); detail(sym);
  };
  const rs = dlg.querySelector('#gReset');
  if (rs) rs.onclick = () => { delete state.growth[sym]; store.set('growth', state.growth); compute(); detail(sym); };
}

// ---------- events ----------
$('#erp').oninput = (e) => { state.erp = +e.target.value; store.set('erp', state.erp); compute(); };
$('#mos').oninput = (e) => { state.mos = +e.target.value; store.set('mos', state.mos); compute(); };
for (const id of ['#q', '#fZone', '#fType']) $(id).addEventListener('input', render);
document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
  state.tab = b.dataset.tab; render();
});
$('#list').addEventListener('click', (e) => {
  const st = e.target.closest('[data-star]');
  if (st) {
    e.stopPropagation();
    const s = st.dataset.star;
    state.stars.has(s) ? state.stars.delete(s) : state.stars.add(s);
    store.set('stars', [...state.stars]); render(); return;
  }
  const row = e.target.closest('.row[data-s]');
  if (row) detail(row.dataset.s);
});
$('#list').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.s) detail(e.target.dataset.s); });
$('#detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

load();
