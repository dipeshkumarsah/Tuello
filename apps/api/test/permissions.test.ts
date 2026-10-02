import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { can, PERMISSIONS, ROLES, type Permission, type Role } from '@tuello/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_KEY, PUBLIC_KEY } from '../src/common/decorators';
import { addMember, Browser, loginAs, signupTenant, startApp, type Harness } from './helpers';

/**
 * Acceptance: each role reaches only the routes its row in the permissions matrix allows.
 * Routes come from the generated OpenAPI document, so a new route is swept automatically.
 */
let h: Harness;
let browsers: Record<Role, Browser>;
let operations: Array<{ method: string; path: string; permission: Permission }>;

beforeAll(async () => {
  h = await startApp();
  const t = await signupTenant(h);
  browsers = { owner: t.owner } as Record<Role, Browser>;
  for (const role of ROLES.filter((r) => r !== 'owner')) {
    const m = await addMember(h, t.tenantId, role, t.slug);
    browsers[role] = await loginAs(h, t.slug, m.email);
  }
  const doc = (await new Browser(h.server, 'x').get('/v1/openapi.json')).body as {
    paths: Record<string, Record<string, { 'x-permission'?: string }>>;
  };
  operations = [];
  for (const [path, ops] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const p = op['x-permission'];
      if (p && p !== 'public') operations.push({ method, path, permission: p as Permission });
    }
  }
});
afterAll(async () => {
  await h?.close();
});

function concrete(path: string): string {
  return path.replace(/\{(\w+)\}/g, (_m, name: string) =>
    name === 'token' ? 'x'.repeat(40) : randomUUID(),
  );
}

describe('route inventory', () => {
  it('every controller method declares @Public() or @RequirePermission() with a known permission', () => {
    const modules = h.app.get(ModulesContainer);
    const scanner = new MetadataScanner();
    const reflector = h.app.get(Reflector);
    let routes = 0;
    const controllers = [...modules.values()].flatMap((m) => [...m.controllers.values()]);
    for (const wrapper of controllers) {
      const proto = Object.getPrototypeOf(wrapper.instance) as object;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, (...a: unknown[]) => unknown>)[name]!;
        if (!Reflect.getMetadata('path', handler)) continue;
        routes += 1;
        const isPublic = reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
          handler,
          wrapper.metatype as never,
        ]);
        const permission = reflector.getAllAndOverride<string>(PERMISSION_KEY, [
          handler,
          wrapper.metatype as never,
        ]);
        expect({
          route: `${wrapper.name}.${name}`,
          declared: !!isPublic || PERMISSIONS.includes(permission as Permission),
        }).toEqual({
          route: `${wrapper.name}.${name}`,
          declared: true,
        });
      }
    }
    expect(routes).toBeGreaterThan(30);
  });

  it('found the protected operations in the OpenAPI document', () => {
    expect(operations.length).toBeGreaterThan(20);
  });

  it('route -> permission table is reviewed (update the snapshot deliberately)', () => {
    const table = operations
      .map((o) => `${o.method.toUpperCase().padEnd(6)} ${o.path} -> ${o.permission}`)
      .sort();
    expect(table).toMatchSnapshot();
  });
});

describe.each(ROLES)('role %s', (role) => {
  it('is allowed exactly where the matrix says', async () => {
    const mismatches: string[] = [];
    for (const op of operations) {
      // Skip calls that would end the sweep's own session.
      if (op.path === '/v1/me/password') continue;
      const res = await browsers[role].send(
        op.method as 'get',
        concrete(op.path),
        op.method === 'get' ? undefined : {},
      );
      // Matrix denials are exactly { code: 'forbidden' } with no detail; handler-level business
      // rules (e.g. 2FA is staff-only) add a detail and count as "reached the route".
      const deniedByMatrix =
        res.status === 403 && res.body.code === 'forbidden' && !res.body.detail;
      const allowed = can(role, op.permission);
      if (res.status === 401)
        mismatches.push(`${op.method.toUpperCase()} ${op.path}: 401 (session lost?)`);
      else if (allowed && deniedByMatrix)
        mismatches.push(`${op.method.toUpperCase()} ${op.path}: denied but matrix allows`);
      else if (!allowed && !deniedByMatrix)
        mismatches.push(`${op.method.toUpperCase()} ${op.path}: ${res.status} but matrix denies`);
    }
    expect(mismatches).toEqual([]);
  });
});

describe('anonymous', () => {
  it('gets 401 on every protected route', async () => {
    const tenantHost = browsers.owner.host;
    const anon = new Browser(h.server, tenantHost);
    for (const op of operations) {
      const res = await anon.send(
        op.method as 'get',
        concrete(op.path),
        op.method === 'get' ? undefined : {},
      );
      expect([`${op.method} ${op.path}`, res.status]).toEqual([`${op.method} ${op.path}`, 401]);
    }
  });
});
