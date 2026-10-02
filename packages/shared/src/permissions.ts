import type { Role } from './roles';

/**
 * THE permissions matrix. Every API route declares exactly one permission from this file
 * (or is explicitly public / self-service), and the web navigation is derived from it.
 * Changing a row here changes server enforcement, UI navigation, and the generated
 * role x route test sweep at the same time.
 */
export const PERMISSION_MATRIX = {
  /** Any signed-in member acting on their own account: /me, logout, 2FA, own sessions. */
  'self.manage': [
    'owner',
    'admin',
    'coordinator',
    'shooter',
    'editor',
    'client',
    'brokerage_admin',
  ],

  'tenant.read': ['owner', 'admin', 'coordinator'],
  'tenant.update': ['owner', 'admin'],

  'branding.read': ['owner', 'admin', 'coordinator'],
  'branding.update': ['owner', 'admin'],

  'domains.read': ['owner', 'admin'],
  'domains.manage': ['owner', 'admin'],

  'members.read': ['owner', 'admin', 'coordinator'],
  'members.manage': ['owner', 'admin'],

  'invites.read': ['owner', 'admin'],
  'invites.manage': ['owner', 'admin'],

  'audit.read': ['owner', 'admin'],

  'jobs.read': ['owner', 'admin'],
  'jobs.retry': ['owner', 'admin'],

  /** CRM: brokerages, clients, contacts, tags, notes, saved views, imports and exports. */
  'clients.read': ['owner', 'admin', 'coordinator'],
  'clients.manage': ['owner', 'admin', 'coordinator'],

  /** Services, variants, packages, add-ons, skills. Includes base prices, so no shooter/editor. */
  'catalog.read': ['owner', 'admin', 'coordinator'],
  'catalog.manage': ['owner', 'admin'],

  /** Size bands, price rules, price lists, travel fees, coupons, tax rates, quotes. */
  'pricing.read': ['owner', 'admin', 'coordinator'],
  'pricing.manage': ['owner', 'admin'],

  /** Tuello's own subscription billing (Stripe Billing). Owner only. Routes arrive in a later phase. */
  'subscription.manage': ['owner'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSION_MATRIX;

export const PERMISSIONS = Object.keys(PERMISSION_MATRIX) as Permission[];

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSION_MATRIX[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return PERMISSIONS.filter((p) => can(role, p));
}
