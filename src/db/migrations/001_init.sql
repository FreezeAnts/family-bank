PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('parent', 'child')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  google_sub TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('chequing', 'savings', 'investment_cash')),
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  balance_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at TEXT NOT NULL,
  UNIQUE (user_id, type)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'posted', 'rejected', 'reversed', 'cancelled')),
  initiated_by TEXT NOT NULL REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  reference_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  related_request_id TEXT,
  posted_at TEXT,
  created_at TEXT NOT NULL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  account_id TEXT REFERENCES accounts(id),
  system_account TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL,
  CHECK (
    (account_id IS NOT NULL AND system_account IS NULL)
    OR (account_id IS NULL AND system_account IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ledger_txn ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(account_id);

CREATE TABLE IF NOT EXISTS deposit_requests (
  id TEXT PRIMARY KEY,
  child_user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  child_note TEXT,
  parent_note TEXT,
  cash_received_at TEXT,
  bank_deposited_at TEXT,
  transaction_id TEXT REFERENCES transactions(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id TEXT PRIMARY KEY,
  child_user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  child_note TEXT,
  parent_note TEXT,
  cash_paid_at TEXT,
  transaction_id TEXT REFERENCES transactions(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chores (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  destination_account_type TEXT NOT NULL DEFAULT 'chequing'
    CHECK (destination_account_type IN ('chequing', 'savings', 'investment_cash')),
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chore_claims (
  id TEXT PRIMARY KEY,
  chore_id TEXT NOT NULL REFERENCES chores(id),
  child_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TEXT NOT NULL,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  transaction_id TEXT REFERENCES transactions(id),
  note TEXT
);

CREATE TABLE IF NOT EXISTS interest_rules (
  id TEXT PRIMARY KEY,
  annual_rate_bps INTEGER NOT NULL CHECK (annual_rate_bps >= 0),
  day_count TEXT NOT NULL DEFAULT 'ACT_365_FIXED',
  eligible_account_type TEXT NOT NULL DEFAULT 'savings',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interest_daily_accrual (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  business_date TEXT NOT NULL,
  closing_balance_cents INTEGER NOT NULL,
  rate_bps INTEGER NOT NULL,
  accrual_cents INTEGER NOT NULL,
  credited INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account_id, business_date)
);

CREATE TABLE IF NOT EXISTS interest_history (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  total_accrual_cents INTEGER NOT NULL,
  transaction_id TEXT REFERENCES transactions(id),
  posted_at TEXT NOT NULL,
  UNIQUE (account_id, period_year, period_month)
);

CREATE TABLE IF NOT EXISTS savings_goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  target_cents INTEGER NOT NULL CHECK (target_cents > 0),
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goal_allocations (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES savings_goals(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS investments (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sector TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT
);

CREATE TABLE IF NOT EXISTS market_prices (
  instrument_id TEXT NOT NULL REFERENCES investments(id),
  as_of TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  PRIMARY KEY (instrument_id, as_of)
);

CREATE TABLE IF NOT EXISTS investment_holdings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  instrument_id TEXT NOT NULL REFERENCES investments(id),
  quantity_milli INTEGER NOT NULL DEFAULT 0,
  avg_cost_cents_per_share INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, instrument_id)
);

CREATE TABLE IF NOT EXISTS investment_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  instrument_id TEXT NOT NULL REFERENCES investments(id),
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  price_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  transaction_id TEXT REFERENCES transactions(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_reconciliation (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('cash_received', 'bank_deposit', 'cash_paid', 'adjustment')),
  amount_cents INTEGER NOT NULL,
  related_request_id TEXT,
  recorded_by TEXT NOT NULL REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
