import { getDb, withTransaction } from '../db/pool.js';
import { postTransaction } from './ledger.js';
import { writeAudit } from './audit.js';
import { newId, nowIso } from '../utils/ids.js';
import { assertPositiveCents } from '../utils/money.js';

export function createChore({ parentUserId, title, description, amountCents, destinationAccountType }) {
  assertPositiveCents(amountCents);
  const id = newId();
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO chores
        (id, title, description, amount_cents, destination_account_type, active, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      id,
      title,
      description || null,
      amountCents,
      destinationAccountType || 'chequing',
      parentUserId,
      now
    );
  writeAudit({
    actorUserId: parentUserId,
    action: 'chore_create',
    entityType: 'chore',
    entityId: id,
    after: { title, amountCents },
  });
  return getDb().prepare('SELECT * FROM chores WHERE id = ?').get(id);
}

export function listChores({ activeOnly = true } = {}) {
  if (activeOnly) {
    return getDb().prepare('SELECT * FROM chores WHERE active = 1 ORDER BY title').all();
  }
  return getDb().prepare('SELECT * FROM chores ORDER BY created_at DESC').all();
}

export function setChoreActive(choreId, active, parentUserId) {
  getDb().prepare('UPDATE chores SET active = ? WHERE id = ?').run(active ? 1 : 0, choreId);
  writeAudit({
    actorUserId: parentUserId,
    action: active ? 'chore_activate' : 'chore_deactivate',
    entityType: 'chore',
    entityId: choreId,
  });
}

export function claimChore({ choreId, childUserId, note }) {
  const chore = getDb().prepare('SELECT * FROM chores WHERE id = ? AND active = 1').get(choreId);
  if (!chore) throw new Error('Chore not found');
  const id = newId();
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO chore_claims
        (id, chore_id, child_user_id, status, submitted_at, note)
       VALUES (?, ?, ?, 'pending', ?, ?)`
    )
    .run(id, choreId, childUserId, now, note || null);
  writeAudit({
    actorUserId: childUserId,
    action: 'chore_claim',
    entityType: 'chore_claim',
    entityId: id,
  });
  return getDb().prepare('SELECT * FROM chore_claims WHERE id = ?').get(id);
}

export function listClaims({ childUserId = null, status = null } = {}) {
  const db = getDb();
  if (childUserId) {
    return db
      .prepare(
        `SELECT cc.*, c.title, c.amount_cents, c.destination_account_type
         FROM chore_claims cc
         JOIN chores c ON c.id = cc.chore_id
         WHERE cc.child_user_id = ?
         ORDER BY cc.submitted_at DESC`
      )
      .all(childUserId);
  }
  if (status) {
    return db
      .prepare(
        `SELECT cc.*, c.title, c.amount_cents, c.destination_account_type, u.display_name AS child_name
         FROM chore_claims cc
         JOIN chores c ON c.id = cc.chore_id
         JOIN users u ON u.id = cc.child_user_id
         WHERE cc.status = ?
         ORDER BY cc.submitted_at ASC`
      )
      .all(status);
  }
  return db
    .prepare(
      `SELECT cc.*, c.title, c.amount_cents, u.display_name AS child_name
       FROM chore_claims cc
       JOIN chores c ON c.id = cc.chore_id
       JOIN users u ON u.id = cc.child_user_id
       ORDER BY cc.submitted_at DESC
       LIMIT 100`
    )
    .all();
}

export function approveClaim({ claimId, parentUserId, ip }) {
  return withTransaction(() => {
    const db = getDb();
    const claim = db
      .prepare(
        `SELECT cc.*, c.amount_cents, c.destination_account_type, c.title
         FROM chore_claims cc
         JOIN chores c ON c.id = cc.chore_id
         WHERE cc.id = ?`
      )
      .get(claimId);
    if (!claim || claim.status !== 'pending') throw new Error('Pending claim not found');

    const account = db
      .prepare(
        `SELECT * FROM accounts WHERE user_id = ? AND type = ? AND status = 'active'`
      )
      .get(claim.child_user_id, claim.destination_account_type);
    if (!account) throw new Error('Destination account not found');

    const result = postTransaction({
      type: 'chore_earning',
      description: `Chore: ${claim.title}`,
      initiatedBy: claim.child_user_id,
      approvedBy: parentUserId,
      relatedRequestId: claim.id,
      idempotencyKey: `chore_approve:${claim.id}`,
      lines: [
        { accountId: account.id, direction: 'debit', amountCents: claim.amount_cents },
        { systemAccount: 'income_chores', direction: 'credit', amountCents: claim.amount_cents },
      ],
    });

    const now = nowIso();
    db.prepare(`
      UPDATE chore_claims
      SET status = 'approved', reviewed_by = ?, reviewed_at = ?, transaction_id = ?
      WHERE id = ?
    `).run(parentUserId, now, result.transaction.id, claim.id);

    writeAudit({
      actorUserId: parentUserId,
      action: 'chore_approve',
      entityType: 'chore_claim',
      entityId: claim.id,
      ip,
    });

    return db.prepare('SELECT * FROM chore_claims WHERE id = ?').get(claim.id);
  });
}

export function rejectClaim({ claimId, parentUserId, note, ip }) {
  const db = getDb();
  const claim = db.prepare('SELECT * FROM chore_claims WHERE id = ?').get(claimId);
  if (!claim || claim.status !== 'pending') throw new Error('Pending claim not found');
  db.prepare(`
    UPDATE chore_claims
    SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, note = COALESCE(?, note)
    WHERE id = ?
  `).run(parentUserId, nowIso(), note || null, claimId);
  writeAudit({
    actorUserId: parentUserId,
    action: 'chore_reject',
    entityType: 'chore_claim',
    entityId: claimId,
    ip,
  });
  return db.prepare('SELECT * FROM chore_claims WHERE id = ?').get(claimId);
}

export function awardBonus({ parentUserId, childUserId, amountCents, accountType, description, idempotencyKey, ip }) {
  assertPositiveCents(amountCents);
  return withTransaction(() => {
    const db = getDb();
    const account = db
      .prepare(`SELECT * FROM accounts WHERE user_id = ? AND type = ? AND status = 'active'`)
      .get(childUserId, accountType || 'chequing');
    if (!account) throw new Error('Account not found');

    const result = postTransaction({
      type: 'bonus',
      description: description || 'Bonus',
      initiatedBy: parentUserId,
      approvedBy: parentUserId,
      idempotencyKey: idempotencyKey || `bonus:${newId()}`,
      lines: [
        { accountId: account.id, direction: 'debit', amountCents },
        { systemAccount: 'income_bonus', direction: 'credit', amountCents },
      ],
    });

    writeAudit({
      actorUserId: parentUserId,
      action: 'bonus_award',
      entityType: 'transaction',
      entityId: result.transaction.id,
      after: { childUserId, amountCents },
      ip,
    });

    return result;
  });
}
