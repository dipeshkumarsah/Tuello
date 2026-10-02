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
  'brokerage.created': 'A brokerage was created.',
  'brokerage.updated': 'A brokerage changed.',
  'brokerage.deleted': 'A brokerage was deleted.',
  'client.created': 'A client (agent) was created.',
  'client.updated': 'A client changed (including tags and price list).',
  'client.deleted': 'A client was deleted.',
  'client.merged': 'A duplicate client was merged into another.',
  'client.note_added': 'A note was added to a client or brokerage.',
  'import.started': 'A CSV import started.',
  'import.completed': 'A CSV import finished.',
  'import.failed': 'A CSV import failed.',
  'catalog.service_changed': 'A service or one of its variants was created, changed or deleted.',
  'catalog.package_changed': 'A package was created, changed or deleted.',
  'catalog.add_on_changed': 'An add-on was created, changed or deleted.',
  'pricing.rules_changed': 'Size bands, property types or price rules changed.',
  'pricing.price_list_changed': 'A client price list was created, changed or deleted.',
  'pricing.travel_changed': 'Territories or travel fee rules changed.',
  'pricing.coupon_changed': 'A coupon was created, changed or deleted.',
  'pricing.tax_changed': 'A tax rate was created, changed or deleted.',
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
