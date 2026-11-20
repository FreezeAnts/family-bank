# Security

Family Bank is self-hosted. Treat your deployment secrets as private.

## Do not commit

- `.env` / `FAMILY_BANK_ENV` files
- SQLite databases under `data/`
- TLS keys, cookies, or OAuth client secrets
- Lab notes such as `deploy/LAB.local.md`

Use [`.env.example`](.env.example) and [`deploy/LAB.local.example.md`](deploy/LAB.local.example.md) as templates only.

## Reporting

If you discover a vulnerability in this repository, open a private security advisory on GitHub when available, or contact the maintainers through the FreezeAnts project channels listed on [freezeants.com](https://www.freezeants.com/).
