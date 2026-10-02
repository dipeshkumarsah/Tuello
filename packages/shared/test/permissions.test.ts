import { describe, expect, it } from 'vitest';
import {
  PERMISSION_MATRIX,
  PERMISSIONS,
  ROLES,
  assignableRoles,
  can,
  permissionsFor,
} from '../src';

describe('permissions matrix', () => {
  it('only references known roles', () => {
    for (const roles of Object.values(PERMISSION_MATRIX)) {
      for (const r of roles) expect(ROLES).toContain(r);
    }
  });

  it('gives every role self.manage', () => {
    for (const r of ROLES) expect(can(r, 'self.manage')).toBe(true);
  });

  it('keeps subscription billing owner-only', () => {
    expect(PERMISSION_MATRIX['subscription.manage']).toEqual(['owner']);
    expect(can('admin', 'subscription.manage')).toBe(false);
  });

  it('gives admin everything owner has except subscription billing', () => {
    const owner = new Set(permissionsFor('owner'));
    const admin = new Set(permissionsFor('admin'));
    expect([...owner].filter((p) => !admin.has(p))).toEqual(['subscription.manage']);
  });

  it('never lets shooter, editor, client or brokerage_admin manage the tenant', () => {
    for (const r of ['shooter', 'editor', 'client', 'brokerage_admin'] as const) {
      expect(permissionsFor(r)).toEqual(['self.manage']);
    }
  });

  it('denies null roles', () => {
    for (const p of PERMISSIONS) expect(can(null, p)).toBe(false);
  });

  it('limits role assignment', () => {
    expect(assignableRoles('owner')).toContain('owner');
    expect(assignableRoles('admin')).not.toContain('owner');
    expect(assignableRoles('admin')).toContain('admin');
    expect(assignableRoles('coordinator')).toEqual([]);
  });
});
