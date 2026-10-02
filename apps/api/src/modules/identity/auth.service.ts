import { Inject, Injectable } from '@nestjs/common';
import {
  burnPasswordCheck,
  ensureTenantDefaults,
  hashPassword,
  passwordNeedsRehash,
  Prisma,
  uuidv7,
  verifyPassword,
  type Database,
} from '@tuello/db';
import { TOKEN_TTL_SECONDS, type LoginResult } from '@tuello/shared';
import type { Response } from 'express';
import type Redis from 'ioredis';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env';
import { Problem } from '../../common/problem';
import { clientIp, type TuelloRequest } from '../../common/request';
import { BotCheckService } from '../../infra/bot-check.service';
import { decrypt, hashToken, newToken } from '../../infra/crypto';
import { QueueService } from '../../infra/queue.service';
import { DB, REDIS } from '../../infra/tokens';
import { verifyTotp } from '../../infra/totp';
import { AuditService, EventsService } from '../events/events.service';
import { TenantDirectory } from '../tenants/tenant-directory.service';
import { AuthTokensService } from './auth-tokens.service';
import { LinksService } from './links.service';
import { SessionService } from './session.service';
import type { signupSchema } from '@tuello/shared';

type SignupData = z.output<typeof signupSchema>;

interface MfaChallenge {
  tenantId: string;
  userId: string;
  attempts: number;
}

const MAX_MFA_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly sessions: SessionService,
    private readonly tokens: AuthTokensService,
    private readonly queue: QueueService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly links: LinksService,
    private readonly bot: BotCheckService,
    private readonly directory: TenantDirectory,
  ) {}

  // ---------------------------------------------------------------------------------- signup

  async signup(input: SignupData, req: TuelloRequest) {
    await this.bot.assertHuman(input.turnstileToken, clientIp(req));
    if (!(await this.db.system.slugAvailable(input.slug))) throw new Problem('slug_taken');
    if (await this.db.system.findUserByEmail(input.email)) throw new Problem('email_taken');

    const tenantId = uuidv7();
    const userId = uuidv7();
    const passwordHash = await hashPassword(input.password);

    try {
      await this.db.withTenant({ tenantId, userId }, async (tx) => {
        await tx.tenant.create({
          data: {
            id: tenantId,
            slug: input.slug,
            name: input.companyName,
            timeZone: input.timeZone,
            currency: input.currency,
            measurementUnit: input.measurementUnit,
          },
        });
        await tx.tenantBranding.create({ data: { tenantId, emailSenderName: input.companyName } });
        await ensureTenantDefaults(tx, tenantId, input.measurementUnit);
        await tx.user.create({
          data: { id: userId, email: input.email, name: input.name, passwordHash },
        });
        const membership = await tx.membership.create({
          data: { tenantId, userId, role: 'owner' },
        });
        const token = await this.tokens.issue(userId, 'verify_email');
        await this.events.emit(
          'tenant.created',
          { type: 'tenant', id: tenantId },
          { slug: input.slug },
        );
        await this.events.emit(
          'member.joined',
          { type: 'membership', id: membership.id },
          { userId, role: 'owner' },
        );
        await this.audit.record(
          req,
          'tenant.created',
          { type: 'tenant', id: tenantId },
          { slug: input.slug },
          userId,
        );
        this.queue.sendEmail({
          tenantId,
          template: 'verify_email',
          to: input.email,
          locale: 'en',
          vars: { name: input.name, link: this.links.url(input.slug, '/verify-email', { token }) },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = JSON.stringify(err.meta?.target ?? '');
        throw new Problem(target.includes('email') ? 'email_taken' : 'slug_taken');
      }
      throw err;
    }
    await this.directory.invalidateSlug(input.slug);
    return { slug: input.slug, email: input.email, loginUrl: this.links.url(input.slug, '/login') };
  }

  async resendVerification(email: string, req: TuelloRequest, slug?: string): Promise<void> {
    const tenant = req.tenant ?? (slug ? await this.directory.bySlug(slug) : null);
    const user = await this.db.system.findUserByEmail(email);
    if (!tenant || !user || user.emailVerifiedAt) return;
    await this.db.withTenant({ tenantId: tenant.id, userId: user.id }, async (tx) => {
      const member = await tx.membership.findFirst({ where: { userId: user.id, deletedAt: null } });
      if (!member) return;
      const token = await this.tokens.issue(user.id, 'verify_email');
      this.queue.sendEmail({
        tenantId: tenant.id,
        template: 'verify_email',
        to: email,
        locale: 'en',
        vars: { name: user.name, link: this.links.url(tenant.slug, '/verify-email', { token }) },
      });
    });
  }

  /** Runs inside the request's tenant transaction. Verifies and signs in (unless 2FA is on). */
  async verifyEmail(token: string, req: TuelloRequest, res: Response): Promise<LoginResult> {
    const tenant = req.tenant!;
    const userId = await this.tokens.consume(token, 'verify_email');
    if (!userId) throw new Problem('invalid_token');
    await this.db.setUser(userId);
    const user = await this.db.tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.emailVerifiedAt) {
      await this.db.tx.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date() },
      });
      await this.events.emit('user.email_verified', { type: 'user', id: userId });
    }
    return this.completeSignIn(req, res, tenant.id, userId, !!user.totpEnabledAt);
  }

  // ----------------------------------------------------------------------------------- login

  /** Manages its own transactions so the argon2 check does not hold a DB connection. */
  async login(
    email: string,
    password: string,
    req: TuelloRequest,
    res: Response,
  ): Promise<LoginResult> {
    const tenant = req.tenant!;
    const user = await this.db.system.findUserByEmail(email);
    if (!user || !user.passwordHash) {
      await burnPasswordCheck(password);
      throw new Problem('invalid_credentials');
    }
    if (!(await verifyPassword(user.passwordHash, password)))
      throw new Problem('invalid_credentials');
    const rehash = passwordNeedsRehash(user.passwordHash) ? await hashPassword(password) : null;

    return this.db.withTenant({ tenantId: tenant.id, userId: user.id }, async (tx) => {
      const member = await tx.membership.findFirst({
        where: { userId: user.id, deletedAt: null, status: 'active' },
      });
      // Same answer as a wrong password: do not reveal who belongs to which company.
      if (!member) throw new Problem('invalid_credentials');
      if (!user.emailVerifiedAt) throw new Problem('email_not_verified');
      if (tenant.status === 'suspended') throw new Problem('tenant_suspended');
      if (rehash) await tx.user.update({ where: { id: user.id }, data: { passwordHash: rehash } });
      return this.completeSignIn(req, res, tenant.id, user.id, user.totpEnabled);
    });
  }

  async issueMfaChallengeFor(tenantId: string, userId: string): Promise<LoginResult> {
    const challengeToken = newToken();
    const challenge: MfaChallenge = { tenantId, userId, attempts: 0 };
    await this.redis.set(
      `mfa:${hashToken(challengeToken)}`,
      JSON.stringify(challenge),
      'EX',
      TOKEN_TTL_SECONDS.mfa_challenge,
    );
    return { status: 'mfa_required', challengeToken };
  }

  /** Inside a tenant transaction: either a session cookie, or a second-factor challenge. */
  private async completeSignIn(
    req: TuelloRequest,
    res: Response,
    tenantId: string,
    userId: string,
    totpEnabled: boolean,
  ): Promise<LoginResult> {
    if (totpEnabled) return this.issueMfaChallengeFor(tenantId, userId);
    const { token, expiresAt } = await this.sessions.create(req, tenantId, userId);
    this.sessions.setCookie(res, token, expiresAt);
    return { status: 'ok' };
  }

  async completeMfa(
    challengeToken: string,
    code: string,
    req: TuelloRequest,
    res: Response,
  ): Promise<LoginResult> {
    const tenant = req.tenant!;
    const key = `mfa:${hashToken(challengeToken)}`;
    const raw = await this.redis.get(key);
    if (!raw) throw new Problem('invalid_token');
    const challenge = JSON.parse(raw) as MfaChallenge;
    if (challenge.tenantId !== tenant.id) throw new Problem('invalid_token');
    if (challenge.attempts >= MAX_MFA_ATTEMPTS) {
      await this.redis.del(key);
      throw new Problem('invalid_token');
    }

    return this.db.withTenant({ tenantId: tenant.id, userId: challenge.userId }, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: challenge.userId } });
      const step = user.totpSecret
        ? verifyTotp(decrypt(user.totpSecret, this.env.ENCRYPTION_KEY), code)
        : null;
      // Each code works once (replay protection across all API instances).
      const fresh =
        step !== null &&
        (await this.redis.set(`totp-used:${user.id}:${step}`, '1', 'EX', 120, 'NX'));
      if (!fresh) {
        await this.redis.set(
          key,
          JSON.stringify({ ...challenge, attempts: challenge.attempts + 1 }),
          'KEEPTTL',
        );
        throw new Problem('invalid_credentials', 'Invalid code.');
      }
      await this.redis.del(key);
      const { token, expiresAt } = await this.sessions.create(req, tenant.id, user.id);
      this.sessions.setCookie(res, token, expiresAt);
      return { status: 'ok' as const };
    });
  }

  async logout(req: TuelloRequest, res: Response): Promise<void> {
    if (req.auth) await this.sessions.revoke({ id: req.auth.sessionId });
    this.sessions.clearCookie(res);
  }

  // ------------------------------------------------------------------ password reset, magic link

  private async memberByEmail(email: string) {
    const user = await this.db.system.findUserByEmail(email);
    if (!user) return null;
    await this.db.setUser(user.id);
    const member = await this.db.tx.membership.findFirst({
      where: { userId: user.id, deletedAt: null, status: 'active' },
    });
    return member ? user : null;
  }

  /** Always succeeds from the caller's point of view (no account enumeration). */
  async requestPasswordReset(
    email: string,
    req: TuelloRequest,
    turnstileToken?: string,
  ): Promise<void> {
    await this.bot.assertHuman(turnstileToken, clientIp(req));
    const user = await this.memberByEmail(email);
    if (!user) return;
    const token = await this.tokens.issue(user.id, 'reset_password');
    this.queue.sendEmail({
      tenantId: req.tenant!.id,
      template: 'reset_password',
      to: email,
      locale: 'en',
      vars: {
        name: user.name,
        email,
        link: this.links.url(req.tenant!.slug, '/reset-password', { token }),
      },
    });
  }

  async confirmPasswordReset(token: string, password: string, req: TuelloRequest): Promise<void> {
    const tenant = req.tenant!;
    const passwordHash = await hashPassword(password);
    await this.db.withTenant({ tenantId: tenant.id }, async (tx) => {
      const userId = await this.tokens.consume(token, 'reset_password');
      if (!userId) throw new Problem('invalid_token');
      await this.db.setUser(userId);
      const now = new Date();
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      await tx.user.update({
        where: { id: userId },
        // The link proves control of the inbox, so it also verifies the address.
        data: {
          passwordHash,
          passwordChangedAt: now,
          emailVerifiedAt: user.emailVerifiedAt ?? now,
        },
      });
      await this.sessions.revoke({ userId });
      await this.audit.record(req, 'user.password_reset', { type: 'user', id: userId }, {}, userId);
    });
  }

  async requestMagicLink(
    email: string,
    req: TuelloRequest,
    turnstileToken?: string,
  ): Promise<void> {
    await this.bot.assertHuman(turnstileToken, clientIp(req));
    const user = await this.memberByEmail(email);
    if (!user) return;
    const token = await this.tokens.issue(user.id, 'magic_link');
    this.queue.sendEmail({
      tenantId: req.tenant!.id,
      template: 'magic_link',
      to: email,
      locale: 'en',
      vars: { name: user.name, link: this.links.url(req.tenant!.slug, '/magic', { token }) },
    });
  }

  async consumeMagicLink(token: string, req: TuelloRequest, res: Response): Promise<LoginResult> {
    const userId = await this.tokens.consume(token, 'magic_link');
    if (!userId) throw new Problem('invalid_token');
    await this.db.setUser(userId);
    const member = await this.db.tx.membership.findFirst({
      where: { userId, deletedAt: null, status: 'active' },
    });
    if (!member) throw new Problem('invalid_token');
    const user = await this.db.tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.emailVerifiedAt) {
      await this.db.tx.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date() },
      });
      await this.events.emit('user.email_verified', { type: 'user', id: userId });
    }
    return this.completeSignIn(req, res, req.tenant!.id, userId, !!user.totpEnabledAt);
  }

  // ------------------------------------------------------------------------------- handoff

  /** One-time, 60-second token that carries a signed-in user to another host of the same tenant. */
  async issueHandoff(tenantId: string, userId: string): Promise<string> {
    const token = newToken();
    await this.redis.set(
      `handoff:${hashToken(token)}`,
      JSON.stringify({ tenantId, userId }),
      'EX',
      TOKEN_TTL_SECONDS.handoff,
    );
    return token;
  }

  async consumeHandoff(token: string, req: TuelloRequest, res: Response): Promise<LoginResult> {
    const raw = await this.redis.getdel(`handoff:${hashToken(token)}`);
    if (!raw) throw new Problem('invalid_token');
    const { tenantId, userId } = JSON.parse(raw) as { tenantId: string; userId: string };
    if (tenantId !== req.tenant!.id) throw new Problem('invalid_token');
    await this.db.setUser(userId);
    const member = await this.db.tx.membership.findFirst({
      where: { userId, deletedAt: null, status: 'active' },
    });
    if (!member) throw new Problem('invalid_token');
    const { token: session, expiresAt } = await this.sessions.create(req, tenantId, userId);
    this.sessions.setCookie(res, session, expiresAt);
    return { status: 'ok' };
  }
}
