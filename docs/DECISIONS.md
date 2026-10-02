# Decisions

Each entry: the decision, then why. Newest last.

### 2026-10-02 · Framework versions pinned to proven majors

NestJS 11, Prisma 6.19, Next.js 15.5, TypeScript 5.9, Vitest 3, BullMQ 5, Storybook 8.6,
ESLint 10 flat config. Newer majors (Nest 12, Prisma 7, Next 16, TypeScript 7) exist but each
changes build or runtime behaviour significantly; Phase 1 favours stability. Dependabot proposes
upgrades weekly.

### Valkey instead of Redis

Requested in the master brief; wire-compatible with Redis, so BullMQ and ioredis work unchanged.
Confirmed with the product owner when Phase 1 mentioned Redis.

### RLS context function raises when missing

`app.current_tenant_id()` raises `TN001` if `app.tenant_id` is unset or empty. A forgotten
context therefore fails loudly instead of silently returning zero rows. Policies wrap it in
`(SELECT …)` so it is evaluated once per statement (InitPlan) and indexes stay usable.

### SECURITY DEFINER lookups owned by a non-bypass role

Some queries must run before the tenant is known. Instead of a BYPASSRLS role (not allowed on
many managed PostgreSQL services, and too broad), they are SQL functions owned by
`tuello_definer` (NOLOGIN, no BYPASSRLS) with policies scoped `TO tuello_definer`. The runtime
role can only execute the functions, never touch the rows directly.

### Users are global; memberships are per tenant

A shooter or editor can work for several companies with one login. `users` has RLS too: rows
are visible only to the user or to members of the current tenant.

### Sessions: Valkey + durable table

Valkey holds the hot copy for stateless API servers; `sessions` gives listing, revocation and a
fallback. The fallback query runs inside the host's tenant only.

### Interactive transaction per request

Each request runs in one transaction with `SET LOCAL` (via `set_config(..., true)`), which is
compatible with PgBouncer transaction pooling. CPU-heavy steps (argon2) run before the
transaction opens (`@NoTenantTransaction()` handlers) so connections are not held.

### Emails bypass the outbox

Email jobs carry one-time links. They are enqueued after commit (`db.afterCommit`) so secrets are
never stored in outbox rows. If enqueueing fails the user can resend; domain events still go
through the outbox.

### TOTP implemented in-house

RFC 6238 is ~60 lines on `node:crypto`; the common library's current major was deprecated.
Covered by the RFC test vectors.

### Single red, tuned per theme

No single red reaches 4.5:1 against both white and black. The destructive colour is one hue,
red-600 (`#DC2626`) in light mode and red-400 (`#F87171`) in dark mode, both ≥ 4.5:1.

### Tenant accent colour validation

An accent must give ≥ 4.5:1 with black or white text (used as a button fill) and ≥ 3:1 against
white (non-text contrast). Checked on the client for live feedback and on the server in the Zod
schema.

### One Next.js app for every host

Middleware rewrites the apex to `/apex/*` and tenant hosts to `/t/*`. One deployable serves
any number of tenants and custom domains; nothing tenant-specific is built in.

### Custom domain TLS via Caddy on-demand + ask endpoint

Free, automatic, and certificates are issued only for hostnames the API confirms as verified.
Behind a `TlsProvisioner` interface so another proxy can be swapped in.

### Deliberate index exceptions to "tenant_id first"

Cross-tenant by nature: global uniqueness of custom hostnames, the outbox publisher's scan of
unpublished events, and the DNS-check scan of pending domains. The schema test lists them
explicitly; any other index must lead with `tenant_id`.

### Dead-letter view is tenant-scoped

The internal "Failed jobs" page shows only the current tenant's jobs (owner/admin). A
platform-operator view needs a platform-admin role, which is out of Phase 1 scope.

### MinIO pinned to its last community image

MinIO stopped publishing community images in late 2025. The compose file pins the last
release; it is development-only (production uses R2 through the same S3 API). If the image
becomes unavailable, Garage or SeaweedFS are drop-in S3-compatible alternatives.

### Dependency overrides

`postcss ≥ 8.5.23` (via Next.js), `deepmerge-ts ≥ 8` (via Prisma config) and
`js-yaml ≥ 5.4.1` (via @nestjs/swagger) are overridden in `pnpm-workspace.yaml` to clear
high-severity advisories. Remove each when the parent package ships the fix.

### No tini in images

Images avoid `apk` at build time. Node handles SIGTERM through Nest shutdown hooks; Compose and
Coolify can add `init: true` if wanted.
