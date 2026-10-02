import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CSRF_COOKIE,
  handoffSchema,
  isReservedSlug,
  loginSchema,
  magicLinkConsumeSchema,
  magicLinkRequestSchema,
  mfaChallengeSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  resendVerificationSchema,
  signupSchema,
  slugAvailabilitySchema,
  slugSchema,
  verifyEmailSchema,
  type LoginResult,
} from '@tuello/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { HostScoped, NoTenantTransaction, Public, RateLimit } from '../../common/decorators';
import type { TuelloRequest } from '../../common/request';
import { ApiZodBody, ApiZodQuery, ZBody, ZQuery } from '../../common/zod';
import { SessionService } from './session.service';
import { AuthService } from './auth.service';
import { Inject } from '@nestjs/common';
import type { Database } from '@tuello/db';
import { DB } from '../../infra/tokens';

const resendSchema = resendVerificationSchema.extend({ slug: z.string().max(60).optional() });
const turnstile = z.object({ turnstileToken: z.string().max(4096).optional() });
const resetRequestSchema = passwordResetRequestSchema.extend(turnstile.shape);
const magicRequestSchema = magicLinkRequestSchema.extend(turnstile.shape);

const STRICT_IP = { by: 'ip', limit: 20, windowSec: 60 } as const;
const STRICT_EMAIL = { by: 'email', limit: 10, windowSec: 900 } as const;

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(DB) private readonly db: Database,
  ) {}

  /** Issues the double-submit CSRF cookie. Call once before the first state-changing request. */
  @Get('csrf')
  @Public()
  @HostScoped('any')
  @NoTenantTransaction()
  csrf(@Req() req: TuelloRequest, @Res({ passthrough: true }) res: Response) {
    const existing = (req.cookies as Record<string, string | undefined>)[CSRF_COOKIE];
    return { token: existing ?? this.sessions.issueCsrf(res) };
  }

  @Get('slug-availability')
  @Public()
  @HostScoped('apex')
  @RateLimit({ by: 'ip', limit: 120, windowSec: 60 })
  @ApiZodQuery(slugAvailabilitySchema)
  async slugAvailability(
    @ZQuery(slugAvailabilitySchema) q: z.infer<typeof slugAvailabilitySchema>,
  ) {
    const parsed = slugSchema.safeParse(q.slug);
    if (!parsed.success) {
      return {
        slug: q.slug,
        available: false,
        reason: isReservedSlug(q.slug) ? 'reserved' : 'invalid',
      };
    }
    const available = await this.db.system.slugAvailable(parsed.data);
    return { slug: parsed.data, available, reason: available ? null : 'taken' };
  }

  @Post('signup')
  @Public()
  @HostScoped('apex')
  @RateLimit({ by: 'ip', limit: 10, windowSec: 3600 })
  @ApiZodBody(signupSchema)
  signup(@ZBody(signupSchema) body: z.output<typeof signupSchema>, @Req() req: TuelloRequest) {
    return this.auth.signup(body, req);
  }

  @Post('verify-email/resend')
  @HttpCode(202)
  @Public()
  @HostScoped('any')
  @NoTenantTransaction()
  @RateLimit(STRICT_IP, { by: 'email', limit: 5, windowSec: 3600 })
  @ApiZodBody(resendSchema)
  async resend(@ZBody(resendSchema) body: z.infer<typeof resendSchema>, @Req() req: TuelloRequest) {
    await this.auth.resendVerification(body.email, req, body.slug);
    return { status: 'accepted' };
  }

  @Post('verify-email')
  @HttpCode(200)
  @Public()
  @RateLimit(STRICT_IP)
  @ApiZodBody(verifyEmailSchema)
  verifyEmail(
    @ZBody(verifyEmailSchema) body: z.infer<typeof verifyEmailSchema>,
    @Req() req: TuelloRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    return this.auth.verifyEmail(body.token, req, res);
  }

  @Post('login')
  @HttpCode(200)
  @Public()
  @NoTenantTransaction()
  @RateLimit(STRICT_IP, STRICT_EMAIL)
  @ApiZodBody(loginSchema)
  login(
    @ZBody(loginSchema) body: z.infer<typeof loginSchema>,
    @Req() req: TuelloRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    return this.auth.login(body.email, body.password, req, res);
  }

  @Post('mfa')
  @HttpCode(200)
  @Public()
  @NoTenantTransaction()
  @RateLimit(STRICT_IP)
  @ApiZodBody(mfaChallengeSchema)
  mfa(
    @ZBody(mfaChallengeSchema) body: z.infer<typeof mfaChallengeSchema>,
    @Req() req: TuelloRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    return this.auth.completeMfa(body.challengeToken, body.code, req, res);
  }

  @Post('logout')
  @HttpCode(204)
  @Public()
  async logout(@Req() req: TuelloRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req, res);
  }

  @Post('password-reset')
  @HttpCode(202)
  @Public()
  @RateLimit(STRICT_IP, { by: 'email', limit: 5, windowSec: 3600 })
  @ApiZodBody(resetRequestSchema)
  async requestReset(
    @ZBody(resetRequestSchema) body: z.infer<typeof resetRequestSchema>,
    @Req() req: TuelloRequest,
  ) {
    await this.auth.requestPasswordReset(body.email, req, body.turnstileToken);
    return { status: 'accepted' };
  }

  @Post('password-reset/confirm')
  @HttpCode(204)
  @Public()
  @NoTenantTransaction()
  @RateLimit(STRICT_IP)
  @ApiZodBody(passwordResetConfirmSchema)
  async confirmReset(
    @ZBody(passwordResetConfirmSchema) body: z.infer<typeof passwordResetConfirmSchema>,
    @Req() req: TuelloRequest,
  ) {
    await this.auth.confirmPasswordReset(body.token, body.password, req);
  }

  @Post('magic-link')
  @HttpCode(202)
  @Public()
  @RateLimit(STRICT_IP, { by: 'email', limit: 5, windowSec: 3600 })
  @ApiZodBody(magicRequestSchema)
  async requestMagic(
    @ZBody(magicRequestSchema) body: z.infer<typeof magicRequestSchema>,
    @Req() req: TuelloRequest,
  ) {
    await this.auth.requestMagicLink(body.email, req, body.turnstileToken);
    return { status: 'accepted' };
  }

  @Post('magic-link/consume')
  @HttpCode(200)
  @Public()
  @RateLimit(STRICT_IP)
  @ApiZodBody(magicLinkConsumeSchema)
  consumeMagic(
    @ZBody(magicLinkConsumeSchema) body: z.infer<typeof magicLinkConsumeSchema>,
    @Req() req: TuelloRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    return this.auth.consumeMagicLink(body.token, req, res);
  }

  @Post('handoff')
  @HttpCode(200)
  @Public()
  @RateLimit(STRICT_IP)
  @ApiZodBody(handoffSchema)
  handoff(
    @ZBody(handoffSchema) body: z.infer<typeof handoffSchema>,
    @Req() req: TuelloRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    return this.auth.consumeHandoff(body.token, req, res);
  }
}
