import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
  personNameSchema,
  slugSchema,
  timeZoneSchema,
  currencySchema,
  measurementUnitSchema,
} from './common';

export const signupSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  slug: slugSchema,
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
  timeZone: timeZoneSchema.default('America/New_York'),
  currency: currencySchema.default('USD'),
  measurementUnit: measurementUnitSchema.default('sqft'),
  turnstileToken: z.string().max(4096).optional(),
});
export type SignupInput = z.input<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const tokenSchema = z.string().min(20).max(200);

export const verifyEmailSchema = z.object({ token: tokenSchema });
export const resendVerificationSchema = z.object({ email: emailSchema });

export const passwordResetRequestSchema = z.object({ email: emailSchema });
export const passwordResetConfirmSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});

export const magicLinkRequestSchema = z.object({ email: emailSchema });
export const magicLinkConsumeSchema = z.object({ token: tokenSchema });

export const handoffSchema = z.object({ token: tokenSchema });

export const totpCodeSchema = z.string().regex(/^\d{6}$/, { error: 'validation.totp_code' });
export const totpConfirmSchema = z.object({ code: totpCodeSchema });
export const totpDisableSchema = z.object({
  code: totpCodeSchema,
  password: z.string().min(1).max(256),
});
export const mfaChallengeSchema = z.object({ challengeToken: tokenSchema, code: totpCodeSchema });

export const slugAvailabilitySchema = z.object({ slug: z.string().max(60) });

export const updateProfileSchema = z.object({
  name: personNameSchema.optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});

export type LoginResult = { status: 'ok' } | { status: 'mfa_required'; challengeToken: string };
