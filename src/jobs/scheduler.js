import cron from 'node-cron';
import { getDb } from '../db/pool.js';
import { accrueDailyInterest, creditMonthlyInterest } from '../services/interest.js';
import { tickMarket } from '../services/investments.js';

function systemActorId() {
  const parent = getDb()
    .prepare(`SELECT id FROM users WHERE role = 'parent' AND status = 'active' ORDER BY created_at LIMIT 1`)
    .get();
  return parent?.id || null;
}

export function startJobs(logger) {
  // Daily interest accrual at 00:15 America/Toronto-ish via server local TZ
  cron.schedule('15 0 * * *', () => {
    try {
      const result = accrueDailyInterest();
      logger.info({ result }, 'Daily interest accrual complete');
    } catch (err) {
      logger.error({ err }, 'Daily interest accrual failed');
    }
  });

  // Monthly interest credit on the 1st at 00:30
  cron.schedule('30 0 1 * *', () => {
    try {
      const actor = systemActorId();
      if (!actor) return;
      const now = new Date();
      // Credit previous month
      const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const result = creditMonthlyInterest({
        year: prev.getUTCFullYear(),
        month: prev.getUTCMonth() + 1,
        systemUserId: actor,
      });
      logger.info({ result }, 'Monthly interest credit complete');
    } catch (err) {
      logger.error({ err }, 'Monthly interest credit failed');
    }
  });

  // Simulated market tick every weekday at 16:00
  cron.schedule('0 16 * * 1-5', () => {
    try {
      const result = tickMarket({});
      logger.info({ count: result.updates?.length }, 'Market tick complete');
    } catch (err) {
      logger.error({ err }, 'Market tick failed');
    }
  });

  logger.info('Scheduled jobs registered');
}
