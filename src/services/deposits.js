import { getDb, withTransaction } from '../db/pool.js';
import { assertAccountOwnedBy } from './accounts.js';
import { postTransaction } from './ledger.js';
import { writeAudit } from './audit.js';
import { newId, nowIso } from '../utils/ids.js';
import { assertPositiveCents } from '../utils/money.js';

export function createDepositRequest({ childUserId, accountId, amountCents, note, idempotencyKey }) {
  assertPositiveCents(amountCents);
  assertAccountOwnedBy(accountId, childUserId);

  // Soft idempotency for requests via unique metadata key in a dedicated check
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT * FROM deposit_requests
       WHERE child_user_id = ? AND status = 'pending' AND child_note = ? AND amount_cents = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(childUserId, `idem:${idempotencyKey}`, amountCents);
  if (existing) return existing;

  const now = nowIso();
  const id = newId();
  db.prepare(`
    INSERT INTO deposit_requests
      (id, child_user_id, account_id, amount_cents, status, child_note, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(id, childUserId, accountId, amountCents, note ? note : `idem:${idempotencyKey}`, now, now);

  writeAudit({
    actorUserId: childUserId,
    action: 'deposit_request_create',
    entityType: 'deposit_request',
    entityId: id,
    after: { amountCents, accountId },
  });

  return db.prepare('SELECT * FROM deposit_requests WHERE id = ?').get(id);
}

export function listDepositRequests({ childUserId = null, status = null } = {}) {
  const db = getDb();
  if (childUserId && status) {
    return db
      .prepare('SELECT * FROM deposit_requests WHERE child_user_id = ? AND status = ? ORDER BY created_at DESC')
      .all(childUserId, status);
  }
  if (childUserId) {
    return db
      .prepare('SELECT * FROM deposit_requests WHERE child_user_id = ? ORDER BY created_at DESC')
      .all(childUserId);
  }
  if (status) {
    return db
      .prepare(
        `SELECT d.*, u.display_name AS child_name, a.name AS account_name
         FROM deposit_requests d
         JOIN users u ON u.id = d.child_user_id
         JOIN accounts a ON a.id = d.account_id
         WHERE d.status = ?
         ORDER BY d.created_at ASC`
      )
      .all(status);
  }
  return db
    .prepare(
      `SELECT d.*, u.display_name AS child_name, a.name AS account_name
       FROM deposit_requests d
       JOIN users u ON u.id = d.child_user_id
       JOIN accounts a ON a.id = d.account_id
       ORDER BY d.created_at DESC
       LIMIT 100`
    )
    .all();
}

export function approveDeposit({ requestId, parentUserId, parentNote, ip }) {
  return withTransaction(() => {
    const db = getDb();
    const req = db.prepare('SELECT * FROM deposit_requests WHERE id = ?').get(requestId);
    if (!req) throw new Error('Deposit request not found');
    if (req.status === 'approved') {
      return req;
    }
    if (req.status !== 'pending') throw new Error('Pending deposit request not found');

    const result = postTransaction({
      type: 'deposit_approve',
      description: parentNote || `Deposit approved ${req.amount_cents} cents`,
      initiatedBy: req.child_user_id,
      approvedBy: parentUserId,
      relatedRequestId: req.id,
      idempotencyKey: `deposit_approve:${req.id}`,
      lines: [
        // Child books: asset increases on debit; offset records parent cash intake.
        { accountId: req.account_id, direction: 'debit', amountCents: req.amount_cents },
        { systemAccount: 'cash_held_parent', direction: 'credit', amountCents: req.amount_cents },
      ],
    });

    const now = nowIso();
    db.prepare(`
      UPDATE deposit_requests
      SET status = 'approved', parent_note = ?, cash_received_at = ?, transaction_id = ?, updated_at = ?
      WHERE id = ?
    `).run(parentNote || null, now, result.transaction.id, now, req.id);

    db.prepare(`
      INSERT INTO cash_reconciliation
        (id, event_type, amount_cents, related_request_id, recorded_by, note, created_at)
      VALUES (?, 'cash_received', ?, ?, ?, ?, ?)
    `).run(newId(), req.amount_cents, req.id, parentUserId, 'Cash verified on deposit approval', now);

    writeAudit({
      actorUserId: parentUserId,
      action: 'deposit_approve',
      entityType: 'deposit_request',
      entityId: req.id,
      after: { transactionId: result.transaction.id },
      ip,
    });

    return db.prepare('SELECT * FROM deposit_requests WHERE id = ?').get(req.id);
  });
}

export function rejectDeposit({ requestId, parentUserId, parentNote, ip }) {
  const db = getDb();
  const req = db.prepare('SELECT * FROM deposit_requests WHERE id = ?').get(requestId);
  if (!req || req.status !== 'pending') throw new Error('Pending deposit request not found');
  const now = nowIso();
  db.prepare(`
    UPDATE deposit_requests SET status = 'rejected', parent_note = ?, updated_at = ? WHERE id = ?
  `).run(parentNote || null, now, requestId);
  writeAudit({
    actorUserId: parentUserId,
    action: 'deposit_reject',
    entityType: 'deposit_request',
    entityId: requestId,
    after: { parentNote },
    ip,
  });
  return db.prepare('SELECT * FROM deposit_requests WHERE id = ?').get(requestId);
}

export function markDepositBanked({ requestId, parentUserId, note, ip }) {
  const db = getDb();
  const req = db.prepare('SELECT * FROM deposit_requests WHERE id = ?').get(requestId);
  if (!req || req.status !== 'approved') throw new Error('Approved deposit required');
  if (req.bank_deposited_at) throw new Error('Already marked as banked');
  const now = nowIso();
  db.prepare(`
    UPDATE deposit_requests SET bank_deposited_at = ?, updated_at = ? WHERE id = ?
  `).run(now, now, requestId);
  db.prepare(`
    INSERT INTO cash_reconciliation
      (id, event_type, amount_cents, related_request_id, recorded_by, note, created_at)
    VALUES (?, 'bank_deposit', ?, ?, ?, ?, ?)
  `).run(newId(), req.amount_cents, req.id, parentUserId, note || 'Deposited to parent bank', now);
  writeAudit({
    actorUserId: parentUserId,
    action: 'deposit_banked',
    entityType: 'deposit_request',
    entityId: requestId,
    ip,
  });
  return db.prepare('SELECT * FROM deposit_requests WHERE id = ?').get(requestId);
}
