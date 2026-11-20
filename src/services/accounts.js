import { getDb, withTransaction } from '../db/pool.js';
import { postTransaction } from './ledger.js';
import { newId, nowIso } from '../utils/ids.js';
import { assertPositiveCents } from '../utils/money.js';
import { writeAudit } from './audit.js';

export function listAccountsForUser(userId) {
  return getDb()
    .prepare(
      `SELECT a.*,
        COALESCE((
          SELECT SUM(ga.amount_cents)
          FROM goal_allocations ga
          JOIN savings_goals g ON g.id = ga.goal_id
          WHERE ga.account_id = a.id AND g.status = 'active'
        ), 0) AS earmarked_cents
       FROM accounts a
       WHERE a.user_id = ? AND a.status = 'active'
       ORDER BY CASE a.type WHEN 'chequing' THEN 1 WHEN 'savings' THEN 2 ELSE 3 END`
    )
    .all(userId)
    .map((a) => ({
      ...a,
      available_cents: a.balance_cents - a.earmarked_cents,
    }));
}

export function getAccount(accountId) {
  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
}

export function assertAccountOwnedBy(accountId, userId) {
  const account = getAccount(accountId);
  if (!account || account.user_id !== userId) {
    throw new Error('Account not found');
  }
  return account;
}

export function createChildAccounts(userId) {
  const db = getDb();
  const now = nowIso();
  const defs = [
    { type: 'chequing', name: 'Chequing' },
    { type: 'savings', name: 'Savings' },
    { type: 'investment_cash', name: 'Investment Cash' },
  ];
  const insert = db.prepare(`
    INSERT INTO accounts (id, user_id, type, name, currency, balance_cents, status, created_at)
    VALUES (?, ?, ?, ?, 'CAD', 0, 'active', ?)
  `);
  for (const def of defs) {
    insert.run(newId(), userId, def.type, def.name, now);
  }
}

export function transferBetweenAccounts({
  userId,
  fromAccountId,
  toAccountId,
  amountCents,
  description,
  idempotencyKey,
  actorUserId,
  ip,
}) {
  assertPositiveCents(amountCents);
  const from = assertAccountOwnedBy(fromAccountId, userId);
  const to = assertAccountOwnedBy(toAccountId, userId);
  if (from.id === to.id) throw new Error('Cannot transfer to the same account');

  const result = postTransaction({
    type: 'transfer',
    description: description || `Transfer ${from.name} → ${to.name}`,
    initiatedBy: actorUserId || userId,
    idempotencyKey,
    lines: [
      { accountId: to.id, direction: 'debit', amountCents },
      { accountId: from.id, direction: 'credit', amountCents },
    ],
  });

  writeAudit({
    actorUserId: actorUserId || userId,
    action: 'transfer',
    entityType: 'transaction',
    entityId: result.transaction.id,
    after: { fromAccountId, toAccountId, amountCents },
    ip,
  });

  return result;
}

export function setOpeningBalance({ accountId, amountCents, parentUserId, idempotencyKey, ip }) {
  assertPositiveCents(amountCents);
  const account = getAccount(accountId);
  if (!account) throw new Error('Account not found');
  if (account.balance_cents !== 0) throw new Error('Opening balance only allowed on zero-balance accounts');

  const result = postTransaction({
    type: 'opening_balance',
    description: `Opening balance for ${account.name}`,
    initiatedBy: parentUserId,
    approvedBy: parentUserId,
    idempotencyKey,
    lines: [
      { accountId: account.id, direction: 'debit', amountCents },
      { systemAccount: 'equity_opening', direction: 'credit', amountCents },
    ],
  });

  writeAudit({
    actorUserId: parentUserId,
    action: 'opening_balance',
    entityType: 'account',
    entityId: accountId,
    after: { amountCents },
    ip,
  });

  return result;
}

export function reconcileAccountBalances() {
  const db = getDb();
  const accounts = db.prepare('SELECT id, balance_cents FROM accounts').all();
  const mismatches = [];
  for (const account of accounts) {
    const derived = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE 0 END), 0) AS bal
         FROM ledger_entries le
         JOIN transactions t ON t.id = le.transaction_id
         WHERE le.account_id = ? AND t.status IN ('posted', 'reversed')`
      )
      .get(account.id).bal;
    // Reversed originals still have entries; use only posted non-reversed? Plan says posted.
    // Better: sum only entries belonging to status=posted transactions.
    const posted = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE 0 END), 0) AS bal
         FROM ledger_entries le
         JOIN transactions t ON t.id = le.transaction_id
         WHERE le.account_id = ? AND t.status = 'posted'`
      )
      .get(account.id).bal;
    if (posted !== account.balance_cents) {
      mismatches.push({
        accountId: account.id,
        cached: account.balance_cents,
        ledger: posted,
        ignoredDerived: derived,
      });
    }
  }
  return mismatches;
}

export function ensureChildStructure(userId) {
  withTransaction(() => {
    const existing = getDb()
      .prepare('SELECT type FROM accounts WHERE user_id = ?')
      .all(userId)
      .map((r) => r.type);
    if (existing.length === 0) createChildAccounts(userId);
  });
}
