"""Daily data job (runs on GitHub Actions).

  python pipeline/fetch.py                # daily: all prices + refresh the oldest fundamentals
  python pipeline/fetch.py --full         # first run: fetch fundamentals for every stock
  python pipeline/fetch.py --limit 50     # quick test on 50 stocks

Writes:
  data/fundamentals/<SYMBOL>.json   cached fundamentals (refreshed on a rolling cycle)
  site/data/stocks.json             everything the dashboard needs, rebuilt every run
"""
from __future__ import annotations

import argparse
import io
import json
import math
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
FUND_DIR = ROOT / "data" / "fundamentals"
OUT = ROOT / "site" / "data" / "stocks.json"
UNIVERSE_CACHE = ROOT / "data" / "universe.csv"
META_CACHE = ROOT / "data" / "meta.json"
EXPORTS = ROOT / "screener_exports"
CR = 1e7  # rupees per crore
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}

sys.path.insert(0, str(Path(__file__).parent))
import screener_export  # noqa: E402


def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), *a, flush=True)


# ---------------- universe ----------------
def universe() -> pd.DataFrame:
    """All NSE equity (EQ series) stocks. Cached so a blocked download never stops the job."""
    try:
        r = requests.get("https://archives.nseindia.com/content/equities/EQUITY_L.csv", headers=UA, timeout=30)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text))
        df.columns = [c.strip() for c in df.columns]
        df = df[df["SERIES"].str.strip() == "EQ"][["SYMBOL", "NAME OF COMPANY"]]
        UNIVERSE_CACHE.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(UNIVERSE_CACHE, index=False)
        log(f"universe: {len(df)} stocks from NSE")
        return df
    except Exception as e:  # noqa: BLE001
        log("NSE list download failed, using cache:", e)
        return pd.read_csv(UNIVERSE_CACHE)


# ---------------- rates ----------------
GSEC_INFO: dict = {"source": "fallback (last known)"}


def gsec_yield(prev: float) -> float:
    """India 10-yr government bond yield (%), monthly OECD series via FRED (no API key)."""
    try:
        r = requests.get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=INDIRLTLT01STM", headers=UA, timeout=30)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text)).dropna()
        v = float(df.iloc[-1, 1])
        if 3 < v < 15:
            log(f"G-sec 10y: {v}% ({df.iloc[-1, 0]})")
            GSEC_INFO.update(source="FRED/OECD", asof=str(df.iloc[-1, 0]))
            return v
    except Exception as e:  # noqa: BLE001
        log("G-sec fetch failed, keeping", prev, e)
    return prev


# ---------------- prices + technicals ----------------
def rsi(close: pd.Series, n: int = 14) -> float | None:
    d = close.diff().dropna()
    if len(d) < n:
        return None
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = up.iloc[-1] / dn.iloc[-1] if dn.iloc[-1] else math.inf
    return round(100 - 100 / (1 + rs), 1)


def prices(symbols: list[str]) -> dict[str, dict]:
    out = {}
    for i in range(0, len(symbols), 100):
        chunk = symbols[i:i + 100]
        tick = [s + ".NS" for s in chunk]
        for attempt in range(3):
            try:
                df = yf.download(tick, period="1y", interval="1d", auto_adjust=True,
                                 progress=False, threads=True, group_by="ticker")
                break
            except Exception as e:  # noqa: BLE001
                log("price chunk failed, retrying", e)
                time.sleep(10 * (attempt + 1))
        else:
            continue
        for s, t in zip(chunk, tick):
            try:
                close = (df[t]["Close"] if len(tick) > 1 else df["Close"]).dropna()
            except KeyError:
                continue
            if len(close) < 5:
                continue
            out[s] = {
                "px": round(float(close.iloc[-1]), 2),
                "tech": {
                    "dma50": round(float(close.tail(50).mean()), 2) if len(close) >= 50 else None,
                    "dma200": round(float(close.tail(200).mean()), 2) if len(close) >= 200 else None,
                    "h52": round(float(close.max()), 2),
                    "l52": round(float(close.min()), 2),
                    "rsi": rsi(close),
                    "chg1d": round(float(close.iloc[-1] / close.iloc[-2] - 1) * 100, 2) if len(close) > 1 else None,
                },
            }
        log(f"prices {min(i + 100, len(symbols))}/{len(symbols)}")
        time.sleep(1)
    return out


# ---------------- fundamentals from Yahoo ----------------
_FX: dict[str, float] = {}


def fx_to_inr(cur: str) -> float | None:
    if cur not in _FX:
        try:
            h = yf.Ticker(f"{cur}INR=X").history(period="5d")["Close"].dropna()
            _FX[cur] = float(h.iloc[-1]) if len(h) else None
            log(f"FX {cur}→INR {_FX[cur]}")
        except Exception as e:  # noqa: BLE001
            log("FX failed", cur, e)
            _FX[cur] = None
    return _FX[cur]

def _row(df: pd.DataFrame, names: list[str]):
    if df is None or df.empty:
        return None
    for n in names:
        if n in df.index:
            return df.loc[n]
    return None


def _series(df, names, cols, scale=CR):
    r = _row(df, names)
    out = []
    for c in cols:
        v = r.get(c) if r is not None else None
        out.append(round(float(v) / scale, 2) if v is not None and pd.notna(v) else None)
    return out


def from_yahoo(sym: str) -> dict | None:
    t = yf.Ticker(sym + ".NS")
    inc, bal, cf = t.income_stmt, t.balance_sheet, t.cashflow
    if inc is None or inc.empty:
        return None
    cols = sorted(inc.columns)  # oldest → newest
    info = {}
    try:
        info = t.info or {}
    except Exception:  # noqa: BLE001
        pass
    # Some companies (e.g. Infosys) report in USD on Yahoo — convert everything to rupees
    cur = (info.get("financialCurrency") or "INR").upper()
    fx = 1.0
    if cur != "INR":
        fx = fx_to_inr(cur)
        if not fx:
            return None
    S = lambda df, names, scale=CR / fx: _series(df, names, cols, scale)  # noqa: E731

    # share count: info first, then the balance sheet / income statement
    sh = info.get("sharesOutstanding")
    if not sh:
        for df, names in ((bal, ["Ordinary Shares Number", "Share Issued"]),
                          (inc, ["Diluted Average Shares", "Basic Average Shares"])):
            r = _row(df, names)
            if r is not None:
                vals = [r.get(c) for c in cols if pd.notna(r.get(c))]
                if vals:
                    sh = float(vals[-1])
                    break

    sales = S(inc, ["Total Revenue", "Operating Revenue"])
    np_ = S(inc, ["Net Income Common Stockholders", "Net Income", "Net Income From Continuing Operation Net Minority Interest"])
    capex_raw = S(cf, ["Capital Expenditure"])
    div_raw = S(cf, ["Cash Dividends Paid", "Common Stock Dividend Paid"])
    eq = S(bal, ["Stockholders Equity", "Common Stock Equity"])
    cash = S(bal, ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"])
    sti = S(bal, ["Other Short Term Investments", "Short Term Investments"])
    lti = S(bal, ["Long Term Equity Investment", "Investments And Advances", "Investmentin Financial Assets"])
    inv = [((a or 0) + (b or 0)) if (a is not None or b is not None) else None for a, b in zip(sti, lti)]
    tot_liab = S(bal, ["Total Liabilities Net Minority Interest"])
    debt = S(bal, ["Total Debt"])
    ol = [(tl - (d or 0)) if tl is not None else None for tl, d in zip(tot_liab, debt)]

    # TTM from the last 4 quarters
    ttm = {}
    try:
        q = t.quarterly_income_stmt
        if q is not None and not q.empty:
            qc = sorted(q.columns)[-4:]
            if len(qc) == 4:
                for k, names in {"ttmNp": ["Net Income Common Stockholders", "Net Income"],
                                 "ttmSales": ["Total Revenue"], "ttmOi": ["Other Income", "Other Non Operating Income Expenses"]}.items():
                    r = _row(q, names)
                    if r is not None and all(pd.notna(r.get(c)) for c in qc):
                        ttm[k] = round(float(sum(r.get(c) for c in qc)) * fx / CR, 2)
    except Exception:  # noqa: BLE001
        pass

    # historic PE / PB at each fiscal year end
    pe, pb = [None] * len(cols), [None] * len(cols)
    try:
        h = t.history(period="10y", interval="1mo", auto_adjust=False)["Close"]
        h.index = h.index.tz_localize(None)
        for j, c in enumerate(cols):
            near = h[h.index <= pd.Timestamp(c) + pd.Timedelta(days=5)]
            if len(near) and sh:
                mcap = float(near.iloc[-1]) * sh / CR
                if np_[j] and np_[j] > 0:
                    pe[j] = round(mcap / np_[j], 2)
                if eq[j] and eq[j] > 0:
                    pb[j] = round(mcap / eq[j], 2)
    except Exception:  # noqa: BLE001
        pass

    return {
        "s": sym, "n": info.get("longName") or info.get("shortName") or sym,
        "sec": info.get("sector"), "ind": info.get("industry"),
        "sh": round(sh / CR, 4) if sh else None,
        "y": [c.year for c in cols],
        "sales": sales,
        "ebitda": S(inc, ["EBITDA", "Normalized EBITDA"]),
        "oi": S(inc, ["Other Income", "Other Non Operating Income Expenses"]),
        "dep": S(inc, ["Reconciled Depreciation", "Depreciation And Amortization In Income Statement"]),
        "int": S(inc, ["Interest Expense", "Interest Expense Non Operating"]),
        "pbt": S(inc, ["Pretax Income"]),
        "tax": S(inc, ["Tax Provision"]),
        "np": np_,
        "div": [abs(v) if v is not None else None for v in div_raw],
        "eq": eq, "debt": debt, "ol": ol, "cash": cash, "inv": inv,
        "rec": S(bal, ["Accounts Receivable", "Receivables"]),
        "invt": S(bal, ["Inventory"]),
        "nb": S(bal, ["Net PPE"]),
        "cfo": S(cf, ["Operating Cash Flow"]),
        "capex": [abs(v) if v is not None else None for v in capex_raw],
        "pe": pe, "pb": pb, **ttm, "src": "yahoo", "cur": cur,
    }


# ---------------- Screener exports (your watchlist, richer 10-yr data) ----------------
def _norm(name: str) -> str:
    name = re.sub(r"\b(limited|ltd|the|india|co|corporation|corp)\b", "", str(name).lower())
    return re.sub(r"[^a-z0-9]", "", name)


def screener_overrides(uni: pd.DataFrame) -> dict[str, dict]:
    by_name = {_norm(n): s for s, n in zip(uni["SYMBOL"], uni["NAME OF COMPANY"])}
    out = {}
    for f in sorted(EXPORTS.glob("*.xls*")):
        try:
            c = screener_export.parse(f)
        except Exception as e:  # noqa: BLE001
            log("could not read", f.name, e)
            continue
        sym = by_name.get(_norm(c["n"])) or f.stem.upper()
        c["s"] = sym
        out[sym] = c
        log(f"screener export: {f.name} → {sym}")
    return out


# ---------------- main ----------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="refresh fundamentals for every stock")
    ap.add_argument("--refresh", type=int, default=250, help="stocks to refresh per run")
    ap.add_argument("--limit", type=int, default=0, help="only process the first N stocks (testing)")
    a = ap.parse_args()

    FUND_DIR.mkdir(parents=True, exist_ok=True)
    meta = json.loads(META_CACHE.read_text()) if META_CACHE.exists() else {"gsec": 7.45}
    uni = universe()
    if a.limit:
        uni = uni.head(a.limit)
    symbols = list(uni["SYMBOL"])
    names = dict(zip(uni["SYMBOL"], uni["NAME OF COMPANY"]))

    meta["gsec"] = gsec_yield(meta.get("gsec", 7.45))

    # rolling fundamentals refresh: missing first, then the oldest
    def age(s):
        p = FUND_DIR / f"{s}.json"
        return json.loads(p.read_text()).get("fetched", "0000") if p.exists() else ""
    todo = sorted(symbols, key=age)
    cached = sum(1 for s in symbols if (FUND_DIR / f"{s}.json").exists())
    if cached < 0.5 * len(symbols):
        log(f"only {cached} cached — doing a full refresh")
        a.full = True
    if not a.full:
        todo = todo[:a.refresh]
    ok = 0
    for i, s in enumerate(todo, 1):
        try:
            c = from_yahoo(s)
            if c:
                c["fetched"] = date.today().isoformat()
                (FUND_DIR / f"{s}.json").write_text(json.dumps(c, separators=(",", ":")))
                ok += 1
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if "Rate" in msg or "429" in msg:
                log("rate limited — pausing 60s")
                time.sleep(60)
        if i % 25 == 0:
            log(f"fundamentals {i}/{len(todo)} ({ok} ok)")
        time.sleep(0.6)

    px = prices(symbols)
    overrides = screener_overrides(uni)

    companies = []
    for s in symbols:
        p = FUND_DIR / f"{s}.json"
        c = overrides.get(s) or (json.loads(p.read_text()) if p.exists() else None)
        if not c:
            continue
        c["s"] = s
        c["n"] = c.get("n") or names.get(s, s)
        if s in overrides and p.exists():  # keep Yahoo's sector labels for Screener-sourced data
            y = json.loads(p.read_text())
            c["sec"], c["ind"] = y.get("sec"), y.get("ind")
        if s in px:
            c.update(px[s])
        if not c.get("px") or not c.get("sh"):
            continue
        companies.append(c)

    meta.update({
        "date": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "count": len(companies), "universe": len(symbols), "gsecInfo": GSEC_INFO,
        "watchlist": sorted(overrides),
    })
    META_CACHE.write_text(json.dumps(meta, indent=1))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"meta": meta, "companies": companies}, separators=(",", ":")))
    log(f"wrote {len(companies)} companies → {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
