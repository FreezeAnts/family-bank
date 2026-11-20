import { api, money } from '../api.js';
import { escapeHtml, kpi, pageHead, statusBadge } from '../ui.js';

export async function renderDashboard(root) {
  const data = await api.dashboard();
  if (data.role === 'parent') {
    location.hash = '#/parent';
    return;
  }

  const name = data.user?.displayName || 'there';
  const accounts = data.accounts || [];
  const byType = Object.fromEntries(accounts.map((a) => [a.type, a]));
  let recent = [];
  if (accounts[0]) {
    recent = await api.transactions(accounts[0].id);
  }

  root.innerHTML = `
    ${pageHead({
      eyebrow: new Date().toLocaleDateString('en-CA', { month: 'long', year: 'numeric' }),
      title: `Good morning, ${name}`,
    })}
    <div class="grid">
      ${kpi('Total available money', money(data.totals.availableCents))}
      ${kpi('Chequing', money(byType.chequing?.balance_cents || 0), 'accent-chequing')}
      ${kpi('Savings', money(byType.savings?.balance_cents || 0), 'accent-savings')}
      ${kpi('Investments portfolio', money(data.portfolioSummary.marketValueCents), 'accent-invest')}
    </div>

    <div class="layout-2" style="margin-top:1rem">
      <div class="stack">
        <div class="card">
          <h3>Quick actions</h3>
          <div class="quick-actions" style="margin-top:.75rem">
            <a class="btn primary" href="#/activity">Deposit money</a>
            <a class="btn secondary" href="#/accounts">Transfer</a>
            <a class="btn secondary" href="#/activity">Request withdrawal</a>
            <a class="btn secondary" href="#/earn">Chore centre</a>
            <a class="btn secondary" href="#/goals">Savings goals</a>
          </div>
        </div>
        <div class="card">
          <h3>Recent activity</h3>
          <table>
            <thead><tr><th>When</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              ${recent.slice(0, 6).map((r) => `<tr>
                <td>${new Date(r.created_at).toLocaleDateString()}</td>
                <td>${escapeHtml(r.description)}</td>
                <td>${r.direction === 'debit' ? '+' : '−'}${money(r.amount_cents)}</td>
                <td>${statusBadge(r.status)}</td>
              </tr>`).join('') || '<tr><td colspan="4">No transactions yet</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <h3>Pending requests</h3>
          <p class="muted">Deposits waiting for cash verification are not yet available.</p>
          <div class="grid" style="margin-top:.75rem">
            ${kpi('Deposits', String(data.pending.deposits))}
            ${kpi('Withdrawals', String(data.pending.withdrawals))}
            ${kpi('Chore claims', String(data.pending.choreClaims))}
          </div>
        </div>
        <div class="card sim">
          <p class="label">Simulated portfolio P/L</p>
          <p class="value">${money(data.portfolioSummary.unrealizedPlCents)}</p>
          <span class="badge sim">Simulated</span>
        </div>
      </div>
    </div>
  `;
}
