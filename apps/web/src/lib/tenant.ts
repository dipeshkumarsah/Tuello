'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BrandingDto,
  TenantDto,
  UpdateBrandingInput,
  UpdateTenantInput,
} from '@tuello/shared';
import { get, patch } from './api';
import { ME_KEY } from './session';

export function useTenant() {
  return useQuery({ queryKey: ['tenant'], queryFn: () => get<TenantDto>('/v1/tenant') });
}

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTenantInput) =>
      patch<{ tenant: TenantDto; handoffUrl: string | null }>('/v1/tenant', input),
    onSuccess: (res) => {
      // A new address means a new host: continue there with a one-time handoff.
      if (res.handoffUrl) {
        window.location.assign(res.handoffUrl);
        return;
      }
      qc.setQueryData(['tenant'], res.tenant);
      void qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}

export function useBranding() {
  return useQuery({
    queryKey: ['branding'],
    queryFn: () => get<BrandingDto>('/v1/tenant/branding'),
  });
}

export function useUpdateBranding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateBrandingInput) => patch<BrandingDto>('/v1/tenant/branding', input),
    onSuccess: (b) => {
      qc.setQueryData(['branding'], b);
      void qc.invalidateQueries({ queryKey: ['public-tenant'] });
    },
  });
}

export function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf(
      'timeZone',
    );
  } catch {
    return [
      'UTC',
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'Europe/London',
      'Australia/Sydney',
    ];
  }
}
