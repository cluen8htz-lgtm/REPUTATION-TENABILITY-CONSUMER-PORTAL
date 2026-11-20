# Reputation Tenability — Client Portal & Website

A private client workspace and public website for **Reputation Tenability**: debt-collection case organization, credit-report review, **credit-card billing-error analysis (FCBA)**, and **self-help repossession review (FL & CA)**.

Reconstructed from the *Project Script & Source Codebook — Revised Edition* (Nov 19, 2026) and upgraded to run anywhere, with no dependency on the original hosting platform.

> Reputation Tenability is a credit-repair and financial-consulting business, not a law firm. Everything the portal produces is screening and drafting work product for review by a licensed attorney — never legal advice, and never sent automatically.

## What's inside

| Area | What it does |
|---|---|
| **Website** | Editorial landing page, the two analysis engines, service areas, FAQ, education. Installable PWA. |
| **Client workspace** | Intake, court cases, private documents (camera capture), collection-call log, learning library with an education assistant, staff review. ⌘K command palette. |
| **FCBA module** `/portal/billing-error` | File statements as auto-labeled exhibits (A … Z, AA …). Claude reads the PDF/image natively and extracts the figures as structured data; you can review/correct every figure. A **deterministic rule engine** (`contracts/fcba-engine.ts`, FCBA-001 … 013) decides findings. A regenerated **annotated PDF** overlays the original pages: red triangle markers and outlines at summary fields (credit limit), red brackets under line items, a red frame for whole-statement defects, and numbered callouts tied to a violation-map appendix citing each statute. Disputes track the §1666 30-day/90-day clocks, draft the letter (AI-polished or template), classify creditor replies (substantive / boilerplate / non-response) and recommend escalation. One-click ZIP exhibit bundle and `.ics` deadline calendar. |
| **Repossession module** `/portal/repossession` | Case per vehicle, labeled exhibits, a plain-language questionnaire (optionally pre-filled by Claude from the uploaded notices and SEC filings), deterministic REPO-001 … 008 screening including California's 15-day Notice of Intent rule, redemption countdown, missing-evidence checklist, and drafts: document demand, SEC due-diligence plan, notice of demand, special report, federal-complaint skeleton. ZIP case bundle. |

### Design principles
- **Rules decide, AI assists.** AI only extracts facts and polishes prose. Whether a rule fires is ordinary, unit-tested code that cites its statute. With no AI key configured, everything still works (manual fact entry + template drafts).
- **Private by construction.** No public or presigned file links. Every download streams through `/api/files/*` and re-checks the session and record ownership on each request.
- **Conservative legal framing.** Indicators are worded as issues to investigate (e.g. securitization does not by itself defeat a servicer's authority to repossess).

## Stack
React 19 · Vite 7 · Tailwind · TanStack Query · tRPC 11 · Hono · Drizzle ORM (MySQL 8) · `pdf-lib` + `unpdf` (annotation & text-layer positioning) · `fflate` (bundles) · Anthropic SDK (`claude-opus-5-5`, structured outputs, server-side refusal fallback) · Vitest · Playwright.

## Quick start

```bash
cp .env.example .env            # set DATABASE_URL and APP_SECRET at minimum
npm ci --legacy-peer-deps
npx drizzle-kit migrate         # create tables (db/migrations)
npm run dev                     # http://localhost:3000
```

Or the whole stack with Docker:

```bash
docker compose up -d db
docker compose run --rm migrate
docker compose up --build app
```

The first account whose email is listed in `OWNER_EMAIL` becomes staff (admin).

## Configuration
See `.env.example`. Highlights:

| Variable | Purpose |
|---|---|
| `APP_SECRET`, `DATABASE_URL` | Required in production. |
| `ANTHROPIC_API_KEY` | Enables document reading, letter polishing, response classification. Optional. |
| `STORAGE_DRIVER` | `local` (default, `STORAGE_DIR`), `s3` (`S3_BUCKET`, works with R2/MinIO via `S3_ENDPOINT`), or `kimi` (original platform storage). |
| `OWNER_EMAIL`, `ALLOW_REGISTRATION` | Staff accounts and open/invite-only sign-up. |
| `KIMI_*`, `VITE_KIMI_*` | Optional legacy Kimi OAuth button. |

## Verification

```bash
npm run check             # TypeScript (app, node, server projects)
npm run lint
npm test                  # unit tests: rule engines, deadlines, exhibit labels, PDF annotation
npm run test:integration  # against a real MySQL (DATABASE_URL); AI disabled, in-memory storage
npm run build && npm start
```

CI runs all of the above on every push and pull request (`.github/workflows/ci.yml`).

## Project map

```
api/                 Hono server, tRPC routers
  ai/llm.ts          Claude client: structured extraction + drafting, typed failure modes
  fcba/annotate.ts   Annotated-statement PDF generator
  fcba-router.ts     Billing-error workflow
  repo-router.ts     Repossession workflow
  files-route.ts     Authenticated downloads, ZIP bundles, .ics calendar
  lib/blob.ts        Storage drivers (local / S3 / platform) + content sniffing
contracts/
  fcba.ts, repo.ts   Rule catalogs from the codebook (statutes, annotations)
  *-engine.ts        Pure, tested rule engines shared by server and browser
db/                  Drizzle schema + SQL migrations
prompts/             Repossession attorney-review system prompt
analysis/            Cuevas violation map & repossession blueprint (reference)
src/                 React app (pages, components, styles)
tests/               Unit tests + DB integration test
```

## Security notes
- scrypt password hashing, rate-limited sign-in/registration, 30-day HttpOnly `SameSite=Lax` session cookie.
- Strict security headers and CSP in production; uploads are type-sniffed from magic bytes and served with `nosniff` and a sandboxing CSP.
- Run behind HTTPS. For multiple app instances, replace the in-memory rate limiter with a shared one.
