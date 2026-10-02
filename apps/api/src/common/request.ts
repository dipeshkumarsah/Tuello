import type { Request } from 'express';
import type { Role } from '@tuello/shared';

export interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;
  status: 'onboarding' | 'active' | 'suspended';
  host: string;
  hostKind: 'subdomain' | 'custom';
}

export interface AuthState {
  sessionId: string;
  tokenHash: string;
  userId: string;
  membershipId: string;
  role: Role;
  email: string;
  name: string;
}

/** Fields the pipeline attaches to each request. */
export interface TuelloRequest extends Request {
  id: string;
  publicHost: string;
  hostKind: 'apex' | 'subdomain' | 'custom' | 'invalid';
  tenant: ResolvedTenant | null;
  auth: AuthState | null;
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
