import { Global, Module } from '@nestjs/common';
import { TenantDirectory } from '../tenants/tenant-directory.service';
import { AuthTokensService } from './auth-tokens.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LinksService } from './links.service';
import { MeController } from './me.controller';
import { SessionService } from './session.service';

@Global()
@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService, AuthTokensService, LinksService, SessionService, TenantDirectory],
  exports: [AuthService, AuthTokensService, LinksService, SessionService, TenantDirectory],
})
export class IdentityModule {}
