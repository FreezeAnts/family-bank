import crypto from 'node:crypto';
import { config, googleOAuthConfigured } from '../config.js';
import { getDb } from '../db/pool.js';
import { getUserByEmail } from './rbac.js';
import { nowIso } from '../utils/ids.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export function createOAuthState() {
  const state = crypto.randomBytes(24).toString('hex');
  const created = nowIso();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  getDb()
    .prepare(`INSERT INTO oauth_states (state, created_at, expires_at) VALUES (?, ?, ?)`)
    .run(state, created, expires);
  return state;
}

export function consumeOAuthState(state) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM oauth_states WHERE state = ?').get(state);
  db.prepare('DELETE FROM oauth_states WHERE state = ? OR expires_at < ?').run(state, nowIso());
  if (!row) return false;
  if (row.expires_at < nowIso()) return false;
  return true;
}

export function buildGoogleAuthUrl(state) {
  if (!googleOAuthConfigured()) {
    throw new Error('Google OAuth is not configured');
  }
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: `${config.baseUrl}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForUser(code) {
  if (!googleOAuthConfigured()) {
    throw new Error('Google OAuth is not configured');
  }

  const body = new URLSearchParams({
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: `${config.baseUrl}/auth/google/callback`,
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenRes.ok) {
    throw new Error('Failed to exchange OAuth code');
  }
  const tokenJson = await tokenRes.json();
  const accessToken = tokenJson.access_token;
  if (!accessToken) throw new Error('No access token from Google');

  const userRes = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userRes.ok) throw new Error('Failed to fetch Google userinfo');
  const profile = await userRes.json();
  if (!profile.email || profile.email_verified === false) {
    throw new Error('Google email not verified');
  }

  const user = getUserByEmail(profile.email);
  if (!user) {
    const err = new Error('This Google account is not authorized for Family Bank');
    err.statusCode = 403;
    throw err;
  }

  if (profile.sub && user.google_sub !== profile.sub) {
    getDb()
      .prepare(`UPDATE users SET google_sub = ?, updated_at = ? WHERE id = ?`)
      .run(profile.sub, nowIso(), user.id);
  }

  return getUserByEmail(profile.email);
}
