import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

dotenv.config({ path: process.env.FAMILY_BANK_ENV || path.join(root, '.env') });

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  env: process.env.NODE_ENV || 'production',
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  baseUrl: process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`,
  sessionSecret: required('SESSION_SECRET', 'dev-only-change-me-session-secret-32chars'),
  databasePath:
    process.env.DATABASE_PATH || path.join(root, 'data', 'family-bank.sqlite'),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  },
  seed: {
    parentEmail: (process.env.PARENT_EMAIL || '').toLowerCase(),
    childEmail: (process.env.CHILD_EMAIL || '').toLowerCase(),
    parentName: process.env.PARENT_NAME || 'Parent',
    childName: process.env.CHILD_NAME || 'Child',
  },
  devAuthEnabled:
    process.env.NODE_ENV === 'development' &&
    String(process.env.DEV_AUTH_ENABLED).toLowerCase() === 'true',
  timezone: process.env.TZ || 'America/Toronto',
  github: {
    owner: process.env.GITHUB_OWNER || 'FreezeAnts',
    repo: process.env.GITHUB_REPO || 'family-bank',
  },
  root,
  publicDir: path.join(root, 'public'),
};

export function googleOAuthConfigured() {
  return Boolean(config.google.clientId && config.google.clientSecret);
}
