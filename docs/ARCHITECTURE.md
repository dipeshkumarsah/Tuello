# Architecture

Tuello is a **modular monolith**: one API, one worker, one web app, one PostgreSQL database.
Modules talk through exported services and domain events, never through each other's tables.

```
 browser ──► Caddy (TLS, on-demand certs) ──► web (Next.js) ──/api──► api (NestJS) ──► PgBouncer ──► PostgreSQL 16
                       │                                          │                              (RLS forced)
                       └──────────── /api/* ──────────────────────┘
                                                                  ├──► Valkey (sessions, cache, rate limits, BullMQ)
                                                                  └──► S3 API (R2 / MinIO): presigned URLs only
 worker (NestJS standalone) ◄── BullMQ ── Valkey
   ├─ outbox relay     (outbox_events → events queue)
   ├─ email            (SMTP: Mailpit locally)
   ├─ domain checks    (DNS TXT verification, scheduled scan)
   └─ dead-letter      (final failures, indexed per tenant)
```

## Request lifecycle (api)

1. **pino-http** assigns/propagates `x-request-id`; logs carry request, tenant and user IDs.
2. **TenantResolutionMiddleware** classifies the host (`X-Forwarded-Host` behind a proxy):
   apex (`tuello.app`, `app.tuello.app`), tenant subdomain, or custom domain, and resolves the
   tenant through `TenantDirectory` (Valkey cache over a SECURITY DEFINER lookup).
3. Guards, in order:
   - **RateLimitGuard**: Valkey fixed windows per IP and per tenant, stricter rules per route.
   - **CsrfGuard**: double-submit cookie (`tuello_csrf` ⇔ `x-csrf-token`) plus Origin check
     on every state-changing request.
   - **AuthGuard**: host scope (`@HostScoped`), deny-by-default (every route must declare
     `@Public()` or `@RequirePermission()`), session lookup, **session tenant must equal host
     tenant**, then the permissions matrix row for the member's role.
4. **TenantTransactionInterceptor** opens one transaction per request:
   `SELECT set_config('app.tenant_id', …, true), set_config('app.user_id', …, true)` (SET LOCAL),
   and the handler runs inside it via `db.tx`.
5. **ProblemFilter** renders every error as RFC 9457 `application/problem+json`.

## Tenant isolation

- Shared database, shared schema. Every tenant-owned table has `tenant_id NOT NULL`
  referencing `tenants`, and `tenant_id` leads its indexes.
- RLS is **enabled and forced** on every table. Policies compare `tenant_id` with
  `app.current_tenant_id()`, which **raises** when `app.tenant_id` is unset, so a query without
  context fails loudly instead of returning nothing.
- The runtime role `tuello_app` is `NOSUPERUSER NOBYPASSRLS`; the api and worker refuse to start
  otherwise (`assertRuntimeRoleIsRestricted`).
- `users` is global identity (one person, many tenants). Its policy shows a user only to itself
  or to members of the current tenant; only the user can update its own row.
- The few lookups that must happen before a tenant is known (host → tenant, email → user for
  login, outbox claiming, webhook ingestion, due domain checks) are `SECURITY DEFINER`
  functions owned by `tuello_definer`, a NOLOGIN role with narrow role-scoped policies. Each
  returns the minimum it must.
- The Prisma extension in `packages/db` (`tenantScopeExtension`) is the only way to query:
  model calls outside `withTenant()` throw `MissingTenantContextError` before reaching SQL.
- Object storage keys are prefixed with the tenant ID; buckets are private; reads and writes use
  short-lived signed URLs; uploads go browser → storage directly (presigned POST).

## Sessions and authentication

- Opaque 256-bit tokens in an `httpOnly; SameSite=Lax; Secure` host-only cookie. Only the
  SHA-256 hash is stored: Valkey (hot copy) and `sessions` (durable, tenant-scoped, listable,
  revocable). If Valkey loses a session, the database copy is looked up **within the host's
  tenant only**, so the fallback cannot cross tenants either.
- Passwords: argon2id (19 MiB, t=2). Password change/reset sets `password_changed_at`, which
  invalidates every older session.
- Email links (verification, reset, magic link) are single-use, hashed, tenant-scoped
  `auth_tokens`. Consumption is a POST from the landing page, so link scanners cannot burn them.
- TOTP (RFC 6238) for staff roles; secrets encrypted with AES-256-GCM; each code works once.
- Changing the workspace address issues a 60-second one-time **handoff** token to carry the
  session to the new host.

## Events, jobs, and the outbox

- Every state change writes a named domain event to `outbox_events` in the same transaction
  (names in `packages/shared/src/events.ts`). The worker claims batches with a lease
  (`FOR UPDATE SKIP LOCKED`), enqueues each on the `events` queue with `jobId = event id`, then
  marks them published. Any number of workers can run.
- Emails carry one-time links, so they are enqueued directly **after commit** instead of through
  the outbox (secrets never sit in outbox rows). Jobs are idempotent and retried exponentially
  (8 attempts); final failures land in the dead-letter queue, indexed per tenant for the
  owner's "Failed jobs" page.
- Custom domains: the tenant publishes `_tuello-verify.<host> TXT tuello-verify=<token>`. The
  worker checks with backoff; once verified the host cache is invalidated and Caddy's on-demand
  TLS `ask` endpoint starts answering yes for it.

## Web app

- One Next.js app serves every host. Middleware rewrites by host: apex → `/apex/*`, tenant →
  `/t/*`. URLs in the browser never change.
- The browser talks to the same public REST API, same-origin under `/api` (proxied by Next or
  routed by Caddy), so cookies stay host-only per tenant.
- Server state via TanStack Query (optimistic updates for role changes); forms via React Hook
  Form + the shared Zod schemas; every string through the i18n layer; currency, dates and units
  formatted from tenant settings.
- Every screen has designed loading (skeleton), empty, error and no-permission states.

## Scaling path (configuration only)

1. Run the worker on its own server (it shares nothing in-process with the API).
2. Move PostgreSQL to its own server or a managed service (point `DATABASE_URL` at PgBouncer).
3. Run several api/web containers behind Caddy (stateless: sessions, rate limits, caches and
   queues live in Valkey).

Reads can later move to a replica: all reads go through `db.tx`, so a read-only client can be
added behind the same extension.
