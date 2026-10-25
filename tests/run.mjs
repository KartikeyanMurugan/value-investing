// Usage: node tests/run.mjs <company.json> [growth%]  (company.json from: python pipeline/screener_export.py export.xlsx)
import { readFileSync } from 'node:fs';
import { value, METHOD_LABEL } from '../site/engine.js';

const c = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const opts = process.argv[3] ? { growthOverride: +process.argv[3] } : {};
const v = value(c, opts);
const f = (x) => (x == null ? '—' : `₹${Math.round(x).toLocaleString('en-IN')}`);
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
console.log(`${v.name} | ${v.typeLabel} | price ${f(v.price)} | r ${pct(v.params.r)} g1 ${pct(v.params.g1)}`);
for (const [k, val] of Object.entries(v.methods)) console.log(`  ${v.used.includes(k) ? '*' : ' '} ${METHOD_LABEL[k].padEnd(32)} ${f(val)}`);
console.log(`fair ${f(v.fair)} range ${f(v.low)}–${f(v.high)} buy-below ${f(v.buyBelow)} | ${v.zone.label}`);
console.log(`implied growth ${pct(v.impliedGrowth)} vs history ${pct(v.histGrowth)} | ROIC ${pct(v.derived.roic)}`);
console.log(`quality ${v.quality.passed}/${v.quality.total}:`, v.quality.checks.map((q) => `${q.pass ? '✓' : '✗'} ${q.label} (${q.detail})`).join(' · '));
