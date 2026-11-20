import { api, money } from '../api.js';
import { confirmModal, escapeHtml, kpi, pageHead, statusBadge, toast } from '../ui.js';

async function loadBundle() {
  const [overview, recon, audit, users] = await Promise.all([
    api.adminOverview(),
    api.reconciliation(),
    api.audit(),
    api.users(),
  ]);
  return { overview, recon, audit, users };
}

function navQuick() {
  return `
    <div class="card">
      <h3>Quick actions</h3>
      <div class="quick-actions" style="margin-top:.75rem">
        <a class="btn secondary" href="#/parent/approvals">Review approvals</a>
        <a class="btn secondary" href="#/parent/chores">Create chore</a>
        <a class="btn secondary" href="#/parent/earnings">Award bonus</a>
        <a class="btn secondary" href="#/parent/interest">Manage interest</a>
        <a class="btn secondary" href="#/parent/reconciliation">Cash reconciliation</a>
      </div>
    </div>`;
}

async function act(label, fn) {
  try {
    await fn();
    toast(label, 'success');
    location.reload();
  } catch (err) {
    toast(err.message, 'error');
  }
}

export async function renderParent(root, section = 'overview') {
  const { overview, recon, audit, users } = await loadBundle();
  const childOptions = overview.children
    .map((c) => `<option value="${c.id}">${escapeHtml(c.display_name)}</option>`)
    .join('');

  if (section === 'overview') {
    root.innerHTML = `
      ${pageHead({ eyebrow: 'Parent', title: 'Family overview' })}
      <div class="grid">
        ${kpi('Total balances', money(overview.cash.virtual_balances_cents))}
        ${kpi('Cash held by parent', money(overview.cash.cash_held_by_parent_cents))}
        ${kpi('Pending approvals', String(
          overview.pending.deposits.length +
          overview.pending.withdrawals.length +
          overview.pending.choreClaims.length
        ))}
        ${kpi('Banked', money(overview.cash.bank_deposited_cents))}
      </div>
      <div class="layout-2" style="margin-top:1rem">
        <div class="card">
          <h3>Children</h3>
          <div class="grid" style="margin-top:.75rem">
            ${overview.children.map((c) => `
              <div class="card">
                <p class="label">${escapeHtml(c.display_name)}</p>
                <p class="value">${money(c.accounts.reduce((s, a) => s + a.balance_cents, 0))}</p>
                <p class="muted">${escapeHtml(c.email)}</p>
              </div>`).join('') || '<p class="muted">No children yet.</p>'}
          </div>
        </div>
        ${navQuick()}
      </div>
    `;
    return;
  }

  if (section === 'approvals') {
    const rows = [
      ...overview.pending.deposits.map((d) => ({
        kind: 'Deposit',
        id: d.id,
        who: d.child_name,
        detail: d.account_name,
        amount: d.amount_cents,
        approve: 'dep-approve',
        reject: 'dep-reject',
        confirm: `Approve ${money(d.amount_cents)} cash deposit? This makes the amount available after you confirm physical cash was received.`,
      })),
      ...overview.pending.withdrawals.map((w) => ({
        kind: 'Withdrawal',
        id: w.id,
        who: w.child_name,
        detail: w.account_name,
        amount: w.amount_cents,
        approve: 'wd-approve',
        reject: 'wd-reject',
        confirm: `Approve ${money(w.amount_cents)} withdrawal? This debits the account. Confirm you will pay cash.`,
      })),
      ...overview.pending.choreClaims.map((c) => ({
        kind: 'Chore',
        id: c.id,
        who: c.child_name,
        detail: c.title,
        amount: c.amount_cents,
        approve: 'ch-approve',
        reject: 'ch-reject',
        confirm: `Approve chore payout of ${money(c.amount_cents)} for “${c.title}”?`,
      })),
    ];

    root.innerHTML = `
      ${pageHead({ eyebrow: 'Approvals', title: 'Approval centre' })}
      <div class="grid">
        ${kpi('Pending deposits', String(overview.pending.deposits.length))}
        ${kpi('Pending withdrawals', String(overview.pending.withdrawals.length))}
        ${kpi('Chore submissions', String(overview.pending.choreClaims.length))}
      </div>
      <div class="stack" style="margin-top:1rem" id="approval-list">
        ${rows.map((r) => `
          <div class="card">
            <div class="page-head" style="margin:0">
              <div>
                <p class="eyebrow">${escapeHtml(r.kind)}</p>
                <h3>${escapeHtml(r.who)} · ${money(r.amount)}</h3>
                <p class="muted">${escapeHtml(r.detail)}</p>
              </div>
              ${statusBadge('pending')}
            </div>
            <div class="actions" style="margin-top:.85rem">
              <button class="btn ok" data-act="${r.approve}" data-id="${r.id}" data-confirm="${escapeHtml(r.confirm)}">Approve</button>
              <button class="btn danger" data-act="${r.reject}" data-id="${r.id}">Reject</button>
            </div>
          </div>`).join('') || '<div class="state-banner success">Nothing pending.</div>'}
      </div>
    `;

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const actName = btn.getAttribute('data-act');
      const id = btn.getAttribute('data-id');
      if (actName.endsWith('approve')) {
        const ok = await confirmModal({
          title: 'Confirm approval',
          body: btn.getAttribute('data-confirm'),
          confirmLabel: 'Approve',
        });
        if (!ok) return;
      } else {
        const ok = await confirmModal({
          title: 'Reject request?',
          body: 'This will not create ledger entries.',
          confirmLabel: 'Reject',
          danger: true,
        });
        if (!ok) return;
      }
      btn.disabled = true;
      if (actName === 'dep-approve') await act('Deposit approved', () => api.approveDeposit(id));
      if (actName === 'dep-reject') await act('Deposit rejected', () => api.rejectDeposit(id));
      if (actName === 'wd-approve') await act('Withdrawal approved', () => api.approveWithdrawal(id));
      if (actName === 'wd-reject') await act('Withdrawal rejected', () => api.rejectWithdrawal(id));
      if (actName === 'ch-approve') await act('Chore approved', () => api.approveChore(id));
      if (actName === 'ch-reject') await act('Chore rejected', () => api.rejectChore(id));
    });
    return;
  }

  if (section === 'deposits') {
    const deposits = await api.deposits();
    root.innerHTML = `
      ${pageHead({ eyebrow: 'Deposits', title: 'Deposit management' })}
      <div class="grid">
        ${kpi('Cash received', money(overview.cash.cash_received_cents))}
        ${kpi('Banked', money(overview.cash.bank_deposited_cents))}
        ${kpi('Held by parent', money(overview.cash.cash_held_by_parent_cents))}
      </div>
      <div class="card" style="margin-top:1rem">
        <table>
          <thead><tr><th>Child</th><th>Amount</th><th>Status</th><th>Cash / Bank</th><th></th></tr></thead>
          <tbody>
            ${deposits.map((d) => `<tr>
              <td>${escapeHtml(d.child_name || d.child_user_id)}</td>
              <td>${money(d.amount_cents)}</td>
              <td>${statusBadge(d.status)}</td>
              <td>${d.cash_received_at ? 'Received' : '—'} / ${d.bank_deposited_at ? 'Banked' : 'Not banked'}</td>
              <td class="actions">
                ${d.status === 'approved' && !d.bank_deposited_at
                  ? `<button class="btn secondary" data-bank="${d.id}">Mark banked</button>`
                  : ''}
              </td>
            </tr>`).join('') || '<tr><td colspan="5">No deposits</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    root.addEventListener('click', async (e) => {
      const id = e.target.getAttribute('data-bank');
      if (!id) return;
      const ok = await confirmModal({
        title: 'Mark bank deposit?',
        body: 'Records that physical cash reached your real bank. Does not change the child virtual balance.',
        confirmLabel: 'Mark banked',
      });
      if (!ok) return;
      await act('Marked banked', () => api.bankDeposit(id));
    });
    return;
  }

  if (section === 'withdrawals') {
    const withdrawals = await api.withdrawals();
    root.innerHTML = `
      ${pageHead({ eyebrow: 'Withdrawals', title: 'Withdrawal management' })}
      <div class="grid">
        ${kpi('Cash paid out', money(overview.cash.cash_paid_cents))}
        ${kpi('Pending', String(overview.pending.withdrawals.length))}
      </div>
      <div class="card" style="margin-top:1rem">
        <table>
          <thead><tr><th>Child</th><th>Amount</th><th>Status</th><th>Paid</th><th></th></tr></thead>
          <tbody>
            ${withdrawals.map((w) => `<tr>
              <td>${escapeHtml(w.child_name || w.child_user_id)}</td>
              <td>${money(w.amount_cents)}</td>
              <td>${statusBadge(w.status)}</td>
              <td>${w.cash_paid_at ? new Date(w.cash_paid_at).toLocaleString() : '—'}</td>
              <td>${w.status === 'approved' && !w.cash_paid_at
                ? `<button class="btn secondary" data-paid="${w.id}">Mark paid</button>`
                : ''}</td>
            </tr>`).join('') || '<tr><td colspan="5">No withdrawals</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    root.addEventListener('click', async (e) => {
      const id = e.target.getAttribute('data-paid');
      if (!id) return;
      const ok = await confirmModal({
        title: 'Confirm cash paid?',
        body: 'Records that cash was physically paid to the child.',
        confirmLabel: 'Mark paid',
      });
      if (!ok) return;
      await act('Marked paid', () => api.paidWithdrawal(id));
    });
    return;
  }

  if (section === 'chores') {
    root.innerHTML = `
      ${pageHead({ eyebrow: 'Chores', title: 'Chore management' })}
      <div class="card">
        <h3>Create chore</h3>
        <form class="inline" id="chore-form" style="margin-top:.75rem">
          <label>Title<input name="title" required /></label>
          <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Pays to<select name="destinationAccountType">
            <option value="chequing">Chequing</option>
            <option value="savings">Savings</option>
            <option value="investment_cash">Investment Cash</option>
          </select></label>
          <label>Description<input name="description" /></label>
          <button class="btn primary" type="submit">Add chore</button>
        </form>
      </div>
      <div class="card" style="margin-top:1rem">
        <h3>Pending chore claims</h3>
        <p class="muted">Approve from Approval centre, or open Approvals for confirmation.</p>
        <a class="btn secondary" href="#/parent/approvals">Open approvals</a>
      </div>
    `;
    root.querySelector('#chore-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await act('Chore created', () => api.createChore(Object.fromEntries(fd.entries())));
    });
    return;
  }

  if (section === 'earnings') {
    root.innerHTML = `
      ${pageHead({ eyebrow: 'Earnings', title: 'Bonuses & earnings' })}
      <div class="card">
        <h3>Award bonus</h3>
        <form class="inline" id="bonus-form" style="margin-top:.75rem">
          <label>Child<select name="childUserId">${childOptions}</select></label>
          <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Account<select name="accountType">
            <option value="chequing">Chequing</option>
            <option value="savings">Savings</option>
            <option value="investment_cash">Investment Cash</option>
          </select></label>
          <label>Note<input name="description" value="Bonus" /></label>
          <button class="btn ok" type="submit">Award</button>
        </form>
      </div>
    `;
    root.querySelector('#bonus-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const ok = await confirmModal({
        title: 'Award bonus?',
        body: `Post ${fd.get('amount')} CAD bonus to the selected account.`,
        confirmLabel: 'Award bonus',
      });
      if (!ok) return;
      await act('Bonus posted', () => api.bonus(Object.fromEntries(fd.entries())));
    });
    return;
  }

  if (section === 'interest') {
    root.innerHTML = `
      ${pageHead({ eyebrow: 'Interest', title: 'Savings interest' })}
      <div class="banner info">Day-count ACT/365 Fixed. Accrues on savings closing balances only. Rate changes never rewrite history.</div>
      <div class="grid">
        ${overview.interestRules.slice(0, 1).map((r) => kpi('Current rate', `${(r.annual_rate_bps / 100).toFixed(2)}%`)).join('') || kpi('Current rate', '—')}
      </div>
      <div class="card" style="margin-top:1rem">
        <form class="inline" id="rate-form">
          <label>Rate (bps)<input name="annualRateBps" type="number" min="0" value="300" required /></label>
          <button class="btn primary" type="submit">Set rate</button>
        </form>
        <div class="row" style="margin-top:.75rem">
          <button class="btn secondary" id="accrue">Accrue today</button>
          <button class="btn secondary" id="credit">Credit month</button>
        </div>
      </div>
    `;
    root.querySelector('#rate-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await act('Interest rate updated', () => api.setInterest({ annualRateBps: Number(fd.get('annualRateBps')) }));
    });
    root.querySelector('#accrue').onclick = () => act('Interest accrued', () => api.accrueInterest());
    root.querySelector('#credit').onclick = () => act('Interest credited', () => api.creditInterest());
    return;
  }

  if (section === 'investments') {
    root.innerHTML = `
      ${pageHead({ eyebrow: 'Investments', title: 'Simulated market admin' })}
      <div class="banner sim">Educational market only — no real securities.</div>
      <div class="card">
        <button class="btn primary" id="tick">Tick simulated market</button>
      </div>
    `;
    root.querySelector('#tick').onclick = () => act('Market ticked', () => api.tickMarket());
    return;
  }

  if (section === 'reconciliation') {
    root.innerHTML = `
      ${pageHead({ eyebrow: 'Cash', title: 'Reconciliation' })}
      <div class="grid">
        ${kpi('Virtual balances', money(recon.summary.virtual_balances_cents))}
        ${kpi('Cash received', money(recon.summary.cash_received_cents))}
        ${kpi('Bank deposited', money(recon.summary.bank_deposited_cents))}
        ${kpi('Held by parent', money(recon.summary.cash_held_by_parent_cents))}
      </div>
      <div class="card" style="margin-top:1rem">
        <table>
          <thead><tr><th>When</th><th>Type</th><th>Amount</th><th>By</th><th>Note</th></tr></thead>
          <tbody>
            ${recon.events.map((e) => `<tr>
              <td>${new Date(e.created_at).toLocaleString()}</td>
              <td>${escapeHtml(e.event_type)}</td>
              <td>${money(e.amount_cents)}</td>
              <td>${escapeHtml(e.recorded_by_name)}</td>
              <td>${escapeHtml(e.note || '')}</td>
            </tr>`).join('') || '<tr><td colspan="5">No events</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  // settings
  let updateInfo = { currentVersion: '—', lastCheckUtc: null, releaseUrl: '#', repo: '' };
  try {
    updateInfo = await api.updateStatus();
  } catch {
    /* non-fatal */
  }

  root.innerHTML = `
    ${pageHead({ eyebrow: 'System', title: 'Audit & settings' })}
    <div class="grid">
      ${kpi('Users', String(users.length))}
      ${kpi('Audit events', String(audit.length))}
      ${kpi('Version', escapeHtml(updateInfo.currentVersion || '—'))}
    </div>
    <div class="card" style="margin-top:1rem" id="update-card">
      <h3>Updates</h3>
      <p class="muted" style="margin-top:.5rem">
        Checks the public GitHub Releases feed (same pattern as Unison). Applying an update uses
        <code>deploy/update-from-github.sh</code> on the host.
      </p>
      <p class="muted" id="update-status" style="margin-top:.75rem">
        ${updateInfo.lastCheckUtc
          ? `Last checked ${escapeHtml(new Date(updateInfo.lastCheckUtc).toLocaleString())}.`
          : 'Not checked yet.'}
      </p>
      <div class="row" style="margin-top:.75rem">
        <button class="btn primary" type="button" id="check-updates">Check for updates</button>
        <a class="btn secondary" href="${escapeHtml(updateInfo.releaseUrl || '#')}" target="_blank" rel="noopener">Releases</a>
      </div>
    </div>
    <div class="card" style="margin-top:1rem">
      <h3>Add family user</h3>
      <form class="inline" id="user-form" style="margin-top:.75rem">
        <label>Email<input name="email" type="email" required /></label>
        <label>Name<input name="displayName" required /></label>
        <label>Role<select name="role"><option value="child">child</option><option value="parent">parent</option></select></label>
        <button class="btn primary" type="submit">Create</button>
      </form>
    </div>
    <div class="card" style="margin-top:1rem">
      <h3>Opening balance</h3>
      <form class="inline" id="open-form" style="margin-top:.75rem">
        <label>Account ID<input name="accountId" required /></label>
        <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
        <button class="btn secondary" type="submit">Post opening</button>
      </form>
    </div>
    <div class="card" style="margin-top:1rem">
      <h3>Audit log</h3>
      <table>
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead>
        <tbody>
          ${audit.slice(0, 40).map((a) => `<tr>
            <td>${new Date(a.created_at).toLocaleString()}</td>
            <td>${escapeHtml(a.actor_name || a.actor_email || '—')}</td>
            <td>${escapeHtml(a.action)}</td>
            <td>${escapeHtml(a.entity_type)} ${escapeHtml(a.entity_id || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  root.querySelector('#check-updates')?.addEventListener('click', async () => {
    const statusEl = root.querySelector('#update-status');
    const btn = root.querySelector('#check-updates');
    if (btn) btn.disabled = true;
    try {
      const result = await api.checkUpdates();
      if (result.errorMessage) {
        if (statusEl) statusEl.textContent = result.errorMessage;
        toast(result.errorMessage, 'error');
        return;
      }
      if (result.updateAvailable) {
        const msg = `Update available: ${result.currentVersion} → ${result.latestVersion}`;
        if (statusEl) {
          statusEl.innerHTML = `${escapeHtml(msg)}. <a href="${escapeHtml(result.releaseUrl)}" target="_blank" rel="noopener">View release</a>`;
        }
        toast(msg, 'success');
      } else {
        const msg = `Up to date (v${result.latestVersion || result.currentVersion}).`;
        if (statusEl) statusEl.textContent = msg;
        toast(msg, 'success');
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message;
      toast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  root.querySelector('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await act('User created', () => api.createUser(Object.fromEntries(fd.entries())));
  });
  root.querySelector('#open-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const ok = await confirmModal({
      title: 'Post opening balance?',
      body: 'Only allowed on zero-balance accounts.',
      confirmLabel: 'Post opening',
    });
    if (!ok) return;
    await act('Opening balance posted', () => api.openingBalance(Object.fromEntries(fd.entries())));
  });
}
