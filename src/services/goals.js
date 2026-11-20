import { getDb, withTransaction } from '../db/pool.js';
import { assertAccountOwnedBy } from './accounts.js';
import { writeAudit } from './audit.js';
import { newId, nowIso } from '../utils/ids.js';
import { assertPositiveCents } from '../utils/money.js';

export function createGoal({ userId, name, targetCents, targetDate }) {
  assertPositiveCents(targetCents);
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO savings_goals (id, user_id, name, target_cents, target_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`
    )
    .run(id, userId, name, targetCents, targetDate || null, nowIso());
  writeAudit({
    actorUserId: userId,
    action: 'goal_create',
    entityType: 'savings_goal',
    entityId: id,
    after: { name, targetCents },
  });
  return getGoal(id, userId);
}

export function getGoal(goalId, userId = null) {
  const db = getDb();
  const goal = db.prepare('SELECT * FROM savings_goals WHERE id = ?').get(goalId);
  if (!goal) return null;
  if (userId && goal.user_id !== userId) return null;
  const allocated = db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM goal_allocations WHERE goal_id = ?')
    .get(goalId).total;
  return { ...goal, allocated_cents: allocated, progress_pct: Math.min(100, Math.round((allocated / goal.target_cents) * 100)) };
}

export function listGoals(userId) {
  const goals = getDb()
    .prepare(`SELECT * FROM savings_goals WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId);
  return goals.map((g) => getGoal(g.id));
}

export function allocateToGoal({ userId, goalId, accountId, amountCents, note }) {
  assertPositiveCents(amountCents);
  return withTransaction(() => {
    const db = getDb();
    const goal = db.prepare('SELECT * FROM savings_goals WHERE id = ? AND user_id = ?').get(goalId, userId);
    if (!goal || goal.status !== 'active') throw new Error('Active goal not found');
    const account = assertAccountOwnedBy(accountId, userId);

    const earmarked = db
      .prepare(
        `SELECT COALESCE(SUM(ga.amount_cents), 0) AS total
         FROM goal_allocations ga
         JOIN savings_goals g ON g.id = ga.goal_id
         WHERE ga.account_id = ? AND g.status = 'active'`
      )
      .get(accountId).total;

    if (earmarked + amountCents > account.balance_cents) {
      throw new Error('Allocation exceeds available (non-earmarked) balance');
    }

    const id = newId();
    db.prepare(
      `INSERT INTO goal_allocations (id, goal_id, account_id, amount_cents, created_at, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, goalId, accountId, amountCents, nowIso(), note || null);

    writeAudit({
      actorUserId: userId,
      action: 'goal_allocate',
      entityType: 'goal_allocation',
      entityId: id,
      after: { goalId, accountId, amountCents },
    });

    return getGoal(goalId, userId);
  });
}
