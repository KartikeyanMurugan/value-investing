"""Offline test: mock Yahoo + NSE so the whole pipeline runs without network."""
import json, sys, types
from pathlib import Path
import numpy as np, pandas as pd
sys.path.insert(0, 'pipeline')
import fetch

cols = [pd.Timestamp(f'{y}-03-31') for y in range(2022, 2026)]
def df(rows): return pd.DataFrame({c: [v * (1.1 ** i) * 1e7 for v in rows.values()] for i, c in enumerate(cols)}, index=list(rows))
class FakeTicker:
    def __init__(self, t): self.t = t
    income_stmt = df({'Total Revenue': 1000, 'EBITDA': 200, 'Net Income Common Stockholders': 120, 'Other Income': 10,
                      'Reconciled Depreciation': 30, 'Interest Expense': 5, 'Pretax Income': 160, 'Tax Provision': 40})
    balance_sheet = df({'Stockholders Equity': 800, 'Total Debt': 100, 'Cash And Cash Equivalents': 50,
                        'Other Short Term Investments': 20, 'Total Liabilities Net Minority Interest': 400,
                        'Accounts Receivable': 150, 'Inventory': 120, 'Net PPE': 500})
    cashflow = df({'Operating Cash Flow': 140, 'Capital Expenditure': -60, 'Cash Dividends Paid': -30})
    quarterly_income_stmt = pd.DataFrame({pd.Timestamp(f'2025-{m:02d}-28'): [35e7, 300e7, 3e7] for m in (3, 6, 9, 12)},
                                         index=['Net Income Common Stockholders', 'Total Revenue', 'Other Income'])
    info = {'sharesOutstanding': 5e7, 'longName': 'Fake Industries Ltd', 'sector': 'Industrials', 'industry': 'Electrical Equipment'}
    def history(self, **k):
        idx = pd.date_range('2016-01-31', '2026-09-30', freq='ME')
        return pd.DataFrame({'Close': np.linspace(100, 400, len(idx))}, index=idx)

def fake_download(tick, **k):
    idx = pd.date_range('2025-10-01', periods=250, freq='B')
    close = pd.Series(np.linspace(300, 420, 250), index=idx)
    frames = {t: pd.DataFrame({'Close': close}) for t in tick}
    return pd.concat(frames, axis=1)

fetch.yf.Ticker = FakeTicker
fetch.yf.download = fake_download
fetch.universe = lambda: pd.DataFrame({'SYMBOL': ['FAKE', 'TESTCO'], 'NAME OF COMPANY': ['Fake Industries Limited', 'Test Company Limited']})
fetch.gsec_yield = lambda prev: 7.45
fetch.time.sleep = lambda s: None
sys.argv = ['fetch.py', '--full']
fetch.main()
d = json.loads(fetch.OUT.read_text())
print(d['meta'])
for c in d['companies']: print(c['s'], c['src'], c['px'], c['sh'], c.get('sec'), c['np'][-3:], c.get('ttmNp'), c['pe'][-2:], c['tech'])
