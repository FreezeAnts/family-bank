import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb } from '../db/pool.js';
import { nowIso } from '../utils/ids.js';

export const STARTUP_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const SETTING_LAST_CHECK = 'updates.last_check_utc';

function packageVersion() {
  try {
    const raw = readFileSync(path.join(config.root, 'package.json'), 'utf8');
    return JSON.parse(raw).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function currentVersion() {
  return normalizeVersion(packageVersion());
}

export function normalizeVersion(value) {
  let trimmed = String(value || '').trim();
  if (trimmed.toLowerCase().startsWith('v')) trimmed = trimmed.slice(1);
  const plus = trimmed.indexOf('+');
  if (plus >= 0) trimmed = trimmed.slice(0, plus);
  return trimmed;
}

export function padVersion(version) {
  let v = normalizeVersion(version);
  let parts = v.split('.').filter(Boolean);
  while (parts.length < 3) {
    v += '.0';
    parts = v.split('.');
  }
  return parts.slice(0, 3).join('.');
}

function parseVersion(version) {
  return padVersion(version)
    .split('.')
    .map((part) => Number.parseInt(part.replace(/[^0-9].*$/, ''), 10) || 0);
}

/** @returns {-1|0|1} */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT value_json FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return fallback;
  }
}

function setSetting(key, value) {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at, updated_by)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value), nowIso());
}

export function getLastCheckUtc() {
  return getSetting(SETTING_LAST_CHECK, null);
}

export function shouldCheckOnStartup(lastCheckUtc = getLastCheckUtc(), utcNow = Date.now()) {
  if (!lastCheckUtc) return true;
  const last = Date.parse(lastCheckUtc);
  if (Number.isNaN(last)) return true;
  return utcNow - last >= STARTUP_CHECK_INTERVAL_MS;
}

function releasesLatestUrl() {
  return `https://api.github.com/repos/${config.github.owner}/${config.github.repo}/releases/latest`;
}

function pickAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  return (
    list.find(
      (a) =>
        a?.name &&
        /^family-bank-/i.test(a.name) &&
        /\.(tar\.gz|tgz|zip)$/i.test(a.name) &&
        a.browser_download_url
    ) || null
  );
}

/**
 * Checks GitHub Releases for a newer Family Bank release.
 * Public repo; no token. Mirrors Unison UpdateCheckService.
 */
export async function checkLatest({ fetchImpl = fetch } = {}) {
  const current = currentVersion();
  const repo = `${config.github.owner}/${config.github.repo}`;
  try {
    const response = await fetchImpl(releasesLatestUrl(), {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `FamilyBank/${current}`,
      },
    });
    const body = await response.text();
    setSetting(SETTING_LAST_CHECK, new Date().toISOString());

    if (!response.ok) {
      const message =
        response.status === 403
          ? 'GitHub rate limit or access error. Try again later.'
          : response.status === 404
            ? `No GitHub releases found for ${repo} yet.`
            : `Could not check for updates (${response.status}).`;
      return errorResult(current, message, repo);
    }

    const release = JSON.parse(body);
    const tag = normalizeVersion(release?.tag_name || '');
    if (!tag || !/^\d+\.\d+/.test(padVersion(tag))) {
      return errorResult(current, 'Latest GitHub release has no usable version tag.', repo);
    }

    const asset = pickAsset(release.assets);
    const downloadUrl = asset?.browser_download_url || release.tarball_url || null;
    const assetName = asset?.name || (release.tarball_url ? `family-bank-${tag}.tar.gz` : null);
    const htmlUrl = release.html_url || `https://github.com/${repo}/releases/latest`;

    if (compareVersions(tag, current) <= 0) {
      return {
        updateAvailable: false,
        currentVersion: current,
        latestVersion: tag,
        downloadUrl: null,
        assetName: null,
        releaseUrl: htmlUrl,
        repo,
        errorMessage: null,
        checkedAt: new Date().toISOString(),
      };
    }

    return {
      updateAvailable: true,
      currentVersion: current,
      latestVersion: tag,
      downloadUrl,
      assetName,
      releaseUrl: htmlUrl,
      repo,
      errorMessage: null,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return errorResult(current, 'Could not reach GitHub. Check your network and try again.', repo);
  }
}

function errorResult(current, message, repo) {
  return {
    updateAvailable: false,
    currentVersion: current,
    latestVersion: null,
    downloadUrl: null,
    assetName: null,
    releaseUrl: `https://github.com/${repo}/releases/latest`,
    repo,
    errorMessage: message,
    checkedAt: new Date().toISOString(),
  };
}

export function updateStatusSnapshot() {
  return {
    currentVersion: currentVersion(),
    lastCheckUtc: getLastCheckUtc(),
    repo: `${config.github.owner}/${config.github.repo}`,
    releaseUrl: `https://github.com/${config.github.owner}/${config.github.repo}/releases/latest`,
  };
}
