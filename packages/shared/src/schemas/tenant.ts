import { z } from 'zod';
import {
  currencySchema,
  hexColorSchema,
  localeSchema,
  measurementUnitSchema,
  slugSchema,
  timeZoneSchema,
} from './common';
import { LOGO_CONTENT_TYPES, LOGO_MAX_BYTES } from '../constants';
import { checkAccentContrast } from '../color';

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: slugSchema,
    timeZone: timeZoneSchema,
    currency: currencySchema,
    measurementUnit: measurementUnitSchema,
    taxLabel: z.string().trim().min(1).max(40),
    locale: localeSchema,
  })
  .partial();
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const completeOnboardingSchema = z.object({}).strict();

export const accentColorSchema = hexColorSchema.refine((c) => checkAccentContrast(c).ok, {
  error: 'validation.accent_contrast',
});

export const updateBrandingSchema = z
  .object({
    accentColor: accentColorSchema.nullable(),
    emailSenderName: z.string().trim().min(1).max(80).nullable(),
    emailReplyTo: z.email().nullable(),
    logoKey: z.string().max(300).nullable(),
  })
  .partial();
export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;

export const logoUploadRequestSchema = z.object({
  contentType: z.enum(LOGO_CONTENT_TYPES),
  size: z.number().int().positive().max(LOGO_MAX_BYTES),
});

export const addDomainSchema = z.object({
  hostname: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/, {
      error: 'validation.hostname',
    }),
});

export interface TenantDto {
  id: string;
  slug: string;
  name: string;
  status: 'onboarding' | 'active' | 'suspended';
  timeZone: string;
  currency: string;
  measurementUnit: 'sqft' | 'm2';
  taxLabel: string;
  locale: string;
  onboardingCompletedAt: string | null;
}

export interface BrandingDto {
  accentColor: string | null;
  accentTextColor: string | null;
  emailSenderName: string | null;
  emailReplyTo: string | null;
  logoKey: string | null;
  logoUrl: string | null;
}

export interface PublicTenantDto {
  slug: string;
  name: string;
  branding: Pick<BrandingDto, 'accentColor' | 'accentTextColor' | 'logoUrl'>;
}

export interface DomainDto {
  id: string;
  hostname: string;
  status: 'pending' | 'verified' | 'failed';
  verificationRecordName: string;
  verificationRecordValue: string;
  cnameTarget: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}
