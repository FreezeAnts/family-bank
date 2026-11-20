function idem() {
  if (globalThis.crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  // HTTP LAN origins are not secure contexts, so randomUUID may be missing.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  if (options.method && options.method !== 'GET') {
    headers['Idempotency-Key'] = headers['Idempotency-Key'] || idem();
  }
  const res = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  me: () => request('/api/me'),
  logout: () => request('/auth/logout', { method: 'POST', body: {} }),
  dashboard: () => request('/api/dashboard'),
  accounts: (userId) => request(userId ? `/api/accounts?userId=${encodeURIComponent(userId)}` : '/api/accounts'),
  transactions: (accountId) => request(`/api/accounts/${accountId}/transactions`),
  transfer: (body) => request('/api/transfers', { method: 'POST', body }),
  createDeposit: (body) => request('/api/deposits', { method: 'POST', body }),
  deposits: () => request('/api/deposits'),
  createWithdrawal: (body) => request('/api/withdrawals', { method: 'POST', body }),
  withdrawals: () => request('/api/withdrawals'),
  chores: () => request('/api/chores'),
  claimChore: (id, body = {}) => request(`/api/chores/${id}/claim`, { method: 'POST', body }),
  choreClaims: () => request('/api/chore-claims'),
  goals: () => request('/api/goals'),
  createGoal: (body) => request('/api/goals', { method: 'POST', body }),
  allocateGoal: (id, body) => request(`/api/goals/${id}/allocate`, { method: 'POST', body }),
  market: () => request('/api/investments/market'),
  portfolio: () => request('/api/investments/portfolio'),
  order: (body) => request('/api/investments/orders', { method: 'POST', body }),
  priceHistory: (id) => request(`/api/investments/${id}/history`),
  adminOverview: () => request('/api/admin/overview'),
  approveDeposit: (id) => request(`/api/admin/approvals/deposits/${id}/approve`, { method: 'POST', body: {} }),
  rejectDeposit: (id) => request(`/api/admin/approvals/deposits/${id}/reject`, { method: 'POST', body: {} }),
  bankDeposit: (id) => request(`/api/admin/approvals/deposits/${id}/bank`, { method: 'POST', body: {} }),
  approveWithdrawal: (id) => request(`/api/admin/approvals/withdrawals/${id}/approve`, { method: 'POST', body: {} }),
  rejectWithdrawal: (id) => request(`/api/admin/approvals/withdrawals/${id}/reject`, { method: 'POST', body: {} }),
  paidWithdrawal: (id) => request(`/api/admin/approvals/withdrawals/${id}/paid`, { method: 'POST', body: {} }),
  approveChore: (id) => request(`/api/admin/approvals/chores/${id}/approve`, { method: 'POST', body: {} }),
  rejectChore: (id) => request(`/api/admin/approvals/chores/${id}/reject`, { method: 'POST', body: {} }),
  createChore: (body) => request('/api/admin/chores', { method: 'POST', body }),
  bonus: (body) => request('/api/admin/bonuses', { method: 'POST', body }),
  reconciliation: () => request('/api/admin/reconciliation'),
  audit: () => request('/api/admin/audit'),
  setInterest: (body) => request('/api/admin/interest', { method: 'POST', body }),
  accrueInterest: () => request('/api/admin/interest/accrue', { method: 'POST', body: {} }),
  creditInterest: () => request('/api/admin/interest/credit', { method: 'POST', body: {} }),
  tickMarket: () => request('/api/admin/investments/tick', { method: 'POST', body: {} }),
  users: () => request('/api/admin/users'),
  createUser: (body) => request('/api/admin/users', { method: 'POST', body }),
  openingBalance: (body) => request('/api/admin/accounts/opening-balance', { method: 'POST', body }),
  updateStatus: () => request('/api/admin/updates'),
  checkUpdates: () => request('/api/admin/updates/check', { method: 'POST', body: {} }),
  devLogin: (email) => request('/auth/dev-login', { method: 'POST', body: { email } }),
};

export function money(cents) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((cents || 0) / 100);
}
