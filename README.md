# Tuello

Multi-tenant SaaS for real estate photography and media companies: CRM, booking, scheduling,
production, delivery, invoicing and contractor pay in one system. Each tenant (media company)
gets its own subdomain and branding; their clients never see the Tuello brand.

**Status: Phase 1 (foundation).** A company can sign up, verify its email, land on its own
subdomain, finish onboarding, invite its team, and everyone signs in. Tenant isolation is
enforced by PostgreSQL row-level security and proven by tests.

## Repository

```
apps/
  api/        NestJS REST API under /v1 (OpenAPI at /v1/docs)
  worker/     NestJS standalone BullMQ consumers (email, outbox, domains, dead-letter)
  web/        Next.js App Router app serving every host (apex + all tenants)
packages/
  db/         Prisma schema, forward-only SQL migrations with RLS, tenant extension, seed
  shared/     Zod schemas, permissions matrix, roles, events, i18n, host rules
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

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Decisions](docs/DECISIONS.md)
- [Costs of external services](docs/COSTS.md)
