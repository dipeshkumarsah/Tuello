import { z } from 'zod';
import { ROLES, type Role } from '../roles';
import { emailSchema, personNameSchema } from './common';

export const roleSchema = z.enum(ROLES);

export const createInviteSchema = z.object({
  email: emailSchema,
  role: roleSchema,
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

/**
 * Accepting an invite. A new user sets a name and password; an existing user signs in with
 * their current password to attach the membership.
 */
export const acceptInviteSchema = z.object({
  name: personNameSchema.optional(),
  /** Validated against the password policy server-side when it creates a new user. */
  password: z.string().min(1).max(256),
});

export const updateMemberSchema = z.object({ role: roleSchema });

export interface MemberDto {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'disabled';
  twoFactorEnabled: boolean;
  createdAt: string;
}

export interface InviteDto {
  id: string;
  email: string;
  role: Role;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  invitedBy: { id: string; name: string } | null;
}

export interface InvitePreviewDto {
  email: string;
  role: Role;
  tenantName: string;
  existingUser: boolean;
  expiresAt: string;
}

export interface MeDto {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
  };
  membership: { id: string; role: Role };
  permissions: string[];
  tenant: {
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
  };
}

export interface SessionDto {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface DeadLetterJobDto {
  id: string;
  queue: string;
  name: string;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
}

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { id: string; name: string } | null;
  createdAt: string;
}
