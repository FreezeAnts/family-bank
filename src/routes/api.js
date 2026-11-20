import { requireUser, requireChild, clientIp } from '../auth/rbac.js';
import { listAccountsForUser, transferBetweenAccounts, assertAccountOwnedBy } from '../services/accounts.js';
import { listTransactionsForAccount } from '../services/ledger.js';
import {
  createDepositRequest,
  listDepositRequests,
} from '../services/deposits.js';
import {
  createWithdrawalRequest,
  listWithdrawalRequests,
} from '../services/withdrawals.js';
import { listChores, claimChore, listClaims } from '../services/chores.js';
import { createGoal, listGoals, allocateToGoal } from '../services/goals.js';
import {
  listMarketplace,
  getPortfolio,
  placeOrder,
  listOrders,
  priceHistory,
} from '../services/investments.js';
import { interestHistory } from '../services/interest.js';
import { parseCadToCents } from '../utils/money.js';
import { newId } from '../utils/ids.js';

function centsFromBody(body) {
  if (body.amountCents != null) return Number(body.amountCents);
  if (body.amount != null) return parseCadToCents(body.amount);
  throw new Error('amount or amountCents required');
}

function idemKey(request) {
  return request.headers['idempotency-key'] || request.body?.idempotencyKey || newId();
}

export async function apiRoutes(fastify) {
  fastify.addHook('preHandler', async (request) => {
    if (request.url.startsWith('/api/') && request.url !== '/api/me') {
      requireUser(request);
    }
  });

  fastify.get('/api/dashboard', async (request) => {
    const user = requireUser(request);
    if (user.role === 'parent') {
      return { role: 'parent', redirect: '/#/parent' };
    }
    const accounts = listAccountsForUser(user.id);
    const pendingDeposits = listDepositRequests({ childUserId: user.id }).filter((d) => d.status === 'pending');
    const pendingWithdrawals = listWithdrawalRequests({ childUserId: user.id }).filter((w) => w.status === 'pending');
    const claims = listClaims({ childUserId: user.id }).filter((c) => c.status === 'pending');
    const goals = listGoals(user.id);
    const portfolio = getPortfolio(user.id);
    return {
      role: 'child',
      user: { id: user.id, displayName: user.display_name },
      accounts,
      totals: {
        balanceCents: accounts.reduce((s, a) => s + a.balance_cents, 0),
        availableCents: accounts.reduce((s, a) => s + a.available_cents, 0),
      },
      pending: {
        deposits: pendingDeposits.length,
        withdrawals: pendingWithdrawals.length,
        choreClaims: claims.length,
      },
      goals,
      portfolioSummary: {
        holdings: portfolio.length,
        marketValueCents: portfolio.reduce((s, h) => s + h.market_value_cents, 0),
        unrealizedPlCents: portfolio.reduce((s, h) => s + h.unrealized_pl_cents, 0),
      },
    };
  });

  fastify.get('/api/accounts', async (request) => {
    const user = requireUser(request);
    const userId = user.role === 'parent' && request.query.userId ? request.query.userId : user.id;
    if (user.role === 'child' && userId !== user.id) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    return listAccountsForUser(userId);
  });

  fastify.get('/api/accounts/:id/transactions', async (request) => {
    const user = requireUser(request);
    const { getAccount } = await import('../services/accounts.js');
    const account = getAccount(request.params.id);
    if (!account) {
      const err = new Error('Account not found');
      err.statusCode = 404;
      throw err;
    }
    if (user.role === 'child' && account.user_id !== user.id) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    return listTransactionsForAccount(account.id, Number(request.query.limit || 50));
  });

  fastify.post('/api/transfers', async (request) => {
    const user = requireChild(request);
    const amountCents = centsFromBody(request.body);
    return transferBetweenAccounts({
      userId: user.id,
      fromAccountId: request.body.fromAccountId,
      toAccountId: request.body.toAccountId,
      amountCents,
      description: request.body.description,
      idempotencyKey: idemKey(request),
      actorUserId: user.id,
      ip: clientIp(request),
    });
  });

  fastify.post('/api/deposits', async (request) => {
    const user = requireChild(request);
    return createDepositRequest({
      childUserId: user.id,
      accountId: request.body.accountId,
      amountCents: centsFromBody(request.body),
      note: request.body.note,
      idempotencyKey: idemKey(request),
    });
  });

  fastify.get('/api/deposits', async (request) => {
    const user = requireUser(request);
    if (user.role === 'parent') return listDepositRequests({});
    return listDepositRequests({ childUserId: user.id });
  });

  fastify.post('/api/withdrawals', async (request) => {
    const user = requireChild(request);
    return createWithdrawalRequest({
      childUserId: user.id,
      accountId: request.body.accountId,
      amountCents: centsFromBody(request.body),
      note: request.body.note,
      idempotencyKey: idemKey(request),
    });
  });

  fastify.get('/api/withdrawals', async (request) => {
    const user = requireUser(request);
    if (user.role === 'parent') return listWithdrawalRequests({});
    return listWithdrawalRequests({ childUserId: user.id });
  });

  fastify.get('/api/chores', async () => listChores({ activeOnly: true }));

  fastify.post('/api/chores/:id/claim', async (request) => {
    const user = requireChild(request);
    return claimChore({
      choreId: request.params.id,
      childUserId: user.id,
      note: request.body?.note,
    });
  });

  fastify.get('/api/chore-claims', async (request) => {
    const user = requireUser(request);
    if (user.role === 'parent') return listClaims({});
    return listClaims({ childUserId: user.id });
  });

  fastify.get('/api/goals', async (request) => {
    const user = requireChild(request);
    return listGoals(user.id);
  });

  fastify.post('/api/goals', async (request) => {
    const user = requireChild(request);
    return createGoal({
      userId: user.id,
      name: request.body.name,
      targetCents: centsFromBody({ amountCents: request.body.targetCents, amount: request.body.targetAmount }),
      targetDate: request.body.targetDate,
    });
  });

  fastify.post('/api/goals/:id/allocate', async (request) => {
    const user = requireChild(request);
    return allocateToGoal({
      userId: user.id,
      goalId: request.params.id,
      accountId: request.body.accountId,
      amountCents: centsFromBody(request.body),
      note: request.body.note,
    });
  });

  fastify.get('/api/investments/market', async () => listMarketplace());
  fastify.get('/api/investments/portfolio', async (request) => {
    const user = requireChild(request);
    return {
      holdings: getPortfolio(user.id),
      orders: listOrders(user.id),
      disclaimer: 'Simulated market — not real money or securities.',
    };
  });

  fastify.get('/api/investments/:id/history', async (request) => {
    requireUser(request);
    return priceHistory(request.params.id);
  });

  fastify.post('/api/investments/orders', async (request) => {
    const user = requireChild(request);
    return placeOrder({
      userId: user.id,
      instrumentId: request.body.instrumentId,
      side: request.body.side,
      quantityMilli: Number(request.body.quantityMilli),
      idempotencyKey: idemKey(request),
      ip: clientIp(request),
    });
  });

  fastify.get('/api/accounts/:id/interest', async (request) => {
    const user = requireUser(request);
    if (user.role === 'child') assertAccountOwnedBy(request.params.id, user.id);
    return interestHistory(request.params.id);
  });
}
