import { getDb, withTransaction } from '../db/pool.js';
import { newId, nowIso } from '../utils/ids.js';
import { assertPositiveCents } from '../utils/money.js';

/**
 * @typedef {{ accountId?: string, systemAccount?: string, direction: 'debit'|'credit', amountCents: number }} LedgerLine
 */

function validateBalanced(lines) {
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    assertPositiveCents(line.amountCents);
    if (Boolean(line.accountId) === Boolean(line.systemAccount)) {
      throw new Error('Each ledger line needs exactly one of accountId or systemAccount');
    }
    if (line.direction === 'debit') debit += line.amountCents;
    else if (line.direction === 'credit') credit += line.amountCents;
    else throw new Error('Invalid ledger direction');
  }
  if (debit !== credit) {
    throw new Error(`Unbalanced transaction: debit ${debit} != credit ${credit}`);
  }
}

function applyBalanceDeltas(db, lines) {
  const getAccount = db.prepare('SELECT id, balance_cents, status FROM accounts WHERE id = ?');
  const updateAccount = db.prepare('UPDATE accounts SET balance_cents = ? WHERE id = ?');

  for (const line of lines) {
    if (!line.accountId) continue;
    const account = getAccount.get(line.accountId);
    if (!account) throw new Error('Account not found');
    if (account.status !== 'active') throw new Error('Account is not active');

    // Asset accounts: debit increases, credit decreases
    const delta = line.direction === 'debit' ? line.amountCents : -line.amountCents;
    const next = account.balance_cents + delta;
    if (next < 0) {
      throw new Error('Insufficient funds');
    }
    updateAccount.run(next, account.id);
  }
}

/**
 * Post a balanced double-entry transaction atomically.
 * Idempotent via idempotencyKey.
 */
export function postTransaction({
  type,
  description,
  initiatedBy,
  approvedBy = null,
  referenceId = null,
  relatedRequestId = null,
  idempotencyKey,
  lines,
  metadata = null,
  requireSufficientFunds = true,
}) {
  if (!idempotencyKey) throw new Error('idempotencyKey required');
  validateBalanced(lines);

  return withTransaction(() => {
    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM transactions WHERE idempotency_key = ?')
      .get(idempotencyKey);
    if (existing) {
      const existingLines = db
        .prepare('SELECT * FROM ledger_entries WHERE transaction_id = ?')
        .all(existing.id);
      return { transaction: existing, lines: existingLines, replayed: true };
    }

    if (requireSufficientFunds) {
      // Pre-check asset credits (outflows) against current balances
      const getAccount = db.prepare('SELECT balance_cents FROM accounts WHERE id = ?');
      const needed = new Map();
      for (const line of lines) {
        if (!line.accountId || line.direction !== 'credit') continue;
        needed.set(line.accountId, (needed.get(line.accountId) || 0) + line.amountCents);
      }
      for (const [accountId, amount] of needed) {
        const row = getAccount.get(accountId);
        if (!row || row.balance_cents < amount) {
          throw new Error('Insufficient funds');
        }
      }
    }

    const now = nowIso();
    const txnId = newId();
    db.prepare(`
      INSERT INTO transactions
        (id, type, description, status, initiated_by, approved_by, reference_id,
         idempotency_key, related_request_id, posted_at, created_at, metadata_json)
      VALUES (?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      txnId,
      type,
      description,
      initiatedBy,
      approvedBy,
      referenceId,
      idempotencyKey,
      relatedRequestId,
      now,
      now,
      metadata ? JSON.stringify(metadata) : null
    );

    const insertLine = db.prepare(`
      INSERT INTO ledger_entries
        (id, transaction_id, account_id, system_account, direction, amount_cents, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    applyBalanceDeltas(db, lines);

    const savedLines = [];
    for (const line of lines) {
      const id = newId();
      insertLine.run(
        id,
        txnId,
        line.accountId || null,
        line.systemAccount || null,
        line.direction,
        line.amountCents,
        now
      );
      savedLines.push({
        id,
        transaction_id: txnId,
        account_id: line.accountId || null,
        system_account: line.systemAccount || null,
        direction: line.direction,
        amount_cents: line.amountCents,
      });
    }

    const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txnId);
    return { transaction, lines: savedLines, replayed: false };
  });
}

export function reverseTransaction(originalTxnId, initiatedBy, reason) {
  return withTransaction(() => {
    const db = getDb();
    const original = db.prepare('SELECT * FROM transactions WHERE id = ?').get(originalTxnId);
    if (!original || original.status !== 'posted') {
      throw new Error('Posted transaction not found');
    }
    const lines = db
      .prepare('SELECT * FROM ledger_entries WHERE transaction_id = ?')
      .all(originalTxnId);

    const reversedLines = lines.map((line) => ({
      accountId: line.account_id || undefined,
      systemAccount: line.system_account || undefined,
      direction: line.direction === 'debit' ? 'credit' : 'debit',
      amountCents: line.amount_cents,
    }));

    const result = postTransaction({
      type: 'reversal',
      description: reason || `Reversal of ${originalTxnId}`,
      initiatedBy,
      approvedBy: initiatedBy,
      referenceId: originalTxnId,
      idempotencyKey: `reversal:${originalTxnId}`,
      lines: reversedLines,
      metadata: { reverses: originalTxnId },
    });

    db.prepare(`UPDATE transactions SET status = 'reversed' WHERE id = ?`).run(originalTxnId);
    return result;
  });
}

export function ledgerBalanceForAccount(accountId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE 0 END), 0) AS debits,
         COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE 0 END), 0) AS credits
       FROM ledger_entries le
       JOIN transactions t ON t.id = le.transaction_id
       WHERE le.account_id = ? AND t.status = 'posted'`
    )
    .get(accountId);
  return row.debits - row.credits;
}

export function listTransactionsForAccount(accountId, limit = 50) {
  return getDb()
    .prepare(
      `SELECT t.*, le.direction, le.amount_cents
       FROM ledger_entries le
       JOIN transactions t ON t.id = le.transaction_id
       WHERE le.account_id = ?
       ORDER BY t.created_at DESC
       LIMIT ?`
    )
    .all(accountId, limit);
}
