export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function statusBadge(status) {
  const s = String(status || 'pending').toLowerCase();
  const cls = s.includes('approv') || s === 'posted' || s === 'success'
    ? 'approved'
    : s.includes('reject') || s === 'error' || s === 'cancelled'
      ? 'rejected'
      : 'pending';
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

export function toast(message, type = 'info') {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function confirmModal({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const host = document.getElementById('modal-host');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    const confirmBtn = document.getElementById('modal-confirm');
    titleEl.textContent = title;
    bodyEl.textContent = body;
    confirmBtn.textContent = confirmLabel;
    confirmBtn.className = danger ? 'btn danger' : 'btn primary';
    host.classList.remove('hidden');

    const cleanup = (result) => {
      host.classList.add('hidden');
      host.removeEventListener('click', onClick);
      confirmBtn.onclick = null;
      resolve(result);
    };
    const onClick = (e) => {
      if (e.target.hasAttribute('data-close-modal')) cleanup(false);
    };
    host.addEventListener('click', onClick);
    confirmBtn.onclick = () => cleanup(true);
  });
}

export function pageHead({ eyebrow, title, actions = '' }) {
  return `
    <div class="page-head">
      <div>
        ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="actions">${actions}</div>
    </div>`;
}

export function kpi(label, value, accent = '') {
  return `
    <div class="card ${accent}">
      <p class="label">${escapeHtml(label)}</p>
      <p class="value">${value}</p>
    </div>`;
}

export function loadingBlock(text = 'Loading…') {
  return `<div class="state-banner loading">${escapeHtml(text)}</div>`;
}

export function errorBlock(text) {
  return `<div class="state-banner error">${escapeHtml(text)}</div>`;
}
