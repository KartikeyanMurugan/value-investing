// Settings for everyone using this copy of the dashboard.

// Stocks that should never show a buy signal, with a reason. Anything here is public if your repo is public,
// so for personal restrictions (e.g. your employer) use the "Mark as restricted" button in the dashboard
// instead — that is saved only in your browser.
// Example: export const RESTRICTED = { INFY: 'Reason shown on the stock' };
export const RESTRICTED = {};

// Fraction of quality checks a stock must pass to appear in "Today's picks"
export const MIN_QUALITY = 0.8;

// Smaller companies are excluded from "Today's picks" (still visible under All stocks):
// their data is less reliable and shares are harder to trade. Market cap in ₹ crore.
export const MIN_MCAP_CR = 500;
