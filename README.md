# Tuello

Multi-tenant SaaS for real estate photography and media companies: CRM, booking, scheduling,
production, delivery, invoicing and contractor pay in one system. Each tenant (media company)
gets its own subdomain and branding; their clients never see the Tuello brand.

**Status: Phase 2 (CRM and service catalog).** On top of the Phase 1 foundation (signup,
subdomains, invites, sign-in, row-level security), a coordinator can manage clients and
brokerages, import them from CSV, and define everything the company sells. One shared pricing
engine prices any order the same way in the API and in the browser.

## Repository

```
apps/
  api/        NestJS REST API under /v1 (OpenAPI at /v1/docs)
  worker/     NestJS standalone BullMQ consumers (email, outbox, domains, CSV import/export, dead-letter)
  web/        Next.js App Router app serving every host (apex + all tenants)
packages/
  db/         Prisma schema, forward-only SQL migrations with RLS, tenant extension, seed
  shared/     Zod schemas, permissions matrix, roles, events, i18n, host rules, pricing engine
  ui/         Black-and-white design system (Radix + Tailwind) with Storybook
e2e/          Playwright flows
infra/        Postgres init, Caddy config
docs/         ARCHITECTURE, DECISIONS, COSTS
```

## Run it locally

Requirements: Node 22, pnpm 10, Docker.

```bash
cp .env.example .env            # set ENCRYPTION_KEY: openssl rand -base64 32
docker compose up -d            # postgres, pgbouncer, valkey, minio, mailpit
pnpm install
pnpm build
set -a; . ./.env; set +a
pnpm db:migrate                 # owner role, direct connection
pnpm db:seed                    # demo tenants "acme" and "birch"
pnpm dev                        # api :4000, worker, web :3000
```

Open:

| URL                                     | What                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| http://tuello.localhost:3000/signup     | Create a company (apex host)                                                                                                                                              |
| http://acme.tuello.localhost:3000/login | Demo tenant. Users: `owner@acme.test`, `admin@`, `coordinator@`, `shooter@`, `editor@`, `client@`, `brokerage-admin@` (same for `birch`). Password `tuello-demo-password` |
| http://localhost:8025                   | Mailpit: every email the system sends                                                                                                                                     |
| http://localhost:4000/v1/docs           | Interactive API documentation                                                                                                                                             |
| http://localhost:9001                   | MinIO console (tuello / tuello-dev-secret)                                                                                                                                |
| `pnpm --filter @tuello/ui storybook`    | Design system on :6006                                                                                                                                                    |

Signed in as owner, admin or coordinator on a tenant: **Clients** (search, filters, saved
views, duplicates and merge, notes, timeline), **Brokerages**, **Import CSV** (from the client
list), **Catalog** (services, variants, packages, add-ons, skills) and **Pricing** (size-band
grid, size bands, price lists with a live quote, coupons, travel fees, tax). Shooters and
editors do not see these screens and the API refuses them.

`*.localhost` resolves to 127.0.0.1 in Chrome, Firefox and Safari, so tenant subdomains work
without editing `/etc/hosts`. (curl needs `-H 'Host: acme.tuello.localhost'`.)

Everything in containers instead: `docker compose --profile apps up -d --build`, then run the
migration once: `docker compose run --rm -e DIRECT_DATABASE_URL=postgresql://tuello:tuello@postgres:5432/tuello api node node_modules/@tuello/db/dist/migrate.js`.

## Tests

```bash
pnpm lint && pnpm typecheck
pnpm test                 # unit (Vitest)
pnpm test:integration     # Testcontainers: RLS proofs, API (Supertest), worker. Needs Docker.
pnpm test:e2e             # Playwright against the running stack (see above)
```

What the suites prove for Phase 1:

- `packages/db/test/rls.test.ts`: for every tenant-owned table, tenant A cannot read, list,
  update, delete, or insert tenant B's rows (as the RLS-restricted role, in raw SQL); a query
  without tenant context throws in Prisma and in SQL; every table has RLS forced; `tenant_id`
  leads every index; `schema.prisma` matches the migrations.
- `apps/api/test/isolation.test.ts`: a session from tenant A is rejected on tenant B's host;
  cross-tenant access through every endpoint fails.
- `apps/api/test/permissions.test.ts`: every route declares a permission; each role reaches
  exactly the routes its matrix row allows (swept from the generated OpenAPI document).
- `e2e/tests/onboarding.spec.ts`: sign up → verify email → land on the subdomain → invite a
  coordinator → coordinator accepts and signs in, with axe WCAG 2.2 AA scans.

What they add for Phase 2:

- `packages/shared/test/pricing.test.ts`: table-driven pricing engine cases: size-band edges,
  property-type and band+type rules, client price lists (fixed, percent, default percent),
  stacked add-ons, percent and fixed coupons (expired, not started, used up, minimum order),
  travel by territory and distance, tax per region with rounding, zero-total orders.
- `packages/db/test/rls.test.ts`: the isolation proofs above, extended to every new table, plus
  composite tenant foreign keys (a row cannot point at another tenant's parent).
- `apps/api/test/crm.test.ts`, `pricing.test.ts`, `imports.test.ts`: search by partial name,
  email, phone or brokerage (with typos); duplicates and merge; catalog and pricing CRUD;
  quotes; a shooter gets 403 on price lists; imports through presigned upload and preview.
- `apps/worker/test/import.test.ts`: a 5,000-client import, then the same file again with no
  duplicates (idempotent); match order; error report; exports.
- `e2e/tests/crm-pricing.spec.ts`: an owner creates a client, finds clients by partial name,
  email and brokerage, changes a size-band price, edits a price list and sees the live quote,
  which equals the API's quote for the same input; a shooter cannot open pricing.
- `e2e/tests/import-load.spec.ts`: 5,000 clients imported by the real worker while the API keeps
  answering (`/v1/clients` p95 under 300 ms during the import).

Integration tests start SeaweedFS as the S3 server (`S3_TEST_IMAGE` overrides the image).

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Decisions](docs/DECISIONS.md)
- [Costs of external services](docs/COSTS.md)
