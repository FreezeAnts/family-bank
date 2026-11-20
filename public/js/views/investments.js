import { api, money } from '../api.js';
import { escapeHtml, pageHead, toast } from '../ui.js';

export async function renderInvestments(root) {
  const [market, portfolio] = await Promise.all([api.market(), api.portfolio()]);
  const marketValue = portfolio.holdings.reduce((s, h) => s + h.market_value_cents, 0);
  const pl = portfolio.holdings.reduce((s, h) => s + h.unrealized_pl_cents, 0);

  root.innerHTML = `
    <div class="banner sim">Simulated market — not real money or securities.</div>
    ${pageHead({ eyebrow: 'Investments', title: 'Marketplace & portfolio' })}
    <div class="grid">
      <div class="card accent-invest sim"><p class="label">Holdings value</p><p class="value">${money(marketValue)}</p><span class="badge sim">Simulated</span></div>
      <div class="card accent-invest sim"><p class="label">Unrealized P/L</p><p class="value">${money(pl)}</p><span class="badge sim">Simulated</span></div>
    </div>
    <div class="card" style="margin-top:1rem">
      <h3>Your holdings</h3>
      <table>
        <thead><tr><th>Symbol</th><th>Qty</th><th>Price</th><th>Value</th><th>P/L</th></tr></thead>
        <tbody>
          ${portfolio.holdings.map((h) => `<tr>
            <td>${escapeHtml(h.symbol)}</td>
            <td>${(h.quantity_milli / 1000).toFixed(3)}</td>
            <td>${money(h.price_cents)}</td>
            <td>${money(h.market_value_cents)}</td>
            <td>${money(h.unrealized_pl_cents)}</td>
          </tr>`).join('') || '<tr><td colspan="5">No holdings yet. Transfer into Investment Cash, then buy.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="section-title" style="margin:1rem 0 .75rem"><h3>Marketplace</h3></div>
    <div class="grid">
      ${market.map((m) => `
        <div class="card sim accent-invest">
          <p class="label">${escapeHtml(m.symbol)} · ${escapeHtml(m.sector || '')}</p>
          <p class="value">${money(m.price_cents)}</p>
          <p class="muted">${escapeHtml(m.name)}</p>
          <canvas id="chart-${m.id}" height="90"></canvas>
          <form class="inline order-form" data-id="${m.id}">
            <label>Shares<input name="shares" type="number" min="0.001" step="0.001" value="1" required /></label>
            <button class="btn ok" name="side" value="buy" type="submit">Buy</button>
            <button class="btn danger" name="side" value="sell" type="submit">Sell</button>
          </form>
        </div>`).join('')}
    </div>
  `;

  for (const m of market) {
    try {
      const hist = await api.priceHistory(m.id);
      const canvas = root.querySelector(`#chart-${m.id}`);
      if (canvas && window.Chart && hist.length) {
        new Chart(canvas, {
          type: 'line',
          data: {
            labels: hist.map((p) => p.as_of.slice(5, 16)),
            datasets: [{
              data: hist.map((p) => p.price_cents / 100),
              borderColor: '#7c3aed',
              tension: 0.3,
              pointRadius: 0,
            }],
          },
          options: {
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { ticks: { callback: (v) => `$${v}` } } },
          },
        });
      }
    } catch {
      /* ignore */
    }
  }

  root.querySelectorAll('.order-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const side = e.submitter?.value || 'buy';
      const shares = Number(new FormData(form).get('shares'));
      try {
        await api.order({
          instrumentId: form.getAttribute('data-id'),
          side,
          quantityMilli: Math.round(shares * 1000),
        });
        toast(`${side} order filled (simulated)`, 'success');
        location.reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}
