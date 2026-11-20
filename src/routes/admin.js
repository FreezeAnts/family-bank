import { requireParent, clientIp, getUserById } from '../auth/rbac.js';
import { getDb } from '../db/pool.js';
import {
  approveDeposit,
  rejectDeposit,
  markDepositBanked,
  listDepositRequests,
} from '../services/deposits.js';
import {
  approveWithdrawal,
  rejectWithdrawal,
  markWithdrawalPaid,
  listWithdrawalRequests,
} from '../services/withdrawals.js';
import {
  createChore,
  listChores,
  setChoreActive,
  listClaims,
  approveClaim,
  rejectClaim,
  awardBonus,
} from '../services/chores.js';
import { getCashSummary, listReconciliationEvents, addAdjustment } from '../services/reconciliation.js';
import { listAudit } from '../services/audit.js';
import { setInterestRate, listInterestRules, accrueDailyInterest, creditMonthlyInterest } from '../services/interest.js';
import { tickMarket, setMarketParams, listMarketplace } from '../services/investments.js';
import { listAccountsForUser, setOpeningBalance, reconcileAccountBalances, createChildAccounts } from '../services/accounts.js';
import { parseCadToCents } from '../utils/money.js';
import { newId, nowIso } from '../utils/ids.js';
import { writeAudit } from '../services/audit.js';
import { checkLatest, updateStatusSnapshot } from '../services/updates.js';

function cents(body) {
  if (body.amountCents != null) return Number(body.amountCents);
  if (body.amount != null) return parseCadToCents(body.amount);
  throw new Error('amount or amountCents required');
}

export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', async (request) => {
    if (request.url.startsWith('/api/admin')) {
      requireParent(request);
    }
  });

  fastify.get('/api/admin/overview', async () => {
    const db = getDb();
    const children = db.prepare(`SELECT id, email, display_name, status FROM users WHERE role = 'child'`).all();
    const childSummaries = children.map((c) => ({
      ...c,
      accounts: listAccountsForUser(c.id),
    }));
    return {
      children: childSummaries,
      pending: {
        deposits: listDepositRequests({ status: 'pending' }),
        withdrawals: listWithdrawalRequests({ status: 'pending' }),
        choreClaims: listClaims({ status: 'pending' }),
      },
      cash: getCashSummary(),
      interestRules: listInterestRules(),
      balanceMismatches: reconcileAccountBalances(),
    };
  });

  fastify.post('/api/admin/approvals/deposits/:id/approve', async (request) => {
    const parent = requireParent(request);
    return approveDeposit({
      requestId: request.params.id,
      parentUserId: parent.id,
      parentNote: request.body?.note,
      ip: clientIp(request),
    });
  });

  fastify.post('/api/admin/approvals/deposits/:id/reject', async (request) => {
    const parent = requireParent(request);
    return rejectDeposit({
      requestId: request.params.id,
      parentUserId: parent.id,
      parentNote: request.body?.note,
      ip: clientIp(request),
    });
  });

  fastify.post('/api/admin/approvals/deposits/:id/bank', async (request) => {
    const parent = requireParent(request);
    return markDepositBanked({
      requestId: request.params.id,
      parentUserId: parent.id,
      note: request.body?.note,
      ip: clientIp(request),
    });
  });

  fastify.post('/api/admin/approvals/withdrawals/:id/approve', async (request) => {
    const parent = requireParent(request);
    return approveWithdrawal({
      requestId: request.params.id,
      parentUserId: parent.id,
      parentNote: request.body?.note,
      ip: clientIp(request),
    });
  });

  fastify.post('/api/admin/approvals/withdrawals/:id/reject', async (request) => {
    const parent = requireParent(request);
    return rejectWithdrawal({
      requestId: request.params.id,
      parentUserId: parent.id,
      parentNote: request.body?.note,
      ip: clientIp(request),
    });
  });

  fastify.post('/api/admin/approvals/withdrawals/:id/paid', async (request) => {
    const parent = requireParent(request);
    return markWithdrawalPaid({
      requestId: request.params.id,
      parentUserId: parent.id,
      note: request.body?.note,
      ip: clientIp(request),
    });
  });

  fastify.post('/api/admin/approvals/chores/:id/approve', async (request) => {
    const parent = requireParent(request);
    return approveClaim({ claimId: request.params.id, parentUserId: parent.id, ip: clientIp(request) });
  });

  fastify.post('/api/admin/approvals/chores/:id/reject', async (request) => {
    const parent = requireParent(request);
    return rejectClaim({
      claimId: request.params.id,
      parentUserId: parent.id,
      note: request.body?.note,
      ip: clientIp(request),
    });
  });

  fastify.get('/api/admin/chores', async () => listChores({ activeOnly: false }));

  fastify.post('/api/admin/chores', async (request) => {
    const parent = requireParent(request);
    return createChore({
      parentUserId: parent.id,
      title: request.body.title,
      description: request.body.description,
      amountCents: cents(request.body),
      destinationAccountType: request.body.destinationAccountType || 'chequing',
    });
  });

  fastify.post('/api/admin/chores/:id/active', async (request) => {
    const parent = requireParent(request);
    setChoreActive(request.params.id, Boolean(request.body.active), parent.id);
    return { ok: true };
  });

  fastify.post('/api/admin/bonuses', async (request) => {
    const parent = requireParent(request);
    return awardBonus({
      parentUserId: parent.id,
      childUserId: request.body.childUserId,
      amountCents: cents(request.body),
      accountType: request.body.accountType || 'chequing',
      description: request.body.description,
      idempotencyKey: request.headers['idempotency-key'] || request.body.idempotencyKey || newId(),
      ip: clientIp(request),
    });
  });

  fastify.get('/api/admin/reconciliation', async () => ({
    summary: getCashSummary(),
    events: listReconciliationEvents(),
  }));

  fastify.post('/api/admin/reconciliation', async (request) => {
    const parent = requireParent(request);
    return addAdjustment({
      parentUserId: parent.id,
      amountCents: Number(request.body.amountCents),
      note: request.body.note,
      ip: clientIp(request),
    });
  });

  fastify.get('/api/admin/audit', async () => listAudit(200));

  fastify.get('/api/admin/interest', async () => listInterestRules());

  fastify.post('/api/admin/interest', async (request) => {
    const parent = requireParent(request);
    return setInterestRate({
      parentUserId: parent.id,
      annualRateBps: Number(request.body.annualRateBps),
      effectiveFrom: request.body.effectiveFrom,
    });
  });

  fastify.post('/api/admin/interest/accrue', async (request) => {
    requireParent(request);
    return accrueDailyInterest(request.body?.businessDate);
  });

  fastify.post('/api/admin/interest/credit', async (request) => {
    const parent = requireParent(request);
    return creditMonthlyInterest({
      year: request.body?.year,
      month: request.body?.month,
      systemUserId: parent.id,
    });
  });

  fastify.get('/api/admin/investments', async () => listMarketplace());

  fastify.post('/api/admin/investments/tick', async (request) => {
    const parent = requireParent(request);
    return tickMarket({ parentUserId: parent.id });
  });

  fastify.post('/api/admin/investments/params', async (request) => {
    const parent = requireParent(request);
    setMarketParams({
      parentUserId: parent.id,
      driftBps: request.body.driftBps,
      volatilityBps: request.body.volatilityBps,
    });
    return { ok: true };
  });

  fastify.get('/api/admin/users', async () => {
    return getDb()
      .prepare(`SELECT id, email, display_name, role, status, created_at FROM users ORDER BY role, display_name`)
      .all();
  });

  fastify.post('/api/admin/users', async (request) => {
    const parent = requireParent(request);
    const email = String(request.body.email || '').toLowerCase();
    const role = request.body.role;
    const displayName = request.body.displayName || email;
    if (!email || !['parent', 'child'].includes(role)) throw new Error('Invalid user payload');
    const id = newId();
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO users (id, email, display_name, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(id, email, displayName, role, now, now);
    if (role === 'child') createChildAccounts(id);
    writeAudit({
      actorUserId: parent.id,
      action: 'user_create',
      entityType: 'user',
      entityId: id,
      after: { email, role },
      ip: clientIp(request),
    });
    return getUserById(id);
  });

  fastify.post('/api/admin/accounts/opening-balance', async (request) => {
    const parent = requireParent(request);
    return setOpeningBalance({
      accountId: request.body.accountId,
      amountCents: cents(request.body),
      parentUserId: parent.id,
      idempotencyKey: request.headers['idempotency-key'] || request.body.idempotencyKey || newId(),
      ip: clientIp(request),
    });
  });

  fastify.get('/api/admin/settings', async () => {
    return getDb().prepare('SELECT key, value_json, updated_at FROM settings ORDER BY key').all();
  });

  fastify.get('/api/admin/updates', async () => updateStatusSnapshot());

  fastify.post('/api/admin/updates/check', async () => checkLatest());
}
