'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  CouponDto,
  CursorPage,
  ItemKind,
  PriceListDto,
  PricingCatalog,
  TerritoryDto,
} from '@tuello/shared';
import { get } from './api';

export function usePricingCatalog() {
  return useQuery({
    queryKey: ['pricing-catalog'],
    queryFn: () => get<PricingCatalog>('/v1/pricing/catalog'),
  });
}

export interface PriceRuleRow {
  id: string;
  itemKind: ItemKind;
  itemId: string;
  sizeBandId: string | null;
  propertyTypeId: string | null;
  price: number;
}

export function usePriceRules() {
  return useQuery({
    queryKey: ['price-rules'],
    queryFn: () => get<{ items: PriceRuleRow[] }>('/v1/price-rules'),
  });
}

export function usePriceLists() {
  return useQuery({
    queryKey: ['price-lists'],
    queryFn: () => get<{ items: PriceListDto[] }>('/v1/price-lists'),
  });
}

export function useCoupons() {
  return useQuery({
    queryKey: ['coupons'],
    queryFn: () => get<CursorPage<CouponDto>>('/v1/coupons?limit=100'),
  });
}

export function useTerritories() {
  return useQuery({
    queryKey: ['territories'],
    queryFn: () => get<{ items: TerritoryDto[] }>('/v1/territories'),
  });
}

export interface TravelRuleRow {
  id: string;
  name: string;
  kind: 'territory' | 'distance';
  territoryId: string | null;
  fee: number | null;
  freeKm: number | null;
  perKm: number | null;
  minFee: number | null;
  maxFee: number | null;
  priority: number;
  active: boolean;
}

export function useTravelRules() {
  return useQuery({
    queryKey: ['travel-rules'],
    queryFn: () => get<{ items: TravelRuleRow[] }>('/v1/travel-fee-rules'),
  });
}

export interface TaxRateRow {
  id: string;
  name: string;
  rateBps: number;
  regionCode: string | null;
  appliesToTravel: boolean;
  active: boolean;
}

export function useTaxRates() {
  return useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => get<{ items: TaxRateRow[] }>('/v1/tax-rates'),
  });
}

/** All priceable items in display order, for pickers. */
export function priceableItems(
  c: PricingCatalog,
): Array<{ kind: ItemKind; id: string; label: string; basePrice: number; active: boolean }> {
  return [
    ...c.variants.map((v) => ({
      kind: 'variant' as const,
      id: v.id,
      label: `${v.serviceName} · ${v.name}`,
      basePrice: v.basePrice,
      active: v.active,
    })),
    ...c.packages.map((p) => ({
      kind: 'package' as const,
      id: p.id,
      label: p.name,
      basePrice: p.basePrice,
      active: p.active,
    })),
    ...c.addOns.map((a) => ({
      kind: 'add_on' as const,
      id: a.id,
      label: a.name,
      basePrice: a.basePrice,
      active: a.active,
    })),
  ];
}
