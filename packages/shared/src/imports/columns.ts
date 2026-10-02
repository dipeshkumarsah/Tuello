import { z } from 'zod';
import { emailSchema } from '../schemas/common';
import { normalizePhone } from '../schemas/crm';

/** Importable entities and their target fields. Shared by the API preview and the worker. */
export const IMPORT_ENTITIES = ['clients', 'brokerages'] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  /** Lower-cased header spellings that map to this field automatically. */
  aliases: string[];
}

export const IMPORT_FIELDS: Record<ImportEntity, ImportField[]> = {
  clients: [
    {
      key: 'firstName',
      label: 'First name',
      aliases: ['first name', 'firstname', 'first', 'given name'],
    },
    {
      key: 'lastName',
      label: 'Last name',
      aliases: ['last name', 'lastname', 'last', 'surname', 'family name'],
    },
    {
      key: 'fullName',
      label: 'Full name',
      aliases: ['name', 'full name', 'agent', 'agent name', 'client', 'client name'],
    },
    { key: 'email', label: 'Email', aliases: ['email', 'e-mail', 'email address', 'mail'] },
    {
      key: 'phone',
      label: 'Phone',
      aliases: ['phone', 'mobile', 'cell', 'phone number', 'telephone'],
    },
    { key: 'company', label: 'Company / team', aliases: ['company', 'team'] },
    { key: 'title', label: 'Title', aliases: ['title', 'position', 'job title'] },
    { key: 'brokerage', label: 'Brokerage', aliases: ['brokerage', 'broker', 'office', 'agency'] },
    {
      key: 'externalRef',
      label: 'External ID',
      aliases: ['id', 'external id', 'external_id', 'crm id', 'reference'],
    },
    { key: 'tags', label: 'Tags (comma separated)', aliases: ['tags', 'tag', 'labels'] },
    {
      key: 'addressLine1',
      label: 'Address',
      aliases: ['address', 'address 1', 'address line 1', 'street'],
    },
    { key: 'city', label: 'City', aliases: ['city', 'town'] },
    { key: 'region', label: 'State / region', aliases: ['state', 'region', 'province', 'county'] },
    {
      key: 'postalCode',
      label: 'Postal code',
      aliases: ['zip', 'zip code', 'postal code', 'postcode'],
    },
  ],
  brokerages: [
    {
      key: 'name',
      label: 'Name',
      required: true,
      aliases: ['name', 'brokerage', 'brokerage name', 'office', 'company'],
    },
    { key: 'email', label: 'Email', aliases: ['email', 'e-mail'] },
    { key: 'phone', label: 'Phone', aliases: ['phone', 'telephone'] },
    { key: 'website', label: 'Website', aliases: ['website', 'web', 'url'] },
    { key: 'externalRef', label: 'External ID', aliases: ['id', 'external id', 'reference'] },
    { key: 'addressLine1', label: 'Address', aliases: ['address', 'street'] },
    { key: 'city', label: 'City', aliases: ['city'] },
    { key: 'region', label: 'State / region', aliases: ['state', 'region', 'province'] },
    { key: 'postalCode', label: 'Postal code', aliases: ['zip', 'postal code', 'postcode'] },
  ],
};

/** Field key -> CSV column header. */
export type ImportMapping = Record<string, string>;

export const importMappingSchema = z.record(z.string().max(40), z.string().max(200));

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ');

export function suggestMapping(entity: ImportEntity, headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS[entity]) {
    const header = headers.find(
      (h) => !used.has(h) && (norm(h) === norm(field.label) || field.aliases.includes(norm(h))),
    );
    if (header) {
      mapping[field.key] = header;
      used.add(header);
    }
  }
  // A full name column is only useful when first/last are absent.
  if (entity === 'clients' && (mapping.firstName || mapping.lastName)) delete mapping.fullName;
  return mapping;
}

export interface ClientImportRow {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  phoneNormalized: string | null;
  company: string | null;
  title: string | null;
  brokerage: string | null;
  externalRef: string | null;
  tags: string[];
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
}

export interface BrokerageImportRow {
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  externalRef: string | null;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
}

export type RowResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const clean = (v: string | undefined, max: number): string | null => {
  const t = (v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

function pick(
  raw: Record<string, string>,
  mapping: ImportMapping,
  key: string,
): string | undefined {
  const header = mapping[key];
  return header ? raw[header] : undefined;
}

/** Validates and normalises one CSV row for the given entity. Same rules in preview and worker. */
export function parseImportRow(
  entity: 'clients',
  raw: Record<string, string>,
  mapping: ImportMapping,
): RowResult<ClientImportRow>;
export function parseImportRow(
  entity: 'brokerages',
  raw: Record<string, string>,
  mapping: ImportMapping,
): RowResult<BrokerageImportRow>;
export function parseImportRow(
  entity: ImportEntity,
  raw: Record<string, string>,
  mapping: ImportMapping,
): RowResult<ClientImportRow | BrokerageImportRow> {
  const errors: string[] = [];
  const get = (k: string, max = 200) => clean(pick(raw, mapping, k), max);

  let email = get('email', 254);
  if (email) {
    const parsed = emailSchema.safeParse(email);
    if (parsed.success) email = parsed.data;
    else errors.push(`Invalid email "${email}"`);
  }
  const phone = get('phone', 40);
  const phoneNormalized = phone ? normalizePhone(phone) : null;
  if (phone && phoneNormalized!.length < 7) errors.push(`Invalid phone "${phone}"`);

  if (entity === 'brokerages') {
    const name = get('name');
    if (!name) errors.push('Name is required');
    if (errors.length) return { ok: false, errors };
    return {
      ok: true,
      value: {
        name: name!,
        email,
        phone,
        website: get('website', 300),
        externalRef: get('externalRef', 100),
        addressLine1: get('addressLine1'),
        city: get('city', 100),
        region: get('region', 100),
        postalCode: get('postalCode', 20),
      },
    };
  }

  let firstName = get('firstName', 100) ?? '';
  let lastName = get('lastName', 100) ?? '';
  const full = get('fullName');
  if (!firstName && !lastName && full) {
    const parts = full.split(/\s+/);
    lastName = parts.length > 1 ? parts.pop()! : '';
    firstName = parts.join(' ');
  }
  const externalRef = get('externalRef', 100);
  if (!firstName && !lastName && !email) errors.push('A name or an email is required');
  if (!email && !externalRef && !(phoneNormalized && (firstName || lastName))) {
    errors.push(
      'Each row needs an email, an external ID, or a name with a phone number (used to avoid duplicates)',
    );
  }
  if (errors.length) return { ok: false, errors };
  const tags = (get('tags', 1000) ?? '')
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((t) => t.slice(0, 50));
  return {
    ok: true,
    value: {
      firstName,
      lastName,
      email,
      phone,
      phoneNormalized,
      company: get('company'),
      title: get('title', 100),
      brokerage: get('brokerage'),
      externalRef,
      tags,
      addressLine1: get('addressLine1'),
      city: get('city', 100),
      region: get('region', 100),
      postalCode: get('postalCode', 20),
    },
  };
}

export const createImportSchema = z.object({
  entity: z.enum(IMPORT_ENTITIES),
  fileName: z.string().trim().min(1).max(200),
  size: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024),
});

export const startImportSchema = z.object({ mapping: importMappingSchema });

export interface ImportJobDto {
  id: string;
  entity: ImportEntity;
  status: 'awaiting_upload' | 'uploaded' | 'queued' | 'running' | 'completed' | 'failed';
  fileName: string;
  mapping: ImportMapping | null;
  totalRows: number;
  processedRows: number;
  createdCount: number;
  updatedCount: number;
  errorCount: number;
  hasErrorReport: boolean;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ImportPreviewDto {
  headers: string[];
  suggestedMapping: ImportMapping;
  fields: ImportField[];
  rows: Array<{ line: number; raw: Record<string, string>; ok: boolean; errors: string[] }>;
}
