import { api, money } from '../api.js';
import { escapeHtml, pageHead, statusBadge, toast } from '../ui.js';

export async function renderActivity(root) {
  const [deposits, withdrawals, accounts] = await Promise.all([
    api.deposits(),
    api.withdrawals(),
    api.accounts(),
  ]);

  root.innerHTML = `
    ${pageHead({ eyebrow: 'Cash movement', title: 'Deposit & withdrawal requests' })}
    <div class="layout-2">
      <div class="stack">
        <div class="card">
          <h3>Request deposit</h3>
          <p class="muted">Give physical cash to your parent. Money becomes available only after they verify it.</p>
          <form class="inline" id="dep-form" style="margin-top:.75rem">
            <label>Account<select name="accountId" required>${accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select></label>
            <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Note<input name="note" placeholder="Optional" /></label>
            <button class="btn primary" type="submit">Submit deposit</button>
          </form>
          <div id="dep-state" class="state-banner default">Enter a valid CAD amount</div>
        </div>
        <div class="card">
          <h3>Request withdrawal</h3>
          <p class="muted">Parent reviews, then pays cash. Available balance is checked before submit.</p>
          <form class="inline" id="wd-form" style="margin-top:.75rem">
            <label>Account<select name="accountId" required>${accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select></label>
            <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Note<input name="note" placeholder="Optional" /></label>
            <button class="btn primary" type="submit">Submit withdrawal</button>
          </form>
          <div id="wd-state" class="state-banner default">Enter a valid CAD amount</div>
        </div>
      </div>
      <div class="card">
        <h3>What happens next</h3>
        <ol class="muted">
          <li>You submit a request.</li>
          <li>Parent verifies cash in/out.</li>
          <li>Approved amounts update your ledger.</li>
          <li>Banking the cash is tracked separately from approval.</li>
        </ol>
      </div>
    </div>
    <div class="card" style="margin-top:1rem">
      <h3>Your requests</h3>
      <table>
        <thead><tr><th>Type</th><th>Amount</th><th>Status</th><th>When</th></tr></thead>
        <tbody>
          ${[...deposits.map((d) => ({ ...d, kind: 'Deposit' })), ...withdrawals.map((w) => ({ ...w, kind: 'Withdrawal' }))]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((r) => `<tr>
              <td>${r.kind}</td>
              <td>${money(r.amount_cents)}</td>
              <td>${statusBadge(r.status)}</td>
              <td>${new Date(r.created_at).toLocaleString()}</td>
            </tr>`).join('') || '<tr><td colspan="4">No requests yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  async function submitForm(formId, stateId, fn) {
    const form = root.querySelector(formId);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const state = root.querySelector(stateId);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.classList.add('disabled');
      state.className = 'state-banner loading';
      state.textContent = 'Submitting request…';
      try {
        const fd = new FormData(form);
        await fn(fd);
        state.className = 'state-banner pending';
        state.textContent = 'Awaiting parent approval';
        toast('Request submitted', 'success');
        setTimeout(() => location.reload(), 700);
      } catch (err) {
        state.className = 'state-banner error';
        state.textContent = err.message;
        btn.disabled = false;
        btn.classList.remove('disabled');
      }
    });
  }

  await submitForm('#dep-form', '#dep-state', (fd) => api.createDeposit({
    accountId: fd.get('accountId'),
    amount: fd.get('amount'),
    note: fd.get('note'),
  }));
  await submitForm('#wd-form', '#wd-state', (fd) => api.createWithdrawal({
    accountId: fd.get('accountId'),
    amount: fd.get('amount'),
    note: fd.get('note'),
  }));
}
