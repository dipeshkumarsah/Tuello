'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  BrokerageDto,
  ClientDto,
  ClientFilters,
  CursorPage,
  PriceListDto,
  SavedViewDto,
  TagDto,
} from '@tuello/shared';
import { get } from './api';

export function clientQueryString(f: Partial<ClientFilters>, cursor?: string | null, limit = 50) {
  const p = new URLSearchParams({ limit: String(limit) });
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
  if (cursor) p.set('cursor', cursor);
  return p.toString();
}

export function useClients(filters: Partial<ClientFilters>) {
  return useInfiniteQuery({
    queryKey: ['clients', filters],
    queryFn: ({ pageParam }) =>
      get<CursorPage<ClientDto>>(`/v1/clients?${clientQueryString(filters, pageParam)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useBrokerageOptions() {
  return useQuery({
    queryKey: ['brokerages', 'options'],
    queryFn: () => get<CursorPage<BrokerageDto>>('/v1/brokerages?limit=100'),
    staleTime: 60_000,
  });
}

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => get<{ items: Array<TagDto & { clientCount: number }> }>('/v1/tags'),
  });
}

export function usePriceListOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['price-lists'],
    queryFn: () => get<{ items: PriceListDto[] }>('/v1/price-lists'),
    enabled,
  });
}

export function useSavedViews(entity: 'clients' | 'brokerages') {
  return useQuery({
    queryKey: ['saved-views', entity],
    queryFn: () => get<{ items: SavedViewDto[] }>(`/v1/saved-views?entity=${entity}`),
  });
}
