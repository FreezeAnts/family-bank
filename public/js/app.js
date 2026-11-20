import { api } from './api.js';
import { renderDashboard } from './views/dashboard.js';
import { renderAccounts } from './views/accounts.js';
import { renderActivity } from './views/activity.js';
import { renderEarn } from './views/earn.js';
import { renderGoals } from './views/goals.js';
import { renderInvestments } from './views/investments.js';
import { renderParent } from './views/parent.js';
import { errorBlock, loadingBlock } from './ui.js';

const appEl = document.getElementById('app');
const loginPanel = document.getElementById('login-panel');
const view = document.getElementById('view');
const nav = document.getElementById('nav');
const bottomNav = document.getElementById('bottom-nav');
const sidebar = document.getElementById('sidebar');
const userChip = document.getElementById('user-chip');
const mobileUser = document.getElementById('mobile-user');
const loginError = document.getElementById('login-error');
const devLogin = document.getElementById('dev-login');

let me = null;

const childRoutes = [
  { hash: '#/', label: 'Home', icon: 'home', render: renderDashboard },
  { hash: '#/accounts', label: 'Accounts', icon: 'wallet', render: renderAccounts },
  { hash: '#/activity', label: 'Activity', icon: 'list', render: renderActivity },
  { hash: '#/earn', label: 'Earn', icon: 'sparkles', render: renderEarn },
  { hash: '#/goals', label: 'Goals', icon: 'target', render: renderGoals },
  { hash: '#/investments', label: 'Invest', icon: 'line-chart', render: renderInvestments },
];

const parentRoutes = [
  { hash: '#/parent', label: 'Overview', icon: 'layout-dashboard', render: (el) => renderParent(el, 'overview') },
  { hash: '#/parent/approvals', label: 'Approvals', icon: 'check-square', render: (el) => renderParent(el, 'approvals') },
  { hash: '#/parent/deposits', label: 'Deposits', icon: 'arrow-down-left', render: (el) => renderParent(el, 'deposits') },
  { hash: '#/parent/withdrawals', label: 'Withdrawals', icon: 'arrow-up-right', render: (el) => renderParent(el, 'withdrawals') },
  { hash: '#/parent/chores', label: 'Chores', icon: 'clipboard-list', render: (el) => renderParent(el, 'chores') },
  { hash: '#/parent/earnings', label: 'Earnings', icon: 'badge-dollar-sign', render: (el) => renderParent(el, 'earnings') },
  { hash: '#/parent/interest', label: 'Interest', icon: 'percent', render: (el) => renderParent(el, 'interest') },
  { hash: '#/parent/investments', label: 'Investments', icon: 'candlestick-chart', render: (el) => renderParent(el, 'investments') },
  { hash: '#/parent/reconciliation', label: 'Reconciliation', icon: 'scale', render: (el) => renderParent(el, 'reconciliation') },
  { hash: '#/parent/settings', label: 'Audit & Settings', icon: 'settings', render: (el) => renderParent(el, 'settings') },
];

function routeTable() {
  return me?.role === 'parent' ? parentRoutes : childRoutes;
}

function linkHtml(routes, forBottom = false) {
  return routes
    .map((r) => {
      if (forBottom && me?.role === 'parent' && !['#/parent', '#/parent/approvals'].includes(r.hash)) {
        return '';
      }
      if (forBottom && me?.role === 'child' && !['#/', '#/accounts', '#/activity', '#/earn', '#/investments'].includes(r.hash)) {
        return '';
      }
      return `<a href="${r.hash}" data-hash="${r.hash}"><i data-lucide="${r.icon}"></i><span>${r.label}</span></a>`;
    })
    .join('');
}

function showLoggedOut(info) {
  appEl.classList.add('logged-out');
  appEl.classList.remove('logged-in');
  loginPanel.classList.remove('hidden');
  view.classList.add('hidden');
  sidebar.classList.add('hidden');
  bottomNav.classList.add('hidden');
  if (info?.devAuthEnabled) devLogin.classList.remove('hidden');
  const params = new URLSearchParams(location.search);
  if (params.get('error')) {
    loginError.textContent = params.get('error');
    loginError.classList.remove('hidden');
  }
}

function userBlock(target) {
  target.innerHTML = `
    <div>${me.displayName}<br><span class="muted" style="color:inherit;opacity:.75">${me.role}</span></div>
    <button class="btn secondary" id="logout-btn" type="button" style="width:100%">Sign out</button>
  `;
  target.querySelector('#logout-btn').onclick = async () => {
    await api.logout();
    location.href = '/';
  };
}

function showLoggedIn() {
  appEl.classList.remove('logged-out');
  appEl.classList.add('logged-in');
  loginPanel.classList.add('hidden');
  view.classList.remove('hidden');
  sidebar.classList.remove('hidden');
  bottomNav.classList.remove('hidden');

  const routes = routeTable();
  nav.innerHTML = linkHtml(routes, false);
  bottomNav.innerHTML = linkHtml(routes, true);
  userBlock(userChip);
  mobileUser.innerHTML = `<button class="btn secondary" id="logout-mobile" type="button">Sign out</button>`;
  document.getElementById('logout-mobile').onclick = async () => {
    await api.logout();
    location.href = '/';
  };
}

async function render() {
  const routes = routeTable();
  const hash = location.hash || routes[0].hash;
  const route = routes.find((r) => r.hash === hash) || routes[0];
  document.querySelectorAll('#nav a, #bottom-nav a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('data-hash') === route.hash);
  });
  view.innerHTML = loadingBlock('Loading…');
  try {
    await route.render(view);
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    view.innerHTML = errorBlock(err.message || 'Failed to load');
  }
}

async function boot() {
  try {
    me = await api.me();
    showLoggedIn();
    if (me.role === 'parent' && (!location.hash || location.hash === '#/')) {
      location.hash = '#/parent';
    }
    await render();
  } catch (err) {
    showLoggedOut(err.data || {});
  }
}

document.getElementById('dev-login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const email = new FormData(form).get('email');
  if (btn) btn.disabled = true;
  try {
    await api.devLogin(email);
    location.href = '/';
  } catch (err) {
    loginError.textContent = err.message || 'Dev login failed';
    loginError.classList.remove('hidden');
    if (btn) btn.disabled = false;
  }
});

window.addEventListener('hashchange', () => {
  if (me) render();
});

boot();
