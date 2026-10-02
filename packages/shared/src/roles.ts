export const ROLES = [
  'owner',
  'admin',
  'coordinator',
  'shooter',
  'editor',
  'client',
  'brokerage_admin',
] as const;

export type Role = (typeof ROLES)[number];

/** Roles that work for the media company (as opposed to its clients). */
export const STAFF_ROLES: readonly Role[] = ['owner', 'admin', 'coordinator', 'shooter', 'editor'];

/** Roles that may enable optional TOTP two-factor authentication. */
export const TOTP_ROLES: readonly Role[] = STAFF_ROLES;

export function isStaffRole(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}

/** Which roles an actor may grant through an invite or a role change. */
export function assignableRoles(actor: Role): readonly Role[] {
  if (actor === 'owner') return ROLES;
  if (actor === 'admin') return ROLES.filter((r) => r !== 'owner');
  return [];
}
