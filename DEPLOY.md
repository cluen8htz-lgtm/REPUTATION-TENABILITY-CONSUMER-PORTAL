# Deploying the portal

The app is one Docker container plus a MySQL 8 database. On startup it applies
any pending database migrations automatically (`RUN_MIGRATIONS=false` turns this off).

## Option A — Railway (recommended)

1. Create an account at railway.com and a **New Project → Deploy from GitHub repo**, choosing
   `cluen8htz-lgtm/REPUTATION-TENABILITY-CONSUMER-PORTAL` (branch `main`). Railway reads `railway.json`
   and builds the `Dockerfile`.
2. In the project, **+ New → Database → MySQL**.
3. On the app service, **Variables**:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{MySQL.MYSQL_URL}}` (reference to the MySQL service) |
   | `APP_SECRET` | output of `openssl rand -base64 48` |
   | `OWNER_EMAIL` | your staff email(s), comma-separated |
   | `ALLOW_REGISTRATION` | `false` (invitation-only) |
   | `ANTHROPIC_API_KEY` | your Claude API key (optional) |
   | `PUBLIC_URL` | `https://<your domain>` |

4. **Files must survive redeploys:** on the app service, **+ Volume**, mount path `/data`.
   (Or set `S3_BUCKET`, `S3_REGION` and AWS credentials to use S3/R2 instead.)
5. **Settings → Networking → Generate Domain**, or add your own domain (Railway issues HTTPS automatically).
6. Deploy. When the health check at `/api/health` passes, open
   `https://<your domain>/login?setup=1` and create the first staff account with an `OWNER_EMAIL` address.
7. Invite clients from **Staff review → Clients → Create account**. Each gets a one-time temporary
   password to share by phone or in person; they change it under **Account**.

## Google sign-in (optional)

1. In Google Cloud Console, open **APIs & Services → OAuth consent screen**. Choose **External**,
   then add the app name, support email, your logo and domain, and publish the app.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
   - Authorized JavaScript origin: `https://<your domain>`
   - Authorized redirect URI: `https://<your domain>/api/oauth/google/callback`
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the app service, along with `PUBLIC_URL`
   set to the same domain. Redeploy; "Continue with Google" then appears on the sign-in and sign-up pages.

A Google sign-in with the same verified email as an existing account signs into that account.

## Option B — your own Linux server (VPS)

Requires Docker and a DNS record pointing your domain at the server.

```bash
git clone https://github.com/cluen8htz-lgtm/REPUTATION-TENABILITY-CONSUMER-PORTAL.git && cd REPUTATION-TENABILITY-CONSUMER-PORTAL
cp .env.example .env.production     # set APP_SECRET, OWNER_EMAIL, ANTHROPIC_API_KEY, ALLOW_REGISTRATION=false
export DOMAIN=portal.example.com MYSQL_PASSWORD=$(openssl rand -hex 24) MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)
docker compose -f deploy/docker-compose.vps.yml --env-file .env.production up -d --build
```

Caddy obtains and renews the HTTPS certificate. Back up the `db-data` and `uploads` volumes.

## After any deploy

- `GET /api/health` returns `{"ok":true}`.
- Sign in as staff, upload a test statement, and download its annotated PDF.
- Back up the database daily (Railway: MySQL service → Backups; VPS: `mysqldump` cron).
