import { api, money } from '../api.js';
import { escapeHtml, pageHead, statusBadge, toast } from '../ui.js';

function accent(type) {
  if (type === 'savings') return 'accent-savings';
  if (type === 'investment_cash') return 'accent-invest';
  return 'accent-chequing';
}

export async function renderAccounts(root) {
  const accounts = await api.accounts();
  root.innerHTML = `
    ${pageHead({ eyebrow: 'Accounts', title: 'Chequing, savings & investment cash' })}
    <div class="grid" id="acct-cards"></div>
    <div class="layout-2" style="margin-top:1rem">
      <div class="card">
        <h3>Transfer between your accounts</h3>
        <form class="inline" id="transfer-form" style="margin-top:.75rem">
          <label>From<select name="fromAccountId" required></select></label>
          <label>To<select name="toAccountId" required></select></label>
          <label>Amount (CAD)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <button class="btn primary" type="submit">Transfer</button>
        </form>
        <div id="transfer-state"></div>
      </div>
      <div class="card">
        <h3>Account notes</h3>
        <p class="muted">Available excludes money earmarked for savings goals. Investment cash funds the simulated market only.</p>
      </div>
    </div>
    <div class="card" style="margin-top:1rem">
      <div class="page-head" style="margin:0 0 .75rem">
        <h3>Recent activity</h3>
        <select id="hist-account"></select>
      </div>
      <div id="txns"></div>
    </div>
  `;

  const cards = root.querySelector('#acct-cards');
  const from = root.querySelector('[name=fromAccountId]');
  const to = root.querySelector('[name=toAccountId]');
  const hist = root.querySelector('#hist-account');

  cards.innerHTML = accounts.map((a) => `
    <div class="card ${accent(a.type)}">
      <p class="label">${escapeHtml(a.name)}</p>
      <p class="value">${money(a.balance_cents)}</p>
      <p class="muted">Available ${money(a.available_cents)} · Earmarked ${money(a.earmarked_cents)}</p>
    </div>`).join('');

  for (const a of accounts) {
    const opt = `<option value="${a.id}">${escapeHtml(a.name)}</option>`;
    from.innerHTML += opt;
    to.innerHTML += opt;
    hist.innerHTML += opt;
  }

  async function loadTx(accountId) {
    const rows = await api.transactions(accountId);
    root.querySelector('#txns').innerHTML = `
      <table>
        <thead><tr><th>When</th><th>Type</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr>
            <td>${new Date(r.created_at).toLocaleString()}</td>
            <td>${escapeHtml(r.type)}</td>
            <td>${escapeHtml(r.description)}</td>
            <td>${r.direction === 'debit' ? '+' : '−'}${money(r.amount_cents)}</td>
            <td>${statusBadge(r.status)}</td>
          </tr>`).join('') || '<tr><td colspan="5">No transactions yet</td></tr>'}
        </tbody>
      </table>`;
  }

  if (accounts[0]) await loadTx(accounts[0].id);
  hist.addEventListener('change', () => loadTx(hist.value));

  root.querySelector('#transfer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const state = root.querySelector('#transfer-state');
    state.innerHTML = `<div class="state-banner loading">Checking available balance…</div>`;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const fd = new FormData(e.target);
      await api.transfer({
        fromAccountId: fd.get('fromAccountId'),
        toAccountId: fd.get('toAccountId'),
        amount: fd.get('amount'),
      });
      state.innerHTML = `<div class="state-banner success">Transfer posted</div>`;
      toast('Transfer complete', 'success');
      location.reload();
    } catch (err) {
      state.innerHTML = `<div class="state-banner error">${escapeHtml(err.message)}</div>`;
      btn.disabled = false;
    }
  });
}
