# Family Bank

Self-hosted family banking app with a double-entry ledger, parent/child portals, chores, savings interest, and a clearly labeled simulated investment market.

A [FreezeAnts](https://www.freezeants.com/) project.

## Features

- Double-entry ledger in CAD cents (immutable posts; corrections via reversals)
- Google OAuth allowlist for parents and children
- Deposit / withdrawal approval workflows with cash reconciliation
- Chores, bonuses, savings goals, ACT/365 Fixed interest
- Simulated educational investment market
- GitHub Releases update check (same pattern as [Unison](https://github.com/FreezeAnts/Unison))

## Requirements

- Node.js 22+
- SQLite (built-in via `node:sqlite`)
- Optional: reverse proxy / tunnel for HTTPS and Google OAuth callbacks

## Quick start

```bash
cp .env.example .env
# Set SESSION_SECRET, PARENT_EMAIL, CHILD_EMAIL
# For local UI without Google: NODE_ENV=development DEV_AUTH_ENABLED=true
npm install
npm run db:migrate
npm run db:seed
npm test
npm run dev
```

Open `http://127.0.0.1:3000`.

## Production sketch

1. Copy the app to your host (for example `/opt/family-bank`).
2. Put secrets in a root-owned env file (mode `600`), pointed at by `FAMILY_BANK_ENV`.
3. Set `NODE_ENV=production`, `DEV_AUTH_ENABLED=false`, real Gmail allowlist emails, and Google OAuth client credentials (see below).
4. Point `BASE_URL` at your public HTTPS origin.
5. Install `deploy/family-bank.service`, run migrations/seed, enable the unit.
6. Schedule `deploy/backup.sh` against `DATABASE_PATH`.

See `deploy/` for the systemd unit, Caddy example, backup script, and GitHub update helper.

## Google OAuth setup

Family Bank uses a Google **Web** OAuth client. Only emails already present in the `users` table can sign in (seeded via `PARENT_EMAIL` / `CHILD_EMAIL`, or added later by a parent).

### 1. Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. **APIs & Services → OAuth consent screen**
   - User type: **External** (for consumer Gmail accounts).
   - Fill in app name and support email.
   - While the app is in **Testing**, add every family Gmail under **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URI (must match `BASE_URL` exactly):

```text
https://bank.example.com/auth/google/callback
```

   Replace `https://bank.example.com` with your public HTTPS origin (no trailing slash).
4. Copy the **Client ID** and **Client secret**.

### 2. App environment

Set these in your env file (for example `/etc/family-bank/env` or `.env`):

```bash
BASE_URL=https://bank.example.com
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
PARENT_EMAIL=parent@example.com
CHILD_EMAIL=child@example.com
```

Restart the app after changing env. `/api/me` should report `"googleConfigured": true`, and the login page **Continue with Google** button becomes active.

### 3. Sign-in flow

1. Browser opens `/auth/google` → Google account picker.
2. Google redirects to `{BASE_URL}/auth/google/callback` with an auth code.
3. The server exchanges the code, reads the verified email, and looks up that email in `users`.
4. Unknown emails are rejected (`This Google account is not authorized for Family Bank`).

### 4. Production hardening

- `NODE_ENV=production`
- `DEV_AUTH_ENABLED=false` (disables the local starter login)
- Keep the OAuth app in Testing with an explicit test-user list, or publish the consent screen if you prefer

Local development can skip Google entirely: `NODE_ENV=development` and `DEV_AUTH_ENABLED=true`.

## Updates

Family Bank uses the same public GitHub Releases pattern as [Unison](https://github.com/FreezeAnts/Unison) (no token):

- **Check:** Parent → **Audit & settings** → **Check for updates** (also logs on startup every 12 hours)
- **Apply on the host:**

```bash
sudo bash deploy/update-from-github.sh
# optional: GITHUB_OWNER=FreezeAnts GITHUB_REPO=family-bank TAG=v0.1.1
```

### Publishing a release (maintainers)

```powershell
pwsh -File scripts/publish-release.ps1          # bump patch, test, pack, gh release
pwsh -File scripts/publish-release.ps1 -Bump minor
pwsh -File scripts/publish-release.ps1 -Bump none -SkipPublish   # pack only
```

That writes `artifacts/family-bank-<version>.tar.gz` (preferred by the host updater) and creates GitHub Release `v<version>`. Commit the version bump, then push tags if you published from a clean tree.

## Environment

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Cookie session secret (required) |
| `BASE_URL` | Public origin used for OAuth redirects |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth web client |
| `PARENT_EMAIL` / `CHILD_EMAIL` | Seed allowlist when users table is empty |
| `DEV_AUTH_ENABLED` | Dev login; only when `NODE_ENV=development` |
| `DATABASE_PATH` | SQLite file path |
| `GITHUB_OWNER` / `GITHUB_REPO` | Releases feed for update checks (default `FreezeAnts` / `family-bank`) |

## Money model

- Amounts stored as integer CAD cents
- Never overwrite balances without ledger rows
- Deposit approval ≠ parent bank deposit (tracked in cash reconciliation)
- Savings goals earmark existing balances only
- Investments are simulated educational instruments only

## License

MIT — see [LICENSE](LICENSE).
