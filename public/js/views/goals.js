import { api, money } from '../api.js';
import { escapeHtml, pageHead, toast } from '../ui.js';

export async function renderGoals(root) {
  const [goals, accounts] = await Promise.all([api.goals(), api.accounts()]);
  root.innerHTML = `
    ${pageHead({ eyebrow: 'Savings goals', title: 'Earmark money you already have' })}
    <div class="banner info">Goal allocations never inflate total balances. They only reserve available cash.</div>
    <form class="inline" id="goal-form">
      <label>Name<input name="name" required /></label>
      <label>Target (CAD)<input name="targetAmount" type="number" min="0.01" step="0.01" required /></label>
      <label>Target date<input name="targetDate" type="date" /></label>
      <button class="btn primary" type="submit">Create goal</button>
    </form>
    <div class="stack" style="margin-top:1rem">
      ${goals.map((g) => `
        <div class="card accent-savings">
          <div class="page-head" style="margin:0">
            <h3>${escapeHtml(g.name)}</h3>
            <span class="badge approved">${g.progress_pct}%</span>
          </div>
          <p>${money(g.allocated_cents)} of ${money(g.target_cents)}</p>
          <div class="progress"><span style="width:${Math.min(100, g.progress_pct)}%"></span></div>
          <form class="inline alloc-form" data-goal="${g.id}">
            <label>From<select name="accountId">${accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)} (${money(a.available_cents)} avail)</option>`).join('')}</select></label>
            <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <button class="btn secondary" type="submit">Allocate</button>
          </form>
        </div>`).join('') || '<p class="muted">No goals yet.</p>'}
    </div>
  `;

  root.querySelector('#goal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api.createGoal({
      name: fd.get('name'),
      targetAmount: fd.get('targetAmount'),
      targetDate: fd.get('targetDate') || null,
    });
    toast('Goal created', 'success');
    location.reload();
  });

  root.querySelectorAll('.alloc-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await api.allocateGoal(form.getAttribute('data-goal'), {
          accountId: fd.get('accountId'),
          amount: fd.get('amount'),
        });
        toast('Allocation saved', 'success');
        location.reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}
