import { getDb } from '../db/pool.js';

export function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getUserByEmail(email) {
  return getDb()
    .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
    .get(String(email).toLowerCase());
}

export function requireUser(request) {
  const userId = request.session?.userId;
  if (!userId) {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
  const user = getUserById(userId);
  if (!user || user.status !== 'active') {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
  return user;
}

export function requireParent(request) {
  const user = requireUser(request);
  if (user.role !== 'parent') {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }
  return user;
}

export function requireChild(request) {
  const user = requireUser(request);
  if (user.role !== 'child') {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }
  return user;
}

export function clientIp(request) {
  return request.headers['cf-connecting-ip'] || request.ip;
}
