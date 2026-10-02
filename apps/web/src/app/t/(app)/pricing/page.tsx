'use client';

import { SkeletonRows, Tabs, TabsContent, TabsList, TabsTrigger } from '@tuello/ui';
import { PageHeader, QueryError, RequirePermission } from '@/components/page';
import {
  Coupons,
  PriceGrid,
  PriceLists,
  SizeBands,
  TaxRates,
  Travel,
} from '@/components/pricing-tabs';
import { useI18n } from '@/lib/i18n';
import { usePricingCatalog } from '@/lib/pricing';

function Pricing() {
  const { t } = useI18n();
  const catalog = usePricingCatalog();
  return (
    <>
      <PageHeader title={t('pricing.title')} description={t('pricing.body')} />
      {catalog.isPending ? (
        <SkeletonRows rows={6} label={t('common.loading')} />
      ) : catalog.isError ? (
        <QueryError onRetry={() => void catalog.refetch()} />
      ) : (
        <Tabs defaultValue="price-lists">
          <TabsList>
            <TabsTrigger value="price-lists">{t('pricing.priceLists')}</TabsTrigger>
            <TabsTrigger value="grid">{t('pricing.grid')}</TabsTrigger>
            <TabsTrigger value="bands">{t('pricing.sizeBands')}</TabsTrigger>
            <TabsTrigger value="coupons">{t('pricing.coupons')}</TabsTrigger>
            <TabsTrigger value="travel">{t('pricing.travel')}</TabsTrigger>
            <TabsTrigger value="tax">{t('pricing.taxRates')}</TabsTrigger>
          </TabsList>
          <TabsContent value="price-lists">
            <PriceLists />
          </TabsContent>
          <TabsContent value="grid">
            <PriceGrid catalog={catalog.data} />
          </TabsContent>
          <TabsContent value="bands">
            <SizeBands catalog={catalog.data} />
          </TabsContent>
          <TabsContent value="coupons">
            <Coupons />
          </TabsContent>
          <TabsContent value="travel">
            <Travel />
          </TabsContent>
          <TabsContent value="tax">
            <TaxRates />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

export default function PricingPage() {
  return (
    <RequirePermission permission="pricing.read">
      <Pricing />
    </RequirePermission>
  );
}
