import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { hashPassword, uuidv7, verifyPassword, type Database } from '@tuello/db';
import {
  acceptInviteSchema,
  assignableRoles,
  createInviteSchema,
  createTranslator,
  cursorPageQuerySchema,
  passwordSchema,
  personNameSchema,
  TOKEN_TTL_SECONDS,
  type CursorPage,
  type CursorPageQuery,
  type InviteDto,
  type InvitePreviewDto,
  type LoginResult,
  type Role,
} from '@tuello/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { NoTenantTransaction, Public, RateLimit, RequirePermission } from '../../common/decorators';
import { afterCursorDesc, decodeCursor, toPage } from '../../common/pagination';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { ApiZodBody, ApiZodQuery, ZBody, ZodPipe, ZQuery } from '../../common/zod';
import { hashToken, newToken } from '../../infra/crypto';
import { QueueService } from '../../infra/queue.service';
import { DB } from '../../infra/tokens';
import { AuditService, EventsService } from '../events/events.service';
import { AuthService } from '../identity/auth.service';
import { LinksService } from '../identity/links.service';
import { SessionService } from '../identity/session.service';

const t = createTranslator('en');

function inviteStatus(i: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): InviteDto['status'] {
  if (i.acceptedAt) return 'accepted';
  if (i.revokedAt) return 'revoked';
  if (i.expiresAt.getTime() <= Date.now()) return 'expired';
  return 'pending';
}

@ApiTags('invites')
@Controller({ path: 'invites', version: '1' })
export class InvitesController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly links: LinksService,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  @RequirePermission('invites.manage')
  @RateLimit({ by: 'tenant', limit: 200, windowSec: 3600 })
  @ApiZodBody(createInviteSchema)
  async create(
    @ZBody(createInviteSchema) body: z.infer<typeof createInviteSchema>,
    @Req() req: TuelloRequest,
  ) {
    const actor = req.auth!;
    const tenant = req.tenant!;
    if (!assignableRoles(actor.role).includes(body.role))
      throw new Problem('forbidden', 'You cannot grant that role.');

    const existing = await this.db.system.findUserByEmail(body.email);
    if (existing) {
      const member = await this.db.tx.membership.findFirst({
        where: { userId: existing.id, deletedAt: null },
      });
      if (member) throw new Problem('conflict', 'This person is already a member.');
    }
    // A fresh invite replaces any pending one for the same address.
    await this.db.tx.invite.updateMany({
      where: { email: body.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const token = newToken();
    const invite = await this.db.tx.invite.create({
      data: {
        tenantId: tenant.id,
        email: body.email,
        role: body.role,
        tokenHash: hashToken(token),
        invitedByUserId: actor.userId,
        expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS.invite * 1000),
      },
    });
    await this.events.emit(
      'member.invited',
      { type: 'invite', id: invite.id },
      { email: body.email, role: body.role },
    );
    await this.audit.record(
      req,
      'member.invited',
      { type: 'invite', id: invite.id },
      { email: body.email, role: body.role },
    );
    this.queue.sendEmail({
      tenantId: tenant.id,
      template: 'invite',
      to: body.email,
      locale: 'en',
      vars: {
        inviter: actor.name,
        role: t(`role.${body.role}`),
        link: this.links.url(tenant.slug, `/invite/${token}`),
      },
    });
    return this.toDto({ ...invite, invitedBy: { id: actor.userId, name: actor.name } });
  }

  private toDto(i: {
    id: string;
    email: string;
    role: string;
    acceptedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
    createdAt: Date;
    invitedBy: { id: string; name: string } | null;
  }): InviteDto {
    return {
      id: i.id,
      email: i.email,
      role: i.role as Role,
      status: inviteStatus(i),
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
      invitedBy: i.invitedBy,
    };
  }

  @Get()
  @RequirePermission('invites.read')
  @ApiZodQuery(cursorPageQuerySchema)
  async list(@ZQuery(cursorPageQuerySchema) q: CursorPageQuery): Promise<CursorPage<InviteDto>> {
    const rows = await this.db.tx.invite.findMany({
      where: {
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        ...afterCursorDesc(decodeCursor(q.cursor)),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: { invitedBy: { select: { id: true, name: true } } },
    });
    return toPage(rows, q.limit, (i) => this.toDto(i));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('invites.manage')
  async revoke(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const result = await this.db.tx.invite.updateMany({
      where: { id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw new Problem('not_found');
    await this.events.emit('member.invite_revoked', { type: 'invite', id });
    await this.audit.record(req, 'member.invite_revoked', { type: 'invite', id });
  }

  // ------------------------------------------------------------ public: preview and accept

  private async findLive(token: string) {
    const invite = await this.db.tx.invite.findFirst({ where: { tokenHash: hashToken(token) } });
    if (!invite || inviteStatus(invite) !== 'pending') throw new Problem('invalid_token');
    return invite;
  }

  @Get('token/:token')
  @Public()
  @RateLimit({ by: 'ip', limit: 30, windowSec: 60 })
  async preview(
    @Param('token', new ZodPipe(z.string().min(20).max(200))) token: string,
    @Req() req: TuelloRequest,
  ): Promise<InvitePreviewDto> {
    const invite = await this.findLive(token);
    const existing = await this.db.system.findUserByEmail(invite.email);
    return {
      email: invite.email,
      role: invite.role as Role,
      tenantName: req.tenant!.name,
      existingUser: !!existing?.passwordHash,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  @Post('token/:token/accept')
  @HttpCode(200)
  @Public()
  @NoTenantTransaction()
  @RateLimit({ by: 'ip', limit: 20, windowSec: 60 })
  @ApiZodBody(acceptInviteSchema)
  async accept(
    @Param('token', new ZodPipe(z.string().min(20).max(200))) token: string,
    @ZBody(acceptInviteSchema) body: z.infer<typeof acceptInviteSchema>,
    @Req() req: TuelloRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const tenant = req.tenant!;
    const invite = await this.db.withTenant({ tenantId: tenant.id }, () => this.findLive(token));
    const existing = await this.db.system.findUserByEmail(invite.email);

    // Expensive hashing happens before the transaction opens.
    let newPasswordHash: string | null = null;
    if (existing?.passwordHash) {
      if (!(await verifyPassword(existing.passwordHash, body.password)))
        throw new Problem('invalid_credentials');
    } else {
      const pw = passwordSchema.safeParse(body.password);
      if (!pw.success) {
        throw new Problem('validation_failed', undefined, [
          { path: 'password', code: 'too_small', message: t('validation.password_min') },
        ]);
      }
      if (!existing && !personNameSchema.safeParse(body.name).success) {
        throw new Problem('validation_failed', undefined, [
          { path: 'name', code: 'required', message: t('validation.required') },
        ]);
      }
      newPasswordHash = await hashPassword(body.password);
    }

    return this.db.withTenant({ tenantId: tenant.id }, async (tx) => {
      // Re-check inside the transaction: single use under concurrency.
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Problem('invalid_token');

      const now = new Date();
      let userId: string;
      if (existing) {
        userId = existing.id;
        await this.db.setUser(userId);
        await tx.user.update({
          where: { id: userId },
          data: {
            emailVerifiedAt: existing.emailVerifiedAt ?? now,
            ...(newPasswordHash ? { passwordHash: newPasswordHash, passwordChangedAt: now } : {}),
          },
        });
      } else {
        userId = uuidv7();
        await this.db.setUser(userId);
        await tx.user.create({
          data: {
            id: userId,
            email: invite.email,
            name: body.name!.trim(),
            passwordHash: newPasswordHash,
            emailVerifiedAt: now,
          },
        });
      }

      const already = await tx.membership.findFirst({ where: { userId, deletedAt: null } });
      const membership =
        already ??
        (await tx.membership.create({ data: { tenantId: tenant.id, userId, role: invite.role } }));
      await this.events.emit(
        'member.joined',
        { type: 'membership', id: membership.id },
        { userId, role: membership.role, inviteId: invite.id },
      );
      await this.audit.record(
        req,
        'member.joined',
        { type: 'membership', id: membership.id },
        { role: membership.role, inviteId: invite.id },
        userId,
      );

      if (existing?.totpEnabled) return this.auth.issueMfaChallengeFor(tenant.id, userId);
      const { token: session, expiresAt } = await this.sessions.create(req, tenant.id, userId);
      this.sessions.setCookie(res, session, expiresAt);
      return { status: 'ok' as const };
    });
  }
}
