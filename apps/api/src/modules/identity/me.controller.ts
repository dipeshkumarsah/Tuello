import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { hashPassword, verifyPassword, type Database } from '@tuello/db';
import {
  changePasswordSchema,
  permissionsFor,
  TOTP_ROLES,
  totpConfirmSchema,
  totpDisableSchema,
  updateProfileSchema,
  type MeDto,
  type SessionDto,
} from '@tuello/shared';
import type { Response } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env';
import { RateLimit, RequirePermission } from '../../common/decorators';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { ApiZodBody, ZBody } from '../../common/zod';
import { decrypt, encrypt } from '../../infra/crypto';
import { DB } from '../../infra/tokens';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../../infra/totp';
import { AuditService, EventsService } from '../events/events.service';
import { SessionService } from './session.service';

@ApiTags('me')
@Controller({ path: 'me', version: '1' })
export class MeController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly sessions: SessionService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('self.manage')
  async me(@Req() req: TuelloRequest): Promise<MeDto> {
    const auth = req.auth!;
    const [user, tenant] = await Promise.all([
      this.db.tx.user.findUniqueOrThrow({ where: { id: auth.userId } }),
      this.db.tx.tenant.findUniqueOrThrow({ where: { id: req.tenant!.id } }),
    ]);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: !!user.emailVerifiedAt,
        twoFactorEnabled: !!user.totpEnabledAt,
      },
      membership: { id: auth.membershipId, role: auth.role },
      permissions: permissionsFor(auth.role),
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        timeZone: tenant.timeZone,
        currency: tenant.currency,
        measurementUnit: tenant.measurementUnit,
        taxLabel: tenant.taxLabel,
        locale: tenant.locale,
        onboardingCompletedAt: tenant.onboardingCompletedAt?.toISOString() ?? null,
      },
    };
  }

  @Patch()
  @RequirePermission('self.manage')
  @ApiZodBody(updateProfileSchema)
  async update(
    @ZBody(updateProfileSchema) body: z.infer<typeof updateProfileSchema>,
    @Req() req: TuelloRequest,
  ) {
    const user = await this.db.tx.user.update({ where: { id: req.auth!.userId }, data: body });
    return { id: user.id, name: user.name, email: user.email };
  }

  @Post('password')
  @HttpCode(204)
  @RequirePermission('self.manage')
  @RateLimit({ by: 'ip', limit: 10, windowSec: 900 })
  @ApiZodBody(changePasswordSchema)
  async changePassword(
    @ZBody(changePasswordSchema) body: z.infer<typeof changePasswordSchema>,
    @Req() req: TuelloRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const auth = req.auth!;
    const user = await this.db.tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw new Problem('invalid_credentials', 'Current password is incorrect.');
    }
    // Every other session of this user ends; this device gets a fresh one.
    const changedAt = new Date();
    await this.db.tx.user.update({
      where: { id: auth.userId },
      data: { passwordHash: await hashPassword(body.newPassword), passwordChangedAt: changedAt },
    });
    await this.sessions.revoke({ userId: auth.userId });
    const { token, expiresAt } = await this.sessions.create(req, req.tenant!.id, auth.userId);
    this.sessions.setCookie(res, token, expiresAt);
    await this.audit.record(req, 'user.password_changed', { type: 'user', id: auth.userId });
  }

  // ---------------------------------------------------------------------------- TOTP 2FA

  private assertStaff(req: TuelloRequest) {
    if (!TOTP_ROLES.includes(req.auth!.role))
      throw new Problem('forbidden', 'Two-factor is available to staff roles.');
  }

  @Post('totp/setup')
  @RequirePermission('self.manage')
  async totpSetup(@Req() req: TuelloRequest) {
    this.assertStaff(req);
    const user = await this.db.tx.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    if (user.totpEnabledAt) throw new Problem('conflict', 'Two-factor is already enabled.');
    const secret = generateTotpSecret();
    await this.db.tx.user.update({
      where: { id: user.id },
      data: { totpSecret: encrypt(secret, this.env.ENCRYPTION_KEY) },
    });
    const url = otpauthUrl({ secret, account: user.email, issuer: req.tenant!.name });
    const qrSvg = await QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    return { secret, otpauthUrl: url, qrSvg };
  }

  @Post('totp/confirm')
  @HttpCode(204)
  @RequirePermission('self.manage')
  @RateLimit({ by: 'ip', limit: 10, windowSec: 300 })
  @ApiZodBody(totpConfirmSchema)
  async totpConfirm(
    @ZBody(totpConfirmSchema) body: z.infer<typeof totpConfirmSchema>,
    @Req() req: TuelloRequest,
  ) {
    this.assertStaff(req);
    const user = await this.db.tx.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    if (!user.totpSecret || user.totpEnabledAt)
      throw new Problem('conflict', 'Start two-factor setup first.');
    if (verifyTotp(decrypt(user.totpSecret, this.env.ENCRYPTION_KEY), body.code) === null) {
      throw new Problem('validation_failed', 'Invalid code.', [
        { path: 'code', code: 'invalid', message: 'Invalid code.' },
      ]);
    }
    await this.db.tx.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } });
    await this.events.emit('user.two_factor_enabled', { type: 'user', id: user.id });
    await this.audit.record(req, 'user.two_factor_enabled', { type: 'user', id: user.id });
  }

  @Post('totp/disable')
  @HttpCode(204)
  @RequirePermission('self.manage')
  @RateLimit({ by: 'ip', limit: 10, windowSec: 300 })
  @ApiZodBody(totpDisableSchema)
  async totpDisable(
    @ZBody(totpDisableSchema) body: z.infer<typeof totpDisableSchema>,
    @Req() req: TuelloRequest,
  ) {
    const user = await this.db.tx.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    if (!user.totpEnabledAt || !user.totpSecret)
      throw new Problem('conflict', 'Two-factor is not enabled.');
    const passwordOk =
      !!user.passwordHash && (await verifyPassword(user.passwordHash, body.password));
    const codeOk =
      verifyTotp(decrypt(user.totpSecret, this.env.ENCRYPTION_KEY), body.code) !== null;
    if (!passwordOk || !codeOk) throw new Problem('invalid_credentials');
    await this.db.tx.user.update({
      where: { id: user.id },
      data: { totpEnabledAt: null, totpSecret: null },
    });
    await this.events.emit('user.two_factor_disabled', { type: 'user', id: user.id });
    await this.audit.record(req, 'user.two_factor_disabled', { type: 'user', id: user.id });
  }

  // ------------------------------------------------------------------------------ sessions

  @Get('sessions')
  @RequirePermission('self.manage')
  async listSessions(@Req() req: TuelloRequest): Promise<{ items: SessionDto[] }> {
    const rows = await this.db.tx.session.findMany({
      where: { userId: req.auth!.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
    });
    return {
      items: rows.map((s) => ({
        id: s.id,
        current: s.id === req.auth!.sessionId,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
      })),
    };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @RequirePermission('self.manage')
  async revokeSession(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const owned = await this.db.tx.session.findFirst({ where: { id, userId: req.auth!.userId } });
    if (!owned) throw new Problem('not_found');
    await this.sessions.revoke({ id });
  }
}
