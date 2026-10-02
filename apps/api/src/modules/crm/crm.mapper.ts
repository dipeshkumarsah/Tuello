import type { Brokerage, Client, ClientContact, Tag } from '@tuello/db';
import type { BrokerageDto, ClientDto, ContactDto } from '@tuello/shared';
import { normalizePhone } from '@tuello/shared';

export function displayName(c: {
  firstName: string;
  lastName: string;
  email: string | null;
}): string {
  const name = `${c.firstName} ${c.lastName}`.trim();
  return name || c.email || 'Unnamed';
}

/** Keyset sort key for "by name": last, first, then email. Maintained on every write. */
export function sortName(c: { firstName: string; lastName: string; email: string | null }): string {
  return `${c.lastName} ${c.firstName} ${c.email ?? ''}`.trim().toLowerCase().slice(0, 400);
}

export function phoneFields(phone: string | null | undefined) {
  if (phone === undefined) return {};
  return { phone, phoneNormalized: phone ? normalizePhone(phone) : null };
}

type ClientWith = Client & {
  brokerage?: Pick<Brokerage, 'id' | 'name'> | null;
  tags?: Array<{ tag: Pick<Tag, 'id' | 'name'> }>;
};

export function toClientDto(c: ClientWith): ClientDto {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    displayName: displayName(c),
    email: c.email,
    phone: c.phone,
    company: c.company,
    title: c.title,
    status: c.status,
    externalRef: c.externalRef,
    priceListId: c.priceListId,
    brokerage: c.brokerage ? { id: c.brokerage.id, name: c.brokerage.name } : null,
    tags: (c.tags ?? [])
      .map((t) => ({ id: t.tag.id, name: t.tag.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    addressLine1: c.addressLine1,
    addressLine2: c.addressLine2,
    city: c.city,
    region: c.region,
    postalCode: c.postalCode,
    country: c.country,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export const clientInclude = {
  brokerage: { select: { id: true, name: true } },
  tags: { select: { tag: { select: { id: true, name: true } } } },
} as const;

export function toBrokerageDto(b: Brokerage & { _count?: { clients: number } }): BrokerageDto {
  return {
    id: b.id,
    name: b.name,
    email: b.email,
    phone: b.phone,
    website: b.website,
    externalRef: b.externalRef,
    priceListId: b.priceListId,
    addressLine1: b.addressLine1,
    addressLine2: b.addressLine2,
    city: b.city,
    region: b.region,
    postalCode: b.postalCode,
    country: b.country,
    ...(b._count ? { clientCount: b._count.clients } : {}),
    createdAt: b.createdAt.toISOString(),
  };
}

export function toContactDto(c: ClientContact): ContactDto {
  return { id: c.id, name: c.name, role: c.role, email: c.email, phone: c.phone, notify: c.notify };
}
