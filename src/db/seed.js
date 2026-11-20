import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { getDb } from './pool.js';
import { migrate } from './migrate.js';
import { newId, nowIso } from '../utils/ids.js';

const ACCOUNT_DEFS = [
  { type: 'chequing', name: 'Chequing' },
  { type: 'savings', name: 'Savings' },
  { type: 'investment_cash', name: 'Investment Cash' },
];

const SAMPLE_INSTRUMENTS = [
  { symbol: 'ACME', name: 'Acme Rockets Inc.', sector: 'Aerospace', description: 'Simulated rocket maker' },
  { symbol: 'MAPL', name: 'Maple Tech Co.', sector: 'Technology', description: 'Simulated Canadian software firm' },
  { symbol: 'BRRY', name: 'Berry Farms Ltd.', sector: 'Agriculture', description: 'Simulated berry producer' },
  { symbol: 'NTHR', name: 'Northern Hydro', sector: 'Energy', description: 'Simulated utility' },
  { symbol: 'PIXL', name: 'Pixel Games', sector: 'Entertainment', description: 'Simulated game studio' },
];

export function seed() {
  migrate();
  const db = getDb();
  const now = nowIso();

  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    if (!config.seed.parentEmail || !config.seed.childEmail) {
      console.warn(
        'No users seeded: set PARENT_EMAIL and CHILD_EMAIL in env, then re-run db:seed'
      );
    } else {
      const parentId = newId();
      const childId = newId();
      const insertUser = db.prepare(`
        INSERT INTO users (id, email, display_name, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
      `);
      insertUser.run(parentId, config.seed.parentEmail, config.seed.parentName, 'parent', now, now);
      insertUser.run(childId, config.seed.childEmail, config.seed.childName, 'child', now, now);

      const insertAccount = db.prepare(`
        INSERT INTO accounts (id, user_id, type, name, currency, balance_cents, status, created_at)
        VALUES (?, ?, ?, ?, 'CAD', 0, 'active', ?)
      `);
      for (const def of ACCOUNT_DEFS) {
        insertAccount.run(newId(), childId, def.type, def.name, now);
      }

      db.prepare(`
        INSERT INTO interest_rules
          (id, annual_rate_bps, day_count, eligible_account_type, effective_from, effective_to, created_by, created_at)
        VALUES (?, 300, 'ACT_365_FIXED', 'savings', ?, NULL, ?, ?)
      `).run(newId(), '2020-01-01', parentId, now);

      console.log(`Seeded parent ${config.seed.parentEmail} and child ${config.seed.childEmail}`);
    }
  }

  const invCount = db.prepare('SELECT COUNT(*) AS c FROM investments').get().c;
  if (invCount === 0) {
    const insertInv = db.prepare(`
      INSERT INTO investments (id, symbol, name, sector, active, description)
      VALUES (?, ?, ?, ?, 1, ?)
    `);
    const insertPrice = db.prepare(`
      INSERT INTO market_prices (instrument_id, as_of, price_cents)
      VALUES (?, ?, ?)
    `);
    const asOf = now;
    for (const inst of SAMPLE_INSTRUMENTS) {
      const id = newId();
      insertInv.run(id, inst.symbol, inst.name, inst.sector, inst.description);
      const base = 1000 + Math.floor(Math.random() * 4000);
      insertPrice.run(id, asOf, base);
    }
    console.log('Seeded simulated investment marketplace');
  }

  const settings = [
    ['market.drift_bps_daily', JSON.stringify(5)],
    ['market.volatility_bps', JSON.stringify(150)],
    ['interest.day_count', JSON.stringify('ACT_365_FIXED')],
    ['brand.name', JSON.stringify('Family Bank')],
  ];
  const upsert = db.prepare(`
    INSERT INTO settings (key, value_json, updated_at, updated_by)
    VALUES (?, ?, ?, NULL)
    ON CONFLICT(key) DO NOTHING
  `);
  for (const [key, value] of settings) {
    upsert.run(key, value, now);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  seed();
  console.log('Seed complete');
}
