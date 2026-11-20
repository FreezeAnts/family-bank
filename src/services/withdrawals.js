import { getDb, withTransaction } from '../db/pool.js';
import { assertAccountOwnedBy, getAccount } from './accounts.js';
import { postTransaction } from './ledger.js';
import { writeAudit } from './audit.js';
import { newId, nowIso } from '../utils/ids.js';
import { assertPositiveCents } from '../utils/money.js';

export function createWithdrawalRequest({ childUserId, accountId, amountCents, note, idempotencyKey }) {
  assertPositiveCents(amountCents);
  const account = assertAccountOwnedBy(accountId, childUserId);
  if (account.balance_cents < amountCents) throw new Error('Insufficient funds');

  const db = getDb();
  const existing = db
    .prepare(
      `SELECT * FROM withdrawal_requests
       WHERE child_user_id = ? AND status = 'pending' AND child_note = ? AND amount_cents = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(childUserId, `idem:${idempotencyKey}`, amountCents);
  if (existing) return existing;

  const now = nowIso();
  const id = newId();
  db.prepare(`
    INSERT INTO withdrawal_requests
      (id, child_user_id, account_id, amount_cents, status, child_note, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(id, childUserId, accountId, amountCents, note ? note : `idem:${idempotencyKey}`, now, now);

  writeAudit({
    actorUserId: childUserId,
    action: 'withdrawal_request_create',
    entityType: 'withdrawal_request',
    entityId: id,
    after: { amountCents, accountId },
  });

  return db.prepare('SELECT * FROM withdrawal_requests WHERE id = ?').get(id);
}

export function listWithdrawalRequests({ childUserId = null, status = null } = {}) {
  const db = getDb();
  if (childUserId) {
    return db
      .prepare('SELECT * FROM withdrawal_requests WHERE child_user_id = ? ORDER BY created_at DESC')
      .all(childUserId);
  }
  if (status) {
    return db
      .prepare(
        `SELECT w.*, u.display_name AS child_name, a.name AS account_name
         FROM withdrawal_requests w
         JOIN users u ON u.id = w.child_user_id
         JOIN accounts a ON a.id = w.account_id
         WHERE w.status = ?
         ORDER BY w.created_at ASC`
      )
      .all(status);
  }
  return db
    .prepare(
      `SELECT w.*, u.display_name AS child_name, a.name AS account_name
       FROM withdrawal_requests w
       JOIN users u ON u.id = w.child_user_id
       JOIN accounts a ON a.id = w.account_id
       ORDER BY w.created_at DESC
       LIMIT 100`
    )
    .all();
}

export function approveWithdrawal({ requestId, parentUserId, parentNote, ip }) {
  return withTransaction(() => {
    const db = getDb();
    const req = db.prepare('SELECT * FROM withdrawal_requests WHERE id = ?').get(requestId);
    if (!req || req.status !== 'pending') throw new Error('Pending withdrawal request not found');

    const account = getAccount(req.account_id);
    if (!account || account.balance_cents < req.amount_cents) {
      throw new Error('Insufficient funds');
    }

    const result = postTransaction({
      type: 'withdrawal_approve',
      description: parentNote || `Withdrawal approved ${req.amount_cents} cents`,
      initiatedBy: req.child_user_id,
      approvedBy: parentUserId,
      relatedRequestId: req.id,
      idempotencyKey: `withdrawal_approve:${req.id}`,
      lines: [
        { accountId: req.account_id, direction: 'credit', amountCents: req.amount_cents },
        { systemAccount: 'cash_out_to_child', direction: 'debit', amountCents: req.amount_cents },
      ],
    });

    const now = nowIso();
    db.prepare(`
      UPDATE withdrawal_requests
      SET status = 'approved', parent_note = ?, transaction_id = ?, updated_at = ?
      WHERE id = ?
    `).run(parentNote || null, result.transaction.id, now, req.id);

    writeAudit({
      actorUserId: parentUserId,
      action: 'withdrawal_approve',
      entityType: 'withdrawal_request',
      entityId: req.id,
      after: { transactionId: result.transaction.id },
      ip,
    });

    return db.prepare('SELECT * FROM withdrawal_requests WHERE id = ?').get(req.id);
  });
}

export function rejectWithdrawal({ requestId, parentUserId, parentNote, ip }) {
  const db = getDb();
  const req = db.prepare('SELECT * FROM withdrawal_requests WHERE id = ?').get(requestId);
  if (!req || req.status !== 'pending') throw new Error('Pending withdrawal request not found');
  const now = nowIso();
  db.prepare(`
    UPDATE withdrawal_requests SET status = 'rejected', parent_note = ?, updated_at = ? WHERE id = ?
  `).run(parentNote || null, now, requestId);
  writeAudit({
    actorUserId: parentUserId,
    action: 'withdrawal_reject',
    entityType: 'withdrawal_request',
    entityId: requestId,
    ip,
  });
  return db.prepare('SELECT * FROM withdrawal_requests WHERE id = ?').get(requestId);
}

export function markWithdrawalPaid({ requestId, parentUserId, note, ip }) {
  const db = getDb();
  const req = db.prepare('SELECT * FROM withdrawal_requests WHERE id = ?').get(requestId);
  if (!req || req.status !== 'approved') throw new Error('Approved withdrawal required');
  if (req.cash_paid_at) throw new Error('Already marked as paid');
  const now = nowIso();
  db.prepare(`
    UPDATE withdrawal_requests SET cash_paid_at = ?, updated_at = ? WHERE id = ?
  `).run(now, now, requestId);
  db.prepare(`
    INSERT INTO cash_reconciliation
      (id, event_type, amount_cents, related_request_id, recorded_by, note, created_at)
    VALUES (?, 'cash_paid', ?, ?, ?, ?, ?)
  `).run(newId(), req.amount_cents, req.id, parentUserId, note || 'Cash paid to child', now);
  writeAudit({
    actorUserId: parentUserId,
    action: 'withdrawal_paid',
    entityType: 'withdrawal_request',
    entityId: requestId,
    ip,
  });
  return db.prepare('SELECT * FROM withdrawal_requests WHERE id = ?').get(requestId);
}
