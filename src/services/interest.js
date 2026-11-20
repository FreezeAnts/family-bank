import { getDb, withTransaction } from '../db/pool.js';
import { postTransaction } from './ledger.js';
import { writeAudit } from './audit.js';
import { dailyInterestCents } from '../utils/money.js';
import { newId, nowIso } from '../utils/ids.js';

function activeRuleForDate(businessDate) {
  return getDb()
    .prepare(
      `SELECT * FROM interest_rules
       WHERE eligible_account_type = 'savings'
         AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY effective_from DESC
       LIMIT 1`
    )
    .get(businessDate, businessDate);
}

export function setInterestRate({ parentUserId, annualRateBps, effectiveFrom }) {
  const db = getDb();
  const now = nowIso();
  const from = effectiveFrom || now.slice(0, 10);

  return withTransaction(() => {
    const current = db
      .prepare(
        `SELECT * FROM interest_rules
         WHERE effective_to IS NULL
         ORDER BY effective_from DESC LIMIT 1`
      )
      .get();
    if (current) {
      // Close previous day
      const closeDate = new Date(from + 'T00:00:00Z');
      closeDate.setUTCDate(closeDate.getUTCDate() - 1);
      const closeStr = closeDate.toISOString().slice(0, 10);
      db.prepare(`UPDATE interest_rules SET effective_to = ? WHERE id = ?`).run(closeStr, current.id);
    }
    const id = newId();
    db.prepare(
      `INSERT INTO interest_rules
        (id, annual_rate_bps, day_count, eligible_account_type, effective_from, effective_to, created_by, created_at)
       VALUES (?, ?, 'ACT_365_FIXED', 'savings', ?, NULL, ?, ?)`
    ).run(id, annualRateBps, from, parentUserId, now);
    writeAudit({
      actorUserId: parentUserId,
      action: 'interest_rate_set',
      entityType: 'interest_rule',
      entityId: id,
      after: { annualRateBps, effectiveFrom: from },
    });
    return db.prepare('SELECT * FROM interest_rules WHERE id = ?').get(id);
  });
}

export function listInterestRules() {
  return getDb()
    .prepare('SELECT * FROM interest_rules ORDER BY effective_from DESC')
    .all();
}

/** Accrue interest for one business date (YYYY-MM-DD) for all savings accounts. */
export function accrueDailyInterest(businessDate = new Date().toISOString().slice(0, 10)) {
  const rule = activeRuleForDate(businessDate);
  if (!rule) return { accrued: 0, skipped: 'no_rule' };

  return withTransaction(() => {
    const db = getDb();
    const accounts = db
      .prepare(`SELECT * FROM accounts WHERE type = 'savings' AND status = 'active'`)
      .all();
    let count = 0;
    const insert = db.prepare(
      `INSERT INTO interest_daily_accrual
        (id, account_id, business_date, closing_balance_cents, rate_bps, accrual_cents, credited)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(account_id, business_date) DO NOTHING`
    );
    for (const account of accounts) {
      const accrual = dailyInterestCents(account.balance_cents, rule.annual_rate_bps);
      const info = insert.run(
        newId(),
        account.id,
        businessDate,
        account.balance_cents,
        rule.annual_rate_bps,
        accrual
      );
      if (info.changes) count += 1;
    }
    return { accruedAccounts: count, businessDate, rateBps: rule.annual_rate_bps };
  });
}

export function creditMonthlyInterest({ year, month, systemUserId }) {
  const y = year || new Date().getUTCFullYear();
  const m = month || new Date().getUTCMonth() + 1;
  const prefix = `${y}-${String(m).padStart(2, '0')}`;

  return withTransaction(() => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT account_id, SUM(accrual_cents) AS total
         FROM interest_daily_accrual
         WHERE business_date LIKE ? AND credited = 0
         GROUP BY account_id
         HAVING total > 0`
      )
      .all(`${prefix}%`);

    const results = [];
    for (const row of rows) {
      const existing = db
        .prepare(
          `SELECT id FROM interest_history WHERE account_id = ? AND period_year = ? AND period_month = ?`
        )
        .get(row.account_id, y, m);
      if (existing) continue;

      const posted = postTransaction({
        type: 'interest_credit',
        description: `Savings interest ${prefix}`,
        initiatedBy: systemUserId,
        approvedBy: systemUserId,
        idempotencyKey: `interest:${row.account_id}:${prefix}`,
        lines: [
          { accountId: row.account_id, direction: 'debit', amountCents: row.total },
          { systemAccount: 'income_interest', direction: 'credit', amountCents: row.total },
        ],
      });

      db.prepare(
        `UPDATE interest_daily_accrual SET credited = 1
         WHERE account_id = ? AND business_date LIKE ? AND credited = 0`
      ).run(row.account_id, `${prefix}%`);

      const histId = newId();
      db.prepare(
        `INSERT INTO interest_history
          (id, account_id, period_year, period_month, total_accrual_cents, transaction_id, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(histId, row.account_id, y, m, row.total, posted.transaction.id, nowIso());

      results.push({ accountId: row.account_id, amountCents: row.total, transactionId: posted.transaction.id });
    }
    return { period: prefix, credits: results };
  });
}

export function interestHistory(accountId) {
  return getDb()
    .prepare(
      `SELECT * FROM interest_history WHERE account_id = ? ORDER BY period_year DESC, period_month DESC`
    )
    .all(accountId);
}
