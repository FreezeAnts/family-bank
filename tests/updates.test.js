import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  normalizeVersion,
  padVersion,
  shouldCheckOnStartup,
  STARTUP_CHECK_INTERVAL_MS,
} from '../src/services/updates.js';

test('normalizeVersion strips v prefix and build metadata', () => {
  assert.equal(normalizeVersion('v1.2.3'), '1.2.3');
  assert.equal(normalizeVersion('1.2.3+abc'), '1.2.3');
});

test('padVersion fills missing segments', () => {
  assert.equal(padVersion('1'), '1.0.0');
  assert.equal(padVersion('1.2'), '1.2.0');
  assert.equal(padVersion('v2.0.1'), '2.0.1');
});

test('compareVersions orders semver-like tags', () => {
  assert.equal(compareVersions('0.1.0', '0.1.1'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
});

test('shouldCheckOnStartup respects 12h interval', () => {
  const now = Date.parse('2026-11-20T12:00:00.000Z');
  assert.equal(shouldCheckOnStartup(null, now), true);
  assert.equal(
    shouldCheckOnStartup(new Date(now - STARTUP_CHECK_INTERVAL_MS - 1).toISOString(), now),
    true
  );
  assert.equal(
    shouldCheckOnStartup(new Date(now - STARTUP_CHECK_INTERVAL_MS + 60_000).toISOString(), now),
    false
  );
});
