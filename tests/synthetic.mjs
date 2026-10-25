import { value } from '../site/engine.js';
const yrs = 10, grow = (b, g) => Array.from({ length: yrs }, (_, i) => +(b * (1 + g) ** i).toFixed(1));
const cases = {
  bank: { s: 'BANKX', n: 'Synthetic Bank', sec: 'Financial Services', ind: 'Banks - Regional', px: 1650, sh: 760,
    sales: grow(80000, 0.15), np: grow(18000, 0.17), oi: grow(15000, 0.14), pbt: grow(24000, 0.17), tax: grow(6000, 0.17),
    int: grow(40000, 0.15), eq: grow(120000, 0.16), debt: grow(1000000, 0.15), div: grow(3000, 0.15), pb: [3, 3.5, 3.2, 2.8, 3, 2.9, 2.7, 2.6, 2.5, 2.4], pe: grow(20, 0) },
  steel: { s: 'STEELX', n: 'Synthetic Steel', sec: 'Basic Materials', ind: 'Steel', px: 140, sh: 1200,
    sales: [60000, 52000, 70000, 110000, 95000, 140000, 120000, 100000, 130000, 125000],
    ebitda: [9000, 4000, 12000, 30000, 15000, 40000, 18000, 12000, 22000, 19000],
    np: [3000, -2000, 5000, 15000, 6000, 25000, 8000, 3000, 10000, 9000], oi: Array(10).fill(300),
    pbt: [4000, -2500, 6500, 20000, 8000, 33000, 10500, 4000, 13000, 12000], tax: [1000, 0, 1500, 5000, 2000, 8000, 2500, 1000, 3000, 3000],
    eq: grow(60000, 0.07), debt: grow(50000, 0.02), cash: Array(10).fill(5000), inv: Array(10).fill(3000), cfo: [6000, 2000, 9000, 20000, 11000, 30000, 14000, 8000, 16000, 15000],
    pe: [12, null, 10, 5, 8, 4, 9, 20, 8, 9], dep: Array(10).fill(4000), nb: grow(70000, 0.04) },
  fmcg: { s: 'FMCGX', n: 'Synthetic FMCG', sec: 'Consumer Defensive', ind: 'Household & Personal Products', px: 2400, sh: 235,
    sales: grow(35000, 0.09), ebitda: grow(7500, 0.11), np: grow(5000, 0.11), oi: grow(400, 0.05), pbt: grow(6700, 0.11), tax: grow(1700, 0.11),
    eq: grow(8000, 0.06), debt: Array(10).fill(0), cash: grow(3000, 0.05), inv: grow(2000, 0.05), cfo: grow(5500, 0.11), div: grow(4000, 0.11),
    pe: [55, 60, 65, 70, 62, 58, 60, 55, 57, 56], dep: grow(500, 0.08), nb: grow(6000, 0.06), rec: grow(1500, 0.08), invt: grow(2500, 0.08), ol: grow(9000, 0.09) },
};
for (const [k, c] of Object.entries(cases)) {
  const v = value(c);
  const m = Object.fromEntries(Object.entries(v.methods).filter(([, x]) => x).map(([a, b]) => [a + (v.used.includes(a) ? '*' : ''), Math.round(b)]));
  console.log(k, v.typeLabel, '| price', c.px, '| fair', Math.round(v.fair), `(${Math.round(v.low)}–${Math.round(v.high)})`, '|', v.zone.label, '| q', `${v.quality.passed}/${v.quality.total}`, '| impl g', v.impliedGrowth?.toFixed(3));
  console.log('   ', JSON.stringify(m));
}
