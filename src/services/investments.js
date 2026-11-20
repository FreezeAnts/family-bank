import { getDb, withTransaction } from '../db/pool.js';
import { postTransaction } from './ledger.js';
import { writeAudit } from './audit.js';
import { newId, nowIso } from '../utils/ids.js';
import { assertPositiveCents } from '../utils/money.js';

function latestPrice(instrumentId) {
  return getDb()
    .prepare(
      `SELECT * FROM market_prices WHERE instrument_id = ? ORDER BY as_of DESC LIMIT 1`
    )
    .get(instrumentId);
}

function getSetting(key, fallback) {
  const row = getDb().prepare('SELECT value_json FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return fallback;
  }
}

export function listMarketplace() {
  const instruments = getDb()
    .prepare(`SELECT * FROM investments WHERE active = 1 ORDER BY symbol`)
    .all();
  return instruments.map((inst) => {
    const price = latestPrice(inst.id);
    return { ...inst, price_cents: price?.price_cents || 0, price_as_of: price?.as_of || null, simulated: true };
  });
}

export function getPortfolio(userId) {
  const holdings = getDb()
    .prepare(
      `SELECT h.*, i.symbol, i.name
       FROM investment_holdings h
       JOIN investments i ON i.id = h.instrument_id
       WHERE h.user_id = ? AND h.quantity_milli > 0`
    )
    .all(userId);

  return holdings.map((h) => {
    const price = latestPrice(h.instrument_id);
    const marketValue = Math.floor((h.quantity_milli * (price?.price_cents || 0)) / 1000);
    const costBasis = Math.floor((h.quantity_milli * h.avg_cost_cents_per_share) / 1000);
    return {
      ...h,
      price_cents: price?.price_cents || 0,
      market_value_cents: marketValue,
      cost_basis_cents: costBasis,
      unrealized_pl_cents: marketValue - costBasis,
      simulated: true,
    };
  });
}

export function placeOrder({ userId, instrumentId, side, quantityMilli, idempotencyKey, ip }) {
  if (!Number.isInteger(quantityMilli) || quantityMilli <= 0) {
    throw new Error('quantityMilli must be a positive integer');
  }
  if (!['buy', 'sell'].includes(side)) throw new Error('Invalid side');

  return withTransaction(() => {
    const db = getDb();
    const instrument = db.prepare('SELECT * FROM investments WHERE id = ? AND active = 1').get(instrumentId);
    if (!instrument) throw new Error('Instrument not found');
    const price = latestPrice(instrumentId);
    if (!price) throw new Error('No market price');

    const totalCents = Math.floor((quantityMilli * price.price_cents) / 1000);
    assertPositiveCents(totalCents);

    const cash = db
      .prepare(`SELECT * FROM accounts WHERE user_id = ? AND type = 'investment_cash' AND status = 'active'`)
      .get(userId);
    if (!cash) throw new Error('Investment cash account missing');

    let holding = db
      .prepare(`SELECT * FROM investment_holdings WHERE user_id = ? AND instrument_id = ?`)
      .get(userId, instrumentId);

    if (side === 'buy') {
      if (cash.balance_cents < totalCents) throw new Error('Insufficient investment cash');
      const result = postTransaction({
        type: 'investment_buy',
        description: `Buy ${instrument.symbol} (simulated)`,
        initiatedBy: userId,
        idempotencyKey,
        lines: [
          { systemAccount: 'investment_holdings_asset', direction: 'debit', amountCents: totalCents },
          { accountId: cash.id, direction: 'credit', amountCents: totalCents },
        ],
      });

      if (!holding) {
        const id = newId();
        db.prepare(
          `INSERT INTO investment_holdings
            (id, user_id, instrument_id, quantity_milli, avg_cost_cents_per_share)
           VALUES (?, ?, ?, ?, ?)`
        ).run(id, userId, instrumentId, quantityMilli, price.price_cents);
      } else {
        const newQty = holding.quantity_milli + quantityMilli;
        const newAvg = Math.floor(
          (holding.quantity_milli * holding.avg_cost_cents_per_share + quantityMilli * price.price_cents) /
            newQty
        );
        db.prepare(
          `UPDATE investment_holdings SET quantity_milli = ?, avg_cost_cents_per_share = ? WHERE id = ?`
        ).run(newQty, newAvg, holding.id);
      }

      const orderId = newId();
      db.prepare(
        `INSERT INTO investment_orders
          (id, user_id, instrument_id, side, quantity_milli, price_cents, total_cents, transaction_id, created_at)
         VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, ?)`
      ).run(orderId, userId, instrumentId, quantityMilli, price.price_cents, totalCents, result.transaction.id, nowIso());

      writeAudit({
        actorUserId: userId,
        action: 'investment_buy',
        entityType: 'investment_order',
        entityId: orderId,
        after: { instrumentId, quantityMilli, totalCents },
        ip,
      });
      return { orderId, totalCents, side: 'buy', simulated: true };
    }

    // sell
    if (!holding || holding.quantity_milli < quantityMilli) throw new Error('Insufficient shares');
    const result = postTransaction({
      type: 'investment_sell',
      description: `Sell ${instrument.symbol} (simulated)`,
      initiatedBy: userId,
      idempotencyKey,
      lines: [
        { accountId: cash.id, direction: 'debit', amountCents: totalCents },
        { systemAccount: 'investment_holdings_asset', direction: 'credit', amountCents: totalCents },
      ],
    });

    const newQty = holding.quantity_milli - quantityMilli;
    db.prepare(`UPDATE investment_holdings SET quantity_milli = ? WHERE id = ?`).run(newQty, holding.id);

    const orderId = newId();
    db.prepare(
      `INSERT INTO investment_orders
        (id, user_id, instrument_id, side, quantity_milli, price_cents, total_cents, transaction_id, created_at)
       VALUES (?, ?, ?, 'sell', ?, ?, ?, ?, ?)`
    ).run(orderId, userId, instrumentId, quantityMilli, price.price_cents, totalCents, result.transaction.id, nowIso());

    writeAudit({
      actorUserId: userId,
      action: 'investment_sell',
      entityType: 'investment_order',
      entityId: orderId,
      after: { instrumentId, quantityMilli, totalCents },
      ip,
    });
    return { orderId, totalCents, side: 'sell', simulated: true };
  });
}

export function tickMarket({ parentUserId = null } = {}) {
  return withTransaction(() => {
    const db = getDb();
    const drift = Number(getSetting('market.drift_bps_daily', 5));
    const vol = Number(getSetting('market.volatility_bps', 150));
    const instruments = db.prepare(`SELECT * FROM investments WHERE active = 1`).all();
    const now = nowIso();
    const insert = db.prepare(
      `INSERT INTO market_prices (instrument_id, as_of, price_cents) VALUES (?, ?, ?)`
    );
    const updates = [];
    for (const inst of instruments) {
      const prev = latestPrice(inst.id);
      if (!prev) continue;
      const shock = Math.floor((Math.random() * 2 - 1) * vol);
      const deltaBps = drift + shock;
      const next = Math.max(100, Math.floor(prev.price_cents * (1 + deltaBps / 10000)));
      insert.run(inst.id, now, next);
      updates.push({ symbol: inst.symbol, from: prev.price_cents, to: next });
    }
    if (parentUserId) {
      writeAudit({
        actorUserId: parentUserId,
        action: 'market_tick',
        entityType: 'market',
        entityId: 'all',
        after: { updates },
      });
    }
    return { asOf: now, updates, simulated: true };
  });
}

export function setMarketParams({ parentUserId, driftBps, volatilityBps }) {
  const db = getDb();
  const now = nowIso();
  const upsert = db.prepare(
    `INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  );
  if (driftBps !== undefined) upsert.run('market.drift_bps_daily', JSON.stringify(driftBps), now, parentUserId);
  if (volatilityBps !== undefined) upsert.run('market.volatility_bps', JSON.stringify(volatilityBps), now, parentUserId);
  writeAudit({
    actorUserId: parentUserId,
    action: 'market_params',
    entityType: 'settings',
    entityId: 'market',
    after: { driftBps, volatilityBps },
  });
}

export function priceHistory(instrumentId, limit = 60) {
  return getDb()
    .prepare(
      `SELECT as_of, price_cents FROM market_prices
       WHERE instrument_id = ?
       ORDER BY as_of DESC
       LIMIT ?`
    )
    .all(instrumentId, limit)
    .reverse();
}

export function listOrders(userId, limit = 50) {
  return getDb()
    .prepare(
      `SELECT o.*, i.symbol, i.name
       FROM investment_orders o
       JOIN investments i ON i.id = o.instrument_id
       WHERE o.user_id = ?
       ORDER BY o.created_at DESC
       LIMIT ?`
    )
    .all(userId, limit);
}
