"""Parse a Screener.in 'Export to Excel' workbook (its 'Data Sheet') into the engine's company format.

Only the Data Sheet is read — it is what Screener fills in, so any template version works.
"""
from __future__ import annotations

import math
from pathlib import Path

import openpyxl


def _num(v):
    if isinstance(v, (int, float)) and not (isinstance(v, float) and math.isnan(v)):
        return float(v)
    return None


def _excel_year(v):
    # Report dates are Excel serials (e.g. 46112 = 31-Mar-2026) or datetimes
    if hasattr(v, "year"):
        return v.year
    if isinstance(v, (int, float)):
        return 1899 + int((v + 365) // 365.25)  # close enough for March year-ends
    return None


def parse(path: str | Path) -> dict:
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb["Data Sheet"]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]

    def label(r):
        return str(r[0]).strip().lower() if r and r[0] is not None else ""

    # Split into sections by header labels
    sections, cur = {}, None
    meta = {}
    for r in rows:
        lab = label(r)
        if lab in ("profit & loss", "quarters", "balance sheet", "cash flow:", "price:", "derived:"):
            cur = lab
            if lab in ("price:", "derived:"):
                sections.setdefault(lab, {})["_"] = r[1:]
            continue
        if lab == "company name":
            meta["name"] = r[1]
        elif lab in ("current price", "market capitalization", "number of shares", "face value"):
            meta[lab] = _num(r[1])
        elif cur and lab:
            sections.setdefault(cur, {})[lab] = r[1:]

    pl = sections.get("profit & loss", {})
    bs = sections.get("balance sheet", {})
    cf = sections.get("cash flow:", {})
    years_raw = pl.get("report date", [])
    keep = [i for i, v in enumerate(years_raw) if v is not None]
    # keep only columns that actually have sales data
    sales_row = pl.get("sales", [])
    keep = [i for i in keep if i < len(sales_row) and _num(sales_row[i]) is not None]

    def series(sec, key):
        row = sec.get(key, [])
        return [(_num(row[i]) if i < len(row) else None) for i in keep]

    sales = series(pl, "sales")
    expenses_keys = ["raw material cost", "change in inventory", "power and fuel", "other mfr. exp",
                     "employee cost", "selling and admin", "other expenses"]
    ebitda = []
    for j, i in enumerate(keep):
        s = sales[j]
        if s is None:
            ebitda.append(None)
            continue
        exp = 0.0
        for k in expenses_keys:
            v = _num(pl.get(k, [None] * (i + 1))[i]) if k in pl and i < len(pl[k]) else None
            if v is None:
                continue
            exp += -v if k == "change in inventory" else v  # inventory build reduces cost
        ebitda.append(s - exp)

    sh_adj = series(sections.get("derived:", {}), "adjusted equity shares in cr")
    shares_cr = next((v for v in reversed(sh_adj) if v), None)
    if not shares_cr:
        n = series(bs, "no. of equity shares")
        last = next((v for v in reversed(n) if v), None)
        shares_cr = last / 1e7 if last else None

    np_ = series(pl, "net profit")
    eq = [(a or 0) + (b or 0) if (a is not None or b is not None) else None
          for a, b in zip(series(bs, "equity share capital"), series(bs, "reserves"))]

    # historic PE / PB from Screener's year-end price row
    price_row = sections.get("price:", {}).get("_", [])
    prices = [(_num(price_row[i]) if i < len(price_row) else None) for i in keep]
    pe, pb = [], []
    for j in range(len(keep)):
        p, n, e = prices[j], np_[j], eq[j]
        s = (sh_adj[j] if j < len(sh_adj) and sh_adj[j] else None) or shares_cr
        pe.append(p * s / n if p and n and n > 0 and s else None)
        pb.append(p * s / e if p and e and e > 0 and s else None)

    years = [_excel_year(years_raw[i]) for i in keep]

    # trailing twelve months from the last 4 quarters
    q = sections.get("quarters", {})
    def ttm(key):
        vals = [_num(v) for v in q.get(key, [])]
        vals = [v for v in vals if v is not None]
        return sum(vals[-4:]) if len(vals) >= 4 else None
    return {
        "s": None, "n": meta.get("name"), "sec": None, "ind": None,
        "px": meta.get("current price"), "sh": shares_cr, "y": years,
        "sales": sales, "ebitda": ebitda, "oi": series(pl, "other income"),
        "dep": series(pl, "depreciation"), "int": series(pl, "interest"),
        "pbt": series(pl, "profit before tax"), "tax": series(pl, "tax"),
        "np": np_, "div": series(pl, "dividend amount"),
        "eq": eq, "debt": series(bs, "borrowings"), "ol": series(bs, "other liabilities"),
        "nb": series(bs, "net block"), "cwip": series(bs, "capital work in progress"),
        "inv": series(bs, "investments"), "rec": series(bs, "receivables"),
        "invt": series(bs, "inventory"), "cash": series(bs, "cash & bank"),
        "cfo": series(cf, "cash from operating activity"),
        "pe": pe, "pb": pb, "src": "screener",
        "ttmNp": ttm("net profit"), "ttmOi": ttm("other income"), "ttmSales": ttm("sales"),
    }


if __name__ == "__main__":
    import json, sys
    print(json.dumps(parse(sys.argv[1]), indent=1, default=str))
