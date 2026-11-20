import { api, money } from '../api.js';
import { escapeHtml, pageHead, statusBadge, toast } from '../ui.js';

export async function renderEarn(root) {
  const [chores, claims] = await Promise.all([api.chores(), api.choreClaims()]);
  root.innerHTML = `
    ${pageHead({ eyebrow: 'Chore centre', title: 'Earn money for completed work' })}
    <div class="grid">
      ${chores.map((c) => `
        <div class="card">
          <p class="label">${escapeHtml(c.title)}</p>
          <p class="value">${money(c.amount_cents)}</p>
          <p class="muted">${escapeHtml(c.description || 'No description')} · pays to ${escapeHtml(c.destination_account_type)}</p>
          <button class="btn primary" data-claim="${c.id}" style="margin-top:.75rem">Mark complete</button>
        </div>`).join('') || '<p class="muted">No chores available.</p>'}
    </div>
    <div class="card" style="margin-top:1rem">
      <h3>Your submissions</h3>
      <table>
        <thead><tr><th>Chore</th><th>Amount</th><th>Status</th><th>Submitted</th></tr></thead>
        <tbody>
          ${claims.map((c) => `<tr>
            <td>${escapeHtml(c.title)}</td>
            <td>${money(c.amount_cents)}</td>
            <td>${statusBadge(c.status)}</td>
            <td>${new Date(c.submitted_at).toLocaleString()}</td>
          </tr>`).join('') || '<tr><td colspan="4">No claims yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  root.addEventListener('click', async (e) => {
    const id = e.target.getAttribute('data-claim');
    if (!id) return;
    e.target.disabled = true;
    try {
      await api.claimChore(id);
      toast('Submitted for approval', 'success');
      location.reload();
    } catch (err) {
      toast(err.message, 'error');
      e.target.disabled = false;
    }
  });
}
