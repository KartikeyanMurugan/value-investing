// Builds a demo site/data/stocks.json from clearly-labelled synthetic companies
import { writeFileSync } from 'node:fs';
const yrs = 10, grow = (b, g) => Array.from({ length: yrs }, (_, i) => +(b * (1 + g) ** i).toFixed(1));
const tech = (px, d200, h, l, rsi, chg) => ({ dma50: px * 1.01, dma200: d200, h52: h, l52: l, rsi, chg1d: chg });
const demo = [
  { s: 'DEMOTECH', n: 'Demo Electronics (synthetic)', sec: 'Technology', ind: 'Electronic Components', px: 1400, sh: 19,
    sales: [860, 890, 1270, 2050, 3150, 3790, 4820], ebitda: [135, 102, 129, 192, 203, 323, 546], np: [91, 69, 77, 119, 107, 170, 318],
    oi: [13, 18, 18, 44, 56, 47, 31], pbt: [113, 87, 111, 179, 166, 237, 445], tax: [22, 21, 34, 56, 42, 53, 100], int: [15, 10, 11, 26, 41, 58, 48],
    eq: [423, 599, 572, 1540, 1613, 1750, 2862], debt: [125, 103, 218, 375, 630, 665, 400], ol: [238, 258, 364, 628, 1446, 1788, 2504],
    cash: [78, 73, 37, 54, 87, 296, 299], inv: [30, 132, 41, 84, 42, 59, 547], rec: [180, 208, 272, 402, 930, 1477, 1841], invt: [142, 179, 291, 587, 1004, 822, 1062],
    nb: [296, 292, 378, 532, 1075, 1144, 1458], cwip: [1, 0, 41, 25, 17, 66, 72], dep: [19, 23, 25, 31, 51, 75, 84], cfo: [156, 37, -13, -70, -109, 176, 290],
    div: [null, null, null, 27, 27, 27, 29], pe: [null, null, null, 42, 84, 52, 47], ttmNp: 368, ttmOi: 51, tech: tech(1400, 1180, 1520, 760, 61, 1.2), src: 'yahoo' },
  { s: 'DEMOBANK', n: 'Demo Bank (synthetic)', sec: 'Financial Services', ind: 'Banks - Regional', px: 1650, sh: 760,
    sales: grow(80000, 0.15), np: grow(18000, 0.17), oi: grow(15000, 0.14), pbt: grow(24000, 0.17), tax: grow(6000, 0.17),
    int: grow(40000, 0.15), eq: grow(120000, 0.16), debt: grow(1000000, 0.15), div: grow(3000, 0.15),
    pb: [3, 3.5, 3.2, 2.8, 3, 2.9, 2.7, 2.6, 2.5, 2.4], pe: grow(20, 0), tech: tech(1650, 1600, 1800, 1400, 52, -0.4), src: 'yahoo' },
  { s: 'DEMOSTEEL', n: 'Demo Steel (synthetic)', sec: 'Basic Materials', ind: 'Steel', px: 52, sh: 1200,
    sales: [60000, 52000, 70000, 110000, 95000, 140000, 120000, 100000, 130000, 125000],
    ebitda: [9000, 4000, 12000, 30000, 15000, 40000, 18000, 12000, 22000, 19000],
    np: [3000, -2000, 5000, 15000, 6000, 25000, 8000, 3000, 10000, 9000], oi: Array(10).fill(300),
    pbt: [4000, -2500, 6500, 20000, 8000, 33000, 10500, 4000, 13000, 12000], tax: [1000, 0, 1500, 5000, 2000, 8000, 2500, 1000, 3000, 3000],
    eq: grow(60000, 0.07), debt: grow(50000, 0.02), cash: Array(10).fill(5000), inv: Array(10).fill(3000),
    cfo: [6000, 2000, 9000, 20000, 11000, 30000, 14000, 8000, 16000, 15000], pe: [12, null, 10, 5, 8, 4, 9, 20, 8, 9],
    dep: Array(10).fill(4000), nb: grow(70000, 0.04), tech: tech(52, 60, 80, 48, 28, -2.1), src: 'yahoo' },
  { s: 'DEMOFMCG', n: 'Demo FMCG (synthetic)', sec: 'Consumer Defensive', ind: 'Household & Personal Products', px: 2400, sh: 235,
    sales: grow(35000, 0.09), ebitda: grow(7500, 0.11), np: grow(5000, 0.11), oi: grow(400, 0.05), pbt: grow(6700, 0.11), tax: grow(1700, 0.11),
    eq: grow(8000, 0.06), debt: Array(10).fill(0), cash: grow(3000, 0.05), inv: grow(2000, 0.05), cfo: grow(5500, 0.11), div: grow(4000, 0.11),
    pe: [55, 60, 65, 70, 62, 58, 60, 55, 57, 56], dep: grow(500, 0.08), nb: grow(6000, 0.06), rec: grow(1500, 0.08), invt: grow(2500, 0.08), ol: grow(9000, 0.09),
    tech: tech(2400, 2450, 2900, 2200, 45, 0.3), src: 'yahoo' },
  { s: 'DEMOPUMP', n: 'Demo Pumps (synthetic)', sec: 'Industrials', ind: 'Specialty Industrial Machinery', px: 140, sh: 30,
    sales: grow(1200, 0.12), ebitda: grow(220, 0.13), np: grow(130, 0.13), oi: grow(10, 0.05), pbt: grow(175, 0.13), tax: grow(45, 0.13),
    eq: grow(700, 0.1), debt: Array(10).fill(40), cash: grow(80, 0.08), inv: grow(60, 0.05), cfo: grow(140, 0.13), div: grow(25, 0.12),
    pe: [18, 22, 25, 20, 24, 28, 26, 22, 21, 23], dep: grow(30, 0.08), nb: grow(500, 0.07), rec: grow(250, 0.1), invt: grow(200, 0.1), ol: grow(300, 0.1),
    tech: tech(140, 165, 230, 133, 31, -1.4), src: 'yahoo' },
  { s: 'DEMOPOWER', n: 'Demo Power Utility (synthetic)', sec: 'Utilities', ind: 'Utilities - Regulated Electric', px: 300, sh: 970,
    sales: grow(110000, 0.06), ebitda: grow(30000, 0.06), np: grow(14000, 0.07), oi: grow(2000, 0.03), pbt: grow(18000, 0.07), tax: grow(4000, 0.07),
    eq: grow(110000, 0.07), debt: grow(180000, 0.04), cash: grow(5000, 0.03), inv: grow(15000, 0.03), cfo: grow(30000, 0.06), div: grow(6500, 0.06),
    pe: [9, 10, 11, 8, 9, 12, 14, 15, 13, 14], dep: grow(9000, 0.05), nb: grow(250000, 0.04), tech: tech(300, 310, 360, 260, 47, 0.2), src: 'yahoo' },
];
const meta = { gsec: 7.45, date: new Date().toISOString(), count: demo.length, universe: demo.length, watchlist: [], demo: true };
writeFileSync('site/data/stocks.json', JSON.stringify({ meta, companies: demo }));
console.log('demo written', demo.length);
