'use client';

import { useQuery } from '@tanstack/react-query';
import { can, type MeDto, type Permission } from '@tuello/shared';
import * as React from 'react';
import { get } from './api';

export const ME_KEY = ['me'] as const;

export function useMeQuery() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => get<MeDto>('/v1/me'),
    staleTime: 60_000,
    retry: false,
  });
}

const MeContext = React.createContext<MeDto | null>(null);

export function MeProvider({ me, children }: { me: MeDto; children: React.ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): MeDto {
  const me = React.useContext(MeContext);
  if (!me) throw new Error('useMe outside the signed-in app');
  return me;
}

/** UI hint only; the API enforces the same matrix on every request. */
export function useCan(permission: Permission): boolean {
  return can(useMe().membership.role, permission);
}
