import { getDb } from '../db/pool.js';
import { writeAudit } from './audit.js';
import { newId, nowIso } from '../utils/ids.js';

export function getCashSummary() {
  const db = getDb();
  const virtual = db
    .prepare(`SELECT COALESCE(SUM(balance_cents), 0) AS total FROM accounts WHERE status = 'active'`)
    .get().total;

  const received = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM cash_reconciliation WHERE event_type = 'cash_received'`)
    .get().total;
  const banked = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM cash_reconciliation WHERE event_type = 'bank_deposit'`)
    .get().total;
  const paid = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM cash_reconciliation WHERE event_type = 'cash_paid'`)
    .get().total;
  const adjustments = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM cash_reconciliation WHERE event_type = 'adjustment'`)
    .get().total;

  return {
    virtual_balances_cents: virtual,
    cash_received_cents: received,
    bank_deposited_cents: banked,
    cash_paid_cents: paid,
    adjustments_cents: adjustments,
    cash_held_by_parent_cents: received - banked - paid + adjustments,
  };
}

export function listReconciliationEvents(limit = 100) {
  return getDb()
    .prepare(
      `SELECT r.*, u.display_name AS recorded_by_name
       FROM cash_reconciliation r
       JOIN users u ON u.id = r.recorded_by
       ORDER BY r.created_at DESC
       LIMIT ?`
    )
    .all(limit);
}

export function addAdjustment({ parentUserId, amountCents, note, ip }) {
  if (!Number.isInteger(amountCents) || amountCents === 0) {
    throw new Error('amountCents must be a non-zero integer');
  }
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO cash_reconciliation
        (id, event_type, amount_cents, related_request_id, recorded_by, note, created_at)
       VALUES (?, 'adjustment', ?, NULL, ?, ?, ?)`
    )
    .run(id, amountCents, parentUserId, note || null, nowIso());
  writeAudit({
    actorUserId: parentUserId,
    action: 'reconciliation_adjustment',
    entityType: 'cash_reconciliation',
    entityId: id,
    after: { amountCents, note },
    ip,
  });
  return getCashSummary();
}
