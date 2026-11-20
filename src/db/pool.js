import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

let db;
let txDepth = 0;

/**
 * Thin wrapper so call sites can keep better-sqlite3-style APIs
 * (prepare/run/get/all + transaction) on top of Node's DatabaseSync.
 */
function wrapDatabase(raw) {
  return {
    raw,
    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        run(...params) {
          const result = stmt.run(...params);
          return {
            changes: result.changes,
            lastInsertRowid: result.lastInsertRowid,
          };
        },
        get(...params) {
          return stmt.get(...params);
        },
        all(...params) {
          return stmt.all(...params);
        },
      };
    },
    exec(sql) {
      raw.exec(sql);
    },
    pragma(pragma) {
      raw.exec(`PRAGMA ${pragma}`);
    },
    transaction(fn) {
      return (...args) => {
        if (txDepth > 0) {
          return fn(...args);
        }
        txDepth += 1;
        raw.exec('BEGIN IMMEDIATE');
        try {
          const result = fn(...args);
          raw.exec('COMMIT');
          return result;
        } catch (err) {
          try {
            raw.exec('ROLLBACK');
          } catch {
            /* ignore */
          }
          throw err;
        } finally {
          txDepth -= 1;
        }
      };
    },
  };
}

export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const raw = new DatabaseSync(config.databasePath);
  db = wrapDatabase(raw);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function withTransaction(fn) {
  const database = getDb();
  return database.transaction(fn)();
}

export function resetDbForTests() {
  if (db?.raw) {
    try {
      db.raw.close();
    } catch {
      /* ignore */
    }
  }
  db = undefined;
  txDepth = 0;
}
