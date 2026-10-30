"""One-off probe: can GitHub Actions fetch official NSE/BSE filings, and are they accurate?

Runs on GitHub (NSE isn't reachable from every network). Writes probe/results.json and
probe/report.md describing, for a few test companies:
  - whether NSE and BSE answered (HTTP status per endpoint)
  - how many years of annual results are listed
  - key numbers parsed from the official XBRL filings (revenue, profit, net worth)
  - promoter holding and pledge from the latest shareholding pattern
"""
from __future__ import annotations

import json
import time
import traceback
from datetime import date
from pathlib import Path

import requests

OUT = Path(__file__).resolve().parents[1] / "probe"
OUT.mkdir(exist_ok=True)
TESTS = ["HDFCBANK", "INFY", "COALINDIA"]
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
NSE = "https://www.nseindia.com"
log_lines: list[str] = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    log_lines.append(s)


class NSESession:
    """Gets NSE's anti-bot cookies by visiting the homepage first (same approach as nselib)."""

    def __init__(self):
        self.s = requests.Session()
        self.s.headers.update({"user-agent": UA, "accept": "*/*", "accept-language": "en-US,en;q=0.9"})
        self.seed()

    def seed(self):
        for path in ("/", "/companies-listing/corporate-filings-financial-results"):
            try:
                r = self.s.get(NSE + path, timeout=20)
                log(f"  seed {path}: HTTP {r.status_code}, cookies={len(self.s.cookies)}")
            except Exception as e:  # noqa: BLE001
                log(f"  seed {path}: {type(e).__name__} {e}")
            time.sleep(1)

    def api(self, endpoint: str, params: dict, referer: str):
        url = f"{NSE}/api/{endpoint}"
        for attempt in range(3):
            try:
                r = self.s.get(url, params=params, timeout=30, headers={"referer": NSE + referer})
                status = r.status_code
                if status == 200:
                    try:
                        return status, r.json()
                    except ValueError:
                        return status, {"_raw": r.text[:300]}
                log(f"  {endpoint} attempt {attempt + 1}: HTTP {status}")
                self.seed()
            except Exception as e:  # noqa: BLE001
                status = f"{type(e).__name__}"
                log(f"  {endpoint} attempt {attempt + 1}: {e}")
            time.sleep(2)
        return status, None

    def file(self, url: str):
        try:
            r = self.s.get(url, timeout=60, headers={"referer": NSE + "/"})
            return r.status_code, (r.content if r.status_code == 200 else None)
        except Exception as e:  # noqa: BLE001
            return type(e).__name__, None


def parse_results_xbrl(blob: bytes) -> dict:
    from nse_xbrl_parser import XBRL
    from nse_xbrl_parser.typed.financial_results import FinancialResultsModel

    pf = XBRL.parse_sync(blob)
    m = FinancialResultsModel.from_instance(pf.raw_instance)
    d = m.model_dump(mode="json")
    d["format"] = str(getattr(pf, "format", ""))
    return d


def parse_shareholding_xbrl(blob: bytes) -> dict:
    from nse_xbrl_parser import XBRL
    from nse_xbrl_parser.typed.shareholding import ShareholdingPatternModel

    pf = XBRL.parse_sync(blob)
    m = ShareholdingPatternModel.from_instance(pf.raw_instance)
    d = m.model_dump(mode="json")
    d.pop("categories", None)
    return d


def cr(x):
    return None if x is None else round(float(x) / 1e7, 1)


def probe_symbol(nse: NSESession, sym: str) -> dict:
    out: dict = {"symbol": sym}

    # 1) Annual financial results listing (older Reg-33 format, goes back many years)
    st, js = nse.api("corporates-financial-results",
                     {"index": "equities", "symbol": sym, "period": "Annual"},
                     "/companies-listing/corporate-filings-financial-results")
    rows = js if isinstance(js, list) else (js or {}).get("data", []) if isinstance(js, dict) else []
    if not rows:  # some NSE endpoints need an explicit date range
        st, js = nse.api("corporates-financial-results",
                         {"index": "equities", "symbol": sym, "period": "Annual",
                          "from_date": "01-01-2012", "to_date": date.today().strftime("%d-%m-%Y")},
                         "/companies-listing/corporate-filings-financial-results")
        rows = js if isinstance(js, list) else (js or {}).get("data", []) if isinstance(js, dict) else []
    out["annual_listing_status"] = st
    out["annual_listing_count"] = len(rows)
    if rows:
        out["annual_listing_keys"] = sorted(rows[0].keys())
        out["annual_periods"] = sorted({str(r.get("toDate") or r.get("to_date") or r.get("period") or "") for r in rows})

    # Parse up to 3 most recent annual filings (one consolidated + one standalone if present)
    parsed = []
    for r in rows[:6]:
        url = r.get("xbrl") or r.get("xbrlFile")
        if not url or not str(url).startswith("http"):
            continue
        fst, blob = nse.file(url)
        entry = {"url": url, "http": fst, "consolidated": r.get("consolidated"), "audited": r.get("audited"),
                 "to_date": r.get("toDate")}
        if blob:
            samples = OUT / "samples"; samples.mkdir(exist_ok=True)
            if not any(samples.glob(f"{sym}_*.xml")):
                (samples / f"{sym}_{r.get('toDate', 'latest')}.xml".replace(" ", "")).write_bytes(blob[:400_000])
            try:
                d = parse_results_xbrl(blob)
                entry.update({
                    "format": d.get("format"), "nature": d.get("nature_of_report"),
                    "period": f'{d.get("period_start_date")}..{d.get("period_end_date")}',
                    "revenue_cr": cr(d.get("revenue_from_operations")), "other_income_cr": cr(d.get("other_income")),
                    "pbt_cr": cr(d.get("profit_before_tax")), "pat_cr": cr(d.get("profit_after_tax")),
                    "net_worth_cr": cr(d.get("net_worth")), "paid_up_cr": cr(d.get("paid_up_equity_capital")),
                    "face_value": d.get("face_value"), "eps": d.get("basic_eps"), "facts": d.get("raw_facts_count"),
                })
            except Exception as e:  # noqa: BLE001
                entry["parse_error"] = f"{type(e).__name__}: {e}"
                entry["trace"] = traceback.format_exc()[-600:]
        parsed.append(entry)
        time.sleep(1)
        if len([p for p in parsed if "pat_cr" in p]) >= 3:
            break
    out["annual_parsed"] = parsed

    # 2) Integrated filings (new 2024+ format)
    st, js = nse.api("integrated-filing-results",
                     {"index": "equities", "symbol": sym, "period_ended": "all",
                      "type": "Integrated Filing- Financials", "page": 1, "size": 20},
                     "/companies-listing/corporate-integrated-filing")
    data = (js or {}).get("data", []) if isinstance(js, dict) else []
    out["integrated_status"] = st
    out["integrated_count"] = len(data)

    # 3) Shareholding pattern (promoter holding, pledge)
    st, js = nse.api("corporate-share-holdings-master", {"index": "equities", "symbol": sym},
                     "/companies-listing/corporate-filings-shareholding-pattern")
    shp = js if isinstance(js, list) else []
    out["shareholding_status"] = st
    out["shareholding_count"] = len(shp)
    if shp:
        latest = shp[0]
        out["shareholding_latest_keys"] = sorted(latest.keys())
        out["shareholding_latest_summary"] = {k: latest.get(k) for k in ("date", "pr_and_prgrp", "public_val", "submissionDate") if k in latest}
        url = latest.get("xbrl")
        if url:
            fst, blob = nse.file(url)
            out["shareholding_xbrl_http"] = fst
            if blob:
                try:
                    out["shareholding_parsed"] = parse_shareholding_xbrl(blob)
                except Exception as e:  # noqa: BLE001
                    out["shareholding_parse_error"] = f"{type(e).__name__}: {e}"
    return out


def probe_bse(sym: str) -> dict:
    out: dict = {}
    try:
        from bse import BSE
        with BSE(download_folder=str(OUT)) as b:
            code = b.getScripCode(sym)
            out["scrip_code"] = code
            snap = b.resultsSnapshot(code)
            out["periods"] = snap.get("periods")
            out["rows"] = snap.get("results_in_crores", {}).get("data", [])[:12]
    except Exception as e:  # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {e}"
    return out


def main():
    started = time.time()
    results = {"date": date.today().isoformat(), "companies": {}, "bse": {}}
    log("== NSE session")
    nse = NSESession()
    for sym in TESTS:
        log(f"== {sym}")
        try:
            results["companies"][sym] = probe_symbol(nse, sym)
        except Exception as e:  # noqa: BLE001
            results["companies"][sym] = {"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-800:]}
        log(f"== BSE {sym}")
        results["bse"][sym] = probe_bse(sym)
        time.sleep(2)
    results["seconds"] = round(time.time() - started)
    (OUT / "results.json").write_text(json.dumps(results, indent=1, default=str))
    (OUT / "log.txt").write_text("\n".join(log_lines))
    log(f"done in {results['seconds']}s")


if __name__ == "__main__":
    main()
