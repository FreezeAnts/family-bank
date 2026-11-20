import { getDb } from '../db/pool.js';
import { newId, nowIso } from '../utils/ids.js';

export function writeAudit({ actorUserId, action, entityType, entityId, before, after, ip }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO audit_log
      (id, actor_user_id, action, entity_type, entity_id, before_json, after_json, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newId(),
    actorUserId || null,
    action,
    entityType,
    entityId || null,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    ip || null,
    nowIso()
  );
}

export function listAudit(limit = 100) {
  return getDb()
    .prepare(
      `SELECT a.*, u.email AS actor_email, u.display_name AS actor_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ORDER BY a.created_at DESC
       LIMIT ?`
    )
    .all(limit);
}
