import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';
import { DomainsController, TlsAskController } from './domains.controller';
import { TenantController } from './tenant.controller';

@Module({
  imports: [IdentityModule],
  controllers: [TenantController, BrandingController, DomainsController, TlsAskController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class TenantsModule {}
