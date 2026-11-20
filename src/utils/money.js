/** All money is integer CAD cents. */

export function assertPositiveCents(amountCents) {
  const n = Number(amountCents);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('Amount must be a positive integer number of cents');
  }
  return n;
}

export function assertNonNegativeCents(amountCents) {
  const n = Number(amountCents);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('Amount must be a non-negative integer number of cents');
  }
  return n;
}

export function formatCad(cents) {
  const value = Number(cents) / 100;
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(value);
}

/**
 * ACT/365 Fixed daily interest accrual, floored toward zero.
 * rate_bps: 300 = 3.00%
 */
export function dailyInterestCents(closingBalanceCents, rateBps) {
  const balance = Number(closingBalanceCents);
  const rate = Number(rateBps);
  if (!Number.isInteger(balance) || balance <= 0 || !Number.isInteger(rate) || rate < 0) {
    return 0;
  }
  return Math.floor((balance * rate) / (10000 * 365));
}

export function parseCadToCents(input) {
  if (typeof input === 'number') {
    return Math.round(input * 100);
  }
  const cleaned = String(input).replace(/[^0-9.-]/g, '');
  if (!cleaned) throw new Error('Invalid amount');
  const num = Number(cleaned);
  if (!Number.isFinite(num)) throw new Error('Invalid amount');
  return Math.round(num * 100);
}
