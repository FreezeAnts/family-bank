import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'family-bank-'));
const dbPath = path.join(tmpDir, 'test.sqlite');
process.env.DATABASE_PATH = dbPath;
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-chars!!';
process.env.NODE_ENV = 'test';
process.env.PARENT_EMAIL = 'parent@example.com';
process.env.CHILD_EMAIL = 'child@example.com';
process.env.DEV_AUTH_ENABLED = 'false';

const { migrate } = await import('../src/db/migrate.js');
const { seed } = await import('../src/db/seed.js');
const { getDb } = await import('../src/db/pool.js');
const { postTransaction } = await import('../src/services/ledger.js');
const { approveDeposit, createDepositRequest } = await import('../src/services/deposits.js');
const { createWithdrawalRequest, approveWithdrawal } = await import('../src/services/withdrawals.js');
const { transferBetweenAccounts } = await import('../src/services/accounts.js');
const { allocateToGoal, createGoal } = await import('../src/services/goals.js');
const { dailyInterestCents } = await import('../src/utils/money.js');
const { accrueDailyInterest, creditMonthlyInterest } = await import('../src/services/interest.js');

migrate();
seed();

const db = getDb();
const parent = db.prepare(`SELECT * FROM users WHERE role='parent'`).get();
const child = db.prepare(`SELECT * FROM users WHERE role='child'`).get();
const chequing = db.prepare(`SELECT * FROM accounts WHERE user_id=? AND type='chequing'`).get(child.id);
const savings = db.prepare(`SELECT * FROM accounts WHERE user_id=? AND type='savings'`).get(child.id);

test('deposit approval credits child balance via ledger', () => {
  const req = createDepositRequest({
    childUserId: child.id,
    accountId: chequing.id,
    amountCents: 2000,
    note: 'test cash',
    idempotencyKey: 'dep-1',
  });
  approveDeposit({ requestId: req.id, parentUserId: parent.id });
  const updated = db.prepare('SELECT balance_cents FROM accounts WHERE id=?').get(chequing.id);
  assert.equal(updated.balance_cents, 2000);
});

test('idempotent deposit approve replays', () => {
  const before = db.prepare('SELECT balance_cents FROM accounts WHERE id=?').get(chequing.id).balance_cents;
  const req = db.prepare(`SELECT * FROM deposit_requests WHERE child_user_id=? ORDER BY created_at DESC`).get(child.id);
  const again = approveDeposit({ requestId: req.id, parentUserId: parent.id });
  assert.equal(again.status, 'approved');
  const after = db.prepare('SELECT balance_cents FROM accounts WHERE id=?').get(chequing.id).balance_cents;
  assert.equal(after, before);
});

test('transfer moves funds and withdrawal enforces sufficiency', () => {
  transferBetweenAccounts({
    userId: child.id,
    fromAccountId: chequing.id,
    toAccountId: savings.id,
    amountCents: 500,
    idempotencyKey: 'xfer-1',
  });
  assert.equal(db.prepare('SELECT balance_cents FROM accounts WHERE id=?').get(savings.id).balance_cents, 500);

  assert.throws(() => {
    createWithdrawalRequest({
      childUserId: child.id,
      accountId: chequing.id,
      amountCents: 999999,
      note: 'too much',
      idempotencyKey: 'wd-bad',
    });
  }, /Insufficient funds/);

  const wd = createWithdrawalRequest({
    childUserId: child.id,
    accountId: chequing.id,
    amountCents: 300,
    note: 'ok',
    idempotencyKey: 'wd-1',
  });
  approveWithdrawal({ requestId: wd.id, parentUserId: parent.id });
  assert.equal(db.prepare('SELECT balance_cents FROM accounts WHERE id=?').get(chequing.id).balance_cents, 1200);
});

test('goal allocation cannot exceed balance', () => {
  const goal = createGoal({ userId: child.id, name: 'Bike', targetCents: 10000 });
  assert.throws(() => {
    allocateToGoal({
      userId: child.id,
      goalId: goal.id,
      accountId: savings.id,
      amountCents: 999999,
    });
  }, /exceeds available/);
  allocateToGoal({
    userId: child.id,
    goalId: goal.id,
    accountId: savings.id,
    amountCents: 100,
  });
  const bal = db.prepare('SELECT balance_cents FROM accounts WHERE id=?').get(savings.id).balance_cents;
  assert.equal(bal, 500);
});

test('unbalanced ledger rejected', () => {
  assert.throws(() => {
    postTransaction({
      type: 'transfer',
      description: 'bad',
      initiatedBy: parent.id,
      idempotencyKey: 'bad-1',
      lines: [{ accountId: chequing.id, direction: 'debit', amountCents: 10 }],
    });
  }, /Unbalanced/);
});

test('interest accrual and monthly credit', () => {
  // Boost savings for visible interest
  postTransaction({
    type: 'bonus',
    description: 'test boost',
    initiatedBy: parent.id,
    approvedBy: parent.id,
    idempotencyKey: 'boost-1',
    lines: [
      { accountId: savings.id, direction: 'debit', amountCents: 1_000_000 },
      { systemAccount: 'income_bonus', direction: 'credit', amountCents: 1_000_000 },
    ],
  });
  const date = '2024-02-29';
  const accrued = accrueDailyInterest(date);
  assert.equal(accrued.businessDate, date);
  const row = db
    .prepare('SELECT * FROM interest_daily_accrual WHERE account_id=? AND business_date=?')
    .get(savings.id, date);
  assert.equal(row.accrual_cents, dailyInterestCents(row.closing_balance_cents, row.rate_bps));

  const credited = creditMonthlyInterest({ year: 2024, month: 2, systemUserId: parent.id });
  assert.ok(credited.credits.length >= 1);
});
