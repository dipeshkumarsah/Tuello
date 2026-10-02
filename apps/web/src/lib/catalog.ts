'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddOnDto, PackageDto, ServiceDto, SkillDto } from '@tuello/shared';
import { get } from './api';

export interface CatalogData {
  services: ServiceDto[];
  packages: PackageDto[];
  addOns: AddOnDto[];
  skills: SkillDto[];
}

export function useCatalog(enabled = true) {
  return useQuery({
    queryKey: ['catalog'],
    queryFn: () => get<CatalogData>('/v1/catalog'),
    enabled,
  });
}

/** Every catalog or pricing write changes quotes: refresh both. */
export function useInvalidatePricing() {
  const qc = useQueryClient();
  return () => {
    for (const k of [
      'catalog',
      'pricing-catalog',
      'price-rules',
      'price-lists',
      'size-bands',
      'coupons',
      'territories',
      'travel-rules',
      'tax-rates',
      'property-types',
    ]) {
      void qc.invalidateQueries({ queryKey: [k] });
    }
  };
}
