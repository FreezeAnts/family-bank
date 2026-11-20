#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bump = process.argv[2] || 'patch';

function step(version, kind) {
  if (kind === 'none') return version;
  const parts = String(version).split('.').map((n) => Number.parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  let [major, minor, patch] = parts;
  if (kind === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

const pkgPath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const next = step(pkg.version, bump);
pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

if (readFileSync(lockPath, 'utf8')) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.version = next;
  if (lock.packages?.['']) {
    lock.packages[''].version = next;
    lock.packages[''].license = pkg.license;
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

process.stdout.write(next);
