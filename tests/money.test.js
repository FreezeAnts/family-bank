import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyInterestCents, formatCad, parseCadToCents } from '../src/utils/money.js';

test('parse and format CAD cents', () => {
  assert.equal(parseCadToCents('12.34'), 1234);
  assert.equal(formatCad(1234), '$12.34');
});

test('ACT/365 Fixed floors daily interest', () => {
  // 10000 cents @ 3% = 300 bps => floor(10000*300/(10000*365)) = floor(3000000/3650000)=floor(0.821)=0
  assert.equal(dailyInterestCents(10000, 300), 0);
  // Larger balance: $10,000.00 = 1_000_000 cents
  assert.equal(dailyInterestCents(1_000_000, 300), Math.floor((1_000_000 * 300) / (10000 * 365)));
});

test('leap day still uses 365 divisor convention', () => {
  const leapDayBalance = 500_000;
  const rate = 300;
  assert.equal(dailyInterestCents(leapDayBalance, rate), Math.floor((leapDayBalance * rate) / (10000 * 365)));
});
