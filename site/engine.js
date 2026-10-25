// Valuation engine — one source of truth, used by the browser (sliders) and by node (tests).
// Units: money in ₹ crore, shares in crore, price in ₹ per share. Arrays are yearly, oldest → newest.

export const DEFAULTS = {
  gsec: 7.45,          // 10-yr G-sec yield %, replaced daily by the pipeline
  erp: 4.5,            // equity risk premium %, slider (min 0 → discount rate never below G-sec)
  mos: 30,             // required margin of safety %
  termGrowth: 5,       // long-run growth % after year 10 (≈ India real GDP + part of inflation)
  growthOverride: null // % for years 1-5; null = auto from history
};

// ---------- helpers ----------
const isNum = (v) => typeof v === 'number' && isFinite(v);
const clean = (a) => (a || []).filter(isNum);
const lastN = (a, n) => clean(a).slice(-n);
const last = (a) => { const c = clean(a); return c.length ? c[c.length - 1] : null; };
const avg = (a) => { const c = clean(a); return c.length ? c.reduce((s, v) => s + v, 0) / c.length : null; };
const sum = (a) => clean(a).reduce((s, v) => s + v, 0);
const median = (a) => { const c = clean(a).sort((x, y) => x - y); if (!c.length) return null; const m = c.length >> 1; return c.length % 2 ? c[m] : (c[m - 1] + c[m]) / 2; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const stdev = (a) => { const c = clean(a); if (c.length < 2) return 0; const m = avg(c); return Math.sqrt(c.reduce((s, v) => s + (v - m) ** 2, 0) / (c.length - 1)); };

// CAGR over the last `years` years; null when either end is non-positive
export function cagr(arr, years = 5) {
  const c = clean(arr);
  if (c.length < 2) return null;
  const n = Math.min(years, c.length - 1);
  const a = c[c.length - 1 - n], b = c[c.length - 1];
  if (a <= 0 || b <= 0) return null;
  return (b / a) ** (1 / n) - 1;
}

// ---------- derived series ----------
export function derive(c) {
  const n = (c.np || []).length;
  const taxRate = [];
  const coreNp = [];       // profit without after-tax other income (that cash is added separately)
  const capex = [];
  for (let i = 0; i < n; i++) {
    const pbt = c.pbt?.[i], tax = c.tax?.[i];
    const tr = isNum(pbt) && pbt > 0 && isNum(tax) ? clamp(tax / pbt, 0, 0.35) : 0.25;
    taxRate.push(tr);
    const np = c.np?.[i], oi = c.oi?.[i];
    coreNp.push(isNum(np) ? np - (c.type === 'financial' || !isNum(oi) ? 0 : oi * (1 - tr)) : null);
    if (c.capex && isNum(c.capex[i])) capex.push(c.capex[i]);
    else if (i > 0 && isNum(c.nb?.[i]) && isNum(c.nb?.[i - 1])) {
      const dCw = (c.cwip?.[i] ?? 0) - (c.cwip?.[i - 1] ?? 0);
      capex.push(Math.max(0, c.nb[i] - c.nb[i - 1] + dCw + (c.dep?.[i] ?? 0)));
    } else capex.push(null);
  }
  const sh = c.sh;
  const eq = last(c.eq), debt = last(c.debt) ?? 0, cash = last(c.cash) ?? 0, inv = last(c.inv) ?? 0;
  const netCash = cash + inv - debt;
  // capital employed in operations (excludes surplus cash/investments)
  const capEmp = (c.eq || []).map((e, i) => isNum(e) ? e + (c.debt?.[i] ?? 0) - (c.cash?.[i] ?? 0) - (c.inv?.[i] ?? 0) : null);
  const roicSeries = coreNp.map((p, i) => isNum(p) && isNum(capEmp[i]) && capEmp[i] > 0 ? p / capEmp[i] : null);
  const roeSeries = (c.np || []).map((p, i) => isNum(p) && isNum(c.eq?.[i]) && c.eq[i] > 0 ? p / c.eq[i] : null);
  const opm = (c.ebitda || []).map((e, i) => isNum(e) && isNum(c.sales?.[i]) && c.sales[i] > 0 ? e / c.sales[i] : null);
  // Cyclicality = how often profit actually fell, not plain variance (fast growth also has high variance)
  const p10 = lastN(c.np, 10);
  let bigDrops = 0, lossYears = 0;
  for (let i = 0; i < p10.length; i++) {
    if (p10[i] <= 0) lossYears++;
    if (i > 0 && p10[i - 1] > 0 && p10[i] < p10[i - 1] * 0.8) bigDrops++;
  }
  const cyclicalScore = bigDrops + 2 * lossYears;
  const profitCV = (() => { const m = avg(p10); return m && m > 0 ? stdev(p10) / m : 9; })();
  // Latest earnings: trailing 4 quarters when available (fresher than last annual report)
  const ttmCore = isNum(c.ttmNp) ? c.ttmNp - (c.type === 'financial' || !isNum(c.ttmOi) ? 0 : c.ttmOi * (1 - (taxRate[n - 1] ?? 0.25))) : null;
  const roce = (c.pbt || []).map((p, i) => isNum(p) && isNum(c.eq?.[i]) ? (p + (c.int?.[i] ?? 0)) / (c.eq[i] + (c.debt?.[i] ?? 0)) : null);
  return {
    taxRate, coreNp, capex, netCash, eq, debt, cash, inv,
    avg5Core: avg(lastN(coreNp, 5)),
    avgAllCore: avg(lastN(coreNp, 10)),
    lastCore: ttmCore ?? last(coreNp),
    ttmCore,
    eps: (ttmCore ?? last(coreNp)) != null && sh ? (ttmCore ?? last(coreNp)) / sh : null,
    bvps: eq != null && sh ? eq / sh : null,
    roic: avg(lastN(roicSeries, 5)),
    roicLatest: last(roicSeries),
    roce5: avg(lastN(roce, 5)),
    cyclicalScore,
    roe: avg(lastN(roeSeries, 5)),
    opmAvg: avg(lastN(opm, 10)),
    salesCagr5: cagr(c.sales, 5),
    profitCagr5: cagr(coreNp, 5),
    profitCV,
    nwc: (last(c.rec) ?? 0) + (last(c.invt) ?? 0) - (last(c.ol) ?? 0),
  };
}

// ---------- sector router ----------
const RX = {
  financial: /financ|bank|nbfc|insur|lending|credit services|capital markets|asset management|housing finance/i,
  cyclical: /basic materials|energy|steel|metal|mining|alumin|copper|zinc|cement|oil|refin|chemical|fertili|sugar|paper|textile|shipping|real estate|realty|construction materials|coal|commodit|tyre|auto ?parts|building materials/i,
  utility: /utilit|power|electric|gas distribution|water/i,
  specialtyChem: /specialty chemical/i,
};

export function classify(c, d = derive(c)) {
  if (c.type) return c.type;
  const text = `${c.sec || ''} ${c.ind || ''}`;
  if (!(d.avg5Core > 0) || !(last(c.np) > 0)) return 'loss';
  const debtEq = d.eq > 0 ? d.debt / d.eq : 0;
  const intShare = last(c.int) && last(c.sales) ? last(c.int) / last(c.sales) : 0;
  if (RX.financial.test(text) || (debtEq > 4 && intShare > 0.25)) return 'financial';
  if (RX.utility.test(text)) return 'utility';
  if ((RX.cyclical.test(text) && !RX.specialtyChem.test(text)) || d.cyclicalScore >= 3) return 'cyclical';
  if ((d.salesCagr5 ?? 0) > 0.18) return 'growth';
  if ((d.roic ?? 0) > 0.18 && d.profitCV < 0.35) return 'compounder';
  return 'default';
}

export const TYPE_LABEL = {
  financial: 'Bank / NBFC / Insurance', cyclical: 'Cyclical', utility: 'Utility / dividend',
  growth: 'High growth', compounder: 'Stable compounder', default: 'General', loss: 'Loss-making',
};

// method weights per business type (methods returning null are skipped and weights renormalised)
export const WEIGHTS = {
  financial: { justifiedPB: 0.45, pbHistory: 0.3, peRelative: 0.25 },
  cyclical: { normalisedEPV: 0.35, evEbitda: 0.35, peNormalised: 0.3 },
  utility: { ddm: 0.35, dcf: 0.35, epv: 0.3 },
  // EPV ignores growth on purpose — for growing firms it is a safety floor, so it gets a small weight
  growth: { dcf: 0.55, peRelative: 0.3, epv: 0.15 },
  compounder: { dcf: 0.55, peRelative: 0.3, epv: 0.15 },
  default: { dcf: 0.45, peRelative: 0.25, grahamFormula: 0.15, epv: 0.15 },
  loss: {},
};

// ---------- methods (each returns ₹/share or null) ----------
function autoGrowth(d, type) {
  const g = Math.min(d.profitCagr5 ?? d.salesCagr5 ?? 0.05, d.salesCagr5 ?? 1);
  return clamp(g, 0, type === 'growth' ? 0.25 : 0.2);
}

// Two-stage DCF on owner earnings: cash flow = earnings × (1 − growth / ROIC)
// (growth needs reinvestment; a high-ROIC business needs less of it)
export function dcfValue(c, d, r, g1, gT, highYears = 5) {
  // current capital efficiency, not dragged down by old idle IPO cash
  const roic = clamp(Math.max(d.roic ?? 0, d.roicLatest ?? 0) || 0.15, 0.06, 0.6);
  let E = d.lastCore;
  if (!(E > 0) || !c.sh) return null;
  let pv = 0;
  const N = highYears + 5;           // high-growth years, then 5 years fading to long-run growth
  for (let t = 1; t <= N; t++) {
    const g = t <= highYears ? g1 : g1 + (gT - g1) * (t - highYears) / 5;
    E *= 1 + g;
    pv += E * (1 - clamp(g / roic, 0, 0.9)) / (1 + r) ** t;
  }
  if (r <= gT) return null;
  const tv = E * (1 + gT) * (1 - clamp(gT / roic, 0, 0.9)) / (r - gT) / (1 + r) ** N;
  return (pv + tv + d.netCash) / c.sh;
}

export function impliedGrowth(c, d, r, gT, price, highYears = 5) {
  if (!(price > 0)) return null;
  let lo = -0.3, hi = 1.2;
  const f = (g) => dcfValue(c, d, r, g, gT, highYears);
  if (f(lo) == null || f(hi) == null) return null;
  if (f(hi) < price) return hi;   // needs > 120%/yr
  if (f(lo) > price) return lo;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; f(m) < price ? lo = m : hi = m; }
  return (lo + hi) / 2;
}

const METHODS = {
  // Earnings power value (video's EPV, corrected): no-growth value of core earnings,
  // plus surplus cash/investments, minus debt, minus any working-capital shortfall.
  epv: (c, d, p) => {
    if (!(d.avg5Core > 0)) return null;
    return (d.avg5Core / p.r + d.netCash + Math.min(0, d.nwc)) / c.sh;
  },
  normalisedEPV: (c, d, p) => {
    if (!(d.avgAllCore > 0)) return null;
    return (d.avgAllCore / p.r + d.netCash + Math.min(0, d.nwc)) / c.sh;
  },
  dcf: (c, d, p) => dcfValue(c, d, p.r, p.g1, p.gT, p.highYears),
  peRelative: (c, d) => {
    const pe = median(lastN((c.pe || []).filter((v) => v > 0 && v < 150), 10));
    return pe && d.eps > 0 ? Math.min(pe, 40) * d.eps : null; // cap: a stock's own bubble history isn't "fair"
  },
  peNormalised: (c, d) => {
    const pe = median(lastN((c.pe || []).filter((v) => v > 0 && v < 150), 10));
    return pe && d.avgAllCore > 0 ? Math.min(pe, 30) * d.avgAllCore / c.sh : null;
  },
  evEbitda: (c, d) => {
    const opm = d.opmAvg, s = last(c.sales);
    if (!(opm > 0) || !(s > 0)) return null;
    const ev = opm * s * 7; // mid-cycle multiple
    return (ev + d.netCash) / c.sh;
  },
  grahamNumber: (c, d) => (d.eps > 0 && d.bvps > 0 ? Math.sqrt(22.5 * d.eps * d.bvps) : null),
  grahamFormula: (c, d, p) => {
    if (!(d.eps > 0)) return null;
    const g = clamp((d.profitCagr5 ?? 0) * 100, 0, 15);
    return d.eps * (8.5 + 2 * g) * 4.4 / p.gsec;
  },
  justifiedPB: (c, d, p) => {
    if (!(d.roe > 0) || !(d.bvps > 0)) return null;
    const payout = clamp(sum(lastN(c.div, 5)) / Math.max(1, sum(lastN(c.np, 5))), 0, 1);
    const g = Math.min(d.roe * (1 - payout), p.r - 0.02, 0.1);
    const pb = clamp((d.roe - g) / (p.r - g), 0.3, 6);
    return pb * d.bvps;
  },
  pbHistory: (c, d) => {
    const pb = median(lastN((c.pb || []).filter((v) => v > 0 && v < 30), 10));
    return pb && d.bvps > 0 ? pb * d.bvps : null;
  },
  ddm: (c, d, p) => {
    const dv = lastN(c.div, 5);
    if (dv.length < 5 || dv.some((v) => !(v > 0))) return null;
    const dps = dv[4] / c.sh;
    const g = clamp(cagr(dv, 4) ?? 0, 0, Math.min(0.06, p.r - 0.03));
    return dps * (1 + g) / (p.r - g);
  },
};

export const METHOD_LABEL = {
  epv: 'Earnings power (no growth)', normalisedEPV: 'Earnings power, 10-yr normalised',
  dcf: 'DCF on owner earnings', peRelative: 'Own median PE × EPS', peNormalised: 'Median PE × normalised EPS',
  evEbitda: 'Mid-cycle EV/EBITDA (7×)', grahamNumber: 'Graham number', grahamFormula: 'Graham growth formula',
  justifiedPB: 'Justified P/B from ROE', pbHistory: 'Own median P/B × book', ddm: 'Dividend discount',
};

// ---------- quality checks ----------
export function quality(c, d, type) {
  const checks = [];
  const add = (label, pass, detail) => checks.push({ label, pass, detail });
  const np5 = lastN(c.np, 5);
  add('Profit positive 5 yrs', np5.length >= 5 && np5.every((v) => v > 0), np5.map((v) => Math.round(v)).join(', '));
  if (type !== 'financial') {
    const cfo5 = sum(lastN(c.cfo, 5)), npS = sum(np5);
    const conv = npS > 0 && lastN(c.cfo, 5).length ? cfo5 / npS : null;
    add('Cash from ops ≥ 60% of profit', conv != null && conv >= 0.6, conv == null ? 'no data' : `${Math.round(conv * 100)}%`);
    const de = d.eq > 0 ? d.debt / d.eq : null;
    add('Debt/Equity < 1', de != null && de < 1, de == null ? 'no data' : de.toFixed(2));
    add('ROCE (5-yr, pre-tax) > 15%', (d.roce5 ?? 0) > 0.15, d.roce5 == null ? 'no data' : `${(d.roce5 * 100).toFixed(1)}%`);
    const oiShare = sum(lastN(c.oi, 5)) / Math.max(1, sum(lastN(c.pbt, 5)));
    add('Other income < 20% of PBT', oiShare < 0.2, `${Math.round(oiShare * 100)}%`);
  } else {
    add('ROE (5-yr) > 12%', (d.roe ?? 0) > 0.12, d.roe == null ? 'no data' : `${(d.roe * 100).toFixed(1)}%`);
    const g = cagr(c.eq, 5);
    add('Book value growing', (g ?? 0) > 0.08, g == null ? 'no data' : `${(g * 100).toFixed(1)}%/yr`);
  }
  const passed = checks.filter((x) => x.pass).length;
  return { checks, passed, total: checks.length, score: checks.length ? passed / checks.length : 0 };
}

// ---------- timing (entry hint only, never decides value) ----------
export function timing(t, price) {
  if (!t || !(price > 0)) return { label: 'No price history', tone: 'muted' };
  const above200 = t.dma200 ? price > t.dma200 : null;
  const offHigh = t.h52 ? (price / t.h52 - 1) : null;
  let label, tone;
  if (t.rsi != null && t.rsi < 30) { label = 'Oversold — falling hard, stagger buys'; tone = 'warn'; }
  else if (above200 === false) { label = 'Below 200-DMA — downtrend, buy in 3 tranches'; tone = 'warn'; }
  else if (above200 && t.dma50 && t.dma50 > t.dma200) { label = 'Uptrend — entry OK'; tone = 'good'; }
  else { label = 'Sideways'; tone = 'muted'; }
  return { label, tone, above200, offHigh, rsi: t.rsi, dma200: t.dma200, h52: t.h52, l52: t.l52 };
}

// ---------- full valuation ----------
export function value(c, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const r = (o.gsec + Math.max(0, o.erp)) / 100;   // floor: never below G-sec
  const gT = Math.min(o.termGrowth / 100, r - 0.02);
  let d = derive(c);
  const type = classify(c, d);
  if (type === 'financial') d = derive({ ...c, type }); // interest/other income is core business for lenders
  const g1 = o.growthOverride != null ? o.growthOverride / 100 : autoGrowth(d, type);
  // durable moats (high ROIC, steady profits) earn a longer high-growth runway
  const highYears = type === 'compounder' ? 10 : 5;
  const p = { r, gT, g1, gsec: o.gsec, highYears };
  const price = c.px;

  const methods = {};
  for (const k of Object.keys(METHOD_LABEL)) {
    try { const v = METHODS[k](c, d, p); methods[k] = isNum(v) && v > 0 ? v : null; } catch { methods[k] = null; }
  }

  const w = WEIGHTS[type] || {};
  let ws = 0, vs = 0; const used = [];
  for (const [k, wt] of Object.entries(w)) if (methods[k] != null) { ws += wt; vs += wt * methods[k]; used.push(k); }
  const fair = ws > 0 ? vs / ws : null;
  const usedVals = used.map((k) => methods[k]);
  const disp = fair && usedVals.length > 1 ? stdev(usedVals) / fair : 0.25;
  const spread = clamp(disp, 0.15, 0.35);
  const low = fair ? fair * (1 - spread) : null;
  const high = fair ? fair * (1 + spread) : null;
  const buyBelow = fair ? fair * (1 - o.mos / 100) : null;

  const ig = type !== 'financial' && type !== 'loss' ? impliedGrowth(c, d, r, gT, price, highYears) : null;
  const histG = d.profitCagr5 ?? d.salesCagr5;
  const q = quality(c, d, type);

  let zone;
  if (!fair || !price) zone = { key: 'na', label: type === 'loss' ? 'Not valuable by formula' : 'Insufficient data', rank: 9 };
  else if (price <= Math.min(low, buyBelow)) zone = { key: 'strong', label: 'Strong buy zone', rank: 0 };
  else if (price <= buyBelow) zone = { key: 'buy', label: 'Buy zone', rank: 1 };
  else if (price <= high) zone = { key: 'fair', label: 'Fairly priced', rank: 2 };
  else if (type !== 'cyclical' && type !== 'utility' && ig != null && ig > 0.25 && ig > 2 * Math.max(histG ?? 0, 0.05)) zone = { key: 'bubble', label: 'Priced for perfection', rank: 4 };
  else zone = { key: 'over', label: 'Overvalued', rank: 3 };

  return {
    symbol: c.s, name: c.n, type, typeLabel: TYPE_LABEL[type], price,
    params: { r, gT, g1, mos: o.mos, gsec: o.gsec, erp: o.erp },
    methods, used, weights: w, fair, low, high, buyBelow,
    discount: fair && price ? 1 - price / fair : null,
    impliedGrowth: ig, histGrowth: histG, zone, quality: q,
    timing: timing(c.tech, price), derived: d,
  };
}
