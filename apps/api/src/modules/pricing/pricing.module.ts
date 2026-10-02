import { Global, Module } from '@nestjs/common';
import { CatalogController } from '../catalog/catalog.controller';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Global()
@Module({
  controllers: [CatalogController, PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
