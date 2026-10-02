import { z } from 'zod';
import { emailSchema } from './common';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const optionalEmail = z
  .union([emailSchema, z.literal('')])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const phoneSchema = z
  .string()
  .trim()
  .max(40)
  .refine((v) => v === '' || normalizePhone(v).length >= 7, { error: 'validation.phone' })
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

/** Digits only, without a leading "1" country code for 11-digit NANP numbers. Used for matching. */
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

const addressShape = {
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  region: optionalText(100),
  postalCode: optionalText(20),
  country: optionalText(2),
};

export const brokerageInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: optionalEmail,
  phone: phoneSchema,
  website: optionalText(300),
  externalRef: optionalText(100),
  priceListId: z.uuid().nullable().optional(),
  ...addressShape,
});
export type BrokerageInput = z.input<typeof brokerageInputSchema>;
export const brokerageUpdateSchema = brokerageInputSchema.partial();

export const CLIENT_STATUSES = ['active', 'archived'] as const;

export const clientInputSchema = z
  .object({
    firstName: z.string().trim().max(100).default(''),
    lastName: z.string().trim().max(100).default(''),
    email: optionalEmail,
    phone: phoneSchema,
    company: optionalText(200),
    title: optionalText(100),
    brokerageId: z.uuid().nullable().optional(),
    priceListId: z.uuid().nullable().optional(),
    externalRef: optionalText(100),
    status: z.enum(CLIENT_STATUSES).optional(),
    tagIds: z.array(z.uuid()).max(50).optional(),
    ...addressShape,
  })
  .refine((c) => (c.firstName + c.lastName).trim().length > 0 || !!c.email, {
    error: 'validation.client_identity',
    path: ['firstName'],
  });
export type ClientInput = z.input<typeof clientInputSchema>;

export const clientUpdateSchema = z.object({
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  email: optionalEmail,
  phone: phoneSchema,
  company: optionalText(200),
  title: optionalText(100),
  brokerageId: z.uuid().nullable().optional(),
  priceListId: z.uuid().nullable().optional(),
  externalRef: optionalText(100),
  status: z.enum(CLIENT_STATUSES).optional(),
  tagIds: z.array(z.uuid()).max(50).optional(),
  ...addressShape,
});

export const contactInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  role: optionalText(100),
  email: optionalEmail,
  phone: phoneSchema,
  notify: z.boolean().default(false),
});

export const tagInputSchema = z.object({ name: z.string().trim().min(1).max(50) });

export const noteInputSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  pinned: z.boolean().default(false),
});

export const CLIENT_SORTS = ['name', 'created'] as const;

/** Filters shared by the client list endpoint, saved views and exports. */
export const clientFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  brokerageId: z.uuid().optional(),
  tagId: z.uuid().optional(),
  status: z.enum(CLIENT_STATUSES).optional(),
  priceListId: z.uuid().optional(),
  sort: z.enum(CLIENT_SORTS).default('name'),
});
export type ClientFilters = z.infer<typeof clientFiltersSchema>;

export const savedViewInputSchema = z.object({
  entity: z.enum(['clients', 'brokerages']),
  name: z.string().trim().min(1).max(80),
  filters: clientFiltersSchema.omit({ q: true }).extend({ q: z.string().max(200).optional() }),
  shared: z.boolean().default(false),
});

export const mergeClientsSchema = z.object({ sourceId: z.uuid() });

export const duplicateCheckSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: z.string().max(254).optional(),
  phone: z.string().max(40).optional(),
  brokerageId: z.uuid().nullable().optional(),
  excludeId: z.uuid().optional(),
});

export interface TagDto {
  id: string;
  name: string;
}

export interface BrokerageDto {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  externalRef: string | null;
  priceListId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  clientCount?: number;
  createdAt: string;
}

export interface ClientDto {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  status: (typeof CLIENT_STATUSES)[number];
  externalRef: string | null;
  priceListId: string | null;
  brokerage: { id: string; name: string } | null;
  tags: TagDto[];
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactDto {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notify: boolean;
}

export interface NoteDto {
  id: string;
  body: string;
  pinned: boolean;
  author: { id: string; name: string } | null;
  createdAt: string;
}

export interface ActivityDto {
  id: string;
  type: string;
  actor: { id: string; name: string } | null;
  data: Record<string, unknown>;
  occurredAt: string;
}

export interface DuplicateDto {
  client: {
    id: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    brokerage: string | null;
  };
  reasons: Array<'email' | 'phone' | 'name'>;
  score: number;
}

export interface SavedViewDto {
  id: string;
  entity: 'clients' | 'brokerages';
  name: string;
  filters: Record<string, unknown>;
  shared: boolean;
  mine: boolean;
}
