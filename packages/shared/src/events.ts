/**
 * Domain events. Every state change writes one of these to the outbox in the same transaction.
 * Names are part of the public contract (they become outgoing webhook types in a later phase):
 * never rename one, add a new name instead.
 */
export const DOMAIN_EVENTS = {
  'tenant.created': 'A tenant signed up.',
  'tenant.updated': 'Tenant settings changed.',
  'tenant.onboarding_completed': 'The onboarding wizard was finished.',
  'tenant.branding_updated': 'Logo, accent colour, or email sender changed.',
  'domain.added': 'A custom domain was added.',
  'domain.verified': 'A custom domain passed DNS verification.',
  'domain.verification_failed': 'A custom domain failed DNS verification.',
  'domain.removed': 'A custom domain was removed.',
  'user.email_verified': 'A user verified their email address.',
  'user.two_factor_enabled': 'A user enabled TOTP two-factor authentication.',
  'user.two_factor_disabled': 'A user disabled TOTP two-factor authentication.',
  'member.invited': 'An invite was sent.',
  'member.invite_revoked': 'An invite was revoked.',
  'member.joined': 'An invite was accepted and a membership created.',
  'member.role_changed': "A member's role changed.",
  'member.removed': 'A member was removed from the tenant.',
} as const;

export type DomainEventName = keyof typeof DOMAIN_EVENTS;

export interface OutboxEventMessage {
  id: string;
  tenantId: string;
  name: DomainEventName;
  aggregateType: string;
  aggregateId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}
